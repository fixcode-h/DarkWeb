/**
 * 判断一张图是不是“文字底图”：店铺头图、选中卡片的底图、横幅这类铺在文字后面的图。
 *
 * 文字已经按深色主题提亮了，底图如果还是浅色，文字就成了浅底浅字（链动小铺店铺页的头图和选中分类卡片）。
 * 普通图片按“图片内容”处理（照片不动、小图不动、带透明的不动），文字底图要按“背景”处理：
 * 只要整体偏浅就压暗，不看尺寸和透明度。判断只看几何关系：图铺满的区域里确实压着文字。
 */

/** 文字底图至少这么大，图标、小装饰图不算 */
const MIN_W = 48;
const MIN_H = 20;
/** 最多检查的文字节点数，长列表里不逐个量 */
const MAX_TEXT_NODES = 40;

type Box = { left: number; top: number; right: number; bottom: number };

function area(b: Box): number {
  return Math.max(0, b.right - b.left) * Math.max(0, b.bottom - b.top);
}

function bigEnough(b: Box): boolean {
  return b.right - b.left >= MIN_W && b.bottom - b.top >= MIN_H;
}

/** el 里有没有可见文字压在 box 里（文字矩形的中心落在 box 内） */
export function textOver(el: Element, box: Box, skip?: Element): boolean {
  const doc = el.ownerDocument;
  const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const range = doc.createRange();
  let n = 0;
  for (let t = walker.nextNode(); t && n < MAX_TEXT_NODES; t = walker.nextNode()) {
    if (!t.nodeValue || !t.nodeValue.trim()) continue;
    const parent = t.parentElement;
    if (!parent || (skip && skip.contains(parent))) continue;
    if (parent.closest('script,style,noscript,template')) continue;
    n++;
    range.selectNodeContents(t);
    const r = range.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const cx = (r.left + r.right) / 2;
    const cy = (r.top + r.bottom) / 2;
    if (cx >= box.left && cx <= box.right && cy >= box.top && cy <= box.bottom) return true;
  }
  return false;
}

/** 解析 background-size 的一个分量；返回像素，'auto' 返回 null */
function sizePart(v: string | undefined, full: number): number | null {
  if (!v || v === 'auto') return null;
  if (v.endsWith('%')) return (parseFloat(v) / 100) * full;
  if (v.endsWith('px')) return parseFloat(v);
  return null;
}

/**
 * 背景图实际铺开的区域占元素多少（0-1）。平铺视为铺满；`auto` 尺寸要用图的原始大小，
 * natural 为空时按铺满处理（宁可多判一次底图，也比浅底浅字强：分类时还会再看图是不是浅色）。
 */
export function bgCoverage(cs: CSSStyleDeclaration, w: number, h: number, natural?: { w: number; h: number } | null): number {
  if (!w || !h) return 0;
  // 平铺的方向按铺满算（repeat / space / round）；只在一个方向平铺的只算那一方向
  const rep = (cs.backgroundRepeat || 'repeat').split(',')[0].trim().split(/\s+/);
  let rx: boolean;
  let ry: boolean;
  if (rep.length === 2) {
    rx = rep[0] !== 'no-repeat';
    ry = rep[1] !== 'no-repeat';
  } else if (rep[0] === 'repeat-x' || rep[0] === 'repeat-y') {
    rx = rep[0] === 'repeat-x';
    ry = !rx;
  } else {
    rx = ry = rep[0] !== 'no-repeat';
  }
  const size = (cs.backgroundSize || 'auto').split(',')[0].trim();
  let iw: number;
  let ih: number;
  if (size === 'cover') return 1;
  if (size === 'contain') {
    if (!natural || !natural.w || !natural.h) return 1;
    const k = Math.min(w / natural.w, h / natural.h);
    iw = natural.w * k;
    ih = natural.h * k;
  } else {
    const [a, b] = size.split(/\s+/);
    const pw = sizePart(a, w);
    const ph = sizePart(b ?? 'auto', h);
    const ratio = natural && natural.w && natural.h ? natural.h / natural.w : null;
    if (pw !== null && ph !== null) {
      iw = pw;
      ih = ph;
    } else if (pw !== null) {
      iw = pw;
      ih = ratio ? pw * ratio : h;
    } else if (ph !== null) {
      ih = ph;
      iw = ratio ? ph / ratio : w;
    } else if (natural && natural.w && natural.h) {
      iw = natural.w;
      ih = natural.h;
    } else {
      return 1;
    }
  }
  const cw = rx ? w : Math.min(w, iw);
  const ch = ry ? h : Math.min(h, ih);
  return (cw * ch) / (w * h);
}

