/**
 * 判断“页面自己已经是深色”（网站自带暗色主题已开启），是的话插件不再叠加一层。
 * 判断依据是页面实际呈现的颜色，而不是某个 class 名：在视口里取 5x5 个点，看每个点最上层的不透明背景。
 * 这样下面几种只看 body 背景会漏掉的情况都能认出来：
 *   - body 透明，深色背景画在 #app 之类的包裹层上（多数单页应用）
 *   - 只声明 color-scheme: dark，不写任何背景色（深色画布由浏览器提供）
 *   - 深灰而不是纯黑的暗色主题
 */
import { parseColor, relativeLuminance } from './engine/color';

const MEDIA_TAGS = new Set(['img', 'video', 'canvas', 'picture', 'iframe', 'embed', 'object', 'svg']);
/** 背景亮度低于它算深色（约 #595959 以下） */
const DARK_LUM = 0.1;
const BRIGHT_LUM = 0.4;
const LIGHT_TEXT_LUM = 0.25;
/** 可见文字里浅色文字至少占这么多 */
const LIGHT_TEXT_SHARE = 0.5;

export interface PointSample {
  /** 这个点看到的背景亮度 */
  bg: number;
}

/** 页面实际采用的配色方案是否为深色。scheme 是 <html> 的 color-scheme 计算值，meta 是 <meta name="color-scheme"> 的内容 */
export function usesDarkScheme(scheme: string, meta: string, prefersDark: boolean): boolean {
  const pick = scheme && scheme.trim() !== 'normal' ? scheme : meta;
  const tokens = (pick || '').toLowerCase().split(/[\s,]+/);
  if (!tokens.includes('dark')) return false;
  if (!tokens.includes('light')) return true;
  return prefersDark;
}

/**
 * 纯判断逻辑（便于单测）。
 * @param canvasLum 画布（html/body 背景，都没有时是浏览器默认画布）的亮度
 * @param textLight 视口内可见文字里浅色文字的占比；没有可见文字时为 null
 * @param coversDocument 深色背景是否铺满整篇文档（而不只是首屏）
 */
export function judgeDark(samples: PointSample[], canvasLum: number, textLight: number | null, coversDocument: boolean): boolean {
  // 文字以浅色为主才像暗色主题；没有文字（纯图片 / 视频页）只看背景
  const textOk = textLight === null || textLight >= LIGHT_TEXT_SHARE;
  // 可采样的点太少（视口被图片/视频占满，或页面还是空的）：只能看画布，并且要有浅色文字佐证
  if (samples.length < 5) return canvasLum < DARK_LUM && textLight !== null && textOk;
  const n = samples.length;
  const dark = samples.filter((s) => s.bg < DARK_LUM).length;
  const bright = samples.filter((s) => s.bg > BRIGHT_LUM).length;
  if (dark / n < 0.8 || bright / n > 0.1) return false;
  // 画布是亮的、深色只盖住首屏：浅色网站的深色头图，往下滚还是白的
  if (canvasLum >= DARK_LUM && !coversDocument) return false;
  return textOk;
}

/** 区间并集的总长度 */
export function unionLength(intervals: Array<[number, number]>): number {
  const list = intervals.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let total = 0;
  let curA = -Infinity;
  let curB = -Infinity;
  for (const [a, b] of list) {
    if (a > curB) {
      if (curB > curA) total += curB - curA;
      curA = a;
      curB = b;
    } else if (b > curB) curB = b;
  }
  if (curB > curA) total += curB - curA;
  return total;
}

function lumOf(color: string, minAlpha: number): number | null {
  const c = parseColor(color);
  return c && c.a >= minAlpha ? relativeLuminance(c) : null;
}

/** 一次测量内共用的计算样式缓存 */
type StyleOf = (el: Element) => CSSStyleDeclaration;

/**
 * 是否在“小块固定定位浮层”里：Cookie 提示条、客服按钮、登录提醒这类浮在页面上的白色小卡片。
 * 它们不代表页面本身的配色，采样时跳过。
 */
function inSmallOverlay(el: Element, styleOf: StyleOf, viewArea: number): boolean {
  let cur: Element | null = el;
  for (let depth = 0; cur && depth < 10 && cur !== document.body && cur !== document.documentElement; depth++) {
    if (styleOf(cur).position === 'fixed') {
      const r = cur.getBoundingClientRect();
      return r.width * r.height < viewArea * 0.45;
    }
    cur = cur.parentElement;
  }
  return false;
}

