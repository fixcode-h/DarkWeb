/**
 * 翻译改动页面时保持阅读位置。
 *
 * 浏览器自带的滚动锚定（overflow-anchor）能处理“视口上方的内容变高变矮”，但有几种情况会失效：
 * - 视口顶部正在读的那段本身被替换成译文：锚点（原文文字节点）被删掉，浏览器只能保住这一段的顶部，
 *   段落变矮后整段缩到视口上方，下面的内容一下子顶上来；
 * - 页面自己写了 overflow-anchor: none（不少站点为了无限滚动会关掉）；
 * - 不支持滚动锚定的浏览器。
 *
 * 做法：改 DOM 前在“阅读线”上取一个不会被删掉的元素，记下它的位置；改完后按它的新位置把滚动补回来。
 * 读的那段自己变了长短（仅显示译文模式）时，按“读到这段的百分之几”换算，而不是死守段落顶部。
 */

/** 改动前记下的位置 */
export interface Anchor {
  el: Element;
  top: number;
  height: number;
  /** 阅读线在视口中的纵坐标 */
  line: number;
  /** 负责滚动的容器；null 表示整个页面 */
  scroller: Element | null;
}

/**
 * 改动后锚点元素应该在的顶部位置。
 * proportional：段落本身的长短会变（替换成译文、还原原文），阅读线落在段落中间时按比例换算。
 */
export function targetTop(a: Pick<Anchor, 'top' | 'height' | 'line'>, newHeight: number, proportional: boolean): number {
  if (!proportional || a.top >= a.line || a.height <= 0 || a.top + a.height <= a.line) return a.top;
  const f = (a.line - a.top) / a.height;
  return a.line - f * newHeight;
}

/** 元素或它的祖先是否固定在屏幕上（导航栏、悬浮按钮）：不能拿来当锚点 */
function pinned(el: Element): boolean {
  for (let e: Element | null = el; e; e = e.parentElement) {
    const p = getComputedStyle(e).position;
    if (p === 'fixed' || p === 'sticky') return true;
  }
  return false;
}

function scrollerOf(el: Element): Element | null {
  for (let e = el.parentElement; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
    const oy = getComputedStyle(e).overflowY;
    if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && e.scrollHeight > e.clientHeight) return e;
  }
  return null;
}

/** 点到 Shadow DOM 宿主时继续往里找 */
function deepHit(x: number, y: number): Element | null {
  let hit = document.elementFromPoint(x, y);
  while (hit?.shadowRoot) {
    const inner = hit.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === hit) break;
    hit = inner;
  }
  return hit;
}

/**
 * 在阅读线上找锚点。resolve 把点中的节点换成改动后仍然存在的元素（跳出译文、跳出将被替换的原文）。
 */
export function capture(resolve: (hit: Element) => Element | null): Anchor | null {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!vw || !vh) return null;
  // 阅读线放在视口上部，避开大多数顶部导航栏，也大致是眼睛停留的位置
  const line = Math.round(vh * 0.25);
  for (const fx of [0.5, 0.35, 0.65, 0.2, 0.8]) {
    const hit = deepHit(Math.round(vw * fx), line);
    if (!hit || hit === document.body || hit === document.documentElement) continue;
    const el = resolve(hit);
    if (!el || !el.isConnected || el === document.body || el === document.documentElement || pinned(el)) continue;
    const r = el.getBoundingClientRect();
    if (!r.height) continue;
    return { el, top: r.top, height: r.height, line, scroller: scrollerOf(el) };
  }
  return null;
}

/** 改动后把锚点挪回原位 */
export function restore(a: Anchor | null, proportional: boolean): void {
  if (!a || !a.el.isConnected) return;
  // 读位置会触发一次布局；浏览器自带的滚动锚定此时已经生效，下面只补它没补到的差
  const r = a.el.getBoundingClientRect();
  const delta = r.top - targetTop(a, r.height, proportional);
  if (Math.abs(delta) < 1) return;
  // instant：页面设了 scroll-behavior: smooth 时也要一步到位，否则会看到一段滚动动画
  (a.scroller ?? window).scrollBy({ top: delta, behavior: 'instant' as ScrollBehavior });
}
