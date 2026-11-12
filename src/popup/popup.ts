import type { Diagnostics } from '../shared/messages';
import {
  SETTINGS_KEY,
  normalizeSettings,
  parseClock,
  scheduleActive,
  siteKeyOf,
  siteModeFor,
  type Settings,
  type SiteMode,
} from '../shared/settings';
import { mountAppearance, type AppearanceControls } from '../ui/appearance';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const MODE_TEXT: Record<string, string> = {
  dynamic: '动态配色',
  native: '站点原生暗色',
  filter: '滤镜反色',
  off: '未启用',
};
const REASON_TEXT: Record<string, string> = {
  default: '',
  'site-rule': '（内置站点规则）',
  'user-choice': '（你的选择）',
  'native-failed': '（原生暗色未生效，已改用动态配色）',
  'native-pending': '（已开启站点原生暗色，刷新后生效；本次先用动态配色）',
  'page-already-dark': '：页面本身已是深色，自动跳过',
  'too-many-errors': '：异常过多，已自动降级',
  'slow-page': '：页面过重，已停止图片分析',
  disabled: '：全局已关闭',
  'site-disabled': '：本站已关闭',
  'rule-off': '：站点规则设为关闭',
  'system-light': '：系统当前为浅色',
  'scheduled-off': '：不在定时启用的时段内',
};

let settings: Settings;
let tabId: number | undefined;
/** 当前标签页的站点键：域名或 IP，非默认端口时带 :端口 */
let host = '';
let appearance: AppearanceControls;

