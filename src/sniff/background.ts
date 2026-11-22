/**
 * 资源嗅探的后台部分。
 *
 * 按需嗅探：只有在用户点了侧边“嗅探”按钮（或弹窗里的“开始嗅探”）的标签页上才记录媒体请求，
 * 其他标签页、没开功能时一个请求都不看。点开始时还会补抓页面里已经加载过的媒体（页面的 performance 记录、video 标签）。
 * 列表放在 storage.session（浏览器关掉就没了，不落盘）。
 * 分片下载、合并在离屏文档（offscreen.ts）里跑；单文件直接交给 chrome.downloads。
 */
import { detect, headerValue, hostOf, isYouTubeHost, totalSize, type MediaKind } from './detect';
import { SNIFF_KEY, loadSniff, normalizeSniff, renderFilename, type SniffSettings } from './settings';
import type { FromOffscreen, Job, OffscreenMsg, Task } from './jobs';
import { biliInfo, isBiliPage, pickAudio, type SiteState } from './site';
import type { SiteAction } from './site-ui';
import type { BiliMedia, BiliPart } from './bili/api';
import type { BiliStreams } from './bili/parse';
import { pickTrack, toSrt } from './bili/parse';

declare const __DRAK_STORE__: boolean;

export interface SniffItem {
  url: string;
  kind: MediaKind;
  ext: string;
  size?: number;
  /** 网络请求还是页面里扫到的 */
  from: 'net' | 'page';
  time: number;
}

export interface TabState {
  items: SniffItem[];
  drm: boolean;
  pageUrl: string;
  /** 站点适配器（B 站）的结果 */
  site?: SiteState;
}

export interface SniffState {
  enabled: boolean;
  supported: boolean;
  active: boolean;
  drm: boolean;
  items: SniffItem[];
  tasks: Task[];
  canDownload: boolean;
  site?: SiteState;
}

const MAX_ITEMS = 200;
const ACTIVE_KEY = 'sniff-active';
const TASKS_KEY = 'sniff-tasks';
const tabKey = (id: number) => `sniff-tab-${id}`;

let settings: SniffSettings | null = null;
const active = new Set<number>();
const tabs = new Map<number, TabState>();
let tasks: Task[] = [];
const ready = (async () => {
  settings = await loadSniff();
  const s = await chrome.storage.session.get([ACTIVE_KEY, TASKS_KEY]);
  for (const id of (s[ACTIVE_KEY] as number[] | undefined) ?? []) active.add(id);
  tasks = (s[TASKS_KEY] as Task[] | undefined) ?? [];
  // Service Worker 重启时，没跑完的任务已经跟着离屏文档没了
  for (const t of tasks) if (!['done', 'error', 'canceled'].includes(t.stage)) Object.assign(t, { stage: 'error', error: '扩展重启，任务中断' });
  if (active.size && settings.enabled) listen(true);
})();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[SNIFF_KEY]) return;
  settings = normalizeSniff(changes[SNIFF_KEY].newValue);
  if (!settings.enabled) for (const id of [...active]) void stop(id);
});

/** 商店版不对 YouTube 做任何嗅探（应用商店政策） */
function blockedHost(host: string): boolean {
  return isYouTubeHost(host) && (__DRAK_STORE__ || !settings?.youtube.enabled);
}

const supportedUrl = (url: string | undefined) => !!url && /^https?:/.test(url) && !blockedHost(hostOf(url));

// ---- 每个标签页的列表 ----

async function tabState(id: number): Promise<TabState> {
  let t = tabs.get(id);
  if (!t) {
    t = ((await chrome.storage.session.get(tabKey(id)))[tabKey(id)] as TabState | undefined) ?? { items: [], drm: false, pageUrl: '' };
    tabs.set(id, t);
  }
  return t;
}

const saveTimers = new Map<number, number>();
function persist(id: number): void {
  clearTimeout(saveTimers.get(id));
  saveTimers.set(id, setTimeout(() => {
    saveTimers.delete(id);
    const t = tabs.get(id);
    if (t) void chrome.storage.session.set({ [tabKey(id)]: t });
    void badge(id);
    void notifyTab(id);
  }, 150) as unknown as number);
}

