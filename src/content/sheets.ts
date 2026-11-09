/**
 * 每个文档 / Shadow Root 一份：跟踪页面样式表，维护对应的覆盖样式表，
 * 并把它们按原顺序挂到 adoptedStyleSheets 末尾（层叠顺序与原页面一致，不改页面 DOM）。
 */
import type { BgImageHit } from './engine/rewriter';
import type { Ctx } from './context';

interface Entry {
  sheet: CSSStyleSheet;
  sig: string;
  text: string;
}

/** 同文本 <style>（例如每个评论组件里一份）共享改写结果 */
const textCache = new Map<string, string>();

function sameList(a: readonly CSSStyleSheet[], b: readonly CSSStyleSheet[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function wrapScreen(text: string, media?: string): string {
  if (!text) return '';
  const inner = media && media !== 'all' ? `@media ${media} {\n${text}}\n` : text;
  return `@media screen {\n${inner}}\n`;
}

export class RootSheets {
  private entries = new Map<CSSStyleSheet, Entry>();
  /** 放在所有覆盖表之后的附加表（站点表、媒体表、补丁表） */
  extra: CSSStyleSheet[] = [];
  /** 放在覆盖表之前的缓存表（只有文档根有） */
  cache: CSSStyleSheet | null = null;
  private patchSheet: CSSStyleSheet;
  private patches = new Map<string, string>();
  /** 正在等待跨域拉取的数量 */
  pending = 0;

  constructor(public root: Document | ShadowRoot, private ctx: Ctx, shared: CSSStyleSheet[]) {
    this.patchSheet = this.newSheet();
    this.extra = [...shared, this.patchSheet];
  }

  newSheet(text = ''): CSSStyleSheet {
    const s = new CSSStyleSheet();
    this.ctx.own.add(s);
    if (text) s.replaceSync(text);
    return s;
  }

  get size(): number {
    return this.entries.size;
  }

  /** 所有覆盖文本（用于写缓存） */
  allText(): string {
    let t = '';
    for (const e of this.entries.values()) t += e.text;
    return t;
  }

  /** 重新扫描这个根下的全部样式表 */
  sync(force = false): void {
    const root = this.root;
    const list: CSSStyleSheet[] = [];
    for (const s of Array.from(root.styleSheets)) {
      const owner = s.ownerNode as Element | null;
      if (owner && owner.nodeType === 1 && owner.hasAttribute('data-drak')) continue;
      list.push(s);
    }
    const pageAdopted = root.adoptedStyleSheets.filter((s) => !this.ctx.own.has(s));
    list.push(...pageAdopted);

    const seen = new Set<CSSStyleSheet>();
    for (const s of list) {
      seen.add(s);
      this.ctx.guard.run('sheet', () => this.update(s, force));
    }
    for (const k of Array.from(this.entries.keys())) if (!seen.has(k)) this.entries.delete(k);

    const ours: CSSStyleSheet[] = [];
    for (const s of list) {
      const e = this.entries.get(s);
      if (e) ours.push(e.sheet);
    }
    const desired = [...pageAdopted, ...(this.cache ? [this.cache] : []), ...ours, ...this.extra];
    if (!sameList(root.adoptedStyleSheets, desired)) root.adoptedStyleSheets = desired;
  }

  private update(s: CSSStyleSheet, force: boolean): void {
    let rules: CSSRuleList | null = null;
    try {
      rules = s.cssRules;
    } catch {
      rules = null;
    }
    const existing = this.entries.get(s);
    const media = s.media?.mediaText || '';
    if (!rules) {
      // 跨域样式表：交给后台拉取文本后再改写
      const href = s.href;
      if (!href) return;
      const sig = `xo|${href}|${media}|${s.disabled}`;
      if (existing && existing.sig === sig && !force) return;
      const entry: Entry = existing ?? { sheet: this.newSheet(), sig, text: '' };
      entry.sig = sig;
      this.entries.set(s, entry);
      // 发现 <link> 时已经预取过：同步应用，赶在首次绘制前
      const ready = this.ctx.peekCss(href);
      if (ready !== undefined) {
        if (ready !== null) {
          const text = wrapScreen(this.rewriteText(ready, href), media);
          entry.text = text;
          entry.sheet.replaceSync(text);
        }
        return;
      }
      this.pending++;
      this.ctx
        .fetchCss(href)
        .then((css) => {
          if (css === null || s.disabled) return;
          this.ctx.guard.run('xo-sheet', () => {
            const text = wrapScreen(this.rewriteText(css, href), media);
            entry.text = text;
            entry.sheet.replaceSync(text);
          });
        })
        .finally(() => {
          this.pending--;
        });
      return;
    }
    const sig = `${rules.length}|${media}|${s.disabled}`;
    if (existing && existing.sig === sig && !force) return;
    let text = '';
    if (!s.disabled) {
      const owner = s.ownerNode as Element | null;
      const base = s.href || (owner ? owner.baseURI : document.baseURI);
      let key = '';
      if (this.root instanceof ShadowRoot && owner && owner.localName === 'style') {
        const t = owner.textContent || '';
        if (t.length < 200_000 && rules.length === countRulesHint(t)) key = t;
      }
      const cached = key ? textCache.get(key) : undefined;
      if (cached !== undefined) text = cached;
      else {
        text = wrapScreen(
          this.ctx.rewriter.rewriteSheet(rules, {
            base,
            ignoreSelector: this.root instanceof Document ? this.ctx.ignoreSelector : '',
            onBgImage: (hit) => this.ctx.onBgImage(hit, this.root),
          }),
          media,
        );
        if (key) {
          if (textCache.size > 500) textCache.clear();
          textCache.set(key, text);
        }
      }
    }
    const entry: Entry = existing ?? { sheet: this.newSheet(), sig, text: '' };
    entry.sig = sig;
    if (entry.text !== text) {
      entry.text = text;
      entry.sheet.replaceSync(text);
    }
    this.entries.set(s, entry);
  }

  /** 改写一段 CSS 文本（跨域样式表），借助临时样式表解析 */
  rewriteText(css: string, base: string): string {
    const tmp = new CSSStyleSheet();
    tmp.replaceSync(css.replace(/@import[^;]+;/g, ''));
    return this.ctx.rewriter.rewriteSheet(tmp.cssRules, {
      base,
      ignoreSelector: this.root instanceof Document ? this.ctx.ignoreSelector : '',
      onBgImage: (hit) => this.ctx.onBgImage(hit, this.root),
    });
  }

  /** 背景图反转补丁 */
  /** image 是完整的 background-image 值 */
  addPatch(hit: BgImageHit, image: string): void {
    const key = hit.wrappers.join('|') + '|' + hit.selector;
    let rule = `${hit.selector}{background-image:${image}${hit.important ? ' !important' : ''}}`;
    for (let i = hit.wrappers.length - 1; i >= 0; i--) rule = `${hit.wrappers[i]}{${rule}}`;
    this.patches.set(key, rule);
    try {
      this.patchSheet.replaceSync(wrapScreen(Array.from(this.patches.values()).join('\n')));
    } catch {
      this.patches.delete(key);
    }
  }

  /** 从根上移除我们挂的所有样式表 */
  detach(): void {
    try {
      this.root.adoptedStyleSheets = this.root.adoptedStyleSheets.filter((s) => !this.ctx.own.has(s));
    } catch {
      /* ignore */
    }
  }

  reset(): void {
    this.entries.clear();
  }
}

/**
 * 粗略判断 <style> 文本与解析出的规则数是否一致（文本被 insertRule 改过时不一致，此时不走文本缓存）。
 * 只数顶层 '}' 不精确，这里只用作“可能一致”的保守判断：规则数为 0 时文本必须也为空。
 */
function countRulesHint(t: string): number {
  let depth = 0;
  let n = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c === 123) depth++;
    else if (c === 125) {
      depth--;
      if (depth === 0) n++;
    }
  }
  return n;
}