const SKIP_TEXT_PARENTS = new Set(['script', 'style', 'noscript', 'template', 'textarea', 'option']);

/** 视口内可见文字里浅色文字的占比（文字颜色取自直接包含文字的元素，而不是采样点上的包裹层） */
function sampleTextLight(ignore: (el: Element) => boolean, styleOf: StyleOf, viewArea: number): number | null {
  const body = document.body;
  if (!body) return null;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  const seen = new Set<Element>();
  let light = 0;
  let total = 0;
  let visited = 0;
  for (let n = walker.nextNode(); n && visited < 4000 && total < 60; n = walker.nextNode()) {
    visited++;
    const el = n.parentElement;
    if (!el || seen.has(el) || SKIP_TEXT_PARENTS.has(el.localName)) continue;
    if (!(n as Text).data.trim()) continue;
    seen.add(el);
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.bottom <= 0 || r.top >= h || r.right <= 0 || r.left >= w) continue;
    if (ignore(el) || inSmallOverlay(el, styleOf, viewArea)) continue;
    const cs = styleOf(el);
    if (cs.visibility === 'hidden' || cs.opacity === '0') continue;
    const fg = lumOf(cs.color, 0.3);
    if (fg === null) continue;
    total++;
    if (fg > LIGHT_TEXT_LUM) light++;
  }
  return total >= 3 ? light / total : null;
}

/**
 * 深色背景是否铺满整篇文档：从 body 往下找横向铺满的块，按纵向区间统计深色块覆盖了多少文档高度。
 * 适用于 html/body 都透明、每个分区各自画深色背景的页面（官网、落地页常见）。
 */
function darkCoverage(docH: number, styleOf: StyleOf): number {
  const body = document.body;
  if (!body || docH <= 0) return 0;
  const vw = window.innerWidth;
  const sy = window.scrollY;
  const dark: Array<[number, number]> = [];
  let queue: Element[] = [body];
  let visited = 0;
  for (let depth = 0; depth < 6 && queue.length && visited < 500; depth++) {
    const next: Element[] = [];
    for (const parent of queue) {
      for (const el of Array.from(parent.children)) {
        if (++visited > 500) break;
        if (SKIP_TEXT_PARENTS.has(el.localName) || MEDIA_TAGS.has(el.localName)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < vw * 0.6 || r.height < 1) continue;
        const cs = styleOf(el);
        if (cs.position === 'fixed') continue;
        const bg = lumOf(cs.backgroundColor, 0.9);
        if (bg === null) next.push(el);
        else if (bg < DARK_LUM) dark.push([r.top + sy, r.bottom + sy]);
        // 浅色块：这段文档是亮的，不往下找
      }
    }
    queue = next;
  }
  return unionLength(dark) / docH;
}

let freeze: CSSStyleSheet | null = null;

/**
 * 量颜色期间关掉过渡：调用方刚撤掉我们的样式时，带 transition 的页面读到的还是过渡起点（我们的深色），会误判；
 * 网站自己切主题的过渡进行到一半时同理。
 */
function frozen<T>(fn: () => T): T {
  try {
    if (!freeze) {
      freeze = new CSSStyleSheet();
      freeze.replaceSync('*,*::before,*::after{transition:none!important}');
    }
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, freeze];
  } catch {
    /* 不支持就直接量 */
  }
  try {
    return fn();
  } finally {
    try {
      if (freeze && document.adoptedStyleSheets.includes(freeze)) {
        document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== freeze);
      }
    } catch {
      /* ignore */
    }
  }
}

/**
 * 页面当前是否已是深色。调用前必须已经撤掉我们自己的样式（<html data-drak-off> + 摘掉覆盖样式表）。
 */