async function badge(id: number): Promise<void> {
  const n = active.has(id) ? (tabs.get(id)?.items.length ?? 0) : 0;
  try {
    await chrome.action.setBadgeText({ tabId: id, text: n ? String(Math.min(n, 99)) : '' });
    if (n) await chrome.action.setBadgeBackgroundColor({ tabId: id, color: '#5c5c5c' });
  } catch {
    /* 标签页已关 */
  }
}

/** 告诉页面里的侧边按钮：是否在嗅探、找到几个 */
async function notifyTab(id: number): Promise<void> {
  const t = tabs.get(id);
  await chrome.tabs.sendMessage(id, { type: 'sniff:update', active: active.has(id), count: t?.items.length ?? 0, drm: !!t?.drm }, { frameId: 0 }).catch(() => {});
}

async function addItem(id: number, item: Omit<SniffItem, 'time'>): Promise<void> {
  const t = await tabState(id);
  const old = t.items.find((x) => x.url === item.url);
  if (old) {
    // 页面扫到的没有大小，网络请求补上
    if (item.size && !old.size) {
      old.size = item.size;
      persist(id);
    }
    return;
  }
  t.items.unshift({ ...item, time: Date.now() });
  if (t.items.length > MAX_ITEMS) t.items.length = MAX_ITEMS;
  persist(id);
}

// ---- 网络请求 ----

function onHeaders(d: chrome.webRequest.WebResponseHeadersDetails): void {
  if (d.tabId < 0 || !active.has(d.tabId) || !settings?.enabled) return;
  if (d.statusCode >= 400 || blockedHost(hostOf(d.url))) return;
  const size = totalSize(d.responseHeaders, d.statusCode);
  const hit = detect(d.url, headerValue(d.responseHeaders, 'content-type'), size, { types: settings.types, minBytes: settings.minSizeKB * 1024 });
  if (hit) void addItem(d.tabId, { url: d.url, kind: hit.kind, ext: hit.ext, size, from: 'net' });
}

let listening = false;
/** 只有在有标签页在嗅探时才挂监听，平时浏览器的请求一个都不经过这里 */
function listen(on: boolean): void {
  if (on === listening || !chrome.webRequest) return;
  listening = on;
  if (on) {
    chrome.webRequest.onHeadersReceived.addListener(onHeaders, { urls: ['http://*/*', 'https://*/*'], types: ['media', 'xmlhttprequest', 'other', 'object', 'image'] }, ['responseHeaders']);
  } else chrome.webRequest.onHeadersReceived.removeListener(onHeaders);
}

// ---- 开始 / 停止 ----

async function saveActive(): Promise<void> {
  await chrome.storage.session.set({ [ACTIVE_KEY]: [...active] });
  listen(active.size > 0);
}

/** 页面里已经加载过的媒体：performance 记录 + video / audio 标签，在页面里执行 */
function pageScan(): { urls: string[]; drm: boolean } {
  const urls = new Set<string>();
  for (const e of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) urls.add(e.name);
  for (const el of document.querySelectorAll<HTMLMediaElement | HTMLSourceElement>('video, audio, source')) {
    const src = (el as HTMLMediaElement).currentSrc || el.src;
    if (src) urls.add(src);
  }
  return { urls: [...urls].filter((u) => /^https?:/.test(u)), drm: false };
}

/** DRM：播放器挂了 MediaKeys 就是加密内容。要在页面自己的环境里看 */
function pageDrm(): boolean {
  return [...document.querySelectorAll('video, audio')].some((v) => !!(v as HTMLMediaElement).mediaKeys);
}