async function save(patch: Partial<Settings>): Promise<void> {
  settings = { ...settings, ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  render();
}

async function inject(): Promise<void> {
  if (tabId !== undefined) await chrome.runtime.sendMessage({ type: 'inject', tabId });
}

/** 当前模式下外观调节是否起作用，不起作用时说明原因并给出一键改法 */
function showNote(d: Diagnostics | null): void {
  const note = $('note');
  const action = $<HTMLButtonElement>('noteAction');
  let text = '';
  let act: { label: string; run: () => void } | null = null;
  let inactive = false;
  if (d?.mode === 'native') {
    text = '这个网站在用它自带的暗色主题，下面的配色主题和亮度、对比度等调节对它不起作用。';
    act = { label: '改用动态配色，自己调颜色', run: () => void setSiteMode('dynamic') };
    inactive = true;
  } else if (d?.mode === 'off' && d.reason === 'page-already-dark') {
    text = '网站本身已是深色，插件没有再叠加一层，所以外观调节不起作用。识别错了或者想用自己的配色：';
    act = { label: '本站仍然启用暗色', run: () => void setSiteMode('dynamic') };
    inactive = true;
  } else if (d?.mode === 'off' && d.pageDark) {
    text = '插件已不再改动本页，但网站自己处于夜间模式，所以看起来仍是暗色。要浅色请在网站自己的设置里切换。';
    inactive = true;
  } else if (d?.mode === 'off') {
    inactive = true;
  } else if (d?.mode === 'filter') {
    text = '滤镜模式只能整体调亮度、对比度、饱和度，配色主题不起作用。';
  }
  $('noteText').textContent = text;
  note.hidden = !text;
  action.hidden = !act;
  if (act) {
    action.textContent = act.label;
    action.onclick = act.run;
  }
  $('appearance').closest('.card')?.classList.toggle('inactive', inactive);
}

async function refreshDiag(): Promise<void> {
  const dot = $('dot');
  if (tabId === undefined || !host) {
    dot.dataset.state = 'none';
    showNote(null);
    return;
  }
  try {
    const d = (await chrome.tabs.sendMessage(tabId, { type: 'diag' }, { frameId: 0 })) as Diagnostics;
    $('status').textContent = `当前：${MODE_TEXT[d.mode] ?? d.mode}${REASON_TEXT[d.reason] ?? ''}`;
    $('diag').textContent = JSON.stringify(d, null, 2);
    dot.dataset.state = d.mode === 'off' ? 'off' : d.reason === 'too-many-errors' || d.reason === 'native-failed' ? 'warn' : 'on';
    showNote(d);
  } catch {
    showNote(null);
    const idle = !settings.enabled || siteModeFor(settings, host) === 'off' || !scheduleActive(settings);
    $('status').textContent = !settings.enabled
      ? '全局已关闭'
      : siteModeFor(settings, host) === 'off'
        ? '本站已关闭'
        : !scheduleActive(settings)
          ? '不在定时启用的时段内'
          : '此页面未运行插件（刷新页面后生效，或为浏览器受限页面）';
    $('diag').textContent = '';
    dot.dataset.state = idle ? 'off' : 'warn';
  }
}

/** 按当前设置刷新所有控件 */
function render(): void {
  $<HTMLInputElement>('enabled').checked = settings.enabled;
  $('main').classList.toggle('disabled', !settings.enabled);
  $('globalState').textContent = !settings.enabled
    ? '已关闭'
    : settings.scheduleEnabled
      ? scheduleActive(settings)
        ? `定时启用中，${settings.scheduleEnd} 关闭`
        : `定时关闭中，${settings.scheduleStart} 开启`
      : settings.followSystem
        ? '跟随系统深色模式'
        : '已开启';

  const mode = host ? siteModeFor(settings, host) : 'auto';
  for (const b of Array.from($('siteMode').querySelectorAll('button'))) {
    const on = b.dataset.mode === mode;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
    b.disabled = !host;
  }

  $<HTMLInputElement>('dimImages').checked = settings.dimImages;
  $<HTMLInputElement>('skipDarkPages').checked = settings.skipDarkPages;
  $<HTMLInputElement>('followSystem').checked = settings.followSystem;
  $<HTMLInputElement>('scheduleEnabled').checked = settings.scheduleEnabled;
  $('times').hidden = !settings.scheduleEnabled;
  $<HTMLInputElement>('scheduleStart').value = settings.scheduleStart;
  $<HTMLInputElement>('scheduleEnd').value = settings.scheduleEnd;
  const a = parseClock(settings.scheduleStart) ?? 0;
  const b = parseClock(settings.scheduleEnd) ?? 0;
  $('scheduleHint').textContent = a === b ? '起止相同，全天启用' : a > b ? '次日' : '';
  appearance?.update(settings);
}

async function setSiteMode(mode: SiteMode): Promise<void> {
  const siteModes = { ...settings.siteModes };
  if (mode === 'auto') delete siteModes[host];
  else siteModes[host] = mode;
  await save({ siteModes });
  if (mode !== 'off') await inject();
  setTimeout(refreshDiag, 300);
}

async function main(): Promise<void> {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  settings = normalizeSettings(data[SETTINGS_KEY]);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id;
  host = tab?.url && /^https?:/.test(tab.url) ? siteKeyOf(tab.url) : '';
  $('host').textContent = host || '此页面不支持';
  appearance = mountAppearance($('appearance'), settings, (patch) => void save(patch));
  render();

  $<HTMLInputElement>('enabled').addEventListener('change', async (e) => {
    await save({ enabled: (e.target as HTMLInputElement).checked });
    if (settings.enabled) await inject();
    setTimeout(refreshDiag, 300);
  });
  $('siteMode').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (b?.dataset.mode && host) void setSiteMode(b.dataset.mode as SiteMode);
  });
  for (const id of ['dimImages', 'skipDarkPages', 'followSystem', 'scheduleEnabled'] as const) {
    $<HTMLInputElement>(id).addEventListener('change', async (e) => {
      await save({ [id]: (e.target as HTMLInputElement).checked } as Partial<Settings>);
      if (id === 'skipDarkPages') setTimeout(refreshDiag, 300);
      else if (id !== 'dimImages') {
        // 条件放宽后当前页面可能还没注入过脚本
        if (scheduleActive(settings)) await inject();
        setTimeout(refreshDiag, 300);
      }
    });
  }
  for (const id of ['scheduleStart', 'scheduleEnd'] as const) {
    $<HTMLInputElement>(id).addEventListener('change', async (e) => {
      const v = (e.target as HTMLInputElement).value;
      if (parseClock(v) === null) return;
      await save({ [id]: v } as Partial<Settings>);
      if (scheduleActive(settings)) await inject();
      setTimeout(refreshDiag, 300);
    });
  }
  $('openOptions').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
  $('copyDiag').addEventListener('click', async () => {
    await navigator.clipboard.writeText($('diag').textContent || '');
    $('copyDiag').textContent = '已复制';
    setTimeout(() => ($('copyDiag').textContent = '复制诊断信息'), 1200);
  });
  $('diagBox').addEventListener('toggle', refreshDiag);
  // 设置页或快捷键改了设置时保持同步
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[SETTINGS_KEY]) return;
    settings = normalizeSettings(changes[SETTINGS_KEY].newValue);
    render();
    setTimeout(refreshDiag, 400);
  });
  refreshDiag();
}

main();
