/** 翻译设置页：改动即保存 */
import { LANGS } from './lang';
import { ENGINE_NAMES, TRANSLATE_KEY, loadTranslate, normalizeTranslate, saveTranslate, siteKeyOf, type TranslateResponse, type TranslateSettings } from './settings';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

let settings: TranslateSettings;
let savedTimer = 0;

/** 一行一个站点；允许粘贴完整网址，只取“域名或 IP:端口” */
export function parseSites(text: string): string[] {
  const out = new Set<string>();
  for (const line of text.split(/[\s,]+/)) {
    const v = siteKeyOf(line);
    if (v) out.add(v);
  }
  return [...out];
}

function read(): TranslateSettings {
  return {
    ...settings,
    engine: $<HTMLSelectElement>('engine').value as TranslateSettings['engine'],
    target: $<HTMLSelectElement>('target').value,
    fallback: $<HTMLInputElement>('fallback').checked,
    mode: $<HTMLSelectElement>('mode').value as TranslateSettings['mode'],
    style: $<HTMLSelectElement>('style').value as TranslateSettings['style'],
    deeplKey: $<HTMLInputElement>('deeplKey').value.trim(),
    llm: {
      baseUrl: $<HTMLInputElement>('llmBase').value.trim() || settings.llm.baseUrl,
      apiKey: $<HTMLInputElement>('llmKey').value.trim(),
      model: $<HTMLInputElement>('llmModel').value.trim() || settings.llm.model,
    },
    autoSites: parseSites($<HTMLTextAreaElement>('autoSites').value),
    fab: {
      ...settings.fab,
      enabled: $<HTMLInputElement>('fabEnabled').checked,
      hiddenSites: parseSites($<HTMLTextAreaElement>('fabHidden').value),
    },
  };
}

async function save(): Promise<void> {
  settings = read();
  await saveTranslate(settings);
  $('saved').textContent = '已保存';
  clearTimeout(savedTimer);
  savedTimer = window.setTimeout(() => ($('saved').textContent = ''), 1500);
}

async function test(): Promise<void> {
  await save();
  const out = $('testResult');
  out.className = 'hint';
  out.textContent = '测试中…';
  const started = Date.now();
  const res = (await chrome.runtime.sendMessage({
    type: 'tr:translate',
    texts: ['The quick brown fox jumps over the lazy dog.'],
    to: settings.target,
    engine: settings.engine,
  })) as TranslateResponse;
  const ms = Date.now() - started;
  if (!res?.ok) {
    out.className = 'errors';
    out.textContent = res?.error || '翻译失败';
  } else if (res.engine !== settings.engine) {
    out.className = 'errors';
    out.textContent = `${res.note ?? ENGINE_NAMES[settings.engine] + '不可用'}；备用的${ENGINE_NAMES[res.engine!]}可用：${res.items?.[0]?.text ?? ''}`;
  } else {
    out.className = 'ok';
    out.textContent = `${res.items?.[0]?.text ?? ''}（${ms} 毫秒）`;
  }
}

async function main(): Promise<void> {
  settings = await loadTranslate();
  for (const [id, name] of Object.entries(ENGINE_NAMES)) $<HTMLSelectElement>('engine').add(new Option(name, id));
  for (const [code, name] of LANGS) $<HTMLSelectElement>('target').add(new Option(name, code));
  $<HTMLSelectElement>('engine').value = settings.engine;
  $<HTMLSelectElement>('target').value = settings.target;
  $<HTMLInputElement>('fallback').checked = settings.fallback;
  $<HTMLSelectElement>('mode').value = settings.mode;
  $<HTMLSelectElement>('style').value = settings.style;
  $<HTMLInputElement>('deeplKey').value = settings.deeplKey;
  $<HTMLInputElement>('llmBase').value = settings.llm.baseUrl;
  $<HTMLInputElement>('llmKey').value = settings.llm.apiKey;
  $<HTMLInputElement>('llmModel').value = settings.llm.model;
  $<HTMLTextAreaElement>('autoSites').value = settings.autoSites.join('\n');
  $<HTMLInputElement>('fabEnabled').checked = settings.fab.enabled;
  $<HTMLTextAreaElement>('fabHidden').value = settings.fab.hiddenSites.join('\n');
  // 按钮在页面上被拖动、隐藏时，这里跟着刷新
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[TRANSLATE_KEY]) return;
    settings = normalizeTranslate(changes[TRANSLATE_KEY].newValue);
    $<HTMLInputElement>('fabEnabled').checked = settings.fab.enabled;
    if (document.activeElement !== $('fabHidden')) $<HTMLTextAreaElement>('fabHidden').value = settings.fab.hiddenSites.join('\n');
  });
  for (const el of Array.from(document.querySelectorAll<Field>('select, input, textarea'))) el.addEventListener('change', () => void save());
  $('test').addEventListener('click', () => void test());
}

if (typeof document !== 'undefined') void main();
