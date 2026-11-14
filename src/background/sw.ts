/**
 * 后台 Service Worker：动态注册内容脚本、跨域资源代理、图片采样、快捷键。
 */
import { classify, classifySvgText, computeStats, type ImageClass } from '../shared/image-stats';
import type { AnalyzeResponse, FetchCssResponse, InvertResponse, Request } from '../shared/messages';
import { fetchCssText, fetchWithLimit } from '../shared/css-fetch';
import '../translate/background';
import '../enhance/background';
import '../update/background';
import {
  CACHE_PREFIX,
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  excludePatternsFor,
  msToNextScheduleEdge,
  normalizeSettings,
  scheduleActive,
  siteKeyOf,
  siteModeFor,
  type Settings,
} from '../shared/settings';

const MAX_IMG_BYTES = 2 * 1024 * 1024;
const MAX_INVERT_DIM = 512;
const MAX_DATA_URL = 128 * 1024;

async function getSettings(): Promise<Settings> {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(data[SETTINGS_KEY]);
}

function excludeFor(s: Settings): string[] {
  const out: string[] = [];
  for (const [h, m] of Object.entries(s.siteModes)) {
    if (m === 'off') out.push(...excludePatternsFor(h));
  }
  return out;
}

/** 按设置注册内容脚本：被关闭的站点直接排除，页面启动时就不需要再异步查询开关 */
async function registerScripts(): Promise<void> {
  const s = await getSettings();
  const existing = await chrome.scripting.getRegisteredContentScripts();
  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: existing.map((x) => x.id) });
  armScheduleAlarm(s);
  // 定时启用的时段之外不注册：页面加载时完全不注入，也就不会先暗一下再变回来
  if (!s.enabled || !scheduleActive(s)) return;
  const common = {
    matches: ['<all_urls>'],
    excludeMatches: excludeFor(s),
    runAt: 'document_start' as const,
    allFrames: true,
    matchOriginAsFallback: true,
    persistAcrossSessions: true,
  };
  await chrome.scripting.registerContentScripts([
    { id: 'drak-probe', js: ['probe.js'], world: 'MAIN', ...common },
    { id: 'drak-main', js: ['content.js'], css: [s.followSystem ? 'base-system.css' : 'base.css'], ...common },
  ]);
}

const SCHEDULE_ALARM = 'drak-schedule';
const CACHE_ALARM = 'drak-cache-gc';

function armScheduleAlarm(s: Settings): void {
  const ms = s.enabled ? msToNextScheduleEdge(s) : null;
  if (ms === null) chrome.alarms.clear(SCHEDULE_ALARM);
  else chrome.alarms.create(SCHEDULE_ALARM, { when: Date.now() + ms + 500 });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === CACHE_ALARM) return pruneCache();
  if (alarm.name !== SCHEDULE_ALARM) return;
  scheduleRegister();
  await registering;
  const s = await getSettings();
  if (!s.enabled || !scheduleActive(s)) return;
  // 进入启用时段：时段外打开的标签页没有注入过脚本，这里补上（已注入的页面自己有定时器，重复注入会被忽略）
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'], discarded: false });
  for (const t of tabs) if (t.id !== undefined) await injectInto(t.id);
});

// ---- 配色缓存清理：超过 30 天没更新的、以及数量超出上限的最旧条目 ----

const CACHE_MAX_AGE = 30 * 24 * 3600 * 1000;
const CACHE_MAX_SITES = 300;

async function pruneCache(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const now = Date.now();
  const drop: string[] = [];
  const keep: [string, number][] = [];
  for (const [k, v] of Object.entries(all)) {
    if (!k.startsWith(CACHE_PREFIX)) continue;
    const t = v && typeof v === 'object' ? Number((v as { t?: number }).t) : NaN;
    // 旧版缓存是纯字符串，没有时间戳和主题签名，直接清掉
    if (!isFinite(t) || now - t > CACHE_MAX_AGE) drop.push(k);
    else keep.push([k, t]);
  }
  keep.sort((a, b) => b[1] - a[1]);
  for (const [k] of keep.slice(CACHE_MAX_SITES)) drop.push(k);
  if (drop.length) await chrome.storage.local.remove(drop);
}

let registering: Promise<void> = Promise.resolve();
function scheduleRegister(): void {
  registering = registering.then(registerScripts).catch((e) => console.warn('[drak] register failed', e));
}

chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  if (!data[SETTINGS_KEY]) await chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
  scheduleRegister();
  chrome.alarms.create(CACHE_ALARM, { delayInMinutes: 5, periodInMinutes: 24 * 60 });
});
chrome.runtime.onStartup.addListener(scheduleRegister);

// ---- 右键菜单：开关本站暗色 ----
const DARK_MENU_ID = 'drak-toggle-site';
function createDarkMenu(): void {
  chrome.contextMenus?.create(
    { id: DARK_MENU_ID, title: '暗色模式：开关本站（Alt+Shift+D）', contexts: ['page'], documentUrlPatterns: ['http://*/*', 'https://*/*'] },
    () => void chrome.runtime.lastError,
  );
}
chrome.runtime.onInstalled.addListener(createDarkMenu);
chrome.runtime.onStartup.addListener(createDarkMenu);
chrome.contextMenus?.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== DARK_MENU_ID || !tab?.url || !/^https?:/.test(tab.url)) return;
  const s = await toggleSite(tab.url);
  if (siteModeFor(s, tab.url) !== 'off' && tab.id !== undefined) await injectInto(tab.id);
});

