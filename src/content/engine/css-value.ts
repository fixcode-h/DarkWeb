/**
 * CSS 值级改写：在一个属性值里找出颜色、var() 引用、url()，按角色替换。
 * 不认识的内容原样保留。
 */
import { isNamedColor } from './color';
import type { ColorTransformer, Role } from './transform';

export const SHADOW_VAR_PREFIX = '--drak-';

export function shadowVarName(role: Role, name: string): string {
  // name 形如 --bg1
  return `${SHADOW_VAR_PREFIX}${role}-${name}`;
}

export interface RewriteResult {
  text: string;
  /** 替换了多少处颜色或 var() 引用 */
  hits: number;
  /** 值里出现了 url() */
  urls: string[];
  /** 通过影子变量引用到的页面变量名（用来统计每个变量在哪些角色下被用到） */
  vars?: string[];
}

const COLOR_FUNCS = new Set(['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'oklch', 'oklab', 'lch', 'lab']);

function isIdentChar(ch: string): boolean {
  return /[a-zA-Z0-9_\-]/.test(ch) || ch.charCodeAt(0) > 127;
}

/** 从 start（指向 '('）开始找到匹配的 ')'，返回其下标；找不到返回 -1 */
export function matchParen(s: string, start: number): number {
  let depth = 0;
  let quote = '';
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 按顶层逗号切分（忽略括号和引号里的逗号） */
export function splitTopLevel(s: string, sep = ','): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === sep && depth === 0) {
      out.push(s.slice(last, i));
      last = i + 1;
    }
  }
  out.push(s.slice(last));
  return out;
}

export function absolutizeUrl(raw: string, base?: string): string {
  let u = raw.trim();
  let q = '';
  if ((u.startsWith('"') && u.endsWith('"')) || (u.startsWith("'") && u.endsWith("'"))) {
    q = u[0];
    u = u.slice(1, -1);
  }
  if (!base || /^(data|blob|about|javascript):/i.test(u) || u.startsWith('#')) return raw;
  try {
    const abs = new URL(u, base).href;
    return `${q || '"'}${abs.replace(/"/g, '%22')}${q || '"'}`;
  } catch {
    return raw;
  }
}

export function stripUrl(raw: string): string {
  let u = raw.trim();
  if ((u.startsWith('"') && u.endsWith('"')) || (u.startsWith("'") && u.endsWith("'"))) u = u.slice(1, -1);
  return u;
}

/**
 * 通道是常量、只有透明度用 var() 的颜色，例如 Tailwind v3 的 `rgb(255 255 255/var(--tw-bg-opacity))`、
 * `rgba(0,0,0,var(--a))`：按不透明颜色改写通道，透明度表达式原样保留。
 */
function transformVarAlpha(fn: string, inner: string, role: Role, tx: ColorTransformer): string | null {
  if (!inner.includes('var(')) return null;
  let channels: string;
  let alpha: string;
  const slash = splitTopLevel(inner, '/');
  if (slash.length === 2) {
    channels = slash[0].trim();
    alpha = slash[1].trim();
  } else {
    const parts = splitTopLevel(inner);
    if (parts.length !== 4) return null;
    channels = parts.slice(0, 3).join(',');
    alpha = parts[3].trim();
  }
  if (!alpha || channels.includes('var(') || channels.includes('(')) return null;
  const base = fn === 'rgba' ? 'rgb' : fn === 'hsla' ? 'hsl' : fn;
  const t = tx.transform(`${base}(${channels})`, role);
  if (!t) return null;
  const m = /^rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/.exec(t);
  if (!m) return null;
  // 改写后自带透明度（例如阴影角色）时与原透明度相乘
  const a = m[4] !== undefined ? `calc(${m[4]} * ${alpha})` : alpha;
  return `rgb(${m[1]} ${m[2]} ${m[3]} / ${a})`;
}

/** 通道变量的影子变量名：`--drak-bg-hsl---background` */
export function channelVarName(role: Role, fn: 'rgb' | 'hsl', name: string): string {
  return `${SHADOW_VAR_PREFIX}${role}-${fn}-${name}`;
}