async function scan(id: number): Promise<void> {
  const s = settings!;
  const opt = { types: s.types, minBytes: s.minSizeKB * 1024 };
  try {
    const [res, drm] = await Promise.all([
      chrome.scripting.executeScript({ target: { tabId: id, allFrames: true }, func: pageScan }),
      chrome.scripting.executeScript({ target: { tabId: id, allFrames: true }, func: pageDrm, world: 'MAIN' }),
    ]);
    const t = await tabState(id);
    if (drm.some((r) => r.result)) {
      t.drm = true;
      persist(id);
    }
    for (const r of res) {
      for (const url of r.result?.urls ?? []) {
        if (blockedHost(hostOf(url))) continue;
        // 只看扩展名（页面里拿不到类型和大小）；没有扩展名的直链靠之后的网络请求补
        const hit = detect(url, '', undefined, opt);
        if (hit && hit.ext !== 'm4s' && hit.kind !== 'image') await addItem(id, { url, kind: hit.kind, ext: hit.ext, from: 'page' });
      }
    }
  } catch {
    /* 页面不允许注入（商店页、PDF 等） */
  }
}

async function start(id: number): Promise<SniffState> {
  await ready;
  const tab = await chrome.tabs.get(id).catch(() => null);
  if (!settings?.enabled || !tab || !supportedUrl(tab.url)) return state(id);
  active.add(id);
  const t = await tabState(id);
  if (t.pageUrl !== tab.url) Object.assign(t, { items: [], drm: false, pageUrl: tab.url, site: undefined });
  await saveActive();
  await scan(id);
  void siteScan(id, tab.url!);
  persist(id);
  return state(id);
}

async function stop(id: number): Promise<void> {
  active.delete(id);
  tabs.delete(id);
  media.delete(id);
  await chrome.storage.session.remove(tabKey(id));
  await saveActive();
  await badge(id);
  await notifyTab(id);
}

chrome.tabs.onRemoved.addListener((id) => {
  if (!active.has(id) && !tabs.has(id)) return;
  active.delete(id);
  tabs.delete(id);
  media.delete(id);
  void chrome.storage.session.remove(tabKey(id));
  void saveActive();
});

// 换了页面就清空列表（嗅探保持开着，刷新页面能抓到从头开始加载的请求）
chrome.tabs.onUpdated.addListener(async (id, info, tab) => {
  if (!active.has(id)) return;
  if (info.url) {
    if (!supportedUrl(info.url)) return void stop(id);
    const t = await tabState(id);
    if (t.pageUrl !== info.url) {
      Object.assign(t, { items: [], drm: false, pageUrl: info.url, site: undefined });
      persist(id);
      // B 站切分 P、换视频是单页应用内跳转，不会再触发 complete
      void siteScan(id, info.url);
    }
  }
  if (info.status === 'complete' && tab.url) void scan(id).then(() => notifyTab(id));
});

async function state(id: number | undefined): Promise<SniffState> {
  await ready;
  const tab = id !== undefined ? await chrome.tabs.get(id).catch(() => null) : null;
  const t = id !== undefined && active.has(id) ? await tabState(id) : null;
  return {
    enabled: !!settings?.enabled,
    supported: supportedUrl(tab?.url),
    active: id !== undefined && active.has(id),
    drm: !!t?.drm,
    items: t?.items ?? [],
    site: t?.site,
    tasks,
    canDownload: await chrome.permissions.contains({ permissions: ['downloads'] }),
  };
}

// ---- 站点适配（B 站） ----

/** 完整的 B 站结果只留在内存里（含播放地址），给界面的是摘要 */
const media = new Map<number, { url: string; m: BiliMedia; at: number }>();

/** 在页面隔离环境里调用 sniff-bili.js 挂的函数 */
async function inBili<T>(id: number, fn: string, ...args: unknown[]): Promise<T> {
  await chrome.scripting.executeScript({ target: { tabId: id }, files: ['sniff-bili.js'] });
  const [r] = await chrome.scripting.executeScript({
    target: { tabId: id },
    func: async (name: string, a: unknown[]) => {
      try {
        const api = (globalThis as unknown as { __drakBili: Record<string, (...x: unknown[]) => Promise<unknown>> }).__drakBili;
        return { ok: true, v: await api[name](...a) };
      } catch (e) {
        return { ok: false, e: e instanceof Error ? e.message : String(e) };
      }
    },
    args: [fn, args],
  });
  const res = r?.result as { ok: boolean; v?: T; e?: string } | undefined;
  if (!res?.ok) throw new Error(res?.e ?? '页面没有响应');
  return res.v as T;
}

