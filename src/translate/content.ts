/**
 * 网页翻译的页面部分（按需注入）。
 *
 * 以“段”为单位翻译：一段是同一个父元素下连续的行内内容（文字、链接、加粗……），
 * 整段连同行内标签一起交给引擎，译文再按标签还原，这样语序可以自由调整而链接、加粗不丢。
 * 只翻译视口附近的段落，滚动到哪里翻到哪里；页面后续新增的内容自动跟进。
 */
import { capture, restore } from './anchor';
import { looksLikeIdentifier, looksLikeTarget, sameLang, worthTranslating } from './lang';
import {
  ENGINE_NAMES,
  TRANSLATE_KEY,
  loadTranslate,
  normalizeTranslate,
  type EngineId,
  type PageCommand,
  type PageState,
  type PageStatus,
  STATE_EVENT,
  type TranslateRequest,
  type TranslateResponse,
  type TranslateSettings,
} from './settings';

interface Run {
  /** 原始节点的父节点 */
  parent: Element | ShadowRoot;
  /** 用来判断可见性、读取样式的元素（父节点是 ShadowRoot 时为宿主） */
  anchor: Element;
  /** 原始节点（连续的兄弟节点） */
  nodes: Node[];
  text: string;
  html: string;
  /** 序列化时的编号 -> 原始行内元素 */
  map: Element[];
  state: 'pending' | 'queued' | 'done' | 'skipped';
  /** 我们插入的节点：双语模式是一个包裹元素，替换模式是替换后的节点 */
  inserted: Node[];
  replaced: boolean;
}

