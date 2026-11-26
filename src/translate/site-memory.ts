/**
 * 同域名自动翻译：用户手动翻译或显示原文后，按页面的最终状态把站点记进或移出“总是翻译的网站”，
 * 并让同一站点已经打开的其他标签页跟着翻译或还原。
 *
 * “同一站点”按主域名算（公共后缀列表里的可注册域名，即 eTLD+1）：forums.unrealengine.com 记成
 * unrealengine.com，所有子域名共用；bbc.co.uk、xxx.github.io 这类公共后缀也能分对。
 * IP、localhost 这类没有上级域名的按完整主机名；非默认端口是站点的一部分。
 * 列表里手动填的子域名（例如 docs.example.com）只管它自己和它下面的子域名。
 */
import { getDomain } from 'tldts';
import { isBareHost, splitSiteKey } from '../shared/settings';
import { loadTranslate, saveTranslate, siteKeyOf } from './settings';

/** 网址或主机名 -> 记进列表用的站点键：主域名[:端口]，IP 原样；不是网页时为空串 */
export function translateSiteOf(input: string | undefined): string {
  if (!input || (/^[a-z][a-z0-9+.-]*:/i.test(input) && !/^https?:/i.test(input))) return '';
  const key = siteKeyOf(input);
  const [name, port] = splitSiteKey(key);
  if (!name || isBareHost(name)) return key;
  const root = getDomain(name, { allowPrivateDomains: true }) || name;
  return port ? `${root}:${port}` : root;
}

/** 列表里的一项是否管得到这个网址：同端口，主机名相同或是它的子域名 */
export function siteMatches(entry: string, input: string | undefined): boolean {
  if (!input) return false;
  const [ename, eport] = splitSiteKey(siteKeyOf(entry));
  const [name, port] = splitSiteKey(siteKeyOf(input));
  if (!ename || !name || eport !== port) return false;
  if (name === ename) return true;
  return !isBareHost(ename) && name.endsWith('.' + ename);
}

/** 这个网址是否在自动翻译列表里 */
export const isAutoSite = (sites: string[], url: string | undefined): boolean => sites.some((s) => siteMatches(s, url));

/**
 * 按页面翻译状态算出新的自动翻译站点列表；没有变化时返回 null。
 * 翻译：已被某项管到就不动，否则加入主域名；显示原文：去掉所有管得到这个网址的项。
 */
export function nextAutoSites(sites: string[], url: string, on: boolean): string[] | null {
  const site = translateSiteOf(url);
  if (!site) return null;
  if (on) return isAutoSite(sites, url) ? null : [...sites, site];
  const rest = sites.filter((s) => !siteMatches(s, url));
  return rest.length === sites.length ? null : rest;
}

const pageUrl = (url: string | undefined): string => (url && /^https?:/i.test(url) ? url : '');

/**
 * 用户在某个标签页里切换了翻译之后调用。
 * start(tabId) 注入并开始翻译；同站点其他标签页还原时只给已注入的页面发 tr:stop。
 */
export async function rememberSite(tabId: number, start: (tabId: number) => Promise<void>): Promise<void> {
  const s = await loadTranslate();
  if (!s.sameSite) return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const url = pageUrl(tab?.url);
  const site = translateSiteOf(url);
  if (!site) return;
  let on: boolean;
  try {
    // 以顶层页面的状态为准（切换命令发给了所有框架）
    on = !!((await chrome.tabs.sendMessage(tabId, { type: 'tr:status' }, { frameId: 0 })) as { active?: boolean } | undefined)?.active;
  } catch {
    return;
  }
  const next = nextAutoSites(s.autoSites, url, on);
  if (next) await saveTranslate({ ...s, autoSites: next });

  const tabs = await chrome.tabs.query({}).catch(() => [] as chrome.tabs.Tab[]);
  await Promise.all(
    tabs
      .filter((t) => t.id !== undefined && t.id !== tabId && translateSiteOf(pageUrl(t.url)) === site)
      .map((t) =>
        on
          ? start(t.id!)
          : chrome.tabs.sendMessage(t.id!, { type: 'tr:stop' }).catch(() => {
              /* 没注入过翻译脚本，本来就是原文 */
            }),
      ),
  );
}