const CHANNEL_PART = /^-?(\d+\.?\d*|\.\d+)(%|deg)?$/;

/**
 * 变量里只存颜色通道的写法（shadcn/ui 的 `--background: 0 0% 100%`、Vercel Geist 的 `--x-value: 0, 0%, 98%`、
 * Tailwind 的 `--color: 255 255 255`）：按 hsl / rgb 两种解释各算出改写后的完整颜色，
 * 供使用处 `hsl(var(--background))` 引用。返回 [变量名后缀, 原颜色] 列表。
 */
export function channelVarCandidates(value: string): Array<['rgb' | 'hsl', string]> {
  const v = value.trim();
  if (!v || v.length > 40 || /[^\d.,%\sdeg-]/.test(v)) return [];
  const parts = v.includes(',') ? v.split(',').map((x) => x.trim()) : v.split(/\s+/);
  if (parts.length !== 3 || !parts.every((x) => CHANNEL_PART.test(x))) return [];
  const out: Array<['rgb' | 'hsl', string]> = [];
  if (!parts[0].endsWith('%') && !parts[0].endsWith('deg') && parts[1].endsWith('%') && parts[2].endsWith('%')) out.push(['hsl', `hsl(${v})`]);
  const pcts = parts.filter((x) => x.endsWith('%')).length;
  if (parts.every((x) => !x.endsWith('deg')) && (pcts === 0 || pcts === 3)) out.push(['rgb', `rgb(${v})`]);
  return out;
}

/** 使用处：`hsl(var(--x))`、`hsl(var(--x) / 0.5)`、`hsla(var(--x), 1)`、`rgb(var(--x) / var(--tw-bg-opacity))` */
function channelVarColor(fn: string, inner: string, whole: string, role: Role): string | null {
  const base = fn === 'rgba' || fn === 'rgb' ? 'rgb' : fn === 'hsla' || fn === 'hsl' ? 'hsl' : null;
  if (!base) return null;
  let parts = splitTopLevel(inner, '/');
  if (parts.length === 1) parts = splitTopLevel(inner);
  if (parts.length > 2) return null;
  const m = /^var\(\s*(--[\w-]+)\s*\)$/.exec(parts[0].trim());
  if (!m || m[1].startsWith(SHADOW_VAR_PREFIX)) return null;
  const shadow = `var(${channelVarName(role, base, m[1])}, ${base}(var(${m[1]})))`;
  const alpha = parts[1]?.trim();
  if (!alpha || alpha === '1' || alpha === '100%') return `var(${channelVarName(role, base, m[1])}, ${whole})`;
  let pct: string;
  if (/^(\d+\.?\d*|\.\d+)$/.test(alpha)) pct = `${Math.round(parseFloat(alpha) * 10000) / 100}%`;
  else if (/^(\d+\.?\d*|\.\d+)%$/.test(alpha)) pct = alpha;
  else pct = `calc(${alpha} * 100%)`;
  return `color-mix(in srgb, ${shadow} ${pct}, transparent)`;
}

/**
 * 改写一个属性值。
 * @param base 原样式表的 URL，用于把相对 url() 变为绝对地址
 */
