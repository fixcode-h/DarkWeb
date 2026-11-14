/** 阅读增强设置页 */
import { siteKeyOf } from '../shared/settings';
import { fontStack, loadEnhance, parseSiteLines, saveEnhance, type EnhanceSettings, type FilterMode, type FontFamily, type SelectionTrigger } from './settings';

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

async function main(): Promise<void> {
  s = await loadEnhance();
  $<HTMLTextAreaElement>('sites').value = s.disabledSites.join('\n');
  render();
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