const PSEUDO = /::?(before|after)\b/i;

/** 选择器里用到的伪元素（只认 before / after，其余伪元素不会画背景图铺在文字后面） */
export function pseudoOf(selector: string): '::before' | '::after' | null {
  const m = PSEUDO.exec(selector);
  if (!m) return null;
  return m[1].toLowerCase() === 'before' ? '::before' : '::after';
}

/**
 * CSS 背景图（元素自己或它的 ::before / ::after）是不是文字底图：
 * 画背景的盒子够大、图铺开的部分占盒子一半以上、盒子里压着文字。
 */
export function isBgBackdrop(el: Element, pseudo: '::before' | '::after' | null, natural?: { w: number; h: number } | null): boolean {
  const host = el.getBoundingClientRect();
  let box: Box = host;
  const cs = getComputedStyle(el, pseudo);
  if (pseudo) {
    if (cs.content === 'none' || cs.display === 'none') return false;
    // 伪元素没有自己的矩形可量：取计算出的宽高，铺满宿主（inset:0、100%）时就是宿主的盒子
    const pw = parseFloat(cs.width);
    const ph = parseFloat(cs.height);
    const w = Number.isFinite(pw) ? Math.min(pw, host.width) : host.width;
    const h = Number.isFinite(ph) ? Math.min(ph, host.height) : host.height;
    if (w < host.width * 0.5 || h < host.height * 0.5) return false;
    box = { left: host.left, top: host.top, right: host.left + w, bottom: host.top + h };
  }
  if (!bigEnough(box)) return false;
  if (bgCoverage(cs, box.right - box.left, box.bottom - box.top, natural) < 0.5) return false;
  return textOver(el, box);
}

/**
 * <img> 当底图用：绝对定位或负层级、盖住所在容器一半以上，图的范围里压着容器里的文字。
 * 普通内容图（商品图、文章插图）和文字并排而不是叠在一起，不会命中。
 */
export function isImgBackdrop(img: HTMLImageElement): boolean {
  const cs = getComputedStyle(img);
  const layered = cs.position === 'absolute' || cs.position === 'fixed' || parseInt(cs.zIndex, 10) < 0;
  if (!layered) return false;
  const r = img.getBoundingClientRect();
  if (!bigEnough(r)) return false;
  const container = (img.offsetParent as Element | null) ?? img.parentElement;
  if (!container || container === img.ownerDocument.body || container === img.ownerDocument.documentElement) {
    // 铺满整页的底图：在 body 里找压在图上的文字
    return textOver(img.ownerDocument.body, r, img);
  }
  const c = container.getBoundingClientRect();
  const overlap: Box = {
    left: Math.max(r.left, c.left),
    top: Math.max(r.top, c.top),
    right: Math.min(r.right, c.right),
    bottom: Math.min(r.bottom, c.bottom),
  };
  if (area(overlap) < area(c) * 0.5) return false;
  return textOver(container, overlap, img);
}

/** 图片的原始尺寸（走浏览器缓存，页面已经加载过这张图时几乎不花时间）；跨域也能拿到尺寸 */
export function naturalSize(url: string, timeout = 3000): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const done = (v: { w: number; h: number } | null) => {
      clearTimeout(timer);
      img.onload = img.onerror = null;
      resolve(v);
    };
    const timer = setTimeout(() => done(null), timeout);
    img.onload = () => done(img.naturalWidth ? { w: img.naturalWidth, h: img.naturalHeight } : null);
    img.onerror = () => done(null);
    img.src = url;
  });
}
