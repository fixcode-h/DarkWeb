/**
 * 边播边录的后台部分（只在完整版；商店版的后台构建时 __DRAK_STORE__ 为 true，整个模块不会被打包进去）。
 *
 * 在这个网站的页面里提前（document_start）放好录制脚本，再刷新页面：播放器一创建 MediaSource 就能录到初始化数据。
 * 脚本只在 sessionStorage 有录制标记的标签页上工作，录完就撤掉注册。
 */
import { renderFilename, type SniffSettings } from '../settings';
import type { Task } from '../jobs';

export interface RecDeps {
  ready: Promise<void>;
  settings: () => SniffSettings;
  supportedUrl: (url: string | undefined) => boolean;
  drm: (tabId: number) => Promise<boolean>;
  newTaskId: () => string;
  addTask: (t: Task) => void;
  task: (id: string) => Task | undefined;
  finish: (t: Task, patch: Partial<Task>) => void;
  saveTasks: () => void;
  notifyTab: (tabId: number) => Promise<void>;
}

export interface RecInfo {
  bytes: number;
  tracks: number;
  time: number;
  duration: number;
}

/** 去掉标题末尾的网站名 */
const cleanTitle = (t: string | undefined) => (t ?? '').replace(/^\(\d+\)\s*/, '').replace(/\s*[-_|–—]\s*(YouTube|哔哩哔哩|bilibili).*$/i, '').trim();

