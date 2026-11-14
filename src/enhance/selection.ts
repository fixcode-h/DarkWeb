/**
 * 划词翻译（静态内容脚本，document_idle，只在顶层页面运行）。
 *
 * 选中一段文字后，在选区末尾旁出现一个小“译”图标，点一下弹出译文卡片；
 * 设置成“立即翻译”时松开鼠标就出卡片。右键“翻译选中的文字”也会打开卡片。
 * 翻译走后台已有的 tr:translate（引擎、目标语言、缓存、自动换引擎都和整页翻译一致）。
 * 卡片放在 Shadow DOM 里，配色照 AgentPanel：中性灰卡片、10px 浮层圆角、蓝色强调、120ms 进场。
 */
import { siteKeyOf } from '../shared/settings';
import { langName } from '../translate/lang';
import { escapeHtml, selectionTarget } from './text';
import { ENGINE_NAMES, TRANSLATE_KEY, loadTranslate, normalizeTranslate, type TranslateResponse, type TranslateSettings } from '../translate/settings';
import { ENHANCE_KEY, enhanceActiveOn, loadEnhance, normalizeEnhance, type EnhanceSettings } from './settings';

const MAX_CHARS = 3000;

const CSS = `
:host { all: initial; }
.root {
  --card: #1f1f1f; --pop: #262626; --fg: #ececec; --muted: #c6c6c6; --subtle: #9c9c9c;
  --edge: rgb(255 255 255 / .1); --hover: rgb(255 255 255 / .07); --active: rgb(255 255 255 / .11);
  --accent: #257de0; --accent-text: #6aabf1; --on-accent: #fff; --danger: #f07a7a;
  --shadow-pop: 0 8px 24px rgb(0 0 0 / .32), 0 2px 6px rgb(0 0 0 / .2);
  --ease-snap: cubic-bezier(.32, .72, 0, 1);
  font: 13px/1.5 system-ui, -apple-system, "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif;
  color: var(--fg); color-scheme: dark;
}
@media (prefers-color-scheme: light) {
  .root {
    --card: #fff; --pop: #fff; --fg: #191919; --muted: #404040; --subtle: #666;
    --edge: rgb(0 0 0 / .1); --hover: rgb(0 0 0 / .05); --active: rgb(0 0 0 / .09); --accent-text: #1757ac; --danger: #c43c3c;
    --shadow-pop: 0 8px 24px rgb(0 0 0 / .12), 0 2px 6px rgb(0 0 0 / .08);
    color-scheme: light;
  }
}
.icon, .card { position: absolute; box-sizing: border-box; }
.icon {
  all: unset; position: absolute; box-sizing: border-box; width: 26px; height: 26px; border-radius: 8px; cursor: pointer;
  display: grid; place-items: center; font-weight: 600; font-size: 13px;
  background: var(--card); color: var(--muted); border: 1px solid var(--edge); box-shadow: var(--shadow-pop);
  animation: pop 120ms var(--ease-snap);
}
.icon:hover { color: var(--fg); background: color-mix(in srgb, var(--card), var(--fg) 7%); }
.icon:active { transform: scale(.92); }
.icon:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.card {
  width: min(380px, calc(100vw - 16px)); max-height: min(420px, 70vh); display: flex; flex-direction: column;
  background: var(--pop); border: 1px solid var(--edge); border-radius: 10px; box-shadow: var(--shadow-pop);
  animation: pop 120ms var(--ease-snap); overflow: hidden;
}
@keyframes pop { from { opacity: 0; transform: scale(.96); } }
.head { display: flex; align-items: center; gap: 8px; padding: 8px 8px 0 12px; color: var(--subtle); font-size: 12px; }
.head .lang { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tool {
  all: unset; box-sizing: border-box; cursor: pointer; width: 26px; height: 26px; border-radius: 7px;
  display: grid; place-items: center; color: var(--subtle); transition: background 60ms, color 60ms;
}
.tool:hover, .tool:focus-visible { background: var(--hover); color: var(--fg); }
.tool:active { background: var(--active); }
.tool svg { width: 14px; height: 14px; }
.body { padding: 6px 12px 12px; overflow: auto; }
.src { color: var(--subtle); font-size: 12px; margin-bottom: 6px; white-space: pre-wrap; word-break: break-word;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.out { color: var(--fg); font-size: 14px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; -webkit-user-select: text; user-select: text; }
.err { color: var(--danger); }
.foot { padding: 0 12px 10px; color: var(--subtle); font-size: 11px; }
.dots { display: inline-flex; gap: 4px; padding: 6px 0; }
.dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); animation: blink 1s infinite ease-in-out; }
.dots i:nth-child(2) { animation-delay: .15s; } .dots i:nth-child(3) { animation-delay: .3s; }
@keyframes blink { 0%, 80%, 100% { opacity: .25; } 40% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .icon, .card, .dots i { animation: none; } }
@media print { .root { display: none; } }
`;

