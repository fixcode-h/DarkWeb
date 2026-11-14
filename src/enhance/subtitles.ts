/**
 * YouTube 双语字幕（静态内容脚本，只在 www.youtube.com 运行）。
 *
 * 播放器右下角加一个“译”按钮，打开后在原字幕下方显示译文（翻译设置里的目标语言）。
 * 做法是盯住播放器自己画出来的字幕：字幕一变就把这一屏的文字送去翻译（有缓存），
 * 译文作为一行插在原字幕下面。不读取视频的字幕文件，所以任何字幕轨（含自动生成）都能用。
 * 只有打开开关后才会把字幕文字发给翻译服务。
 */
import { looksLikeTarget } from '../translate/lang';
import { TRANSLATE_KEY, loadTranslate, normalizeTranslate, type TranslateResponse, type TranslateSettings } from '../translate/settings';
import { ENHANCE_KEY, loadEnhance, normalizeEnhance, saveEnhance, type EnhanceSettings } from './settings';
import { escapeHtml } from './text';

const SUB_CLASS = 'drak-sub';
const BTN_CLASS = 'drak-sub-btn';
const DEBOUNCE = 250;
const CACHE_MAX = 500;

const STYLE = `
.${SUB_CLASS} {
  display: block !important; width: fit-content; margin: 2px auto 0; padding: 1px 6px; border-radius: 3px;
  background: rgb(8 8 8 / .75); color: #ffe9a8; font-family: "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", system-ui, sans-serif;
  line-height: 1.35; text-align: center; white-space: pre-wrap; pointer-events: none;
}
.${BTN_CLASS} { display: inline-flex !important; align-items: center; justify-content: center; vertical-align: top; }
.${BTN_CLASS} span {
  display: grid; place-items: center; min-width: 26px; height: 20px; padding: 0 5px; border-radius: 6px; box-sizing: border-box;
  border: 1.5px solid rgb(255 255 255 / .85); color: #fff; font: 600 12px/1 system-ui, "PingFang SC", "Microsoft YaHei", sans-serif;
  transition: background 120ms cubic-bezier(.32, .72, 0, 1), border-color 120ms;
}
.${BTN_CLASS}[aria-pressed="true"] span { background: #257de0; border-color: #257de0; }
`;

/** 一个字幕框里显示的文字：各行之间用换行连起来 */
export function captionText(win: Element): string {
  return Array.from(win.querySelectorAll('.caption-visual-line'))
    .map((line) =>
      Array.from(line.querySelectorAll('.ytp-caption-segment'))
        .map((s) => s.textContent ?? '')
        .join(''),
    )
    .map((t) => t.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

class Subtitles {
  private enhance!: EnhanceSettings;
  private tr!: TranslateSettings;
  private container: Element | null = null;
  private observer = new MutationObserver(() => this.schedule());
  private timer = 0;
  private readonly cache = new Map<string, string>();
  private readonly pending = new Set<string>();

  async init(): Promise<void> {
    [this.enhance, this.tr] = await Promise.all([loadEnhance(), loadTranslate()]);
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.documentElement.appendChild(style);
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[ENHANCE_KEY]) this.enhance = normalizeEnhance(changes[ENHANCE_KEY].newValue);
      if (changes[TRANSLATE_KEY]) {
        const before = this.tr.target + this.tr.engine;
        this.tr = normalizeTranslate(changes[TRANSLATE_KEY].newValue);
        if (before !== this.tr.target + this.tr.engine) this.cache.clear();
      }
      this.syncButton();
      this.render();
    });
    // YouTube 是单页应用，播放器会换；每秒看一眼，确保按钮和监听挂在当前播放器上
    setInterval(() => this.attach(), 1000);
    this.attach();
  }

  private attach(): void {
    const controls = document.querySelector('#movie_player .ytp-right-controls');
    if (controls && !controls.querySelector(`.${BTN_CLASS}`)) {
      const btn = document.createElement('button');
      btn.className = `ytp-button ${BTN_CLASS}`;
      btn.title = '双语字幕（Drak）';
      btn.setAttribute('aria-label', '双语字幕');
      btn.innerHTML = '<span>译</span>';
      btn.addEventListener('click', () => void this.toggle());
      controls.prepend(btn);
      this.syncButton();
    }
    const container = document.querySelector('#movie_player .ytp-caption-window-container');
    if (container && container !== this.container) {
      this.observer.disconnect();
      this.container = container;
      this.observer.observe(container, { childList: true, subtree: true, characterData: true });
      this.schedule();
    }
  }

  private syncButton(): void {
    document.querySelectorAll(`.${BTN_CLASS}`).forEach((b) => b.setAttribute('aria-pressed', String(this.enhance.subtitles.enabled)));
  }

  private async toggle(): Promise<void> {
    const latest = normalizeEnhance((await chrome.storage.local.get(ENHANCE_KEY))[ENHANCE_KEY]);
    latest.subtitles.enabled = !latest.subtitles.enabled;
    this.enhance = latest;
    this.syncButton();
    // 打开双语时顺手打开播放器自己的字幕
    if (latest.subtitles.enabled) {
      const cc = document.querySelector('#movie_player .ytp-subtitles-button');
      if (cc?.getAttribute('aria-pressed') === 'false') (cc as HTMLElement).click();
    }
    this.render();
    await saveEnhance(latest);
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.render(), DEBOUNCE);
  }

  /** 给每个字幕框补上（或更新、撤掉）译文那一行 */
  private render(): void {
    if (!this.container) return;
    const on = this.enhance.subtitles.enabled;
    for (const win of Array.from(this.container.querySelectorAll('.caption-window'))) {
      const box = win.querySelector('.captions-text') ?? win;
      let line = box.querySelector(`:scope > .${SUB_CLASS}`) as HTMLElement | null;
      const text = on ? captionText(win) : '';
      const translated = text && !looksLikeTarget(text, this.tr.target) ? this.cache.get(text) : undefined;
      if (!translated) {
        line?.remove();
        if (text && !looksLikeTarget(text, this.tr.target)) void this.request(text);
        continue;
      }
      if (!line) {
        line = document.createElement('span');
        line.className = SUB_CLASS;
        line.setAttribute('translate', 'no');
      }
      if (line.textContent !== translated) line.textContent = translated;
      // 字号跟原字幕一致
      const seg = win.querySelector('.ytp-caption-segment') as HTMLElement | null;
      if (seg) line.style.fontSize = getComputedStyle(seg).fontSize;
      if (line.parentNode !== box || line.nextSibling) {
        this.observer.disconnect();
        box.appendChild(line);
        this.observer.observe(this.container, { childList: true, subtree: true, characterData: true });
      }
    }
  }

  private async request(text: string): Promise<void> {
    if (this.pending.has(text)) return;
    this.pending.add(text);
    let res: TranslateResponse | undefined;
    try {
      res = await chrome.runtime.sendMessage({ type: 'tr:translate', texts: [escapeHtml(text).replace(/\n/g, '<br>')], to: this.tr.target, engine: this.tr.engine });
    } catch {
      res = undefined;
    }
    this.pending.delete(text);
    if (!res?.ok || !res.items?.[0]) return;
    const t = document.createElement('template');
    t.innerHTML = res.items[0].text.replace(/<br\s*\/?>/gi, '\n');
    this.cache.set(text, (t.content.textContent ?? '').trim());
    if (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
    this.render();
  }
}

if (window.top === window && /(^|\.)youtube\.com$/.test(location.hostname)) void new Subtitles().init();