export function createRecorder(d: RecDeps) {
  const REC_SCRIPT_IDS = ['drak-rec-hook', 'drak-rec'];
  const recordings = new Map<number, { taskId: string; origin: string; info: RecInfo }>();

  async function recStart(tabId: number): Promise<{ ok: boolean; error?: string }> {
    await d.ready;
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab?.url || !d.supportedUrl(tab.url)) return { ok: false, error: '这个页面不支持' };
    if (recordings.has(tabId)) return { ok: true };
    if (await d.drm(tabId)) return { ok: false, error: '加密内容（DRM），无法录制' };
    const origin = new URL(tab.url).origin;
    await chrome.scripting.unregisterContentScripts({ ids: REC_SCRIPT_IDS }).catch(() => {});
    const matches = [...new Set([origin, ...[...recordings.values()].map((r) => r.origin)])].map((o) => `${o}/*`);
    await chrome.scripting.registerContentScripts([
      { id: 'drak-rec-hook', js: ['sniff-record-hook.js'], matches, runAt: 'document_start', world: 'MAIN', persistAcrossSessions: false },
      { id: 'drak-rec', js: ['sniff-record.js'], matches, runAt: 'document_start', persistAcrossSessions: false },
    ]);
    await chrome.scripting.executeScript({ target: { tabId }, func: (flag: string) => sessionStorage.setItem(flag, '1'), args: ['drak-rec'] });
    const title = cleanTitle(tab.title);
    const id = d.newTaskId();
    d.addTask({ id, tabId, name: renderFilename(d.settings().filename, { 标题: title || 'video' }), stage: 'download', done: 0, total: 0, bytes: 0, speed: 0, started: Date.now(), note: '边播边录' });
    recordings.set(tabId, { taskId: id, origin, info: { bytes: 0, tracks: 0, time: 0, duration: 0 } });
    await chrome.tabs.reload(tabId);
    return { ok: true };
  }

  async function recUnregister(): Promise<void> {
    if (recordings.size) return;
    await chrome.scripting.unregisterContentScripts({ ids: REC_SCRIPT_IDS }).catch(() => {});
  }

  async function recStop(tabId: number, cancel = false): Promise<{ ok: boolean; error?: string }> {
    const r = recordings.get(tabId);
    if (!r) return { ok: false, error: '没有在录制' };
    const t = d.task(r.taskId);
    if (cancel) {
      await chrome.tabs.sendMessage(tabId, { type: 'sniff:rec-cancel' }).catch(() => {});
      recordings.delete(tabId);
      if (t) d.finish(t, { stage: 'canceled' });
      await recUnregister();
      return { ok: true };
    }
    if (t) {
      // 用停止时的页面标题（录制期间可能换了视频或标题）
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      const title = cleanTitle(tab?.title);
      if (title) t.name = renderFilename(d.settings().filename, { 标题: title });
      t.stage = 'merge';
      d.saveTasks();
    }
    const sent = await chrome.tabs.sendMessage(tabId, { type: 'sniff:rec-stop', name: t?.name ?? 'video' }, { frameId: 0 }).then(() => true, () => false);
    if (!sent) recDone(tabId, { ok: false, error: '页面没有响应，录制中断' });
    return { ok: sent };
  }

  function recDone(tabId: number, m: { ok: boolean; error?: string; file?: string; bytes?: number }): void {
    const r = recordings.get(tabId);
    if (!r) return;
    recordings.delete(tabId);
    const t = d.task(r.taskId);
    if (t && !['done', 'error', 'canceled'].includes(t.stage)) {
      d.finish(t, m.ok ? { stage: 'done', file: m.file, bytes: m.bytes ?? t.bytes, note: '边播边录，已保存到下载文件夹' } : { stage: m.error === '已取消' ? 'canceled' : 'error', error: m.error });
      // 文件是页面里的下载链接保存的，找到这条下载记录，“打开文件夹”才能用
      if (m.ok && chrome.downloads) {
        setTimeout(async () => {
          const [item] = await chrome.downloads.search({ urlRegex: `^blob:${r.origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`, orderBy: ['-startTime'], limit: 1 }).catch(() => []);
          if (item?.startTime && Date.parse(item.startTime) >= t.started) {
            t.downloadId = item.id;
            d.saveTasks();
          }
        }, 1500);
      }
    }
    void recUnregister();
    void d.notifyTab(tabId);
  }

  function recProgress(tabId: number, m: { bytes: number; tracks: number; time: number; duration: number }): void {
    const r = recordings.get(tabId);
    if (!r) return;
    r.info = { bytes: m.bytes, tracks: m.tracks, time: m.time, duration: m.duration };
    void d.notifyTab(tabId);
    const t = d.task(r.taskId);
    if (t) {
      const dt = (Date.now() - t.started) / 1000;
      Object.assign(t, { bytes: m.bytes, done: Math.round(m.time), total: Math.round(m.duration), speed: dt > 0 ? m.bytes / dt : 0 });
      d.saveTasks();
    }
  }

  // 录制中的标签页被关掉，或者跳到别的网站：录制作废
  chrome.tabs.onRemoved.addListener((id) => recordings.has(id) && recDone(id, { ok: false, error: '页面已关闭，录制中断' }));
  chrome.tabs.onUpdated.addListener((id, info) => {
    const r = recordings.get(id);
    if (!r || !info.url) return;
    if (!info.url.startsWith(`${r.origin}/`)) recDone(id, { ok: false, error: '页面已跳转，录制中断' });
    // 同一网站换了视频（单页应用跳转）：先把已经录到的存下来
    else if (r.info.bytes > 0) void recStop(id);
  });


  return {
    start: recStart,
    stop: recStop,
    done: recDone,
    progress: recProgress,
    info: (tabId: number) => recordings.get(tabId)?.info,
    hint: (url: string | undefined) =>
      url && /(^|\.)youtube\.com$/.test(new URL(url).hostname)
        ? 'YouTube 的视频是分段加载的，用边播边录保存：点开始后页面会刷新，先在播放器里选好清晰度，再从头播放到结尾。'
        : '列表里找不到可下载的地址时用：点开始后页面会刷新，从头播放到想保存的位置再停止。只录播放器加载过的部分，不能录加密内容。',
    tabOfTask: (taskId: string) => [...recordings].find(([, r]) => r.taskId === taskId)?.[0],
  };
}
