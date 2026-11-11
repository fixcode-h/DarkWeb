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

export interface PointSample {
  /** 这个点看到的背景亮度 */
  bg: number;
  /** 这个点最上层元素的文字亮度 */
  fg: number | null;
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
 * @param bodyFg body 文字亮度
 * @param coversDocument 深色背景是否铺满整篇文档（而不只是首屏）
 */
export function judgeDark(samples: PointSample[], canvasLum: number, bodyFg: number | null, coversDocument: boolean): boolean {
  const lightBody = (bodyFg ?? 0) > LIGHT_TEXT_LUM;
  // 可采样的点太少（视口被图片/视频占满，或页面还是空的）：只能看画布
  if (samples.length < 5) return canvasLum < DARK_LUM && lightBody;
  const n = samples.length;
  const dark = samples.filter((s) => s.bg < DARK_LUM).length;
  const bright = samples.filter((s) => s.bg > BRIGHT_LUM).length;
  if (dark / n < 0.8 || bright / n > 0.1) return false;
  // 画布是亮的、深色只盖住首屏：浅色网站的深色头图，往下滚还是白的
  if (canvasLum >= DARK_LUM && !coversDocument) return false;
  const lightText = samples.filter((s) => s.fg !== null && s.fg > LIGHT_TEXT_LUM).length;
  return lightText / n >= 0.5 || lightBody;
}

function lumOf(color: string, minAlpha: number): number | null {
  const c = parseColor(color);
  return c && c.a >= minAlpha ? relativeLuminance(c) : null;
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
    // body 没单独设文字色时，继承到的就是配色方案的默认文字色，计算值里已经体现
    const bodyFg = lumOf(bs.color, 0.5);

    const w = window.innerWidth;
    const h = window.innerHeight;
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
          for (const el of stack) {
            if (MEDIA_TAGS.has(el.localName)) continue;
            bg = lumOf(getComputedStyle(el).backgroundColor, 0.9);
            if (bg !== null) {
              if (bg < DARK_LUM && el !== html && el !== document.body) darkEls.add(el);
              break;
            }
          }
          samples.push({ bg: bg ?? canvasLum, fg: lumOf(getComputedStyle(top).color, 0.5) });
        }
      }
    }
    // 深色背景是否铺满文档：页面不滚动，或者某个深色元素和文档一样高（包裹层），或者是固定定位的应用外壳
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
    return judgeDark(samples, canvasLum, bodyFg, covers);
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
