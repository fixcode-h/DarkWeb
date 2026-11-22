/**
 * 给点选的元素生成一条尽量稳定、又只命中它的 CSS 选择器。
 *
 * 屏蔽规则要在下次打开页面时还能命中同一个元素，而广告、推荐卡片这类内容常常是异步插进来的，
 * 刷新后兄弟元素的数量和顺序都可能变。所以按这个顺序找：
 * 1. 只用看起来不是随机生成的 id 和 class，从元素自己往上加祖先，直到唯一；
 * 2. 再加上构建工具生成的哈希类名（css-1x2y3z 这类同一版本网站每次刷新都一样，只在网站改版时变）；
 * 3. 还不唯一，才在有同类兄弟的那几层补位置，而且位置只在同类兄弟里数（:nth-child(n of …)），
 *    别的卡片插在前面也不受影响；
 * 4. 兜底：从 body 起逐层带序号。
 */

/** 构建工具生成的哈希类名（css-1x2y3z、sc-AbCdE、_3kF9a）、纯数字 id 一般每次构建都变，不用 */
export function looksStable(name: string): boolean {
  if (!name || name.length > 40) return false;
  if (/^\d/.test(name)) return false;
  if (/^(css|sc|jsx|emotion|styled|svelte)-/i.test(name)) return false;
  if (/^_?[a-z0-9]{5,}$/i.test(name) && /\d/.test(name) && /[a-z]/i.test(name) && !/[-_]/.test(name.slice(1))) return false;
  if (/[0-9a-f]{6,}/i.test(name)) return false;
  return /^[a-z_-][\w-]*$/i.test(name);
}

/**
 * 哈希类名：同一版本的网站每次加载都一样，比随加载顺序变化的位置可靠，但网站改版会变，所以排在稳定类名之后。
 * 带长串数字的（时间戳、流水号）每次加载都可能不同，不用。
 */
export function looksHashed(name: string): boolean {
  return !looksStable(name) && name.length <= 40 && /^-?[a-z_][\w-]*$/i.test(name) && !/\d{6,}/.test(name);
}

/** 一次最多往上找几层祖先（不带位置时） */
const MAX_DEPTH = 8;

function part(el: Element, hashed: boolean): string {
  const tag = CSS.escape(el.localName);
  if (el.id && looksStable(el.id)) return `${tag}#${CSS.escape(el.id)}`;
  const all = Array.from(el.classList);
  const classes = all.filter(looksStable).slice(0, 3);
  if (hashed) classes.push(...all.filter(looksHashed).slice(0, 2));
  return tag + classes.map((c) => `.${CSS.escape(c)}`).join('');
}

/** 有 id 或 class，不是光秃秃的标签名 */
function specific(p: string): boolean {
  return /[#.]/.test(p);
}

function count(sel: string): number {
  try {
    return document.querySelectorAll(sel).length;
  } catch {
    return -1;
  }
}

function unique(sel: string, el: Element): boolean {
  try {
    const all = document.querySelectorAll(sel);
    return all.length === 1 && all[0] === el;
  } catch {
    return false;
  }
}

/** parts 从元素自己往上排，取前 k 层拼成选择器 */
function join(parts: string[], k: number): string {
  return parts.slice(0, k).reverse().join(' > ');
}

/** 在和自己长得一样（同一段选择器）的兄弟里排第几 */
function nthAmong(el: Element, p: string): string {
  let i = 1;
  for (let s = el.previousElementSibling; s; s = s.previousElementSibling) if (s.matches(p)) i++;
  // 没有 class 时 “of div” 和 nth-of-type 一样；有 class 时只数同类兄弟，别的元素插进来不影响
  return `:nth-child(${i} of ${p})`;
}

function hasTwin(el: Element, p: string): boolean {
  for (const sib of Array.from(el.parentElement?.children ?? [])) if (sib !== el && sib.matches(p)) return true;
  return false;
}

export function selectorFor(el: Element): string {
  const levels: Element[] = [];
  for (let c: Element | null = el; c && c !== document.body && c !== document.documentElement; c = c.parentElement) levels.push(c);
  if (!levels.length) return el.localName;

  // 1、2：不带位置
  for (const hashed of [false, true]) {
    const parts = levels.map((l) => part(l, hashed));
    for (let k = 1; k <= Math.min(parts.length, MAX_DEPTH); k++) {
      const sel = join(parts, k);
      // 至少要有一层带 id / class，免得 “div > img” 这种碰巧唯一的选择器以后误伤别处
      if (parts.slice(0, k).some(specific) && unique(sel, el)) return sel;
      // 到了有稳定 id 的祖先还不唯一，再往上加也没用
      if (parts[k - 1].includes('#')) break;
    }
  }

  // 3：从元素往上找一个锚点（稳定 id，或者整页只有它一个的类名组合），只在锚点以下有同类兄弟的层补位置
  const parts = levels.map((l) => part(l, true));
  let top = levels.length;
  for (let i = 0; i < levels.length; i++) {
    if (parts[i].includes('#') || (specific(parts[i]) && count(parts[i]) === 1)) {
      top = i + 1;
      break;
    }
  }
  const head = top === levels.length ? 'body > ' : '';
  const chain = parts.slice(0, top);
  for (let i = 0; i < top; i++) {
    if (!hasTwin(levels[i], parts[i])) continue;
    chain[i] += nthAmong(levels[i], parts[i]);
    const sel = head + join(chain, top);
    if (unique(sel, el)) return sel;
  }
  const sel = head + join(chain, top);
  if (unique(sel, el)) return sel;

  // 4：兜底，从 body 起逐层带序号
  const path = levels.map((l) => `${part(l, false)}:nth-of-type(${1 + Array.from(l.parentElement?.children ?? []).filter((s) => s.localName === l.localName).indexOf(l)})`);
  return ['body', ...path.reverse()].join(' > ');
}