const ICON_COPY =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 3.5v-.5A1.5 1.5 0 0 0 9 1.5H3A1.5 1.5 0 0 0 1.5 3v6A1.5 1.5 0 0 0 3 10.5h.5"/></svg>';
const ICON_OK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 8.5l3 3 7-7"/></svg>';
const ICON_CLOSE = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 4l8 8M12 4l-8 8"/></svg>';

/** 译文是 HTML 片段，转回纯文字显示（template 里的内容不会执行） */
function htmlToText(html: string): string {
  const t = document.createElement('template');
  t.innerHTML = html.replace(/<br\s*\/?>/gi, '\n');
  return t.content.textContent ?? '';
}

class SelectionTranslator {
  private host: HTMLElement | null = null;
  private root!: HTMLElement;
  private icon: HTMLButtonElement | null = null;
  private card: HTMLElement | null = null;
  private enhance!: EnhanceSettings;
  private tr!: TranslateSettings;
  private readonly site = siteKeyOf(location.host);
  private seq = 0;
  /** 最近一次选区：文字和选区末尾的位置（页面坐标） */
  private last: { text: string; x: number; y: number; top: number; bottom: number; left: number } | null = null;

  async init(): Promise<void> {
    [this.enhance, this.tr] = await Promise.all([loadEnhance(), loadTranslate()]);
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[ENHANCE_KEY]) this.enhance = normalizeEnhance(changes[ENHANCE_KEY].newValue);
      if (changes[TRANSLATE_KEY]) this.tr = normalizeTranslate(changes[TRANSLATE_KEY].newValue);
      if (!this.enabled()) this.closeAll();
    });
    document.addEventListener('mouseup', (e) => this.onMouseUp(e), true);
    document.addEventListener('mousedown', (e) => this.onMouseDown(e), true);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeAll();
    }, true);
    window.addEventListener('blur', () => this.hideIcon());
    // 右键菜单“翻译选中的文字”
    chrome.runtime.onMessage.addListener((msg: { type?: string; text?: string }) => {
      if (msg?.type !== 'enh:translate-selection') return;
      const picked = this.readSelection();
      const text = picked?.text || String(msg.text ?? '').trim();
      if (!text) return;
      this.last = picked ?? { text, x: innerWidth / 2 + scrollX, y: 80 + scrollY, top: 80 + scrollY, bottom: 80 + scrollY, left: innerWidth / 2 - 190 + scrollX };
      this.last.text = text;
      void this.translate();
    });
  }

  private enabled(): boolean {
    return this.enhance.selection.enabled && enhanceActiveOn(this.enhance, this.site);
  }

  private isOurs(e: Event): boolean {
    return !!this.host && e.composedPath().includes(this.host);
  }

  private onMouseDown(e: MouseEvent): void {
    if (this.isOurs(e)) return;
    this.closeAll();
  }

  private onMouseUp(e: MouseEvent): void {
    if (e.button !== 0 || this.isOurs(e) || !this.enabled()) return;
    // 等浏览器把选区定下来（双击选词、三击选段落）
    setTimeout(() => {
      const picked = this.readSelection();
      if (!picked) return;
      this.last = picked;
      if (this.enhance.selection.trigger === 'auto') void this.translate();
      else this.showIcon();
    }, 10);
  }

  private readSelection(): typeof this.last {
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const text = sel.toString().trim();
    if (!text || text.length > MAX_CHARS || !/[\p{L}]/u.test(text)) return null;
    // 输入框、可编辑区域里选字是为了改字，不打扰
    const node = sel.anchorNode;
    const el = node instanceof Element ? node : node?.parentElement;
    if (el?.closest('input, textarea, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]')) return null;
    const range = sel.getRangeAt(sel.rangeCount - 1);
    const rects = range.getClientRects();
    const end = rects[rects.length - 1] ?? range.getBoundingClientRect();
    const all = range.getBoundingClientRect();
    if (!end || (!end.width && !end.height)) return null;
    return { text, x: end.right + scrollX, y: end.bottom + scrollY, top: all.top + scrollY, bottom: all.bottom + scrollY, left: all.left + scrollX };
  }

  private mount(): void {
    if (!this.host) {
      this.host = document.createElement('div');
      this.host.setAttribute('translate', 'no');
      this.host.dataset.drakSelection = '';
      this.host.style.cssText = 'all: initial; position: absolute; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;';
      const shadow = this.host.attachShadow({ mode: 'open' });
      shadow.innerHTML = `<style>${CSS}</style><div class="root"></div>`;
      this.root = shadow.querySelector('.root')!;
    }
    if (!this.host.isConnected) document.documentElement.appendChild(this.host);
  }

  private hideIcon(): void {
    this.icon?.remove();
    this.icon = null;
  }

  private closeAll(): void {
    this.seq++;
    this.hideIcon();
    this.card?.remove();
    this.card = null;
  }

  private showIcon(): void {
    if (!this.last) return;
    this.mount();
    this.hideIcon();
    const b = document.createElement('button');
    b.className = 'icon';
    b.type = 'button';
    b.title = '翻译选中的文字';
    b.textContent = '译';
    const maxX = scrollX + document.documentElement.clientWidth - 30;
    b.style.left = `${Math.min(this.last.x + 4, maxX)}px`;
    b.style.top = `${this.last.y + 6}px`;
    // 不让点击把页面选区清掉
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => void this.translate());
    this.root.appendChild(b);
    this.icon = b;
  }

  private async translate(): Promise<void> {
    const sel = this.last;
    if (!sel) return;
    this.mount();
    this.hideIcon();
    this.card?.remove();
    const id = ++this.seq;
    const to = selectionTarget(sel.text, this.tr.target);

    const card = document.createElement('div');
    card.className = 'card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', '划词翻译');
    card.innerHTML = `
      <div class="head"><span class="lang"></span>
        <button class="tool copy" type="button" title="复制译文">${ICON_COPY}</button>
        <button class="tool close" type="button" title="关闭（Esc）">${ICON_CLOSE}</button>
      </div>
      <div class="body"><div class="src"></div><div class="out"><span class="dots"><i></i><i></i><i></i></span></div></div>
      <div class="foot"></div>`;
    const $ = (s: string) => card.querySelector(s) as HTMLElement;
    $('.lang').textContent = `译成 ${langName(to)}`;
    $('.src').textContent = sel.text;
    $('.close').addEventListener('click', () => this.closeAll());
    const copy = $('.copy');
    copy.style.visibility = 'hidden';
    this.root.appendChild(card);
    this.card = card;
    this.place(card, sel);

    let res: TranslateResponse;
    try {
      res = await chrome.runtime.sendMessage({ type: 'tr:translate', texts: [escapeHtml(sel.text)], to, engine: this.tr.engine });
    } catch (e) {
      res = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    if (id !== this.seq || !card.isConnected) return;
    const out = $('.out');
    if (!res?.ok || !res.items?.[0]) {
      out.className = 'out err';
      out.textContent = res?.error || '翻译失败';
      return;
    }
    const text = htmlToText(res.items[0].text).trim();
    out.textContent = text;
    const src = res.items[0].src;
    if (src) $('.lang').textContent = `${langName(src)} → ${langName(to)}`;
    $('.foot').textContent = (res.engine ? ENGINE_NAMES[res.engine] : '') + (res.note ? ' · 首选引擎不可用，已自动换用' : '');
    copy.style.visibility = '';
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(text);
        copy.innerHTML = ICON_OK;
        setTimeout(() => (copy.innerHTML = ICON_COPY), 1200);
      } catch {
        /* 页面禁止写剪贴板 */
      }
    });
    this.place(card, sel);
  }

  /** 卡片放在选区下方；下面放不下就放上面；左右不出视口 */
  private place(card: HTMLElement, sel: NonNullable<typeof this.last>): void {
    const vw = document.documentElement.clientWidth;
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    const left = Math.max(scrollX + 8, Math.min(sel.left, scrollX + vw - w - 8));
    let top = sel.bottom + 8;
    if (top + h > scrollY + innerHeight - 8 && sel.top - scrollY > h + 16) top = sel.top - h - 8;
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }
}

if (window.top === window && /^https?:$/.test(location.protocol)) void new SelectionTranslator().init();