const scanning = new Map<number, string>();
async function siteScan(id: number, url: string): Promise<void> {
  if (!settings?.bili.enabled || !isBiliPage(url) || scanning.get(id) === url) return;
  scanning.set(id, url);
  const t = await tabState(id);
  t.site = { loading: true };
  persist(id);
  try {
    // 页面刚开始跳转时脚本还注入不进去，稍等一下
    let m: BiliMedia | null = null;
    for (let i = 0; i < 3 && !m; i++) {
      try {
        m = await inBili<BiliMedia | null>(id, 'resolve', url);
      } catch (e) {
        if (i === 2) throw e;
        await new Promise((r) => setTimeout(r, 800));
      }
    }
    if (!m) throw new Error('不是视频页面');
    const part = m.parts[m.current];
    const subs = await inBili<{ lang: string; label: string; url: string }[]>(id, 'subtitles', part).catch(() => []);
    if (t.pageUrl !== url || !active.has(id)) return;
    media.set(id, { url, m, at: Date.now() });
    t.site = { info: biliInfo(m, settings.bili.codec, subs) };
  } catch (e) {
    if (t.pageUrl === url) t.site = { error: e instanceof Error ? e.message : String(e) };
  } finally {
    scanning.delete(id);
    persist(id);
  }
}

async function biliStreams(id: number, part: BiliPart): Promise<BiliStreams> {
  const c = media.get(id);
  const cur = c?.m.parts[c.m.current];
  // 播放地址有时效，超过 20 分钟重新取
  if (c && cur?.cid === part.cid && Date.now() - c.at < 20 * 60_000) return c.m.streams;
  return inBili<BiliStreams>(id, 'streamsFor', part);
}

async function siteDownload(tabId: number, a: SiteAction): Promise<{ ok: boolean; error?: string }> {
  await ready;
  if (!(await chrome.permissions.contains({ permissions: ['downloads'] }))) return { ok: false, error: '需要先在弹窗里授权“管理下载内容”' };
  if (!media.has(tabId)) {
    // 后台被浏览器回收过，内存里的结果没了：重新取一次
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab?.url && active.has(tabId)) await siteScan(tabId, tab.url);
  }
  const c = media.get(tabId);
  if (!c) return { ok: false, error: '视频信息已过期，请重新嗅探' };
  const m = c.m;
  const part = m.parts.find((p) => p.index === a.part) ?? m.parts[m.current];
  const vars = { 标题: m.title, 分P: m.parts.length > 1 ? [m.kind === 'bangumi' ? `第${part.index}集` : `P${part.index}`, part.title].filter(Boolean).join(' ') : undefined, UP主: m.owner };
  try {
    if (a.what === 'cover') {
      if (!m.cover) throw new Error('没有封面');
      await saveAs(m.cover, `${renderFilename(settings!.filename, vars)}.${/\.png(\?|$)/i.test(m.cover) ? 'png' : 'jpg'}`);
      return { ok: true };
    }
    if (a.what === 'danmaku') {
      await saveAs(`https://comment.bilibili.com/${part.cid}.xml`, `${renderFilename(settings!.filename, vars)}.danmaku.xml`);
      return { ok: true };
    }
    if (a.what === 'subtitle') {
      const subs = await inBili<{ lang: string; url: string }[]>(tabId, 'subtitles', part);
      const sub = subs.find((x) => x.lang === a.lang);
      if (!sub) throw new Error('这一集没有这个字幕');
      const body = await inBili<{ from: number; to: number; content: string }[]>(tabId, 'subtitleBody', sub.url);
      await saveAs(`data:application/x-subrip;charset=utf-8,${encodeURIComponent(toSrt(body))}`, `${renderFilename(settings!.filename, vars)}.${a.lang}.srt`);
      return { ok: true };
    }
    const streams = await biliStreams(tabId, part);
    if (streams.drm) throw new Error('加密内容（DRM），无法下载');
    const q = streams.qualities.find((x) => x.qn === a.qn && x.available) ?? streams.qualities.find((x) => x.available);
    const v = q && pickTrack(q, settings!.bili.codec);
    if (!q || !v) throw new Error('当前账号没有可下载的清晰度');
    const audio = pickAudio({ streams });
    const name = renderFilename(settings!.filename, { ...vars, 清晰度: q.label });
    const id = newTaskId();
    const t: Task = { id, tabId, name, stage: 'queued', done: 0, total: 0, bytes: 0, speed: 0, started: Date.now() };
    tasks.unshift(t);
    tasks = tasks.slice(0, 30);
    referers.set(id, 'https://www.bilibili.com/');
    saveTasks();
    await ensureOffscreen();
    const job: Job = { id, kind: 'tracks', url: v.track.url, tracks: [v.track.url, ...(audio ? [audio.url] : [])], backups: [v.track.backup, audio?.backup ?? []], name, concurrency: settings!.concurrency };
    await toOffscreen({ target: 'sniff-offscreen', type: 'run', job });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const newTaskId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ---- 下载任务 ----

let tasksTimer = 0;
function saveTasks(): void {
  clearTimeout(tasksTimer);
  tasksTimer = setTimeout(() => void chrome.storage.session.set({ [TASKS_KEY]: tasks }), 200) as unknown as number;
}

const task = (id: string) => tasks.find((t) => t.id === id);

let offscreenReady: Promise<void> | null = null;
async function ensureOffscreen(): Promise<void> {
  const has = (await chrome.runtime.getContexts?.({ contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType] }))?.length;
  if (has) return;
  offscreenReady ??= chrome.offscreen
    .createDocument({ url: 'sniff-offscreen.html', reasons: ['BLOBS' as chrome.offscreen.Reason], justification: '下载视频分片并合并成一个文件' })
    .finally(() => (offscreenReady = null));
  await offscreenReady;
}

