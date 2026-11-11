/** 弹窗里的“网页翻译”一栏，独立于暗色模式的弹窗脚本 */
import { LANGS } from './lang';
import { ENGINE_NAMES, loadTranslate, saveTranslate, siteKeyOf, type EngineId, type PageStatus, type TranslateSettings } from './settings';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let settings: TranslateSettings;
let tabId: number | undefined;
let site = '';
let active = false;
let poll = 0;

async function pageStatus(): Promise<PageStatus | null> {
  if (tabId === undefined) return null;
  try {
    return (await chrome.tabs.sendMessage(tabId, { type: 'tr:status' }, { frameId: 0 })) as PageStatus;
  } catch {
    // 还没注入翻译脚本
    return null;
  }
}

function needsKey(): string {
  if (settings.engine === 'deepl' && !settings.deeplKey) return 'DeepL 需要先在“翻译设置”里填写 API 密钥';
  if (settings.engine === 'llm' && !settings.llm.apiKey) return 'AI 大模型需要先在“翻译设置”里填写接口和密钥';
  return '';
}

async function refresh(): Promise<void> {
  const st = await pageStatus();
  active = !!st?.active;
  $('trToggle').textContent = active ? '显示原文' : '翻译此页面';
  $('trToggle').classList.toggle('primary', !active);
  let text = needsKey();
  if (st?.error) text = `翻译失败：${st.error}`;
  else if (active && st) {
    const via = st.engine && st.engine !== settings.engine ? `（已改用${ENGINE_NAMES[st.engine]}）` : '';
    text = st.total ? `已翻译 ${st.done} / ${st.total} 段${via}` : '正在翻译…';
  }
  $('trStatus').textContent = text;
  clearTimeout(poll);
  if (active) poll = window.setTimeout(refresh, 800);
}

async function save(patch: Partial<TranslateSettings>): Promise<void> {
  settings = { ...settings, ...patch };
  await saveTranslate(settings);
  // 页面里的翻译脚本会按新设置重新翻译，这里只刷新状态
  setTimeout(refresh, 300);
}

async function main(): Promise<void> {
  settings = await loadTranslate();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id;
  try {
    site = tab?.url && /^https?:/.test(tab.url) ? siteKeyOf(new URL(tab.url).host) : '';
  } catch {
    site = '';
  }

  const target = $<HTMLSelectElement>('trTarget');
  for (const [code, name] of LANGS) target.add(new Option(name, code));
  if (!LANGS.some((l) => l[0] === settings.target)) target.add(new Option(settings.target, settings.target));
  target.value = settings.target;
  const engine = $<HTMLSelectElement>('trEngine');
  for (const [id, name] of Object.entries(ENGINE_NAMES)) engine.add(new Option(name, id));
  engine.value = settings.engine;
  $<HTMLSelectElement>('trMode').value = settings.mode;
  const auto = $<HTMLInputElement>('trAuto');
  auto.checked = !!site && settings.autoSites.includes(site);

  const toggle = $<HTMLButtonElement>('trToggle');
  toggle.disabled = auto.disabled = !site;
  toggle.addEventListener('click', async () => {
    if (tabId === undefined) return;
    await chrome.runtime.sendMessage({ type: 'tr:toggle', tabId });
    await refresh();
  });
  target.addEventListener('change', () => save({ target: target.value }));
  engine.addEventListener('change', () => save({ engine: engine.value as EngineId }));
  $<HTMLSelectElement>('trMode').addEventListener('change', (e) => save({ mode: (e.target as HTMLSelectElement).value as TranslateSettings['mode'] }));
  auto.addEventListener('change', async () => {
    const sites = settings.autoSites.filter((s) => s !== site);
    if (auto.checked) sites.push(site);
    await save({ autoSites: sites });
    if (auto.checked && !active && tabId !== undefined) {
      await chrome.runtime.sendMessage({ type: 'tr:start', tabId });
      await refresh();
    }
  });
  $('trOptions').addEventListener('click', (e) => {
    e.preventDefault();
    void chrome.tabs.create({ url: chrome.runtime.getURL('translate.html') });
  });
  await refresh();
}

void main();
