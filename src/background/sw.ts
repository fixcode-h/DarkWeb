/**
 * 后台 Service Worker：动态注册内容脚本、跨域资源代理、图片采样、快捷键。
 */
import { classify, classifySvgText, computeStats, type ImageClass } from '../shared/image-stats';
import type { AnalyzeResponse, FetchCssResponse, InvertResponse, Request } from '../shared/messages';
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  excludePatternsFor,
  normalizeSettings,
  siteKeyOf,
  siteModeFor,
  type Settings,
} from '../shared/settings';

const MAX_CSS_BYTES = 4 * 1024 * 1024;
const MAX_IMG_BYTES = 2 * 1024 * 1024;
const MAX_INVERT_DIM = 512;
const MAX_DATA_URL = 128 * 1024;
const FETCH_TIMEOUT = 8000;

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
  if (!s.enabled) return;
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

let registering: Promise<void> = Promise.resolve();
function scheduleRegister(): void {
  registering = registering.then(registerScripts).catch((e) => console.warn('[drak] register failed', e));
}

chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  if (!data[SETTINGS_KEY]) await chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
  scheduleRegister();
});
chrome.runtime.onStartup.addListener(scheduleRegister);

let lastRegKey = '';
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[SETTINGS_KEY]) return;
  const s = normalizeSettings(changes[SETTINGS_KEY].newValue);
  // 只有影响注册的字段变化才重新注册
  const key = JSON.stringify([s.enabled, s.followSystem, excludeFor(s)]);
  if (key === lastRegKey) return;
  lastRegKey = key;
  scheduleRegister();
});

// ---- 资源代理 ----

async function fetchWithLimit(url: string, maxBytes: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, { signal: ctrl.signal, credentials: 'include', cache: 'force-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const len = Number(res.headers.get('content-length') || 0);
    if (len > maxBytes) throw new Error('too large');
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchCss(url: string): Promise<FetchCssResponse> {
  if (!/^https?:/i.test(url)) return { ok: false, error: 'bad url' };
  try {
    const res = await fetchWithLimit(url, MAX_CSS_BYTES);
    let text = await res.text();
    if (text.length > MAX_CSS_BYTES) return { ok: false, error: 'too large' };
    // 展开一层 @import（构造样式表不支持 @import）
    const imports = Array.from(text.matchAll(/@import\s+(?:url\()?\s*["']?([^"')\s;]+)["']?\s*\)?([^;]*);/g));
    for (const m of imports.slice(0, 10)) {
      try {
        const child = new URL(m[1], url).href;
        const r = await fetchWithLimit(child, MAX_CSS_BYTES);
        let t = await r.text();
        const media = m[2].trim();
        if (media && !/^layer/.test(media)) t = `@media ${media} {\n${t}\n}`;
        text = t + '\n' + text;
      } catch {
        /* 子表失败就跳过 */
      }
    }
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

const imageCache = new Map<string, Promise<ImageClass>>();

async function loadImage(url: string): Promise<{ blob: Blob; svg: string | null }> {
  const res = await fetchWithLimit(url, MAX_IMG_BYTES);
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
