/** 阅读增强设置页 */
import { siteKeyOf } from '../shared/settings';
import { fontStack, loadEnhance, normalizeEnhance, parseSiteLines, saveEnhance, type EnhanceSettings, type FilterMode, type FontFamily, type SelectionTrigger } from './settings';

const $ = <T extends HTMLElement = HTMLInputElement>(id: string) => document.getElementById(id) as T;

let s: EnhanceSettings;
let savedTimer = 0;

async function save(): Promise<void> {
  await saveEnhance(s);
  const el = $('saved');
  el.classList.add('show');
  clearTimeout(savedTimer);
  savedTimer = window.setTimeout(() => el.classList.remove('show'), 1200);
}

function render(): void {
  $('selEnabled').checked = s.selection.enabled;
  $<HTMLSelectElement>('selTrigger').value = s.selection.trigger;
  $<HTMLSelectElement>('selTrigger').disabled = !s.selection.enabled;
  $<HTMLSelectElement>('fontFamily').value = s.font.family;
  $('fontCustom').value = s.font.custom;
  $('customRow').classList.toggle('hidden', s.font.family !== 'custom');
  $<HTMLSelectElement>('lineHeight').value = String(s.font.lineHeight);
  $('bolder').checked = s.font.bolder;
  $<HTMLSelectElement>('filterMode').value = s.filter.mode;
  $('strength').value = String(s.filter.strength);
  $('strengthVal').textContent = `${s.filter.strength}%`;
  $('strengthRow').classList.toggle('hidden', s.filter.mode === 'off');
  const pv = $('preview');
  pv.style.fontFamily = fontStack(s.font);
  pv.style.lineHeight = s.font.lineHeight ? String(s.font.lineHeight) : '';
  pv.style.setProperty('-webkit-text-stroke', s.font.bolder ? '0.25px currentColor' : '');
}

function bind(id: string, ev: 'change' | 'input', fn: (el: HTMLInputElement) => void): void {
  $(id).addEventListener(ev, () => {
    fn($(id));
    render();
    void save();
  });
}

/** 按网站的屏蔽规则与自定义 CSS 列表 */
function renderSites(): void {
  const list = $('siteList');
  const sites = [...new Set([...Object.keys(s.hideRules), ...Object.keys(s.siteCss)])].sort();
  list.replaceChildren();
  if (!sites.length) {
    const p = document.createElement('div');
    p.className = 'empty-sites';
    p.textContent = '还没有。在网页上右键“屏蔽页面元素…”点选，或在下面添加网站后手写。';
    list.appendChild(p);
    return;
  }
  for (const site of sites) {
    const box = document.createElement('div');
    box.className = 'site';
    box.innerHTML = `<div class="site-head"><b></b><button type="button" class="btn danger">删除</button></div>
      <label>隐藏的元素（CSS 选择器，一行一个）<textarea class="sels" spellcheck="false"></textarea></label>
      <label>自定义 CSS<textarea class="css" spellcheck="false" placeholder="例如：.sidebar { width: 200px !important; }"></textarea></label>`;
    box.querySelector('b')!.textContent = site;
    const sels = box.querySelector('.sels') as HTMLTextAreaElement;
    const css = box.querySelector('.css') as HTMLTextAreaElement;
    sels.value = (s.hideRules[site] ?? []).join('\n');
    css.value = s.siteCss[site] ?? '';
    const commit = () => {
      const next = normalizeEnhance({ ...s, hideRules: { ...s.hideRules, [site]: sels.value.split('\n') }, siteCss: { ...s.siteCss, [site]: css.value } });
      s.hideRules = next.hideRules;
      s.siteCss = next.siteCss;
      // 清空后两项都没有了，保留这一栏直到刷新，方便继续写
      sels.value = (s.hideRules[site] ?? []).join('\n');
      void save();
    };
    sels.addEventListener('change', commit);
    css.addEventListener('change', commit);
    box.querySelector('.danger')!.addEventListener('click', () => {
      delete s.hideRules[site];
      delete s.siteCss[site];
      renderSites();
      void save();
    });
    list.appendChild(box);
  }
}

async function main(): Promise<void> {
  s = await loadEnhance();
  $<HTMLTextAreaElement>('sites').value = s.disabledSites.join('\n');
  render();
  renderSites();
  $('shortcuts').addEventListener('click', () => void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));
  $('addSite').addEventListener('click', () => {
    const site = siteKeyOf($('newSite').value);
    if (!site) return;
    // 先放一条空的自定义 CSS 占位，让这一栏出现
    if (!(site in s.hideRules) && !(site in s.siteCss)) s.siteCss[site] = '/* 在这里写本站的 CSS */';
    $('newSite').value = '';
    renderSites();
    void save();
  });
  // 页面上点选隐藏后，这里同步刷新
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.enhance) return;
    const next = normalizeEnhance(changes.enhance.newValue);
    // 阅读模式里改的排版偏好不在这页显示，但要跟上，免得这页保存时写回旧值
    s.reader = next.reader;
    if (JSON.stringify(next.hideRules) !== JSON.stringify(s.hideRules) && !document.activeElement?.closest('#siteList')) {
      s.hideRules = next.hideRules;
      s.siteCss = next.siteCss;
      renderSites();
    }
  });
  bind('selEnabled', 'change', (el) => (s.selection.enabled = el.checked));
  bind('selTrigger', 'change', (el) => (s.selection.trigger = el.value as SelectionTrigger));
  bind('fontFamily', 'change', (el) => (s.font.family = el.value as FontFamily));
  bind('fontCustom', 'change', (el) => (s.font.custom = el.value.replace(/[^\p{L}\p{N} ,"'_-]/gu, '')));
  bind('lineHeight', 'change', (el) => (s.font.lineHeight = Number(el.value)));
  bind('bolder', 'change', (el) => (s.font.bolder = el.checked));
  bind('filterMode', 'change', (el) => (s.filter.mode = el.value as FilterMode));
  bind('strength', 'input', (el) => (s.filter.strength = Number(el.value)));
  $<HTMLTextAreaElement>('sites').addEventListener('change', (e) => {
    s.disabledSites = parseSiteLines((e.target as HTMLTextAreaElement).value, siteKeyOf);
    $<HTMLTextAreaElement>('sites').value = s.disabledSites.join('\n');
    void save();
  });
}

void main();
