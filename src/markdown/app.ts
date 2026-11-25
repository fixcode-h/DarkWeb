/**
 * Markdown 页面（由后台注入到浏览器直接显示的 .md 源文件页面）。
 * 把纯文本页换成：阅读（目录 + 渲染）/ 分栏（源码 + 实时预览）/ 源码 三种视图，
 * 支持保存回本地文件（File System Access API）、下载副本、草稿暂存。
 */
import { MD_ATTR } from './match';
import { MdEditor, type FormatCmd } from './editor';
import { renderMarkdown, toggleTask, type Heading } from './render';
import { sanitizeMarkdownHtml } from './sanitize';
import { Blocks } from './blocks';
import { MD_CSS } from './style';
import { MD_EDITOR_SIZES, MD_FONT_SIZES, MD_KEY, MD_WIDTHS, MD_WIDTH_MAX, MD_WIDTH_MIN, DEFAULT_MARKDOWN, normalizeMarkdown, saveMarkdown, stepIn, type MarkdownSettings, type MdTheme, type MdView } from './settings';
import { SETTINGS_KEY, normalizeSettings, scheduleActive, siteModeFor } from '../shared/settings';

const DRAFT_PREFIX = 'mdDraft:';
const DRAFT_INDEX = 'mdDrafts';
const MAX_DRAFTS = 30;
const SAVE_HINT_KEY = 'mdSaveHintSeen';

interface Draft {
  text: string;
  /** 暂存时磁盘上原文的指纹：对不上说明文件之后在外部改过 */
  base: string;
  t: number;
}

