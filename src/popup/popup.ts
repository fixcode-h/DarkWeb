import type { Diagnostics } from '../shared/messages';
import { SETTINGS_KEY, normalizeSettings, siteModeFor, type Settings, type SiteMode } from '../shared/settings';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const MODE_TEXT: Record<string, string> = {
  dynamic: '动态配色',
  native: '站点原生暗色',
  filter: '滤镜反色',
  off: '未启用',
};
const REASON_TEXT: Record<string, string> = {
  default: '',
  'site-rule': '（站点规则）',
  'user-choice': '（你的选择）',
  'native-failed': '（原生暗色未生效，已改用动态配色）',
  'native-pending': '（已开启站点原生暗色，刷新后生效；本次先用动态配色）',
  'page-already-dark': '：页面本身已是深色，自动跳过',
  'too-many-errors': '：异常过多，已自动降级',
  'slow-page': '：页面过重，已停止图片分析',
  disabled: '：全局已关闭',
  'site-disabled': '：本站已关闭',
  'system-light': '：系统当前为浅色',
};

let settings: Settings;
let tabId: number | undefined;
let host = '';

async function save(patch: Partial<Settings>): Promise<void> {
  settings = { ...settings, ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

function siteKey(): string {
  return host.replace(/^www\./, '');
}

async function refreshDiag(): Promise<void> {
  if (tabId === undefined) return;
  try {
    const d = (await chrome.tabs.sendMessage(tabId, { type: 'diag' }, { frameId: 0 })) as Diagnostics;
    $('status').textContent = `当前：${MODE_TEXT[d.mode] ?? d.mode}${REASON_TEXT[d.reason] ?? ''}`;
    $('diag').textContent = JSON.stringify(d, null, 2);
  } catch {
    $('status').textContent = host ? '此页面未运行插件（刷新页面后生效，或为浏览器受限页面）' : '';
    $('diag').textContent = '';
  }
}

async function main(): Promise<void> {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  settings = normalizeSettings(data[SETTINGS_KEY]);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id;
  try {
    host = tab?.url && /^https?:/.test(tab.url) ? new URL(tab.url).hostname : '';
  } catch {
    host = '';
  }
  $('host').textContent = host || '此页面不支持';
  ($('siteMode') as HTMLSelectElement).disabled = !host;

  $<HTMLInputElement>('enabled').checked = settings.enabled;
  $<HTMLSelectElement>('siteMode').value = host ? siteModeFor(settings, host) : 'auto';
  $<HTMLInputElement>('brightness').value = String(settings.brightness);
  $<HTMLInputElement>('contrast').value = String(settings.contrast);
  $<HTMLInputElement>('dimImages').checked = settings.dimImages;
  $<HTMLInputElement>('followSystem').checked = settings.followSystem;

  $<HTMLInputElement>('enabled').addEventListener('change', async (e) => {
    await save({ enabled: (e.target as HTMLInputElement).checked });
    if (settings.enabled && tabId !== undefined) await chrome.runtime.sendMessage({ type: 'inject', tabId });
    setTimeout(refreshDiag, 300);
  });
  $<HTMLSelectElement>('siteMode').addEventListener('change', async (e) => {
    const mode = (e.target as HTMLSelectElement).value as SiteMode;
    const siteModes = { ...settings.siteModes };
    delete siteModes[host];
    if (mode === 'auto') delete siteModes[siteKey()];
    else siteModes[siteKey()] = mode;
    await save({ siteModes });
    if (mode !== 'off' && tabId !== undefined) await chrome.runtime.sendMessage({ type: 'inject', tabId });
    setTimeout(refreshDiag, 300);
  });
  let timer = 0;
  for (const id of ['brightness', 'contrast'] as const) {
    $<HTMLInputElement>(id).addEventListener('input', (e) => {
      clearTimeout(timer);
      const v = Number((e.target as HTMLInputElement).value);
      timer = window.setTimeout(() => save({ [id]: v } as Partial<Settings>), 150);
    });
  }
  $<HTMLInputElement>('dimImages').addEventListener('change', (e) => save({ dimImages: (e.target as HTMLInputElement).checked }));
  $<HTMLInputElement>('followSystem').addEventListener('change', (e) => save({ followSystem: (e.target as HTMLInputElement).checked }));
  $('openOptions').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
  $('copyDiag').addEventListener('click', () => navigator.clipboard.writeText($('diag').textContent || ''));
  $('diagBox').addEventListener('toggle', refreshDiag);
  refreshDiag();
}

main();