export function rewriteValue(value: string, role: Role, tx: ColorTransformer, base?: string): RewriteResult {
  const res: RewriteResult = { text: '', hits: 0, urls: [] };
  let out = '';
  const s = value;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    // 字符串
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < s.length && s[j] !== ch) {
        if (s[j] === '\\') j++;
        j++;
      }
      out += s.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    // #hex
    if (ch === '#' && (i === 0 || !isIdentChar(s[i - 1]))) {
      let j = i + 1;
      while (j < s.length && /[0-9a-fA-F]/.test(s[j])) j++;
      const len = j - i - 1;
      if ((len === 3 || len === 4 || len === 6 || len === 8) && (j >= s.length || !isIdentChar(s[j]))) {
        const t = tx.transform(s.slice(i, j), role);
        if (t) {
          out += t;
          res.hits++;
        } else out += s.slice(i, j);
        i = j;
        continue;
      }
      out += s.slice(i, j);
      i = j;
      continue;
    }
    // 标识符 / 函数
    if (/[a-zA-Z_\-]/.test(ch) && (i === 0 || !isIdentChar(s[i - 1]))) {
      let j = i;
      while (j < s.length && isIdentChar(s[j])) j++;
      const ident = s.slice(i, j);
      const lower = ident.toLowerCase();
      if (s[j] === '(') {
        const end = matchParen(s, j);
        if (end < 0) {
          out += s.slice(i);
          break;
        }
        const inner = s.slice(j + 1, end);
        if (lower === 'url') {
          res.urls.push(stripUrl(inner));
          out += `url(${absolutizeUrl(inner, base)})`;
          i = end + 1;
          continue;
        }
        if (lower === 'var') {
          const parts = splitTopLevel(inner);
          const name = parts[0].trim();
          const fallback = parts.length > 1 ? parts.slice(1).join(',') : undefined;
          if (name.startsWith('--') && !name.startsWith(SHADOW_VAR_PREFIX)) {
            let fb = '';
            if (fallback !== undefined) {
              const r = rewriteValue(fallback, role, tx, base);
              res.urls.push(...r.urls);
              if (r.vars) (res.vars ??= []).push(...r.vars);
              fb = `,${r.text}`;
            }
            out += `var(${shadowVarName(role, name)}, var(${name}${fb}))`;
            (res.vars ??= []).push(name);
            res.hits++;
          } else {
            out += s.slice(i, end + 1);
          }
          i = end + 1;
          continue;
        }
        if (COLOR_FUNCS.has(lower)) {
          const whole = s.slice(i, end + 1);
          let t = tx.transform(whole, role) ?? transformVarAlpha(lower, inner, role, tx);
          if (!t) {
            t = channelVarColor(lower, inner, whole, role);
            const m = t && /var\(\s*(--[\w-]+)/.exec(inner);
            if (m) (res.vars ??= []).push(m[1]);
          }
          if (t) {
            out += t;
            res.hits++;
          } else {
            out += whole;
          }
          i = end + 1;
          continue;
        }
        // 其他函数（渐变、calc、color-mix 等）：递归处理参数
        const r = rewriteValue(inner, role, tx, base);
        res.hits += r.hits;
        res.urls.push(...r.urls);
        if (r.vars) (res.vars ??= []).push(...r.vars);
        out += `${ident}(${r.text})`;
        i = end + 1;
        continue;
      }
      if (lower !== 'transparent' && isNamedColor(lower)) {
        const t = tx.transform(lower, role);
        if (t) {
          out += t;
          res.hits++;
          i = j;
          continue;
        }
      }
      out += ident;
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  res.text = out;
  return res;
}

/** 属性名 -> 颜色角色；不涉及颜色的属性返回 null */
export function roleOfProperty(prop: string): Role | null {
  switch (prop) {
    case 'background':
    case 'background-color':
    case 'background-image':
      return 'bg';
    case 'color':
    case 'caret-color':
    case 'text-decoration-color':
    case 'text-decoration':
    case '-webkit-text-fill-color':
    case '-webkit-text-stroke-color':
    case 'text-emphasis-color':
    case 'fill':
    case 'stroke':
    case 'stop-color':
    case 'flood-color':
    case 'lighting-color':
      return 'fg';
    case 'box-shadow':
    case 'text-shadow':
      return 'shadow';
    default:
      if (/^(border|outline|column-rule)/.test(prop)) {
        if (prop.endsWith('-color')) return 'border';
        // 只有简写（border、border-top、outline……）可能带颜色；border-width/radius 等不含颜色
        if (/^(border(-(top|right|bottom|left|block|inline)(-(start|end))?)?|outline|column-rule)$/.test(prop)) return 'border';
      }
      return null;
  }
}

/** 一个值里是否可能含颜色（快速预筛） */
export function mayContainColor(value: string): boolean {
  return /#|rgb|hsl|var\(|[a-z]{3,}/i.test(value);
}
