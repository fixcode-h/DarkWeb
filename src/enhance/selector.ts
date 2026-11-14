/**
 * 给点选的元素生成一条尽量稳定、又只命中它（或同一位置同类元素）的 CSS 选择器。
 * 优先用看起来不是随机生成的 id 和 class；不够唯一再往上加祖先、最后补 :nth-of-type。
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

function part(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (el.id && looksStable(el.id)) return `${tag}#${CSS.escape(el.id)}`;
  const classes = Array.from(el.classList).filter(looksStable).slice(0, 3);
  return tag + classes.map((c) => `.${CSS.escape(c)}`).join('');
}

function nth(el: Element): string {
  let i = 1;
  for (let s = el.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === el.tagName) i++;
  return `:nth-of-type(${i})`;
}

function unique(sel: string, el: Element): boolean {
  try {
    const all = document.querySelectorAll(sel);
    return all.length === 1 && all[0] === el;
  } catch {
    return false;
  }
}

export function selectorFor(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  for (let depth = 0; cur && cur !== document.documentElement && depth < 6; depth++) {
    parts.unshift(part(cur));
    const sel = parts.join(' > ');
    if (unique(sel, el)) return sel;
    if (cur.id && looksStable(cur.id)) {
      // 祖先有稳定 id 还不唯一：在本层补序号
      parts[0] += nth(cur);
      if (unique(parts.join(' > '), el)) return parts.join(' > ');
    }
    cur = cur.parentElement;
  }
  // 兜底：从 body 起逐层带序号
  const path: string[] = [];
  for (let c: Element | null = el; c && c !== document.body && c !== document.documentElement; c = c.parentElement) path.unshift(part(c) + nth(c));
  return ['body', ...path].join(' > ');
}
