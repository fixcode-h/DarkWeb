/**
 * 同域名自动翻译：用户手动翻译或显示原文后，按页面的最终状态把站点记进或移出“总是翻译的网站”，
 * 并让同一站点已经打开的其他标签页跟着翻译或还原。
 * 站点按 siteKeyOf 识别（域名或 IP，非默认端口时带端口），与“总是翻译此网站”是同一份列表。
 */
import { loadTranslate, saveTranslate, siteKeyOf } from './settings';

/** 按页面翻译状态算出新的自动翻译站点列表；没有变化时返回 null */
export function nextAutoSites(sites: string[], site: string, on: boolean): string[] | null {
  if (!site || sites.includes(site) === on) return null;
  return on ? [...sites, site] : sites.filter((s) => s !== site);
}

const siteOfUrl = (url: string | undefined): string => (url && /^https?:/i.test(url) ? siteKeyOf(url) : '');

/**
 * 用户在某个标签页里切换了翻译之后调用。
 * start(tabId) 注入并开始翻译；同站点其他标签页还原时只给已注入的页面发 tr:stop。
 */
export async function rememberSite(tabId: number, start: (tabId: number) => Promise<void>): Promise<void> {
  const s = await loadTranslate();
  if (!s.sameSite) return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const site = siteOfUrl(tab?.url);
  if (!site) return;
  let on: boolean;
  try {
    // 以顶层页面的状态为准（切换命令发给了所有框架）
    on = !!((await chrome.tabs.sendMessage(tabId, { type: 'tr:status' }, { frameId: 0 })) as { active?: boolean } | undefined)?.active;
  } catch {
    return;
  }
  const next = nextAutoSites(s.autoSites, site, on);
  if (next) await saveTranslate({ ...s, autoSites: next });

  const tabs = await chrome.tabs.query({}).catch(() => [] as chrome.tabs.Tab[]);
  await Promise.all(
    tabs
      .filter((t) => t.id !== undefined && t.id !== tabId && siteOfUrl(t.url) === site)
      .map((t) =>
        on
          ? start(t.id!)
          : chrome.tabs.sendMessage(t.id!, { type: 'tr:stop' }).catch(() => {
              /* 没注入过翻译脚本，本来就是原文 */
            }),
      ),
  );
}