let lastRegKey = '';
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[SETTINGS_KEY]) return;
  const s = normalizeSettings(changes[SETTINGS_KEY].newValue);
  // 只有影响注册的字段变化才重新注册
  const key = JSON.stringify([s.enabled, s.followSystem, excludeFor(s), s.scheduleEnabled && [s.scheduleStart, s.scheduleEnd]]);
  if (key === lastRegKey) return;
  lastRegKey = key;
  scheduleRegister();
});

// ---- 资源代理 ----

async function fetchCss(url: string): Promise<FetchCssResponse> {
  return fetchCssText(url, { credentials: 'include', cache: 'force-cache' });
}

const imageCache = new Map<string, Promise<ImageClass>>();

async function loadImage(url: string): Promise<{ blob: Blob; svg: string | null }> {
  const res = await fetchWithLimit(url, MAX_IMG_BYTES, { credentials: 'include', cache: 'force-cache' });
  const blob = await res.blob();
  if (blob.size > MAX_IMG_BYTES) throw new Error('too large');
  const isSvg = /svg/i.test(blob.type) || /\.svg(\?|#|$)/i.test(url);
  return { blob, svg: isSvg ? await blob.text() : null };
}

async function analyze(url: string, dimImages: boolean): Promise<ImageClass> {
  const { blob, svg } = await loadImage(url);
  if (svg !== null) return classifySvgText(svg);
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, 64 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0, w, h);
  const stats = computeStats(g.getImageData(0, 0, w, h).data, w, h, bmp.width, bmp.height);
  bmp.close();
  return classify(stats, dimImages);
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function invert(url: string): Promise<InvertResponse> {
  const { blob, svg } = await loadImage(url);
  if (svg !== null) {
    const patched = svg.replace(/<svg\b([^>]*)>/i, '<svg$1><style>svg{filter:invert(1) hue-rotate(180deg)}</style>');
    const dataUrl = 'data:image/svg+xml;base64,' + toBase64(new TextEncoder().encode(patched).buffer as ArrayBuffer);
    return dataUrl.length > MAX_DATA_URL ? { ok: false, error: 'too large' } : { ok: true, dataUrl };
  }
  const bmp = await createImageBitmap(blob);
  if (Math.max(bmp.width, bmp.height) > MAX_INVERT_DIM) {
    bmp.close();
    return { ok: false, error: 'too large' };
  }
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const g = canvas.getContext('2d')!;
  g.filter = 'invert(1) hue-rotate(180deg)';
  g.drawImage(bmp, 0, 0);
  bmp.close();
  const out = await canvas.convertToBlob({ type: 'image/png' });
  const dataUrl = 'data:image/png;base64,' + toBase64(await out.arrayBuffer());
  return dataUrl.length > MAX_DATA_URL ? { ok: false, error: 'too large' } : { ok: true, dataUrl };
}

chrome.runtime.onMessage.addListener((msg: Request, _sender, sendResponse) => {
  switch (msg?.type) {
    case 'fetch-css':
      fetchCss(msg.url).then(sendResponse);
      return true;
    case 'analyze-image': {
      const key = `${msg.dimImages ? 1 : 0}|${msg.url}`;
      let p = imageCache.get(key);
      if (!p) {
        p = analyze(msg.url, msg.dimImages).catch(() => 'keep' as ImageClass);
        imageCache.set(key, p);
        if (imageCache.size > 3000) imageCache.delete(imageCache.keys().next().value!);
      }
      p.then((cls) => sendResponse({ ok: true, cls } satisfies AnalyzeResponse));
      return true;
    }
    case 'invert-image':
      invert(msg.url)
        .catch((e) => ({ ok: false, error: String(e) }) as InvertResponse)
        .then(sendResponse);
      return true;
    default:
      return false;
  }
});

// ---- 快捷键：开关当前站点 ----

/** url 可以是整条网址或 host[:port]；按站点键（域名 / IP:端口）开关，不区分具体页面 */
export async function toggleSite(url: string): Promise<Settings> {
  const s = await getSettings();
  const key = siteKeyOf(url);
  if (!key) return s;
  const next = { ...s, siteModes: { ...s.siteModes } };
  // 当前生效的是“关闭”（可能来自上级域名）时，这个键恢复自动；否则关闭
  if (siteModeFor(s, key) === 'off' && s.siteModes[key] !== undefined) delete next.siteModes[key];
  else if (siteModeFor(s, key) === 'off') next.siteModes[key] = 'dynamic';
  else next.siteModes[key] = 'off';
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-global') {
    const s = await getSettings();
    await chrome.storage.local.set({ [SETTINGS_KEY]: { ...s, enabled: !s.enabled } });
    if (!s.enabled) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id !== undefined && tab.url && /^https?:/.test(tab.url)) await injectInto(tab.id);
    }
    return;
  }
  if (command !== 'toggle-site') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/^https?:/.test(tab.url)) return;
  const s = await toggleSite(tab.url);
  // 重新开启时，当前页面没有注入过脚本，需要补注入
  if (siteModeFor(s, tab.url) !== 'off' && tab.id !== undefined) await injectInto(tab.id);
});

async function injectInto(tabId: number): Promise<void> {
  const s = await getSettings();
  try {
    await chrome.scripting.insertCSS({ target: { tabId, allFrames: true }, files: [s.followSystem ? 'base-system.css' : 'base.css'] });
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['probe.js'], world: 'MAIN' });
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['content.js'] });
  } catch {
    /* 受限页面 */
  }
}

// 弹窗请求补注入
chrome.runtime.onMessage.addListener((msg: { type?: string; tabId?: number }, _s, sendResponse) => {
  if (msg?.type === 'inject' && typeof msg.tabId === 'number') {
    injectInto(msg.tabId).then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});
