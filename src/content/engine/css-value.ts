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
}

const COLOR_FUNCS = new Set(['rgb', 'rgba', 'hsl', 'hsla']);

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
              fb = `,${r.text}`;
            }
            out += `var(${shadowVarName(role, name)}, var(${name}${fb}))`;
            res.hits++;
          } else {
            out += s.slice(i, end + 1);
          }
          i = end + 1;
          continue;
        }
        if (COLOR_FUNCS.has(lower)) {
          const whole = s.slice(i, end + 1);
          const t = tx.transform(whole, role);
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