export function pageLooksDark(ignore: (el: Element) => boolean): boolean {
  if (!document.body) return false;
  return frozen(() => {
    const html = document.documentElement;
    const hs = getComputedStyle(html);
    const bs = getComputedStyle(document.body);
    const meta = document.querySelector('meta[name="color-scheme" i]')?.getAttribute('content') || '';
    const darkScheme = usesDarkScheme(hs.colorScheme, meta, matchMedia('(prefers-color-scheme: dark)').matches);
    // 画布背景：html 的背景，没有就沿用 body 的，都没有就是浏览器默认画布
    const canvasLum = lumOf(hs.backgroundColor, 0.5) ?? lumOf(bs.backgroundColor, 0.5) ?? (darkScheme ? 0.007 : 1);
    const cache = new Map<Element, CSSStyleDeclaration>();
    const styleOf: StyleOf = (el) => {
      let cs = cache.get(el);
      if (!cs) {
        cs = getComputedStyle(el);
        cache.set(el, cs);
      }
      return cs;
    };

    const w = window.innerWidth;
    const h = window.innerHeight;
    const viewArea = w * h;
    const samples: PointSample[] = [];
    const darkEls = new Set<Element>();
    if (w >= 200 && h >= 150) {
      for (let i = 0; i < 5; i++) {
        for (let j = 0; j < 5; j++) {
          const stack = document.elementsFromPoint(((i + 0.5) / 5) * w, ((j + 0.5) / 5) * h);
          // 被图片/视频盖住的点不计入
          if (!stack.length || MEDIA_TAGS.has(stack[0].localName)) continue;
          const top = stack.find((e) => !MEDIA_TAGS.has(e.localName) && !e.closest('svg'));
          if (!top || ignore(top)) continue;
          // 从上往下找第一层基本不透明的背景；半透明遮罩（弹窗蒙层）跳过，看它下面的页面
          let bg: number | null = null;
          let overlay = false;
          for (const el of stack) {
            if (MEDIA_TAGS.has(el.localName)) continue;
            bg = lumOf(styleOf(el).backgroundColor, 0.9);
            if (bg !== null) {
              // 浮在页面上的小卡片（Cookie 提示等）不代表页面配色
              if (inSmallOverlay(el, styleOf, viewArea)) overlay = true;
              else if (bg < DARK_LUM && el !== html && el !== document.body) darkEls.add(el);
              break;
            }
          }
          if (overlay) continue;
          samples.push({ bg: bg ?? canvasLum });
        }
      }
    }
    let textLight = sampleTextLight(ignore, styleOf, viewArea);
    // 视口里没有可见文字：退回看 body 的文字色（没单独设时就是配色方案的默认文字色）
    if (textLight === null) {
      const bodyFg = lumOf(bs.color, 0.5);
      if (bodyFg !== null && samples.length < 5) textLight = bodyFg > LIGHT_TEXT_LUM ? 1 : 0;
    }
    // 深色背景是否铺满文档：页面不滚动，或者某个深色元素和文档一样高（包裹层），或者各分区的深色背景连起来铺满了文档
    const docH = Math.max(html.scrollHeight, document.body.scrollHeight);
    let covers = docH <= h * 1.2;
    if (!covers) {
      for (const el of darkEls) {
        if (el.getBoundingClientRect().height >= docH * 0.9) {
          covers = true;
          break;
        }
      }
    }
    if (!covers && canvasLum >= DARK_LUM) covers = darkCoverage(docH, styleOf) >= 0.85;
    return judgeDark(samples, canvasLum, textLight, covers);
  });
}

const THEME_WORD = /dark|night|light|theme|skin/i;
const THEME_ATTR = /theme|mode|scheme|color|dark|night|skin/i;

/** <html>/<body> 上的属性变化是否像是“网站切换了主题”，值得重新量一次 */
export function themeAttrChanged(name: string, oldValue: string | null, newValue: string | null): boolean {
  if (oldValue === newValue || name.startsWith('data-drak')) return false;
  if (name === 'class') {
    const a = new Set((oldValue || '').split(/\s+/).filter(Boolean));
    const b = new Set((newValue || '').split(/\s+/).filter(Boolean));
    for (const t of a) if (!b.has(t) && THEME_WORD.test(t)) return true;
    for (const t of b) if (!a.has(t) && THEME_WORD.test(t)) return true;
    return false;
  }
  if (name === 'style') {
    const pick = (v: string | null) => (v || '').match(/(?:color-scheme|background(?:-color)?)\s*:[^;]*/gi)?.join(';') || '';
    return pick(oldValue) !== pick(newValue);
  }
  return THEME_ATTR.test(name);
}
