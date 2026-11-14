/**
 * 阅读模式（按需注入：右键“阅读模式”、快捷键、设置页说明里的入口）。
 *
 * 用 Mozilla Readability 抽出正文，在全屏覆盖层里重新排版；再触发一次或按 Esc 关闭。
 * 覆盖层放在 Shadow DOM 里，配色照 AgentPanel：中性灰、蓝色强调、10px 圆角、120ms 进场；
 * 字号、栏宽、字体、主题记在设置里，下次打开沿用。
 */
import { Readability } from '@mozilla/readability';
import { ENHANCE_KEY, READER_FONT_SIZES, READER_WIDTHS, loadEnhance, normalizeEnhance, saveEnhance, type EnhanceSettings, type ReaderPrefs } from './settings';
import { sanitizeArticle } from './sanitize';

const CSS = `
:host { all: initial; }
.shell {
  --bg: #171717; --card: #1f1f1f; --pop: #262626; --fg: #e6e6e6; --muted: #c6c6c6; --subtle: #9c9c9c;
  --edge: rgb(255 255 255 / .1); --hover: rgb(255 255 255 / .07); --active: rgb(255 255 255 / .11);
  --accent: #257de0; --link: #6aabf1; --code-bg: rgb(255 255 255 / .06);
  --shadow-pop: 0 8px 24px rgb(0 0 0 / .32), 0 2px 6px rgb(0 0 0 / .2);
  --ease-snap: cubic-bezier(.32, .72, 0, 1);
  position: fixed; inset: 0; z-index: 2147483647; overflow: auto; overscroll-behavior: contain;
  background: var(--bg); color: var(--fg); color-scheme: dark;
  font: 14px/1.5 system-ui, -apple-system, "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif;
  animation: fade 120ms var(--ease-snap);
}
.shell.light {
  --bg: #fbfbfa; --card: #fff; --pop: #fff; --fg: #1f1f1f; --muted: #404040; --subtle: #6b6b6b;
  --edge: rgb(0 0 0 / .1); --hover: rgb(0 0 0 / .05); --active: rgb(0 0 0 / .09); --link: #1757ac; --code-bg: rgb(0 0 0 / .05);
  --shadow-pop: 0 8px 24px rgb(0 0 0 / .12), 0 2px 6px rgb(0 0 0 / .08); color-scheme: light;
}
.shell.sepia {
  --bg: #f4ecd8; --card: #f8f1e1; --pop: #fbf6ea; --fg: #3b2f22; --muted: #5b4a37; --subtle: #85725c;
  --edge: rgb(80 60 30 / .16); --hover: rgb(80 60 30 / .07); --active: rgb(80 60 30 / .12); --link: #8a4b14; --code-bg: rgb(80 60 30 / .08);
  --shadow-pop: 0 8px 24px rgb(80 60 30 / .14), 0 2px 6px rgb(80 60 30 / .08); color-scheme: light;
}
@keyframes fade { from { opacity: 0; } }
.bar {
  position: sticky; top: 12px; z-index: 1; width: max-content; margin: 12px 16px 0 auto; display: flex; align-items: center; gap: 2px; padding: 4px;
  background: var(--pop); border: 1px solid var(--edge); border-radius: 10px; box-shadow: var(--shadow-pop);
}
.bar button {
  all: unset; box-sizing: border-box; cursor: pointer; min-width: 30px; height: 30px; padding: 0 8px; border-radius: 7px;
  display: grid; place-items: center; color: var(--muted); font-size: 13px; transition: background 60ms, color 60ms; white-space: nowrap;
}
.bar button:hover, .bar button:focus-visible { background: var(--hover); color: var(--fg); }
.bar button:active { background: var(--active); }
.bar button[aria-pressed="true"] { color: var(--fg); background: var(--active); }
.bar .sep { width: 1px; height: 18px; background: var(--edge); margin: 0 4px; }
.bar svg { width: 15px; height: 15px; }
.page { margin: 0 auto; padding: 24px 24px 120px; box-sizing: content-box; }
.content article, .content section { display: block; margin: 0; padding: 0; }
.meta { color: var(--subtle); font-size: .8em; margin-bottom: 8px; }
h1.title { font-size: 1.75em; line-height: 1.3; margin: 0 0 8px; font-weight: 700; color: var(--fg); }
.byline { color: var(--subtle); font-size: .85em; margin-bottom: 28px; padding-bottom: 20px; border-bottom: 1px solid var(--edge); }
.content { line-height: 1.8; word-break: break-word; overflow-wrap: anywhere; }
.content.serif, h1.title.serif { font-family: "Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", "SimSun", Georgia, serif; }
.content p { margin: 0 0 1.1em; }
.content h2, .content h3, .content h4 { line-height: 1.4; margin: 1.6em 0 .6em; color: var(--fg); }
.content a { color: var(--link); text-decoration: underline; text-decoration-color: color-mix(in srgb, var(--link) 40%, transparent); text-underline-offset: 3px; }
.content img, .content video, .content picture, .content svg { max-width: 100%; height: auto; border-radius: 7px; }
.content figure { margin: 1.4em 0; } .content figcaption { color: var(--subtle); font-size: .85em; text-align: center; margin-top: 6px; }
.content blockquote { margin: 1.2em 0; padding: 2px 0 2px 16px; border-left: 3px solid var(--edge); color: var(--muted); }
.content pre { background: var(--code-bg); border: 1px solid var(--edge); border-radius: 7px; padding: 12px 14px; overflow: auto; font-size: .82em; line-height: 1.6; }
.content code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .88em; }
.content :not(pre) > code { background: var(--code-bg); padding: 1px 5px; border-radius: 4px; }
.content table { border-collapse: collapse; display: block; overflow: auto; font-size: .9em; }
.content th, .content td { border: 1px solid var(--edge); padding: 6px 10px; }
.content hr { border: 0; border-top: 1px solid var(--edge); margin: 2em 0; }
.empty { color: var(--subtle); text-align: center; padding: 120px 24px; }
@media (prefers-reduced-motion: reduce) { .shell { animation: none; } }
@media print { .bar { display: none; } .shell { position: static; overflow: visible; } }
`;

