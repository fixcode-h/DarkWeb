/** 阅读增强设置页里的“Markdown 文件”一节 */
import { MD_EDITOR_SIZES, MD_KEY, loadMarkdown, normalizeMarkdown, saveMarkdown, type MarkdownSettings, type MdView } from './settings';

const $ = <T extends HTMLElement = HTMLInputElement>(id: string) => document.getElementById(id) as T;

let s: MarkdownSettings;
let savedTimer = 0;

async function save(): Promise<void> {
  await saveMarkdown(s);
  const el = $('saved');
  el.classList.add('show');
  clearTimeout(savedTimer);
  savedTimer = window.setTimeout(() => el.classList.remove('show'), 1200);
}

function render(): void {
  $('mdEnabled').checked = s.enabled;
  $('mdRemote').checked = s.remote;
  $<HTMLSelectElement>('mdView').value = s.view;
  $('mdToc').checked = s.toc;
  $('mdDrafts').checked = s.drafts;
  $('mdSync').checked = s.syncScroll;
  $<HTMLSelectElement>('mdEditorSize').value = String(s.editorFontSize);
  for (const id of ['mdRemote', 'mdView', 'mdToc', 'mdDrafts', 'mdSync', 'mdEditorSize']) $(id).disabled = !s.enabled;
}

function bind(id: string, fn: (el: HTMLInputElement) => void): void {
  $(id).addEventListener('change', () => {
    fn($(id));
    render();
    void save();
  });
}

async function checkFileAccess(): Promise<void> {
  const allowed = await new Promise<boolean>((resolve) => chrome.extension.isAllowedFileSchemeAccess(resolve));
  $('mdFileWarn').classList.toggle('hidden', allowed || !s.enabled);
}

async function main(): Promise<void> {
  s = await loadMarkdown();
  for (const px of MD_EDITOR_SIZES) $<HTMLSelectElement>('mdEditorSize').add(new Option(`${px} px`, String(px)));
  render();
  void checkFileAccess();
  // 从扩展详情页开完权限回来，提示自动消失
  window.addEventListener('focus', () => void checkFileAccess());
  $('mdFileAccess').addEventListener('click', () => void chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` }));
  bind('mdEnabled', (el) => {
    s.enabled = el.checked;
    void checkFileAccess();
  });
  bind('mdRemote', (el) => (s.remote = el.checked));
  bind('mdView', (el) => (s.view = el.value as MdView));
  bind('mdToc', (el) => (s.toc = el.checked));
  bind('mdDrafts', (el) => (s.drafts = el.checked));
  bind('mdSync', (el) => (s.syncScroll = el.checked));
  bind('mdEditorSize', (el) => (s.editorFontSize = Number(el.value)));
  // Markdown 页面里改的字号、主题等也写同一个键，这里跟上，免得这页保存时写回旧值
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[MD_KEY]) return;
    s = normalizeMarkdown(changes[MD_KEY].newValue);
    render();
  });
}

void main();
