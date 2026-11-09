/**
 * 样式表级改写：遍历 CSSOM，为每条含颜色的规则生成同选择器、只含颜色属性的覆盖规则。
 * 覆盖规则放进紧跟在页面样式之后的可构造样式表里，优先级和层叠顺序与原页面一致。
 */
import { rewriteValue, roleOfProperty, shadowVarName, stripUrl } from './css-value';
import type { ColorTransformer, Role } from './transform';

const ROLES: Role[] = ['bg', 'fg', 'border', 'shadow'];
const ROOT_SELECTOR = /(^|[\s,>+~(])(:root|html)(?![\w-])/i;

/** longhand 取不到值（简写里含 var() 时）时，依次尝试的简写 */
const SHORTHANDS: Record<string, string[]> = {
  background: ['background'],
  border: [
    'border', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-color',
    'border-block', 'border-inline', 'border-block-start', 'border-block-end',
    'border-inline-start', 'border-inline-end', 'border-block-color', 'border-inline-color',
  ],
  outline: ['outline'],
  'column-rule': ['column-rule'],
  'text-decoration': ['text-decoration'],
};

function shorthandFamily(prop: string): string[] | null {
  if (prop.startsWith('background')) return SHORTHANDS.background;
  if (prop.startsWith('border')) return SHORTHANDS.border;
  if (prop.startsWith('outline')) return SHORTHANDS.outline;
  if (prop.startsWith('column-rule')) return SHORTHANDS['column-rule'];
  if (prop.startsWith('text-decoration')) return SHORTHANDS['text-decoration'];
  return null;
}

export interface Decl {
  prop: string;
  value: string;
  important: boolean;
  original: string;
}

export interface BgImageHit {
  /** 外层包裹，如 ['@media (min-width: 800px)'] */
  wrappers: string[];
  selector: string;
  url: string;
  important: boolean;
}

export interface RewriteOptions {
  /** 原样式表 URL，用于把相对 url() 转成绝对地址 */
  base?: string;
  /** 站点规则里需要整体排除的区域（如播放器）；为空则不包 @scope */
  ignoreSelector?: string;
  /** 背景图回调，供图片分析器异步处理 */
  onBgImage?: (hit: BgImageHit) => void;
  /** 遇到读不到的跨域 @import 时回调 */
  onBlockedImport?: (href: string) => void;
}

function hasCSS(name: string): boolean {
  return typeof (globalThis as Record<string, unknown>)[name] === 'function';
}

function isStyleRule(r: CSSRule): r is CSSStyleRule {
  return r.type === 1;
}

export class SheetRewriter {
  private ruleCache = new WeakMap<CSSRule, string>();
  /** 一个 rewrite 周期内统计 */
  stats = { rules: 0, decls: 0 };

  constructor(public tx: ColorTransformer) {}

  reset(): void {
    this.ruleCache = new WeakMap();
  }

  rewriteSheet(rules: CSSRuleList, opts: RewriteOptions): string {
    return this.rewriteList(rules, opts, []);
  }

  private rewriteList(rules: CSSRuleList, opts: RewriteOptions, wrappers: string[]): string {
    let out = '';
    let styleBuf = '';
    const flush = () => {
      if (!styleBuf) return;
      out += opts.ignoreSelector ? `@scope (:root) to (${opts.ignoreSelector}) {\n${styleBuf}}\n` : styleBuf;
      styleBuf = '';
    };
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      try {
        if (isStyleRule(rule)) {
          const text = this.styleRule(rule, opts, wrappers);
          if (!text) continue;
          // @scope 内的选择器匹配不到作用域根（html）本身，涉及根元素的规则放在 @scope 外
          if (opts.ignoreSelector && ROOT_SELECTOR.test(rule.selectorText)) {
            flush();
            out += text;
          } else {
            styleBuf += text;
          }
          continue;
        }
        flush();
        out += this.otherRule(rule, opts, wrappers);
      } catch {
        // 单条规则失败只跳过这一条
      }
    }
    flush();
    return out;
  }

  private styleRule(rule: CSSStyleRule, opts: RewriteOptions, wrappers: string[]): string {
    const cached = this.ruleCache.get(rule);
    if (cached !== undefined) return cached;
    this.stats.rules++;
    const decls = this.declarations(rule.style, opts, (url, important) =>
      opts.onBgImage?.({ wrappers, selector: rule.selectorText, url, important }),
    );
    let nested = '';
    const sub = (rule as unknown as { cssRules?: CSSRuleList }).cssRules;
    if (sub && sub.length) nested = this.rewriteList(sub, { ...opts, ignoreSelector: undefined }, wrappers);
    const text = decls || nested ? `${rule.selectorText} {${decls}${nested}}\n` : '';
    this.ruleCache.set(rule, text);
    return text;
  }

  /** 生成一组声明的覆盖文本 */
  declarations(
    style: CSSStyleDeclaration,
    opts: RewriteOptions,
    onBgUrl?: (url: string, important: boolean) => void,
  ): string {
    let out = '';
    for (const d of this.collect(style, opts, onBgUrl)) {
      out += `${d.prop}:${d.value}${d.important ? ' !important' : ''};`;
    }
    return out;
  }

  /**
   * 收集一组声明里所有颜色相关属性的改写结果（含 CSS 变量的分角色影子变量）。
   * 颜色属性即使没变也会输出，保证覆盖表之间的先后关系与原页面一致。
   */
  collect(
    style: CSSStyleDeclaration,
    opts: RewriteOptions,
    onBgUrl?: (url: string, important: boolean) => void,
  ): Decl[] {
    const out: Decl[] = [];
    const done = new Set<string>();
    for (let i = 0; i < style.length; i++) {
      const prop = style[i];
      if (prop.startsWith('--')) {
        if (prop.startsWith('--drak-')) continue;
        const value = style.getPropertyValue(prop);
        const important = style.getPropertyPriority(prop) === 'important';
        for (const role of ROLES) {
          const r = rewriteValue(value, role, this.tx, opts.base);
          if (r.hits > 0) {
            out.push({ prop: shadowVarName(role, prop), value: r.text, important, original: value });
            this.stats.decls++;
          }
        }
        continue;
      }
      const role = roleOfProperty(prop);
      if (!role) continue;
      let target = prop;
      let value = style.getPropertyValue(prop);
      if (value === '') {
        const fam = shorthandFamily(prop);
        const sh = fam?.find((s) => style.getPropertyValue(s) !== '');
        if (!sh || done.has(sh)) continue;
        target = sh;
        value = style.getPropertyValue(sh);
      }
      if (done.has(target)) continue;
      done.add(target);
      const important = style.getPropertyPriority(target) === 'important';
      const r = rewriteValue(value, role, this.tx, opts.base);
      if (target === 'background-image' && r.urls.length === 1 && r.hits === 0 && onBgUrl) {
        try {
          onBgUrl(new URL(stripUrl(r.urls[0]), opts.base || location.href).href, important);
        } catch {
          /* 无效 URL */
        }
      }
      out.push({ prop: target, value: r.text, important, original: value });
      this.stats.decls++;
    }
    return out;
  }

  private otherRule(rule: CSSRule, opts: RewriteOptions, wrappers: string[]): string {
    // @import
    if (rule.type === 3) {
      const imp = rule as CSSImportRule;
      let inner = '';
      try {
        if (imp.styleSheet) inner = this.rewriteList(imp.styleSheet.cssRules, { ...opts, base: imp.styleSheet.href || opts.base }, wrappers);
      } catch {
        if (imp.href) opts.onBlockedImport?.(new URL(imp.href, opts.base || location.href).href);
        return '';
      }
      if (!inner) return '';
      const media = imp.media?.mediaText;
      const layer = (imp as unknown as { layerName?: string | null }).layerName;
      if (layer !== null && layer !== undefined) inner = `@layer ${layer} {\n${inner}}\n`;
      if (media) inner = `@media ${media} {\n${inner}}\n`;
      return inner;
    }
    // @keyframes：同名 keyframes 后者整体覆盖前者，所以要复制全部属性
    if (rule.type === 7) {
      const kf = rule as CSSKeyframesRule;
      let body = '';
      let hits = 0;
      for (let i = 0; i < kf.cssRules.length; i++) {
        const frame = kf.cssRules[i] as CSSKeyframeRule;
        let decls = '';
        for (let j = 0; j < frame.style.length; j++) {
          const p = frame.style[j];
          const v = frame.style.getPropertyValue(p);
          const role = roleOfProperty(p);
          if (role) {
            const r = rewriteValue(v, role, this.tx, opts.base);
            hits += r.hits;
            decls += `${p}:${r.text};`;
          } else {
            decls += `${p}:${v};`;
          }
        }
        body += `${frame.keyText} {${decls}}\n`;
      }
      if (!hits) return '';
      const name = hasCSS('CSS') && CSS.escape ? CSS.escape(kf.name) : kf.name;
      return `@keyframes ${name} {\n${body}}\n`;
    }
    // 分组规则：@media / @supports / @layer / @container / @scope ...
    const sub = (rule as CSSGroupingRule).cssRules;
    if (sub) {
      let head: string;
      if (rule.type === 4) head = `@media ${(rule as CSSMediaRule).media.mediaText}`;
      else if (rule.type === 12) head = `@supports ${(rule as CSSSupportsRule).conditionText}`;
      else if (typeof CSSLayerBlockRule !== 'undefined' && rule instanceof CSSLayerBlockRule) head = `@layer ${rule.name}`;
      else {
        const text = rule.cssText;
        head = text.slice(0, text.indexOf('{')).trim();
      }
      if (!head.startsWith('@') || head.startsWith('@font') || head.startsWith('@page')) return '';
      const inner = this.rewriteList(sub, opts, [...wrappers, head]);
      return inner ? `${head} {\n${inner}}\n` : '';
    }
    return '';
  }
}