const ICON_CLOSE = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
const THEMES: Array<[ReaderPrefs['theme'], string]> = [
  ['auto', '跟随系统'],
  ['dark', '深色'],
  ['light', '浅色'],
  ['sepia', '米黄'],
];

interface ReaderApi {
  toggle(): void;
  isOpen(): boolean;
}

class Reader implements ReaderApi {
  private host: HTMLElement | null = null;
  private shell!: HTMLElement;
  private prefs!: ReaderPrefs;
  private settings!: EnhanceSettings;
  private prevOverflow = '';
  private prevFocus: Element | null = null;
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this.isOpen()) {
      e.stopPropagation();
      this.close();
    }
  };
  private readonly media = matchMedia('(prefers-color-scheme: light)');

  isOpen(): boolean {
    return !!this.host?.isConnected;
  }

  toggle(): void {
    if (this.isOpen()) this.close();
    else void this.open();
  }

  private async open(): Promise<void> {
    this.settings = await loadEnhance();
    this.prefs = this.settings.reader;
    // Readability 会改动传入的文档，给它一份副本
    const clone = document.cloneNode(true) as Document;
    let article: ReturnType<Readability['parse']> = null;
    try {
      article = new Readability(clone, { charThreshold: 300 }).parse();
    } catch {
      article = null;
    }
    this.host = document.createElement('div');
    this.host.setAttribute('data-drak-reader', '');
    this.host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647;';
    const shadow = this.host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${CSS}</style><div class="shell" role="dialog" aria-modal="true" aria-label="阅读模式" tabindex="-1"></div>`;
    this.shell = shadow.querySelector('.shell')!;
    this.shell.innerHTML = `
      <div class="bar" role="toolbar" aria-label="阅读模式设置">
        <button data-act="smaller" title="减小字号">A−</button>
        <button data-act="bigger" title="增大字号">A+</button>
        <span class="sep"></span>
        <button data-act="narrow" title="窄栏">窄</button>
        <button data-act="wide" title="宽栏">宽</button>
        <span class="sep"></span>
        <button data-act="font" title="切换黑体 / 宋体"></button>
        <button data-act="theme" title="切换主题"></button>
        <span class="sep"></span>
        <button data-act="close" title="退出阅读模式（Esc）">${ICON_CLOSE}</button>
      </div>
      <div class="page"><div class="meta"></div><h1 class="title"></h1><div class="byline"></div><div class="content"></div></div>`;
    const $ = (s: string) => this.shell.querySelector(s) as HTMLElement;
    if (article?.content && (article.textContent?.trim().length ?? 0) > 80) {
      $('.meta').textContent = article.siteName || location.hostname;
      $('.title').textContent = article.title || document.title;
      const mins = Math.max(1, Math.round((article.length ?? 0) / 500));
      $('.byline').textContent = [article.byline, `约 ${mins} 分钟读完`].filter(Boolean).join(' · ');
      const body = sanitizeArticle(article.content, location.href);
      // 正文开头常常再带一遍标题，上面已经显示过了
      const norm = (t: string | null | undefined) => (t ?? '').replace(/\s+/g, '').toLowerCase();
      const first = body.querySelector('h1, h2');
      if (first && norm(first.textContent) === norm($('.title').textContent)) first.remove();
      $('.content').replaceChildren(body);
      if (article.dir) $('.content').dir = article.dir;
      if (article.lang) $('.content').lang = article.lang;
    } else {
      $('.page').innerHTML = '<div class="empty">这个页面没有找到适合阅读模式的正文。</div>';
    }
    this.shell.addEventListener('click', (e) => {
      const btn = (e.target as Element).closest('button[data-act]');
      if (btn) this.act(btn.getAttribute('data-act')!);
    });
    this.media.addEventListener('change', this.applyPrefs);
    this.applyPrefs();
    this.prevOverflow = document.documentElement.style.overflow;
    this.prevFocus = document.activeElement;
    document.documentElement.style.overflow = 'hidden';
    document.documentElement.appendChild(this.host);
    document.addEventListener('keydown', this.onKey, true);
    this.shell.focus({ preventScroll: true });
  }

  private close(): void {
    this.host?.remove();
    this.host = null;
    document.documentElement.style.overflow = this.prevOverflow;
    document.removeEventListener('keydown', this.onKey, true);
    this.media.removeEventListener('change', this.applyPrefs);
    if (this.prevFocus instanceof HTMLElement) this.prevFocus.focus({ preventScroll: true });
  }

  private step(list: readonly number[], v: number, d: 1 | -1): number {
    const i = list.indexOf(v);
    return list[Math.min(list.length - 1, Math.max(0, (i < 0 ? 0 : i) + d))];
  }

  private act(a: string): void {
    const p = this.prefs;
    if (a === 'close') return this.close();
    if (a === 'smaller') p.fontSize = this.step(READER_FONT_SIZES, p.fontSize, -1);
    if (a === 'bigger') p.fontSize = this.step(READER_FONT_SIZES, p.fontSize, 1);
    if (a === 'narrow') p.width = this.step(READER_WIDTHS, p.width, -1);
    if (a === 'wide') p.width = this.step(READER_WIDTHS, p.width, 1);
    if (a === 'font') p.font = p.font === 'sans' ? 'serif' : 'sans';
    if (a === 'theme') p.theme = THEMES[(THEMES.findIndex((t) => t[0] === p.theme) + 1) % THEMES.length][0];
    this.applyPrefs();
    void this.save();
  }

  private async save(): Promise<void> {
    // 只改阅读偏好，其他设置以存储里最新的为准
    const latest = normalizeEnhance((await chrome.storage.local.get(ENHANCE_KEY))[ENHANCE_KEY]);
    latest.reader = { ...this.prefs };
    await saveEnhance(latest);
  }

  private readonly applyPrefs = (): void => {
    if (!this.host) return;
    const p = this.prefs;
    const theme = p.theme === 'auto' ? (this.media.matches ? 'light' : 'dark') : p.theme;
    this.shell.className = `shell ${theme === 'dark' ? '' : theme}`.trim();
    const art = this.shell.querySelector('.page') as HTMLElement;
    art.style.maxWidth = `${p.width}px`;
    art.style.fontSize = `${p.fontSize}px`;
    this.shell.querySelector('.content')?.classList.toggle('serif', p.font === 'serif');
    this.shell.querySelector('h1.title')?.classList.toggle('serif', p.font === 'serif');
    const q = (s: string) => this.shell.querySelector(`button[data-act="${s}"]`) as HTMLElement;
    q('font').textContent = p.font === 'serif' ? '宋体' : '黑体';
    q('theme').textContent = THEMES.find((t) => t[0] === p.theme)![1];
    q('smaller').toggleAttribute('disabled', p.fontSize === READER_FONT_SIZES[0]);
    q('bigger').toggleAttribute('disabled', p.fontSize === READER_FONT_SIZES[READER_FONT_SIZES.length - 1]);
  };
}

const w = window as unknown as { __drakReader?: ReaderApi };
// 脚本每次触发都会重新注入：已经有实例就直接切换
(w.__drakReader ??= new Reader()).toggle();