function toOffscreen(msg: OffscreenMsg): Promise<unknown> {
  return chrome.runtime.sendMessage(msg).catch(() => undefined);
}

/** 分片请求补上原页面的 Referer：只针对扩展自己（不属于任何标签页）发出的请求，任务结束就撤掉 */
const ruleIds = new Map<string, number>();
const ruleHosts = new Map<string, Set<string>>();
const referers = new Map<string, string>();
let nextRule = 1;

async function allowHosts(taskId: string, hosts: string[]): Promise<void> {
  const referer = referers.get(taskId);
  if (!referer || !chrome.declarativeNetRequest) return;
  const set = ruleHosts.get(taskId) ?? new Set<string>();
  const before = set.size;
  hosts.forEach((h) => set.add(h));
  ruleHosts.set(taskId, set);
  if (set.size === before && ruleIds.has(taskId)) return;
  const old = ruleIds.get(taskId);
  const id = old ?? nextRule++;
  ruleIds.set(taskId, id);
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: old ? [old] : [],
    addRules: [
      {
        id,
        priority: 1,
        action: {
          type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType,
          // Origin 也换成页面的：有的 CDN（如 B 站）看到 chrome-extension:// 来源直接拒绝
          requestHeaders: [
            { header: 'referer', operation: 'set' as chrome.declarativeNetRequest.HeaderOperation, value: referer },
            { header: 'origin', operation: 'set' as chrome.declarativeNetRequest.HeaderOperation, value: new URL(referer).origin },
          ],
        },
        condition: {
          requestDomains: [...set],
          tabIds: [chrome.tabs.TAB_ID_NONE],
          resourceTypes: ['xmlhttprequest', 'media', 'other'] as chrome.declarativeNetRequest.ResourceType[],
        },
      },
    ],
  });
}

async function dropRule(taskId: string): Promise<void> {
  const id = ruleIds.get(taskId);
  ruleIds.delete(taskId);
  ruleHosts.delete(taskId);
  referers.delete(taskId);
  if (id && chrome.declarativeNetRequest) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [id] }).catch(() => {});
}

function finish(t: Task, patch: Partial<Task>): void {
  Object.assign(t, patch, { finished: Date.now() });
  void dropRule(t.id);
  saveTasks();
}

