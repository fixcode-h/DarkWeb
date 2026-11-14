/**
 * 输入框翻译（静态内容脚本，document_idle，只在顶层页面运行）。
 *
 * 在输入框、文本框或可编辑区域里写完一段话，快速连按三次空格，
 * 已输入的内容就被替换成目标语言（默认英文）。替换用 insertText 完成，Ctrl+Z 可以撤销回原文。
 * 密码框、过长的内容不处理。翻译走后台已有的 tr:translate。
 */
import { siteKeyOf } from '../shared/settings';
import { langName } from '../translate/lang';
import { TRANSLATE_KEY, loadTranslate, normalizeTranslate, type TranslateResponse, type TranslateSettings } from '../translate/settings';
import { ENHANCE_KEY, enhanceActiveOn, loadEnhance, normalizeEnhance, type EnhanceSettings } from './settings';
import { escapeHtml } from './text';

const WINDOW_MS = 600;
const MAX_CHARS = 5000;

const CSS = `
:host { all: initial; }
.toast {
  --pop: #262626; --fg: #ececec; --edge: rgb(255 255 255 / .1); --accent: #257de0; --danger: #f07a7a;
  --shadow-pop: 0 8px 24px rgb(0 0 0 / .32), 0 2px 6px rgb(0 0 0 / .2);
  position: fixed; display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 10px;
  background: var(--pop); color: var(--fg); border: 1px solid var(--edge); box-shadow: var(--shadow-pop);
  font: 12px/1.4 system-ui, -apple-system, "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif;
  animation: pop 120ms cubic-bezier(.32, .72, 0, 1); white-space: nowrap; color-scheme: dark;
}
@media (prefers-color-scheme: light) {
  .toast { --pop: #fff; --fg: #191919; --edge: rgb(0 0 0 / .1); --danger: #c43c3c; --shadow-pop: 0 8px 24px rgb(0 0 0 / .12), 0 2px 6px rgb(0 0 0 / .08); color-scheme: light; }
}
.toast.err { color: var(--danger); }
.spin { width: 10px; height: 10px; border-radius: 50%; border: 2px solid transparent; border-top-color: var(--accent); animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes pop { from { opacity: 0; transform: translateY(4px); } }
@media (prefers-reduced-motion: reduce) { .toast { animation: none; } }
`;

type Editable = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

const TEXT_INPUTS = new Set(['text', 'search', 'url', 'email', '']);

/** 可以翻译的输入位置：普通文本框、多行文本框、可编辑区域；密码框之类不碰 */
export function editableOf(el: EventTarget | null): Editable | null {
  if (el instanceof HTMLTextAreaElement) return el.readOnly || el.disabled ? null : el;
  if (el instanceof HTMLInputElement) return TEXT_INPUTS.has(el.type) && !el.readOnly && !el.disabled ? el : null;
  if (el instanceof HTMLElement && el.isContentEditable) return (el.closest('[contenteditable]:not([contenteditable="false"])') as HTMLElement) ?? el;
  return null;
}

function valueOf(el: Editable): string {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : (el.innerText ?? '');
}

/** 选中全部内容再 insertText：保留浏览器原生的撤销记录，页面框架也能收到 input 事件 */
function replaceAll(el: Editable, text: string): void {
  el.focus();
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.select();
  } else {
    const r = document.createRange();
    r.selectNodeContents(el);
    const sel = getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
  }
  if (!document.execCommand('insertText', false, text)) {
    // 极少数编辑器拦了 execCommand：直接赋值
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.value = text;
    else el.textContent = text;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  }
}

class InputTranslator {
  private enhance!: EnhanceSettings;
  private tr!: TranslateSettings;
  private readonly site = siteKeyOf(location.host);
  private spaces: number[] = [];
  private busy = false;
  private host: HTMLElement | null = null;
  private toastTimer = 0;

  async init(): Promise<void> {
    [this.enhance, this.tr] = await Promise.all([loadEnhance(), loadTranslate()]);
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[ENHANCE_KEY]) this.enhance = normalizeEnhance(changes[ENHANCE_KEY].newValue);
      if (changes[TRANSLATE_KEY]) this.tr = normalizeTranslate(changes[TRANSLATE_KEY].newValue);
    });
    document.addEventListener('keydown', (e) => this.onKey(e), true);
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key !== ' ' || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) {
      if (e.key !== ' ') this.spaces = [];
      return;
    }
    if (!this.enhance.input.enabled || !enhanceActiveOn(this.enhance, this.site) || this.busy) return;
    const el = editableOf(e.composedPath()[0] ?? e.target);
    if (!el) return;
    const now = performance.now();
    this.spaces = [...this.spaces.filter((t) => now - t < WINDOW_MS), now];
    if (this.spaces.length < 3) return;
    this.spaces = [];
    e.preventDefault();
    // 前两次空格已经打进去了，翻译时一起去掉
    const text = valueOf(el).replace(/\s+$/, '');
    if (!text.trim() || text.length > MAX_CHARS) return;
    void this.translate(el, text);
  }

  private async translate(el: Editable, text: string): Promise<void> {
    this.busy = true;
    const to = this.enhance.input.target;
    this.toast(el, `正在译成${langName(to)}…`, 'busy');
    let res: TranslateResponse;
    try {
      res = await chrome.runtime.sendMessage({ type: 'tr:translate', texts: [escapeHtml(text)], to, engine: this.tr.engine });
    } catch (e) {
      res = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    this.busy = false;
    if (!res?.ok || !res.items?.[0]) {
      this.toast(el, res?.error || '翻译失败', 'err');
      return;
    }
    // 用户在等待期间又改了内容：不覆盖
    if (valueOf(el).replace(/\s+$/, '') !== text) {
      this.toast(el, '内容已改动，未替换', 'err');
      return;
    }
    const t = document.createElement('template');
    t.innerHTML = res.items[0].text.replace(/<br\s*\/?>/gi, '\n');
    replaceAll(el, (t.content.textContent ?? '').trim());
    this.toast(el, '已替换，Ctrl+Z 撤销', 'ok');
  }

  private toast(el: Editable, msg: string, kind: 'busy' | 'ok' | 'err'): void {
    if (!this.host) {
      this.host = document.createElement('div');
      this.host.setAttribute('data-drak-input', '');
      this.host.style.cssText = 'all: initial; position: fixed; top: 0; left: 0; z-index: 2147483647; pointer-events: none;';
      this.host.attachShadow({ mode: 'open' }).innerHTML = `<style>${CSS}</style><div class="toast"></div>`;
    }
    if (!this.host.isConnected) document.documentElement.appendChild(this.host);
    const box = this.host.shadowRoot!.querySelector('.toast') as HTMLElement;
    box.className = `toast ${kind === 'err' ? 'err' : ''}`;
    box.innerHTML = kind === 'busy' ? '<span class="spin"></span>' : '';
    box.append(msg);
    const r = el.getBoundingClientRect();
    box.style.left = `${Math.max(8, Math.min(r.left, innerWidth - 220))}px`;
    box.style.top = `${r.bottom + 6 + 30 > innerHeight ? Math.max(8, r.top - 36) : r.bottom + 6}px`;
    clearTimeout(this.toastTimer);
    if (kind !== 'busy') this.toastTimer = window.setTimeout(() => this.host?.remove(), kind === 'err' ? 3000 : 1800);
  }
}

if (window.top === window && /^https?:$/.test(location.protocol)) void new InputTranslator().init();
