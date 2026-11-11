/**
 * 网页翻译的后台部分：翻译请求（缓存、切批、并发、失败自动换引擎）、
 * 按需注入翻译脚本、右键菜单、快捷键、自动翻译站点。
 * 由 sw.ts 以 import 引入，自成一体。
 */
import { LIMITS, chunk, translateBatch } from './engines';
import {
  ENGINE_NAMES,
  TRANSLATE_KEY,
  loadTranslate,
  normalizeTranslate,
  siteKeyOf,
  type EngineId,
  type TranslateRequest,
  type TranslateResponse,
  type TranslateSettings,
  type TranslatedItem,
} from './settings';

const CACHE_MAX = 5000;
const CONCURRENCY = 4;
const cache = new Map<string, TranslatedItem>();

function cacheGet(key: string): TranslatedItem | undefined {
  const v = cache.get(key);
  if (v) {
    // 最近使用的挪到末尾
    cache.delete(key);
    cache.set(key, v);
  }
  return v;
}
function cacheSet(key: string, v: TranslatedItem): void {
  cache.set(key, v);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
}

let running = 0;
const waiting: Array<() => void> = [];
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= CONCURRENCY) await new Promise<void>((r) => waiting.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

async function runEngine(engine: EngineId, texts: string[], to: string, s: TranslateSettings): Promise<TranslatedItem[]> {
  const parts = await Promise.all(
    chunk(texts, LIMITS[engine]).map((batch) =>
      limited(async () => {
        try {
          return await translateBatch(engine, batch, to, s);
        } catch {
          // 网络抖动：重试一次
          return translateBatch(engine, batch, to, s);
        }
      }),
    ),
  );
  return parts.flat();
}

/** 失败后可以自动改用的免费引擎 */
function fallbackOf(engine: EngineId): EngineId {
  return engine === 'microsoft' ? 'google' : 'microsoft';
}

/** 记住哪个引擎刚失败过，一段时间内直接用备用引擎，不让每一批都先超时一次 */
const brokenUntil = new Map<EngineId, number>();

async function translate(req: TranslateRequest): Promise<TranslateResponse> {
  const s = await loadTranslate();
  const preferred = req.engine;
  const backup = fallbackOf(preferred);
  const order: EngineId[] = !s.fallback
    ? [preferred]
    : (brokenUntil.get(preferred) ?? 0) > Date.now()
      ? [backup, preferred]
      : [preferred, backup];
  let firstError = '';
  for (const engine of order) {
    const keyOf = (t: string) => `${engine}|${req.to}|${t}`;
    const items: Array<TranslatedItem | undefined> = req.texts.map((t) => cacheGet(keyOf(t)));
    const missing = [...new Set(req.texts.filter((_, i) => !items[i]))];
    try {
      if (missing.length) {
        const got = await runEngine(engine, missing, req.to, s);
        missing.forEach((t, i) => cacheSet(keyOf(t), got[i]));
      }
      return { ok: true, engine, note: firstError || undefined, items: req.texts.map((t, i) => items[i] ?? cache.get(keyOf(t))!) };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      firstError ||= `${ENGINE_NAMES[engine]}：${msg}`;
      brokenUntil.set(engine, Date.now() + 5 * 60 * 1000);
    }
  }
  return { ok: false, error: firstError || '翻译失败' };
}

// ---- 注入与控制 ----

async function sendToTab(tabId: number, type: 'tr:start' | 'tr:toggle'): Promise<void> {
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['translate.js'] });
    await chrome.tabs.sendMessage(tabId, { type });
  } catch {
    /* 浏览器受限页面 */
  }
}

chrome.runtime.onMessage.addListener((msg: { type?: string; tabId?: number; texts?: string[]; to?: string; engine?: EngineId }, _sender, sendResponse) => {
  if (msg?.type === 'tr:translate' && Array.isArray(msg.texts) && msg.to && msg.engine) {
    translate(msg as TranslateRequest).then(sendResponse);
    return true;
  }
  if ((msg?.type === 'tr:start' || msg?.type === 'tr:toggle') && typeof msg.tabId === 'number') {
    sendToTab(msg.tabId, msg.type).then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});

// 快捷键
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-translate') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id !== undefined) await sendToTab(tab.id, 'tr:toggle');
});

// 右键菜单
const MENU_ID = 'drak-translate';
function createMenu(): void {
  chrome.contextMenus?.create(
    { id: MENU_ID, title: '翻译此页面 / 显示原文', contexts: ['page', 'selection', 'link'] },
    () => void chrome.runtime.lastError,
  );
}
chrome.runtime.onInstalled.addListener(createMenu);
chrome.runtime.onStartup.addListener(createMenu);
chrome.contextMenus?.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID && tab?.id !== undefined) void sendToTab(tab.id, 'tr:toggle');
});

// 自动翻译站点：页面加载完成后注入并开始
let autoSites: Set<string> | null = null;
async function getAutoSites(): Promise<Set<string>> {
  autoSites ??= new Set((await loadTranslate()).autoSites);
  return autoSites;
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[TRANSLATE_KEY]) autoSites = new Set(normalizeTranslate(changes[TRANSLATE_KEY].newValue).autoSites);
});
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete' || !tab.url || !/^https?:/.test(tab.url)) return;
  const sites = await getAutoSites();
  if (!sites.size) return;
  let host: string;
  try {
    host = new URL(tab.url).host;
  } catch {
    return;
  }
  if (sites.has(siteKeyOf(host))) await sendToTab(tabId, 'tr:start');
});