/** 去掉地址里的查询参数后的文件名，作为没有标题时的兜底 */
function urlName(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '').replace(/\.[a-z0-9]{2,5}$/i, '');
  } catch {
    return '';
  }
}

async function download(tabId: number, url: string): Promise<{ ok: boolean; error?: string }> {
  await ready;
  if (!(await chrome.permissions.contains({ permissions: ['downloads'] }))) return { ok: false, error: '需要先在弹窗里授权“管理下载内容”' };
  const t = await tabState(tabId);
  const item = t.items.find((x) => x.url === url);
  if (!item) return { ok: false, error: '找不到这个资源，请重新嗅探' };
  if (t.drm && (item.kind === 'hls' || item.kind === 'dash')) return { ok: false, error: '加密内容（DRM），无法下载' };
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const title = (tab?.title ?? '').replace(/[-_|–—]\s*(哔哩哔哩|bilibili).*$/i, '').trim();
  const name = renderFilename(settings!.filename, { 标题: title || urlName(url) || 'video' });
  const id = newTaskId();
  const task: Task = { id, tabId, name, stage: 'queued', done: 0, total: 0, bytes: 0, speed: 0, started: Date.now() };
  tasks.unshift(task);
  tasks = tasks.slice(0, 30);
  if (tab?.url) referers.set(id, tab.url);

  if (item.kind === 'hls' || item.kind === 'dash') {
    saveTasks();
    await ensureOffscreen();
    const job: Job = { id, kind: item.kind, url, name, concurrency: settings!.concurrency };
    await toOffscreen({ target: 'sniff-offscreen', type: 'run', job });
    return { ok: true };
  }
  // 单个文件：浏览器自己下载，有进度和断点续传
  await allowHosts(id, [hostOf(url)]);
  task.file = `${name}.${item.ext === 'm4s' ? 'mp4' : item.ext}`;
  task.stage = 'download';
  saveTasks();
  try {
    const r = await saveAs(url, task.file);
    Object.assign(task, { downloadId: r.id, file: r.file });
    saveTasks();
    return { ok: true };
  } catch (e) {
    finish(task, { stage: 'error', error: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: task.error };
  }
}

async function cancel(id: string): Promise<void> {
  const t = task(id);
  if (!t || ['done', 'error', 'canceled'].includes(t.stage)) return;
  if (t.downloadId !== undefined && t.stage === 'download') await chrome.downloads?.cancel(t.downloadId).catch(() => {});
  else await toOffscreen({ target: 'sniff-offscreen', type: 'cancel', id });
  finish(t, { stage: 'canceled' });
}

/** 离屏文档发来的进度和结果 */
async function fromOffscreen(msg: FromOffscreen): Promise<unknown> {
  const t = task(msg.id);
  if (!t) return;
  if (msg.type === 'sniff:hosts') return allowHosts(msg.id, msg.hosts);
  if (t.stage === 'canceled') return;
  if (msg.type === 'sniff:progress') {
    const dt = (Date.now() - t.started) / 1000;
    Object.assign(t, { stage: msg.stage, done: msg.done, total: msg.total, bytes: msg.bytes, speed: dt > 0 ? msg.bytes / dt : 0 });
    saveTasks();
  } else if (msg.type === 'sniff:error') {
    finish(t, { stage: msg.canceled ? 'canceled' : 'error', error: msg.canceled ? undefined : msg.error });
  } else if (msg.type === 'sniff:save') {
    t.stage = 'save';
    t.note = msg.note;
    saveTasks();
    try {
      for (const f of msg.files) {
        const { id: dl, file } = await saveAs(f.url, `${t.name}${f.suffix ?? ''}.${f.ext}`);
        blobDownloads.set(dl, f.url);
        t.file ??= file;
        t.downloadId ??= dl;
      }
    } catch (e) {
      finish(t, { stage: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  }
}

/** 交给浏览器下载；个别系统环境（非 UTF-8 的 Linux 区域设置）不接受中文文件名，退回英文名再试一次 */
async function saveAs(url: string, file: string): Promise<{ id: number; file: string }> {
  try {
    return { id: await chrome.downloads.download({ url, filename: `Drak/${file}`, conflictAction: 'uniquify' }), file };
  } catch (e) {
    if (!/filename/i.test(String(e))) throw e;
    const ascii = `video-${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}${file.slice(file.lastIndexOf('.'))}`;
    return { id: await chrome.downloads.download({ url, filename: `Drak/${ascii}`, conflictAction: 'uniquify' }), file: ascii };
  }
}

/** 下载完（或失败）后释放离屏文档里的 Blob */
const blobDownloads = new Map<number, string>();

chrome.downloads?.onChanged.addListener((d) => {
  const state = d.state?.current;
  if (!state || state === 'in_progress') return;
  const blob = blobDownloads.get(d.id);
  if (blob) {
    blobDownloads.delete(d.id);
    void toOffscreen({ target: 'sniff-offscreen', type: 'revoke', url: blob });
  }
  const t = tasks.find((x) => x.downloadId === d.id);
  if (!t || ['done', 'error', 'canceled'].includes(t.stage)) return;
  if (state === 'complete') finish(t, { stage: 'done' });
  else finish(t, { stage: d.error?.current === 'USER_CANCELED' ? 'canceled' : 'error', error: d.error?.current });
});

// 单文件下载的进度：浏览器下载管理器自己有，这里每秒同步一次给弹窗看
setInterval(async () => {
  const live = tasks.filter((t) => t.stage === 'download' && t.downloadId !== undefined);
  if (!live.length || !chrome.downloads) return;
  for (const t of live) {
    const [d] = await chrome.downloads.search({ id: t.downloadId });
    if (!d) continue;
    const dt = (Date.now() - t.started) / 1000;
    Object.assign(t, { bytes: d.bytesReceived, total: d.totalBytes > 0 ? d.totalBytes : 0, done: d.bytesReceived, speed: dt > 0 ? d.bytesReceived / dt : 0 });
  }
  saveTasks();
}, 1000);

// ---- 消息 ----

type Msg =
  | { type: 'sniff:start'; tabId?: number }
  | { type: 'sniff:stop'; tabId?: number }
  | { type: 'sniff:state'; tabId?: number }
  | { type: 'sniff:download'; tabId?: number; url: string }
  | { type: 'sniff:site'; tabId?: number; action: SiteAction }
  | { type: 'sniff:cancel'; id: string }
  | { type: 'sniff:clear' }
  | { type: 'sniff:show'; id: string };

chrome.runtime.onMessage.addListener((msg: Msg | FromOffscreen, sender, reply) => {
  const type = (msg as { type?: string })?.type;
  if (!type?.startsWith('sniff:')) return false;
  const tabId = (msg as { tabId?: number }).tabId ?? sender.tab?.id;
  const done = (p: Promise<unknown>) => {
    p.then(reply, (e) => reply({ ok: false, error: String(e) }));
    return true;
  };
  switch (type) {
    case 'sniff:start':
      return tabId === undefined ? false : done(start(tabId));
    case 'sniff:stop':
      return tabId === undefined ? false : done(stop(tabId).then(() => state(tabId)));
    case 'sniff:state':
      return done(state(tabId));
    case 'sniff:download':
      return tabId === undefined ? false : done(download(tabId, (msg as { url: string }).url));
    case 'sniff:site':
      return tabId === undefined ? false : done(siteDownload(tabId, (msg as { action: SiteAction }).action));
    case 'sniff:cancel':
      return done(cancel((msg as { id: string }).id));
    case 'sniff:clear':
      tasks = tasks.filter((t) => !['done', 'error', 'canceled'].includes(t.stage));
      saveTasks();
      return done(Promise.resolve({ ok: true }));
    case 'sniff:show': {
      const t = task((msg as { id: string }).id);
      if (t?.downloadId !== undefined) chrome.downloads?.show(t.downloadId);
      return false;
    }
    case 'sniff:progress':
    case 'sniff:hosts':
    case 'sniff:save':
    case 'sniff:error':
      return done(ready.then(() => fromOffscreen(msg as FromOffscreen)));
    default:
      return false;
  }
});