interface FileHandle {
  name: string;
  createWritable(): Promise<{ write(data: string | Blob): Promise<void>; close(): Promise<void> }>;
}
type SavePicker = (opts: { suggestedName?: string; types?: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileHandle>;

const ICON = {
  doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>',
  toc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 6h16M8 12h12M8 18h12"/></svg>',
  pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg>',
  dl: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  code: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
  table: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/></svg>',
  task: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="7" height="7" rx="1.5"/><path d="M4.5 7.5l1.5 1.5 2.5-3M14 7.5h7M3 17.5h18"/></svg>',
  ul: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/></svg>',
  ol: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M10 6h11M10 12h11M10 18h11M4 5l1.5-1v5M3.5 14.5a1.5 1.5 0 1 1 2.5 1.2L3.5 19H6.5"/></svg>',
  quote: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7.2 17c-1.9 0-3.2-1.5-3.2-3.6C4 9.9 6.4 7.3 9.6 6l.7 1.2C8.4 8.2 7.4 9.6 7.2 11c1.6.1 2.8 1.3 2.8 3 0 1.7-1.2 3-2.8 3zm9 0c-1.9 0-3.2-1.5-3.2-3.6 0-3.5 2.4-6.1 5.6-7.4l.7 1.2c-1.9 1-2.9 2.4-3.1 3.8 1.6.1 2.8 1.3 2.8 3 0 1.7-1.2 3-2.8 3z"/></svg>',
  width: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/></svg>',
  sync: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4"/></svg>',
};

const THEME_NAME: Record<MdTheme, string> = { auto: '自动', dark: '深色', light: '浅色', sepia: '米黄' };
const THEMES: MdTheme[] = ['auto', 'dark', 'light', 'sepia'];

/** 32 位 FNV-1a，只用来判断“原文变没变” */
function fingerprint(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${s.length}:${(h >>> 0).toString(36)}`;
}

function fileNameOf(url: string): string {
  try {
    const seg = new URL(url).pathname.split('/').filter(Boolean).pop() ?? 'README.md';
    return decodeURIComponent(seg);
  } catch {
    return 'README.md';
  }
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

class MarkdownPage {
  private s!: MarkdownSettings;
  private readonly url = location.href.split('#')[0];
  private readonly isFile = location.protocol === 'file:';
  private readonly name = fileNameOf(location.href);
  /** 磁盘上（或服务器上）的原文，保存成功后更新 */
  private saved: string;
  private text: string;
  private headings: Heading[] = [];
  private words = 0;
  private editor: MdEditor | null = null;
  private handle: FileHandle | null = null;
  private view: MdView = 'read';
  private darkByDrak = false;
  private systemDark = matchMedia('(prefers-color-scheme: dark)');

  private app = el('div', 'md-app');
  private top = el('header', 'md-top');
  private fmt = el('div', 'md-fmt');
  private main = el('div', 'md-main');
  private toc = el('nav', 'md-toc');
  private editorBox = el('div', 'md-editor');
  private preview = el('div', 'md-preview');
  private page = el('div', 'md-page');
  private body = el('article', 'md-body');
  private status = el('footer', 'md-status');
  private renderTimer = 0;
  private drawnTheme = '';
  private draftTimer = 0;
  /** 最近一次用户在哪一栏滚动：同步滚动只从这一栏带另一栏 */
  private scrollLead: 'editor' | 'preview' = 'editor';
  private syncing = false;
  private blocks: { line: number; el: HTMLElement }[] = [];
  /** 代码块顶栏、Mermaid 图 */
  private fx = new Blocks(this.body, () => this.resolvedTheme());

  constructor(source: string) {
    this.saved = source;
    this.text = source;
  }

  async start(): Promise<void> {
    const data = await chrome.storage.local.get([MD_KEY, SETTINGS_KEY]);
    this.s = normalizeMarkdown(data[MD_KEY]);
    const ds = normalizeSettings(data[SETTINGS_KEY]);
    this.darkByDrak = ds.enabled && siteModeFor(ds, location.host) !== 'off' && scheduleActive(ds) && (!ds.followSystem || this.systemDark.matches);
    this.view = this.s.view;
    this.build();
    this.applyPrefs();
    this.renderPreview();
    this.setView(this.view, false);
    this.scrollToHash();
    void this.checkDraft();
    this.systemDark.addEventListener('change', () => this.applyTheme());
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[MD_KEY]) return;
      this.s = normalizeMarkdown(changes[MD_KEY].newValue);
      this.applyPrefs();
    });
  }

  // ---- 搭界面 ----

  private build(): void {
    document.title = this.name;
    const style = el('style');
    style.textContent = MD_CSS;
    const head = document.head ?? document.documentElement.insertBefore(document.createElement('head'), document.body);
    head.appendChild(style);
    if (!document.querySelector('meta[name=viewport]')) {
      const vp = el('meta');
      vp.name = 'viewport';
      vp.content = 'width=device-width, initial-scale=1';
      head.appendChild(vp);
    }

    const meta = this.isFile ? `本地文件 · ${formatSize(new Blob([this.saved]).size)}` : `${location.host} · ${formatSize(new Blob([this.saved]).size)}`;
    this.top.innerHTML = `
      <div class="md-file">${ICON.doc}<b></b><span class="md-dot" hidden title="有未保存的修改"></span><span class="meta"></span></div>
      <div class="md-spacer"></div>
      <div class="md-seg" role="group" aria-label="视图">
        <button type="button" data-view="read" title="阅读（Ctrl+E 切换）">阅读</button>
        <button type="button" data-view="split" title="分栏编辑">分栏</button>
        <button type="button" data-view="source" title="只看源码">源码</button>
      </div>
      <div class="md-bar" role="toolbar" aria-label="显示设置">
        <button type="button" data-act="toc" data-only="read" title="显示 / 隐藏目录">${ICON.toc}</button>
        <span class="md-sep" data-only="read"></span>
        <button type="button" data-act="smaller" title="减小字号">A−</button>
        <button type="button" data-act="bigger" title="增大字号">A+</button>
        <span class="md-sep" data-only="read"></span>
        <button type="button" data-act="width" data-only="read" class="md-wbtn">${ICON.width}<span></span></button>
        <button type="button" data-act="sync" data-only="split" title="分栏同步滚动">${ICON.sync}</button>
        <button type="button" data-act="theme" title="切换主题">${ICON.moon}</button>
      </div>
      <button type="button" class="md-btn" data-act="download" title="下载当前内容">${ICON.dl}<span>下载</span></button>
      <button type="button" class="md-btn" data-act="saveas" data-only="edit" title="保存到选择的位置">另存为</button>
      <button type="button" class="md-btn" data-act="save-read" data-only="read" hidden>${ICON.save}保存</button>
      <button type="button" class="md-btn primary" data-act="edit" data-only="read" title="编辑（Ctrl+E）">${ICON.pen}编辑</button>
      <button type="button" class="md-btn primary" data-act="save" data-only="edit" title="保存（Ctrl+S）">${ICON.save}保存 <kbd>Ctrl+S</kbd></button>`;
    this.top.querySelector('.md-file b')!.textContent = this.name;
    this.top.querySelector('.md-file .meta')!.textContent = `· ${meta}`;

    const fmtBtn = (cmd: FormatCmd, label: string, title: string) => `<button type="button" data-fmt="${cmd}" title="${title}">${label}</button>`;
    this.fmt.innerHTML = [
      fmtBtn('heading', '<b>H</b>', '标题（循环 ## / ### / 正文）'),
      fmtBtn('bold', '<b style="font-weight:800">B</b>', '粗体（Ctrl+B）'),
      fmtBtn('italic', '<i style="font-family:serif">I</i>', '斜体（Ctrl+I）'),
      fmtBtn('strike', '<s>S</s>', '删除线'),
      '<span class="md-sep"></span>',
      fmtBtn('link', ICON.link, '链接（Ctrl+K）'),
      fmtBtn('code', ICON.code, '行内代码'),
      fmtBtn('codeblock', '<span style="font:600 11px var(--mono)">{ }</span>', '代码块'),
      fmtBtn('quote', ICON.quote, '引用'),
      '<span class="md-sep"></span>',
      fmtBtn('ul', ICON.ul, '无序列表'),
      fmtBtn('ol', ICON.ol, '有序列表'),
      fmtBtn('task', ICON.task, '任务列表'),
      fmtBtn('table', ICON.table, '插入表格'),
      fmtBtn('image', ICON.image, '插入图片'),
      fmtBtn('hr', '—', '分隔线'),
      '<span class="hint">Ctrl+F 查找 · Ctrl+Z 撤销 · Ctrl+E 阅读</span>',
    ].join('');

    this.status.innerHTML = '<span>Markdown · UTF-8</span><span data-s="pos">第 1 行，第 1 列</span><span data-s="sel"></span><span class="r" data-s="count"></span>';

    this.page.append(this.body, this.grip('l'), this.grip('r'));
    this.preview.appendChild(this.page);
    this.main.append(this.toc, this.editorBox, this.preview);
    this.app.append(this.top, this.fmt, this.main, this.status);
    document.body.replaceChildren(this.app);
    document.documentElement.setAttribute(MD_ATTR, 'render');

    this.top.addEventListener('click', (e) => this.onTopClick(e));
    this.fmt.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLElement>('[data-fmt]');
      if (b) this.editor?.format(b.dataset.fmt as FormatCmd);
    });
    this.toc.addEventListener('click', (e) => {
      const a = (e.target as Element).closest<HTMLAnchorElement>('a[data-id]');
      if (!a) return;
      e.preventDefault();
      this.scrollToId(a.dataset.id!);
    });
    this.body.addEventListener('click', (e) => this.onBodyClick(e));
    this.preview.addEventListener('scroll', () => this.onPreviewScroll(), { passive: true });
    this.preview.addEventListener('pointerenter', () => (this.scrollLead = 'preview'));
    this.preview.addEventListener('wheel', () => (this.scrollLead = 'preview'), { passive: true });
    this.editorBox.addEventListener('pointerenter', () => (this.scrollLead = 'editor'));
    this.editorBox.addEventListener('wheel', () => (this.scrollLead = 'editor'), { passive: true });
    document.addEventListener('keydown', (e) => this.onKey(e), true);
    window.addEventListener('beforeunload', (e) => {
      if (!this.dirty) return;
      e.preventDefault();
      e.returnValue = '';
    });
    window.addEventListener('hashchange', () => this.scrollToHash());
  }

  // ---- 偏好 ----

  private resolvedTheme(): Exclude<MdTheme, 'auto'> {
    if (this.s.theme !== 'auto') return this.s.theme;
    return this.darkByDrak || this.systemDark.matches ? 'dark' : 'light';
  }

  /** 下一个主题：跳过和当前看起来一样的（比如“自动”正显示深色时，下一个直接到浅色） */
  private nextTheme(): MdTheme {
    const now = this.resolvedTheme();
    let i = THEMES.indexOf(this.s.theme);
    for (let n = 0; n < THEMES.length; n++) {
      i = (i + 1) % THEMES.length;
      const t = THEMES[i];
      if (t === 'auto' || t !== now) return t;
    }
    return 'auto';
  }

  private applyTheme(): void {
    const t = this.resolvedTheme();
    // 图的配色是画的时候定的：主题变了要重画
    if (this.drawnTheme && this.drawnTheme !== t) queueMicrotask(() => this.fx.redraw());
    this.drawnTheme = t;
    this.app.classList.toggle('light', t === 'light');
    this.app.classList.toggle('sepia', t === 'sepia');
    document.documentElement.style.colorScheme = t === 'dark' ? 'dark' : 'light';
    const btn = this.top.querySelector<HTMLElement>('[data-act="theme"]')!;
    btn.title = `主题：${THEME_NAME[this.s.theme]}${this.s.theme === 'auto' ? `（当前${THEME_NAME[t]}）` : ''}，点击切换`;
  }

  private applyPrefs(): void {
    this.applyTheme();
    this.body.style.setProperty('--md-base', `${this.s.fontSize}px`);
    this.page.style.maxWidth = `${this.s.pageWidth}px`;
    this.app.style.setProperty('--md-editor-size', `${this.s.editorFontSize}px`);
    this.editor?.setFontSize(this.s.editorFontSize);
    const q = (a: string) => this.top.querySelector<HTMLButtonElement>(`[data-act="${a}"]`)!;
    const editing = this.view !== 'read';
    const sizes: readonly number[] = editing ? MD_EDITOR_SIZES : MD_FONT_SIZES;
    const cur = editing ? this.s.editorFontSize : this.s.fontSize;
    q('smaller').disabled = cur === sizes[0];
    q('bigger').disabled = cur === sizes[sizes.length - 1];
    q('smaller').title = editing ? '减小编辑器字号' : '减小字号';
    q('bigger').title = editing ? '增大编辑器字号' : '增大字号';
    q('width').querySelector('span')!.textContent = String(this.s.pageWidth);
    q('width').title = `栏宽 ${this.s.pageWidth} px：点击切换档位，也可以拖动正文两侧边缘调节，双击边缘恢复默认`;
    q('toc').setAttribute('aria-pressed', String(this.s.toc));
    q('sync').setAttribute('aria-pressed', String(this.s.syncScroll));
    this.updateTocVisibility();
  }

  /** 正文两侧的拖动条：栏居中，所以宽度 = 指针到中线距离的两倍 */
  private grip(side: 'l' | 'r'): HTMLElement {
    const g = el('div', `md-grip ${side}`);
    g.title = '拖动调节栏宽，双击恢复默认';
    g.addEventListener('dblclick', () => this.updatePrefs({ pageWidth: DEFAULT_MARKDOWN.pageWidth }));
    g.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      g.setPointerCapture(e.pointerId);
      const r = this.preview.getBoundingClientRect();
      const mid = r.left + r.width / 2;
      const tip = el('div', 'md-wtip');
      tip.style.left = `${mid}px`;
      tip.style.top = `${r.top + 12}px`;
      this.app.appendChild(tip);
      this.app.classList.add('md-resizing');
      let w = this.s.pageWidth;
      const move = (ev: PointerEvent) => {
        w = Math.round(Math.min(MD_WIDTH_MAX, Math.max(MD_WIDTH_MIN, Math.abs(ev.clientX - mid) * 2)) / 10) * 10;
        this.page.style.maxWidth = `${w}px`;
        // 窗口比设置窄时栏实际被压窄，提示里两个都写上
        const real = Math.round(this.page.getBoundingClientRect().width);
        tip.textContent = real < w ? `${w} px（当前窗口只放得下 ${real}）` : `${w} px`;
      };
      move(e);
      const up = () => {
        g.removeEventListener('pointermove', move);
        g.removeEventListener('pointerup', up);
        g.removeEventListener('pointercancel', up);
        tip.remove();
        this.app.classList.remove('md-resizing');
        this.updatePrefs({ pageWidth: w });
      };
      g.addEventListener('pointermove', move);
      g.addEventListener('pointerup', up);
      g.addEventListener('pointercancel', up);
    });
    return g;
  }

  private updatePrefs(patch: Partial<MarkdownSettings>): void {
    this.s = { ...this.s, ...patch };
    this.applyPrefs();
    void saveMarkdown(this.s);
  }

  // ---- 视图 ----

  private setView(v: MdView, focus = true): void {
    const prevLine = this.view === 'read' ? this.previewTopLine() : (this.editor?.topLine() ?? 0);
    this.view = v;
    this.app.dataset.view = v;
    for (const b of this.top.querySelectorAll<HTMLElement>('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === v));
    if (v !== 'read' && !this.editor) {
      this.editor = new MdEditor(this.editorBox, {
        doc: this.text,
        fontSize: this.s.editorFontSize,
        onChange: (text) => this.onEdit(text),
        onCursor: (c) => this.onCursor(c),
        onScroll: () => this.onEditorScroll(),
      });
    }
    this.applyPrefs();
    if (v === 'read') {
      this.flushRender();
      requestAnimationFrame(() => this.scrollPreviewToLine(prevLine));
    } else {
      requestAnimationFrame(() => {
        this.editor!.scrollToLine(prevLine);
        if (v === 'split') this.scrollPreviewToLine(prevLine);
        if (focus) this.editor!.focus();
      });
    }
  }

  private onTopClick(e: MouseEvent): void {
    const t = e.target as Element;
    // 只认顶栏里的按钮（外层 .md-app 自己也带 data-view）
    const vb = t.closest<HTMLElement>('button[data-view]');
    if (vb) return this.setView(vb.dataset.view as MdView);
    const act = t.closest<HTMLElement>('button[data-act]')?.dataset.act;
    const editing = this.view !== 'read';
    switch (act) {
      case 'edit':
        return this.setView('split');
      case 'toc':
        return this.updatePrefs({ toc: !this.s.toc });
      case 'smaller':
      case 'bigger': {
        const dir = act === 'bigger' ? 1 : -1;
        if (editing) return this.updatePrefs({ editorFontSize: stepIn(MD_EDITOR_SIZES, this.s.editorFontSize as (typeof MD_EDITOR_SIZES)[number], dir) });
        return this.updatePrefs({ fontSize: stepIn(MD_FONT_SIZES, this.s.fontSize as (typeof MD_FONT_SIZES)[number], dir) });
      }
      case 'width': {
        // 拖出来的任意宽度也能接着点：跳到比它大的下一档，到头回第一档
        const next = MD_WIDTHS.find((w) => w > this.s.pageWidth) ?? MD_WIDTHS[0];
        return this.updatePrefs({ pageWidth: next });
      }
      case 'sync':
        return this.updatePrefs({ syncScroll: !this.s.syncScroll });
      case 'theme':
        return this.updatePrefs({ theme: this.nextTheme() });
      case 'download':
        return this.download();
      case 'saveas':
        return void this.save(true);
      case 'save':
      case 'save-read':
        return void this.save(false);
    }
  }

  private onKey(e: KeyboardEvent): void {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 's') {
      e.preventDefault();
      e.stopPropagation();
      void this.save(e.shiftKey);
    } else if (k === 'e' && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      this.setView(this.view === 'read' ? 'split' : 'read');
    }
  }

  // ---- 渲染 ----

  private renderPreview(): void {
    const r = renderMarkdown(this.text);
    this.headings = r.headings;
    this.words = r.words;
    const frag = sanitizeMarkdownHtml(r.html, location.href);
    if (!this.text.trim()) this.body.replaceChildren(el('p', 'md-empty', '空文件。点“编辑”开始写。'));
    else this.body.replaceChildren(frag);
    this.fx.decorate();
    this.blocks = Array.from(this.body.querySelectorAll<HTMLElement>('[data-line]'))
      .map((e) => ({ line: Number(e.dataset.line), el: e }))
      .filter((b) => isFinite(b.line))
      .sort((a, b) => a.line - b.line);
    this.renderToc();
    this.updateCount();
  }

  private scheduleRender(): void {
    clearTimeout(this.renderTimer);
    // 大文件稍微多攒一会儿再渲染，打字不卡
    const delay = this.text.length > 200_000 ? 400 : this.text.length > 50_000 ? 200 : 80;
    this.renderTimer = window.setTimeout(() => this.flushRender(), delay);
  }

  private flushRender(): void {
    clearTimeout(this.renderTimer);
    this.renderTimer = 0;
    const keep = this.view === 'split' && this.s.syncScroll ? null : this.preview.scrollTop;
    this.renderPreview();
    if (keep !== null) this.preview.scrollTop = keep;
    else this.onEditorScroll();
  }

  private renderToc(): void {
    const hs = this.headings.filter((h) => h.level <= 3);
    const min = Math.min(...hs.map((h) => h.level));
    this.toc.replaceChildren();
    const title = el('h6', '', '目录');
    this.toc.appendChild(title);
    for (const h of hs) {
      const a = el('a', `l${h.level - min + 1}`);
      a.href = `#${encodeURIComponent(h.id)}`;
      a.dataset.id = h.id;
      a.textContent = h.text || '（无标题）';
      a.title = h.text;
      this.toc.appendChild(a);
    }
    const stat = el('div', 'stat');
    const mins = Math.max(1, Math.round(this.words / 400));
    const lm = Date.parse(document.lastModified);
    stat.textContent = `${this.words.toLocaleString()} 字 · 约 ${mins} 分钟读完`;
    if (this.isFile && isFinite(lm) && Date.now() - lm > 5000) {
      stat.append(el('br'), `最后修改 ${formatTime(lm)}`);
    }
    this.toc.appendChild(stat);
    this.updateTocVisibility();
    this.onPreviewScroll();
  }

  private updateTocVisibility(): void {
    const enough = this.headings.filter((h) => h.level <= 3).length > 3;
    this.app.toggleAttribute('data-notoc', !(this.s.toc && enough));
    const btn = this.top.querySelector<HTMLButtonElement>('[data-act="toc"]');
    if (btn) btn.disabled = !enough;
  }

  private updateCount(): void {
    const lines = this.text.split('\n').length;
    const c = this.status.querySelector('[data-s="count"]');
    if (c) c.textContent = `${this.words.toLocaleString()} 字 · ${lines.toLocaleString()} 行`;
  }

  private onCursor(c: { line: number; col: number; selected: number }): void {
    this.status.querySelector('[data-s="pos"]')!.textContent = `第 ${c.line} 行，第 ${c.col} 列`;
    this.status.querySelector('[data-s="sel"]')!.textContent = c.selected ? `已选 ${c.selected} 字` : '';
  }

  // ---- 点击正文：任务框、页内锚点 ----

  private onBodyClick(e: MouseEvent): void {
    if (this.fx.onClick(e)) return;
    const t = e.target as Element;
    const box = t.closest<HTMLElement>('.task-box[data-task]');
    if (box) {
      e.preventDefault();
      const next = toggleTask(this.text, Number(box.dataset.task));
      if (next === this.text) return;
      if (this.editor) this.editor.setText(next, true);
      else this.onEdit(next);
      this.flushRender();
      return;
    }
    const a = t.closest<HTMLAnchorElement>('a[href^="#"]');
    if (a && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      const id = decodeURIComponent(a.getAttribute('href')!.slice(1));
      if (id) {
        e.preventDefault();
        this.scrollToId(id);
      }
    }
  }

  private scrollToId(id: string): void {
    const target = this.body.querySelector<HTMLElement>(`#${CSS.escape(id)}`) ?? this.body.querySelector<HTMLElement>(`[name="${CSS.escape(id)}"]`);
    if (!target) return;
    this.scrollLead = 'preview';
    this.preview.scrollTo({ top: this.offsetIn(target) - 12, behavior: 'smooth' });
    history.replaceState(null, '', `#${encodeURIComponent(id)}`);
  }

  private scrollToHash(): void {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!id) return;
    requestAnimationFrame(() => {
      const target = this.body.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
      if (target) this.preview.scrollTop = this.offsetIn(target) - 12;
    });
  }

  private offsetIn(e: HTMLElement): number {
    return e.getBoundingClientRect().top - this.preview.getBoundingClientRect().top + this.preview.scrollTop;
  }

  // ---- 滚动：目录高亮、分栏同步 ----

  private onPreviewScroll(): void {
    if (this.view === 'read' && !this.app.hasAttribute('data-notoc')) {
      let cur = '';
      for (const h of this.headings) {
        const e = this.body.querySelector<HTMLElement>(`#${CSS.escape(h.id)}`);
        if (!e) continue;
        if (this.offsetIn(e) - this.preview.scrollTop <= 80) cur = h.id;
        else break;
      }
      if (!cur && this.headings.length) cur = this.headings[0].id;
      for (const a of this.toc.querySelectorAll<HTMLElement>('a[data-id]')) a.classList.toggle('on', a.dataset.id === cur);
    }
    if (this.view === 'split' && this.s.syncScroll && this.scrollLead === 'preview' && !this.syncing && this.editor) {
      this.syncing = true;
      this.editor.scrollToLine(this.previewTopLine());
      requestAnimationFrame(() => (this.syncing = false));
    }
  }

  private onEditorScroll(): void {
    if (this.view !== 'split' || !this.s.syncScroll || this.scrollLead !== 'editor' || this.syncing || !this.editor) return;
    this.syncing = true;
    this.scrollPreviewToLine(this.editor.topLine());
    requestAnimationFrame(() => (this.syncing = false));
  }

  /** 预览滚到源码第 line 行对应的位置（在前后两个带行号的块之间按比例插值） */
  private scrollPreviewToLine(line: number): void {
    const b = this.blocks;
    if (!b.length) return;
    if (line <= 0) {
      this.preview.scrollTop = 0;
      return;
    }
    let i = 0;
    while (i + 1 < b.length && b[i + 1].line <= line) i++;
    const a = b[i];
    const next = b[i + 1];
    const ya = this.offsetIn(a.el);
    let y = ya;
    if (next && next.line > a.line) {
      const yb = this.offsetIn(next.el);
      y = ya + ((line - a.line) / (next.line - a.line)) * (yb - ya);
    } else if (!next) {
      const lines = this.text.split('\n').length;
      y = ya + Math.min(1, (line - a.line) / Math.max(1, lines - a.line)) * a.el.offsetHeight;
    }
    this.preview.scrollTop = y - 16;
  }

  /** 预览顶部对应的源码行 */
  private previewTopLine(): number {
    const b = this.blocks;
    if (!b.length) return 0;
    const top = this.preview.scrollTop + 16;
    let i = 0;
    while (i + 1 < b.length && this.offsetIn(b[i + 1].el) <= top) i++;
    const a = b[i];
    const next = b[i + 1];
    const ya = this.offsetIn(a.el);
    if (next && next.line > a.line) {
      const yb = this.offsetIn(next.el);
      if (yb > ya) return a.line + Math.max(0, Math.min(1, (top - ya) / (yb - ya))) * (next.line - a.line);
    }
    return a.line;
  }

  // ---- 编辑、草稿 ----

  private get dirty(): boolean {
    return this.text !== this.saved;
  }

  private onEdit(text: string): void {
    this.text = text;
    this.updateDirty();
    this.scheduleRender();
    this.scheduleDraft();
  }

  private updateDirty(): void {
    const d = this.dirty;
    this.top.querySelector<HTMLElement>('.md-dot')!.hidden = !d;
    this.top.querySelector<HTMLElement>('[data-act="save-read"]')!.hidden = !d;
    document.title = (d ? '● ' : '') + this.name;
    const meta = this.top.querySelector('.md-file .meta')!;
    if (d) meta.textContent = this.s.drafts ? '· 已修改 · 草稿已自动暂存' : '· 已修改';
  }

  private scheduleDraft(): void {
    if (!this.s.drafts) return;
    clearTimeout(this.draftTimer);
    this.draftTimer = window.setTimeout(() => void this.writeDraft(), 800);
  }

  private async writeDraft(): Promise<void> {
    const key = DRAFT_PREFIX + this.url;
    try {
      if (!this.dirty) {
        await this.clearDraft();
        return;
      }
      const draft: Draft = { text: this.text, base: fingerprint(this.saved), t: Date.now() };
      const idx = ((await chrome.storage.local.get(DRAFT_INDEX))[DRAFT_INDEX] ?? {}) as Record<string, number>;
      idx[this.url] = draft.t;
      // 只留最近的若干份
      const old = Object.entries(idx)
        .sort((a, b) => b[1] - a[1])
        .slice(MAX_DRAFTS)
        .map(([u]) => u);
      for (const u of old) delete idx[u];
      await chrome.storage.local.set({ [key]: draft, [DRAFT_INDEX]: idx });
      if (old.length) await chrome.storage.local.remove(old.map((u) => DRAFT_PREFIX + u));
    } catch {
      /* 扩展更新后上下文失效等：草稿只是锦上添花 */
    }
  }

  private async clearDraft(): Promise<void> {
    clearTimeout(this.draftTimer);
    try {
      const idx = ((await chrome.storage.local.get(DRAFT_INDEX))[DRAFT_INDEX] ?? {}) as Record<string, number>;
      delete idx[this.url];
      await chrome.storage.local.set({ [DRAFT_INDEX]: idx });
      await chrome.storage.local.remove(DRAFT_PREFIX + this.url);
    } catch {
      /* 同上 */
    }
  }

  private async checkDraft(): Promise<void> {
    if (!this.s.drafts) return;
    const key = DRAFT_PREFIX + this.url;
    const d = (await chrome.storage.local.get(key))[key] as Draft | undefined;
    if (!d || typeof d.text !== 'string') return;
    if (d.text === this.saved) {
      void this.clearDraft();
      return;
    }
    const changed = d.base !== fingerprint(this.saved);
    const bar = el('div', 'md-banner');
    const msg = el('span');
    msg.textContent = `有一份 ${formatTime(d.t)} 未保存的修改。${changed ? '注意：文件在那之后被改过，恢复会覆盖这些改动。' : ''}`;
    const restore = el('button', 'md-btn primary', '恢复');
    const drop = el('button', 'md-btn', '丢弃');
    restore.type = drop.type = 'button';
    bar.append(msg, drop, restore);
    this.app.insertBefore(bar, this.fmt);
    restore.addEventListener('click', () => {
      bar.remove();
      if (this.editor) this.editor.setText(d.text, true);
      else this.onEdit(d.text);
      if (this.view === 'read') this.setView('split');
      this.flushRender();
    });
    drop.addEventListener('click', () => {
      bar.remove();
      void this.clearDraft();
    });
  }

  // ---- 保存 / 下载 ----

  private download(): void {
    const blob = new Blob([this.text], { type: 'text/markdown;charset=utf-8' });
    const a = el('a');
    a.href = URL.createObjectURL(blob);
    a.download = this.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  }

  private picker(): SavePicker | null {
    const fn = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
    return typeof fn === 'function' ? fn.bind(window) : null;
  }

  private async save(saveAs: boolean): Promise<void> {
    const pick = this.picker();
    if (!pick) {
      this.download();
      this.markSaved(false);
      return;
    }
    if (!this.handle || saveAs) {
      // 第一次保存本地文件：先说明一下为什么要选位置（只提示一次）
      if (!saveAs && this.isFile && !(await this.hintSeen())) {
        this.saveHint();
        return;
      }
      try {
        this.handle = await pick({ suggestedName: this.name, types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown'] } }] });
      } catch (e) {
        if ((e as DOMException)?.name === 'AbortError') return;
        // 页面不允许用文件选择器（比如被沙箱化的页面）：退回下载
        this.download();
        this.markSaved(false);
        return;
      }
    }
    try {
      const w = await this.handle.createWritable();
      await w.write(this.text);
      await w.close();
      this.markSaved(true);
    } catch (e) {
      this.handle = null;
      this.toast(`保存失败：${(e as Error)?.message || e}。可以先点“下载”留一份副本。`);
    }
  }

  private markSaved(toDisk: boolean): void {
    this.saved = this.text;
    this.updateDirty();
    void this.clearDraft();
    const meta = this.top.querySelector('.md-file .meta')!;
    const where = toDisk && this.handle ? `已保存到 ${this.handle.name}` : '已下载';
    meta.textContent = `· ${where} · ${formatTime(Date.now()).slice(11)}`;
    this.toast(toDisk ? `${where}。之后按 Ctrl+S 直接覆盖保存。` : '浏览器不支持直接写文件，已下载一份副本。', true);
  }

  private async hintSeen(): Promise<boolean> {
    try {
      return !!(await chrome.storage.local.get(SAVE_HINT_KEY))[SAVE_HINT_KEY];
    } catch {
      return true;
    }
  }

  private saveHint(): void {
    this.app.querySelector('.md-toast')?.remove();
    const t = el('div', 'md-toast');
    t.innerHTML = `<b>保存到原文件？</b><p>浏览器出于安全考虑，第一次保存时会让你确认一次写入位置：请选中原来的 <span></span> 覆盖。之后按 Ctrl+S 就直接保存了。</p>
      <div class="row"><button type="button" class="md-btn" data-k="dl">下载副本</button><button type="button" class="md-btn primary" data-k="go">选择并保存</button></div>`;
    t.querySelector('p span')!.textContent = this.name;
    t.addEventListener('click', (e) => {
      const k = (e.target as Element).closest<HTMLElement>('[data-k]')?.dataset.k;
      if (!k) return;
      t.remove();
      void chrome.storage.local.set({ [SAVE_HINT_KEY]: true }).catch(() => undefined);
      if (k === 'dl') {
        this.download();
        return;
      }
      void this.save(true);
    });
    this.app.appendChild(t);
  }

  private toastTimer = 0;
  private toast(text: string, small = false): void {
    this.app.querySelector('.md-toast')?.remove();
    const t = el('div', `md-toast${small ? ' small' : ''}`);
    const p = el('p');
    p.textContent = text;
    t.appendChild(p);
    this.app.appendChild(t);
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.remove(), small ? 2600 : 6000);
  }
}

(() => {
  const w = window as unknown as { __drakMarkdown?: boolean };
  if (w.__drakMarkdown) return;
  w.__drakMarkdown = true;
  const pre = document.body?.firstElementChild;
  const source = pre?.tagName === 'PRE' ? (pre.textContent ?? '') : (document.body?.textContent ?? '');
  const page = new MarkdownPage(source.replace(/\r\n?/g, '\n'));
  page.start().catch((e) => {
    console.warn('[drak] markdown render failed', e);
    document.documentElement.setAttribute(MD_ATTR, 'off');
  });
})();