/** 整块跳过，不进入 */
const SKIP = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'PRE', 'IFRAME', 'FRAME', 'CANVAS', 'VIDEO', 'AUDIO',
  'OBJECT', 'EMBED', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'TITLE', 'MAP', 'AREA', 'DATALIST', 'PROGRESS', 'METER', 'DRAK-TRANSLATE-TOAST',
]);
/** 行内的“原子”：留在段落里占位，但内容不翻译 */
const ATOM = new Set(['CODE', 'KBD', 'SAMP', 'VAR', 'IMG', 'PICTURE', 'SVG', 'MATH', 'WBR', 'RT', 'RP']);
/** 一定是行内的标签 */
const INLINE = new Set([
  'B', 'I', 'EM', 'STRONG', 'U', 'S', 'SMALL', 'MARK', 'ABBR', 'CITE', 'Q', 'SUB', 'SUP', 'DEL', 'INS', 'TIME', 'DFN', 'BDI', 'BDO', 'RUBY', 'STRIKE', 'TT', 'BIG', 'NOBR',
]);
/** 多数时候是行内，但常被样式改成块，需要看计算样式 */
const MAYBE_INLINE = new Set(['A', 'SPAN', 'FONT', 'LABEL']);
/** 即使文字较短也另起一行显示译文的段落类标签 */
const PARA = new Set(['P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'DD', 'DT', 'FIGCAPTION', 'SUMMARY', 'CAPTION']);

/** 双语模式下在译文里重复出现的原子（代码类）；图片、图标只保留原文那一份 */
const CLONE_ATOM = new Set(['CODE', 'KBD', 'SAMP', 'VAR']);
const ICON_CLASS = /(^|[\s_-])(icons?|iconfont|fa[srldb]?|glyphicon|material-icons|material-symbols)($|[\s_-])/i;

const WRAP_CLASS = 'drak-tr';
const BATCH_RUNS = 40;
const BATCH_CHARS = 4000;
const MAX_IN_FLIGHT = 3;

const STYLE_BASE = `
font.${WRAP_CLASS}[data-block]{display:block;margin:.3em 0 .15em}
font.${WRAP_CLASS}:not([data-block]){margin-inline-start:.45em}
`;
const STYLE_THEMES: Record<TranslateSettings['style'], string> = {
  plain: '',
  dim: `font.${WRAP_CLASS}{opacity:.72}`,
  underline: `font.${WRAP_CLASS}{text-decoration:underline dashed;text-decoration-thickness:1px;text-underline-offset:.25em}`,
  highlight: `font.${WRAP_CLASS}{background:color-mix(in srgb,currentColor 13%,transparent);border-radius:3px}font.${WRAP_CLASS}[data-block]{padding:.1em .3em}`,
};

class PageTranslator {
  private settings!: TranslateSettings;
  private active = false;
  private runs = new Set<Run>();
  private byParent = new Map<Element, Run[]>();
  /** 原始节点 -> 所属的段 */
  private nodeRun = new WeakMap<Node, Run>();
  /** 我们插入的顶层节点 */
  private ours = new WeakSet<Node>();
  private queue: Run[] = [];
  private inFlight = 0;
  private flushTimer = 0;
  private dirty = new Set<Node>();
  private dirtyTimer = 0;
  private io: IntersectionObserver | null = null;
  private mo: MutationObserver | null = null;
  private roots = new Set<ShadowRoot>();
  private styles: HTMLStyleElement[] = [];
  private usedEngine: EngineId | null = null;
  private error = '';
  private noted = false;
  private parser = new DOMParser();

  constructor() {
    chrome.runtime.onMessage.addListener((msg: PageCommand, _sender, sendResponse) => {
      switch (msg?.type) {
        case 'tr:start':
          void this.start().then(() => sendResponse(this.status()));
          return true;
        case 'tr:stop':
          this.stop();
          sendResponse(this.status());
          return false;
        case 'tr:toggle':
          if (this.active) {
            this.stop();
            sendResponse(this.status());
            return false;
          }
          void this.start().then(() => sendResponse(this.status()));
          return true;
        case 'tr:status':
          sendResponse(this.status());
          return false;
        default:
          return false;
      }
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[TRANSLATE_KEY] || !this.active) return;
      const next = normalizeTranslate(changes[TRANSLATE_KEY].newValue);
      const prev = this.settings;
      this.settings = next;
      if (next.engine !== prev.engine || next.target !== prev.target || next.mode !== prev.mode) {
        this.stop();
        void this.start();
      } else if (next.style !== prev.style) {
        for (const s of this.styles) s.textContent = this.css();
      }
    });
  }

  status(): PageStatus {
    let total = 0;
    let done = 0;
    for (const r of this.runs) {
      if (r.state === 'skipped') continue;
      total++;
      if (r.state === 'done') done++;
    }
    return { active: this.active, total, done, engine: this.usedEngine, error: this.error };
  }

  /** 告诉侧边按钮当前状态（同一页面里的其他内容脚本） */
  private emit(): void {
    const state: PageState = { active: this.active, busy: this.active && (this.inFlight > 0 || this.queue.length > 0) };
    document.dispatchEvent(new CustomEvent(STATE_EVENT, { detail: JSON.stringify(state) }));
  }

  async start(): Promise<void> {
    if (this.active) return;
    this.active = true;
    this.emit();
    this.settings = await loadTranslate();
    if (!this.active) return;
    this.error = '';
    this.noted = false;
    this.usedEngine = null;
    this.addStyle(document.head || document.documentElement);
    this.io = new IntersectionObserver((entries) => this.onIntersect(entries), { rootMargin: '600px 0px' });
    this.mo = new MutationObserver((records) => this.onMutations(records));
    this.observe(document);
    if (document.body) this.walk(document.body);
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.mo?.disconnect();
    this.io?.disconnect();
    this.mo = this.io = null;
    clearTimeout(this.flushTimer);
    clearTimeout(this.dirtyTimer);
    if (this.runs.size) {
      this.keepPosition(() => {
        for (const run of this.runs) this.revert(run);
      }, this.settings.mode);
    }
    this.runs.clear();
    this.byParent.clear();
    this.nodeRun = new WeakMap();
    this.ours = new WeakSet();
    this.queue = [];
    this.dirty.clear();
    this.roots.clear();
    for (const s of this.styles) s.remove();
    this.styles = [];
    this.emit();
  }

  // ---- 样式 ----

  private css(): string {
    return STYLE_BASE + STYLE_THEMES[this.settings.style];
  }

  private addStyle(into: Node): void {
    const style = document.createElement('style');
    style.dataset.drakTr = '';
    style.textContent = this.css();
    this.ours.add(style);
    into.appendChild(style);
    this.styles.push(style);
  }

  private observe(root: Document | ShadowRoot): void {
    this.mo?.observe(root, { subtree: true, childList: true, characterData: true });
  }

  // ---- 收集段落 ----

  private skipElement(el: Element): boolean {
    if (SKIP.has(el.tagName.toUpperCase())) return true;
    if (el.getAttribute('translate') === 'no' || el.classList.contains('notranslate')) return true;
    return (el as HTMLElement).isContentEditable;
  }

  private isAtom(el: Element): boolean {
    if (ATOM.has(el.tagName.toUpperCase())) return true;
    // 图标字体：文字其实是图标的连字名（如 material-icons 的 "menu"），翻译了图标就没了
    return !el.firstElementChild && ICON_CLASS.test(el.getAttribute('class') || '') && (el.textContent || '').length <= 30;
  }

  /** 元素自身是不是行内盒 */
  private inlineBox(el: Element): boolean {
    const tag = el.tagName;
    if (INLINE.has(tag)) return true;
    if (!MAYBE_INLINE.has(tag)) return false;
    const d = getComputedStyle(el).display;
    return d === 'inline' || d === 'contents';
  }

  /** 可以整体并入一段：自身行内，且里面没有块级内容 */
  private inlineOnly(el: Element): boolean {
    if (el.shadowRoot || !this.inlineBox(el) || this.skipElement(el)) return false;
    for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
      if (this.isAtom(c)) continue;
      if (c.tagName === 'BR' || !this.inlineOnly(c)) return false;
    }
    return true;
  }

  private walk(root: Element | ShadowRoot): void {
    if (root instanceof Element) {
      if (this.ours.has(root) || this.skipElement(root) || this.isAtom(root)) return;
      const sr = root.shadowRoot;
      if (sr) {
        if (!this.roots.has(sr)) {
          this.roots.add(sr);
          this.addStyle(sr);
          this.observe(sr);
        }
        this.walk(sr);
      }
    }
    let cur: Node[] = [];
    const flush = () => {
      if (cur.length) this.addRun(root, cur);
      cur = [];
    };
    // 先取快照：遍历过程中不改 DOM，但子元素的递归可能很深
    for (const child of Array.from(root.childNodes)) {
      if (this.ours.has(child) || this.nodeRun.has(child)) {
        flush();
        continue;
      }
      if (child.nodeType === Node.TEXT_NODE) {
        cur.push(child);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as Element;
        if (this.isAtom(el)) cur.push(el);
        else if (el.tagName === 'BR' || this.skipElement(el)) flush();
        else if (this.inlineOnly(el)) cur.push(el);
        else {
          flush();
          this.walk(el);
        }
      }
    }
    flush();
  }

  private addRun(parent: Element | ShadowRoot, nodes: Node[]): void {
    const anchor = parent instanceof Element ? parent : parent.host;
    const blank = (n: Node) => n.nodeType === Node.TEXT_NODE && !/\S/.test(n.nodeValue || '');
    while (nodes.length && blank(nodes[0])) nodes.shift();
    while (nodes.length && blank(nodes[nodes.length - 1])) nodes.pop();
    if (!nodes.length) return;
    const map: Element[] = [];
    let text = '';
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const ser = (n: Node): string => {
      if (n.nodeType === Node.TEXT_NODE) {
        const t = (n.nodeValue || '').replace(/\s+/g, ' ');
        text += t;
        return esc(t);
      }
      if (n.nodeType !== Node.ELEMENT_NODE) return '';
      const el = n as Element;
      const i = map.push(el) - 1;
      if (this.isAtom(el)) {
        // 代码等原子把文字带上（标记为不翻译），引擎才看得到完整的句子；图片、图标是空占位
        const keep = CLONE_ATOM.has(el.tagName) ? (el.textContent || '').replace(/\s+/g, ' ').slice(0, 200) : '';
        return `<b i="${i}" class="notranslate" translate="no">${esc(keep)}</b>`;
      }
      let inner = '';
      for (const c of Array.from(el.childNodes)) inner += ser(c);
      return `<a i="${i}">${inner}</a>`;
    };
    const html = nodes.map(ser).join('').trim();
    text = text.trim();
    if (!worthTranslating(text) || looksLikeTarget(text, this.settings.target) || looksLikeIdentifier(text) || this.isLinkName(anchor, nodes, text)) return;
    const run: Run = { parent, anchor, nodes, text, html, map, state: 'pending', inserted: [], replaced: false };
    this.runs.add(run);
    for (const n of nodes) this.nodeRun.set(n, run);
    const list = this.byParent.get(anchor);
    if (list) list.push(run);
    else this.byParent.set(anchor, [run]);
    // 重新观察一次，保证已经在视口里的元素也会收到通知
    this.io?.unobserve(anchor);
    this.io?.observe(anchor);
  }

  /**
   * 链接文字就是链接地址的最后一段（GitHub 文件列表里的 `build`、`scripts`，仓库名、用户名）：是名字不是句子，不翻。
   */
  private isLinkName(anchor: Element, nodes: Node[], text: string): boolean {
    if (/\s/.test(text)) return false;
    let link: Element | null = null;
    if (nodes.length === 1 && nodes[0].nodeType === Node.ELEMENT_NODE && (nodes[0] as Element).tagName === 'A') link = nodes[0] as Element;
    else link = anchor.closest('a');
    const href = link?.getAttribute('href');
    if (!href) return false;
    try {
      const path = new URL(href, location.href).pathname.replace(/\/+$/, '');
      const last = decodeURIComponent(path.slice(path.lastIndexOf('/') + 1));
      // 区分大小写：文档目录里“Installation”指向 /installation 的仍是要翻的标题
      return last === text;
    } catch {
      return false;
    }
  }

  private onIntersect(entries: IntersectionObserverEntry[]): void {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      this.io?.unobserve(e.target);
      for (const run of this.byParent.get(e.target) ?? []) {
        if (run.state !== 'pending') continue;
        run.state = 'queued';
        this.queue.push(run);
      }
    }
    this.scheduleFlush();
  }

  // ---- 请求 ----

  private scheduleFlush(): void {
    if (this.flushTimer || !this.queue.length) return;
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = 0;
      this.flush();
    }, 60);
  }

  private flush(): void {
    while (this.active && this.queue.length && this.inFlight < MAX_IN_FLIGHT) {
      const batch: Run[] = [];
      let chars = 0;
      while (this.queue.length && batch.length < BATCH_RUNS && (!batch.length || chars + this.queue[0].html.length <= BATCH_CHARS)) {
        const run = this.queue.shift()!;
        if (!this.runs.has(run)) continue;
        batch.push(run);
        chars += run.html.length;
      }
      if (batch.length) void this.send(batch);
    }
    this.emit();
  }

  private async send(batch: Run[]): Promise<void> {
    this.inFlight++;
    const { engine, target } = this.settings;
    let res: TranslateResponse;
    try {
      const req: TranslateRequest = { type: 'tr:translate', texts: batch.map((r) => r.html), to: target, engine };
      res = await chrome.runtime.sendMessage(req);
    } catch (e) {
      res = { ok: false, error: String(e) };
    }
    this.inFlight--;
    // 期间可能已停止或切换了设置
    if (!this.active || engine !== this.settings.engine || target !== this.settings.target) return;
    if (!res?.ok || !res.items) {
      this.error = res?.error || '翻译失败';
      for (const run of batch) if (this.runs.has(run)) run.state = 'skipped';
      toast(`翻译失败：${this.error}`);
    } else {
      this.error = '';
      this.usedEngine = res.engine ?? engine;
      if (res.note && res.engine && res.engine !== engine && !this.noted) {
        this.noted = true;
        toast(`${res.note}。已自动改用${ENGINE_NAMES[res.engine]}。`);
      }
      // 先把要写进页面的译文都准备好，再在一次“记位置 → 改 DOM → 补滚动”里写进去
      const ready: [Run, string][] = [];
      batch.forEach((run, i) => {
        if (!this.runs.has(run)) return;
        const item = res.items![i];
        const plain = this.plainText(item?.text ?? '');
        if (!item || !plain || sameLang(item.src, target) || plain === run.text || !run.nodes.every((n) => n.parentNode === run.parent)) {
          run.state = 'skipped';
          return;
        }
        ready.push([run, item.text]);
      });
      if (ready.length) {
        this.keepPosition(() => {
          for (const [run, html] of ready) {
            try {
              this.apply(run, html);
              run.state = 'done';
            } catch {
              run.state = 'skipped';
            }
          }
        }, this.settings.mode);
      }
      // 自己造成的 DOM 变化不需要再处理
      this.mo?.takeRecords();
    }
    this.flush();
  }

  // ---- 阅读位置 ----

  /**
   * 改 DOM 时保持阅读位置：译文变短、变长都不让正在看的内容被挤走。
   * 仅显示译文模式下段落本身会变长短，阅读线落在段落中间时按比例换算位置。
   */
  private keepPosition(fn: () => void, mode: TranslateSettings['mode']): void {
    let anchor = null;
    try {
      anchor = capture((hit) => this.stableElement(hit));
    } catch {
      /* 取不到锚点就只靠浏览器自带的滚动锚定 */
    }
    fn();
    try {
      restore(anchor, mode === 'replace');
    } catch {
      /* 同上 */
    }
  }

  /** 把点中的节点换成改动后仍在页面上的元素：跳出我们插入的译文，跳出可能被替换掉的原文段 */
  private stableElement(hit: Element): Element | null {
    let n: Node | null = hit;
    for (let p: Node | null = hit; p; p = p.parentNode) if (this.ours.has(p)) n = p.parentNode;
    const run = this.runOf(n);
    if (run) return run.anchor;
    if (n instanceof ShadowRoot) return n.host;
    return n instanceof Element ? n : null;
  }

  // ---- 渲染 ----

  private parse(html: string): HTMLElement {
    return this.parser.parseFromString(`<!doctype html><body>${html}`, 'text/html').body;
  }

  private plainText(html: string): string {
    return (this.parse(html).textContent || '').replace(/\s+/g, ' ').trim();
  }

  /** 按译文里的标签编号，用原始行内元素的浅拷贝重建节点 */
  private build(run: Run, html: string, reuseAtoms: boolean): DocumentFragment {
    const out = document.createDocumentFragment();
    const used = new Set<number>();
    const go = (src: Node, into: Node) => {
      for (const child of Array.from(src.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
          into.appendChild(document.createTextNode(child.nodeValue || ''));
          continue;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        const idx = Number((child as Element).getAttribute('i') ?? NaN);
        const orig = Number.isInteger(idx) ? run.map[idx] : undefined;
        if (!orig) {
          go(child, into);
          continue;
        }
        if (this.isAtom(orig)) {
          if (used.has(idx)) continue;
          used.add(idx);
          if (reuseAtoms) into.appendChild(orig);
          else if (CLONE_ATOM.has(orig.tagName)) into.appendChild(stripIds(orig.cloneNode(true) as Element));
          continue;
        }
        used.add(idx);
        const clone = orig.cloneNode(false) as Element;
        if (!reuseAtoms) stripIds(clone);
        go(child, clone);
        if (clone.childNodes.length) into.appendChild(clone);
      }
    };
    go(this.parse(html), out);
    // 替换模式下，引擎丢掉的图片等原子补回末尾，不能让页面内容消失
    if (reuseAtoms) run.map.forEach((el, i) => this.isAtom(el) && !used.has(i) && !out.contains(el) && out.appendChild(el));
    return out;
  }

  private apply(run: Run, html: string): void {
    const last = run.nodes[run.nodes.length - 1];
    if (this.settings.mode === 'replace') {
      const frag = this.build(run, html, true);
      const inserted = Array.from(frag.childNodes);
      // 顶层的原子（图片、代码）是原节点本身，被挪进了译文里：不算“我们的”，也不能当原文移除
      for (const n of inserted) if (!run.nodes.includes(n)) this.ours.add(n);
      run.parent.insertBefore(frag, run.nodes.find((n) => n.parentNode === run.parent) ?? null);
      for (const n of run.nodes) if (n.parentNode === run.parent && !inserted.includes(n as ChildNode)) run.parent.removeChild(n);
      run.inserted = inserted;
      run.replaced = true;
      return;
    }
    const wrap = document.createElement('font');
    wrap.className = `${WRAP_CLASS} notranslate`;
    wrap.setAttribute('translate', 'no');
    wrap.lang = this.settings.target;
    if (this.blockStyle(run)) wrap.dataset.block = '';
    wrap.appendChild(this.build(run, html, false));
    this.ours.add(wrap);
    last.parentNode!.insertBefore(wrap, last.nextSibling);
    run.inserted = [wrap];
  }

  /** 译文另起一行还是跟在原文后面 */
  private blockStyle(run: Run): boolean {
    const cs = getComputedStyle(run.anchor);
    // 单行截断、多行截断的容器里另起一行会被裁掉
    if (cs.whiteSpace === 'nowrap' || (cs.webkitLineClamp && cs.webkitLineClamp !== 'none')) return false;
    if (/flex|grid/.test(cs.display)) return false;
    return run.text.length >= 28 || (PARA.has(run.anchor.tagName) && run.text.length >= 10);
  }

  private revert(run: Run): void {
    if (run.replaced) {
      const first = run.inserted.find((n) => n.parentNode === run.parent) ?? null;
      if (first || run.parent.isConnected) {
        // 用一个临时标记定位，原节点依次放回它前面（译文里可能夹着被复用的原节点）
        const mark = document.createComment('');
        try {
          run.parent.insertBefore(mark, first);
          for (const n of run.nodes) run.parent.insertBefore(n, mark);
        } catch {
          /* 页面已经自己改过这一块 */
        }
        mark.remove();
      }
    }
    for (const n of run.inserted) if (!run.nodes.includes(n)) n.parentNode?.removeChild(n);
    run.inserted = [];
    run.replaced = false;
  }

  // ---- 页面后续变化 ----

  private drop(run: Run): void {
    // 页面自己改了这一段：双语模式撤掉旧译文；替换模式下原文已经被页面丢弃，不再放回
    if (!run.replaced) for (const n of run.inserted) n.parentNode?.removeChild(n);
    for (const n of run.nodes) this.nodeRun.delete(n);
    this.runs.delete(run);
    const list = this.byParent.get(run.anchor);
    if (list) {
      const rest = list.filter((r) => r !== run);
      if (rest.length) this.byParent.set(run.anchor, rest);
      else this.byParent.delete(run.anchor);
    }
  }

  /** 找到节点所在的段（节点可能在段内行内元素的深处） */
  private runOf(node: Node | null): Run | undefined {
    for (let n = node, depth = 0; n && depth < 6; n = n.parentNode, depth++) {
      const run = this.nodeRun.get(n);
      if (run) return run;
    }
    return undefined;
  }

  private insideOurs(node: Node | null): boolean {
    for (let n = node; n; n = n.parentNode) if (this.ours.has(n)) return true;
    return false;
  }

  private onMutations(records: MutationRecord[]): void {
    for (const rec of records) {
      const target = rec.target;
      if (this.insideOurs(target)) continue;
      if (rec.type === 'characterData') {
        const run = this.runOf(target);
        if (run) {
          this.drop(run);
          this.dirty.add(run.parent);
        } else if (target.parentNode) this.dirty.add(target.parentNode);
        continue;
      }
      const added = Array.from(rec.addedNodes).filter((n) => !this.ours.has(n));
      const removed = Array.from(rec.removedNodes).filter((n) => !this.ours.has(n));
      if (!added.length && !removed.length) continue;
      // 改动落在某一段内部（行内元素里）：整段重来
      const inner = this.runOf(target);
      if (inner) {
        this.drop(inner);
        this.dirty.add(inner.parent);
        continue;
      }
      for (const n of removed) {
        const run = this.nodeRun.get(n);
        if (run) this.drop(run);
      }
      if (added.length || removed.length) this.dirty.add(target);
    }
    if (this.dirty.size && !this.dirtyTimer) {
      this.dirtyTimer = window.setTimeout(() => {
        this.dirtyTimer = 0;
        const nodes = Array.from(this.dirty);
        this.dirty.clear();
        for (const n of nodes) {
          if (!n.isConnected) continue;
          // 父元素下原有的段可能要和新内容合并成一段：未翻译的先撤掉再重新划分
          if (!(n instanceof Element || n instanceof ShadowRoot)) continue;
          const key = n instanceof Element ? n : n.host;
          for (const run of this.byParent.get(key) ?? []) if (run.state === 'pending' && run.parent === n) this.drop(run);
          this.walk(n);
        }
        this.mo?.takeRecords();
      }, 200);
    }
  }
}

function stripIds(el: Element): Element {
  el.removeAttribute('id');
  el.removeAttribute('name');
  for (const d of Array.from(el.querySelectorAll('[id]'))) d.removeAttribute('id');
  return el;
}

// ---- 提示条（只在顶层页面显示） ----
let toastHost: HTMLElement | null = null;
let toastTimer = 0;
function toast(text: string): void {
  if (window.top !== window) return;
  if (!toastHost) {
    toastHost = document.createElement('drak-translate-toast');
    toastHost.setAttribute('translate', 'no');
    toastHost.attachShadow({ mode: 'open' }).innerHTML =
      '<style>div{position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:340px;padding:10px 14px;border-radius:8px;' +
      'background:#232427;color:#e4e4e4;border:1px solid #3a3c40;box-shadow:0 6px 24px rgba(0,0,0,.35);' +
      'font:13px/1.5 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;word-break:break-word}</style><div></div>';
  }
  toastHost.shadowRoot!.querySelector('div')!.textContent = text;
  if (!toastHost.isConnected) document.documentElement.appendChild(toastHost);
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastHost?.remove(), 6000);
}

const w = window as unknown as { __drakTranslate?: PageTranslator };
w.__drakTranslate ??= new PageTranslator();
