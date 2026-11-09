/**
 * 按站点修正规则（设计文档第 9 节）。规则是纯数据，不含脚本。
 */

export type RuleMode = 'dynamic' | 'native' | 'filter' | 'off';

export interface SiteRule {
  /** 主机名匹配：'zhihu.com' 精确匹配，'*.zhihu.com' 匹配子域和自身 */
  match: string[];
  mode?: RuleMode;
  /** 启用站点原生暗色主题的方式 */
  native?: {
    /** 在 <html> 上设置的属性，如 ['data-theme', 'dark'] */
    attr?: [string, string];
    /** 在 <html> 上添加的 class */
    className?: string;
    /** 服务端按 cookie 渲染主题的站点：写入的 cookie，如 ['themeApp', 'dark']。写入后下次加载生效，关闭时还原 */
    cookie?: [string, string];
  };
  /** 整块不处理的区域（如播放器） */
  ignore?: string[];
  /** 强制反转的元素（如公式图） */
  invert?: string[];
  /** 强制不动的图片（如二维码、视频封面） */
  keepImage?: string[];
  /** 直接指定 CSS 变量的暗色值 */
  vars?: Record<string, string>;
  /** 追加的 CSS 补丁 */
  css?: string;
}

export interface EffectiveRule {
  mode?: RuleMode;
  native?: SiteRule['native'];
  ignore: string[];
  invert: string[];
  keepImage: string[];
  vars: Record<string, string>;
  css: string;
}

export function hostMatches(pattern: string, host: string): boolean {
  const p = pattern.trim().toLowerCase();
  const h = host.toLowerCase();
  if (p.startsWith('*.')) {
    const base = p.slice(2);
    return h === base || h.endsWith('.' + base);
  }
  return p === h;
}

function isSelectorValid(sel: string): boolean {
  if (typeof document === 'undefined') return true;
  try {
    document.createDocumentFragment().querySelector(sel);
    return true;
  } catch {
    return false;
  }
}

/** 校验一条规则，返回问题列表（空表示合法） */
export function validateRule(raw: unknown): string[] {
  const errs: string[] = [];
  if (!raw || typeof raw !== 'object') return ['规则必须是对象'];
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.match) || r.match.length === 0 || !r.match.every((m) => typeof m === 'string' && m.trim())) {
    errs.push('match 必须是非空字符串数组');
  }
  if (r.mode !== undefined && !['dynamic', 'native', 'filter', 'off'].includes(r.mode as string)) {
    errs.push('mode 只能是 dynamic / native / filter / off');
  }
  for (const key of ['ignore', 'invert', 'keepImage'] as const) {
    const v = r[key];
    if (v === undefined) continue;
    if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) errs.push(`${key} 必须是字符串数组`);
    else for (const sel of v as string[]) if (!isSelectorValid(sel)) errs.push(`${key} 里的选择器无效：${sel}`);
  }
  if (r.vars !== undefined) {
    if (typeof r.vars !== 'object' || r.vars === null) errs.push('vars 必须是对象');
    else
      for (const [k, v] of Object.entries(r.vars as Record<string, unknown>)) {
        if (!k.startsWith('--') || typeof v !== 'string' || /[;{}]/.test(v)) errs.push(`vars 里的 ${k} 无效`);
      }
  }
  if (r.css !== undefined) {
    if (typeof r.css !== 'string') errs.push('css 必须是字符串');
    else if (/@import|url\(\s*['"]?\s*(https?:|\/\/)/i.test(r.css)) errs.push('css 不允许 @import 或外链 url()');
  }
  if (r.native !== undefined) {
    const n = r.native as Record<string, unknown>;
    if (n.attr !== undefined && !(Array.isArray(n.attr) && n.attr.length === 2 && n.attr.every((x) => typeof x === 'string'))) {
      errs.push('native.attr 必须是 [属性名, 值]');
    }
    if (n.className !== undefined && typeof n.className !== 'string') errs.push('native.className 必须是字符串');
    if (
      n.cookie !== undefined &&
      !(Array.isArray(n.cookie) && n.cookie.length === 2 && n.cookie.every((x) => typeof x === 'string' && /^[\w.-]+$/.test(x)))
    ) {
      errs.push('native.cookie 必须是 [名称, 值]，只能包含字母、数字、下划线、点和短横线');
    }
  }
  return errs;
}

export interface ParsedRules {
  rules: SiteRule[];
  errors: string[];
}

/** 解析用户规则 JSON，不合法的条目丢弃并给出原因 */
export function parseUserRules(text: string): ParsedRules {
  const out: ParsedRules = { rules: [], errors: [] };
  let data: unknown;
  try {
    data = JSON.parse(text || '[]');
  } catch (e) {
    out.errors.push(`JSON 解析失败：${(e as Error).message}`);
    return out;
  }
  if (!Array.isArray(data)) {
    out.errors.push('最外层必须是数组');
    return out;
  }
  data.forEach((r, i) => {
    const errs = validateRule(r);
    if (errs.length) out.errors.push(`第 ${i + 1} 条：${errs.join('；')}`);
    else out.rules.push(r as SiteRule);
  });
  return out;
}

/** 合并：后面的（优先级高的）覆盖前面的标量字段，数组字段合并 */
export function resolveRule(host: string, ...layers: SiteRule[][]): EffectiveRule {
  const eff: EffectiveRule = { ignore: [], invert: [], keepImage: [], vars: {}, css: '' };
  for (const layer of layers) {
    for (const r of layer) {
      if (!r.match.some((m) => hostMatches(m, host))) continue;
      if (r.mode) eff.mode = r.mode;
      if (r.native) eff.native = r.native;
      if (r.ignore) eff.ignore.push(...r.ignore);
      if (r.invert) eff.invert.push(...r.invert);
      if (r.keepImage) eff.keepImage.push(...r.keepImage);
      if (r.vars) Object.assign(eff.vars, r.vars);
      if (r.css) eff.css += '\n' + r.css;
    }
  }
  return eff;
}
