/**
 * 图片分析（设计文档第 4 节）：照片不动，透明底深色图形反转，大面积白底图降亮度。
 * 只分析进入视口附近的图片；跨域图片交给后台拉取采样。
 */
import { classify, computeStats, type ImageClass } from '../shared/image-stats';
import type { AnalyzeResponse, InvertResponse } from '../shared/messages';
import type { BgImageHit } from './engine/rewriter';
import { isIgnored, type Ctx } from './context';
import { isBgBackdrop, isImgBackdrop, naturalSize, pseudoOf } from './backdrop';
import type { RootSheets } from './sheets';

const ATTR = 'data-drak-img';
const MAX_BG_ANALYSIS = 60;
const JPEG = /\.jpe?g(?:$|[?#@!_])/i;

/**
 * 页面加载完成（load 之后再等一次空闲）。跨域图片要由后台重新下载一份来采样，
 * 放在页面自己加载期间做会和页面抢带宽，图片多的网站因此明显变慢。
 */
let afterLoad: Promise<void> | null = null;
function pageLoaded(): Promise<void> {
  if (!afterLoad) {
    afterLoad = new Promise<void>((resolve) => {
      const idle = () => ('requestIdleCallback' in window ? requestIdleCallback(() => resolve(), { timeout: 2000 }) : setTimeout(resolve, 300));
      if (document.readyState === 'complete') idle();
      else window.addEventListener('load', idle, { once: true });
    });
  }
  return afterLoad;
}

/**
 * 不用下载就能断定保持原样的图片：JPEG 没有透明通道，不可能是“透明底深色图形”；
 * 关掉“白底图降亮度”或者图片太小时也不会被压暗。
 */
export function obviouslyKeep(url: string, naturalW: number, naturalH: number, dimImages: boolean): boolean {
  if (!JPEG.test(url)) return false;
  return !dimImages || naturalW * naturalH < 200 * 200;
}

export class MediaAnalyzer {
  private cache = new Map<string, Promise<ImageClass>>();
  private io: IntersectionObserver;
  private tracked: WeakRef<Element>[] = [];
  private bgSeen = new Set<string>();
  /**
   * 样式表里有、但页面上还没有元素用到的背景图规则。单页应用（Vue / React）先加载样式表、
   * 接口返回后才渲染出店铺头图这类元素，以前第一次没用到就再也不看，头图一直是浅色。
   * DOM 有新增时再查一遍。
   */
  private pendingBg: { hit: BgImageHit; root: Document | ShadowRoot }[] = [];
  private pendingTimer = 0;
  private bgCount = 0;
  private inlineSeen = new WeakSet<Element>();
  private active = 0;
  private queue: (() => void)[] = [];
  counts = { keep: 0, invert: 0, dim: 0 };
  stopped = false;

  constructor(private ctx: Ctx, private rootOf: (root: Document | ShadowRoot) => RootSheets | undefined) {
    this.io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          this.io.unobserve(e.target);
          this.ctx.guard.run('img', () => this.handle(e.target as HTMLImageElement));
        }
      },
      { rootMargin: '100% 0px' },
    );
  }

  observe(img: HTMLImageElement): void {
    if (this.stopped) return;
    if (isIgnored(img, this.ctx.ignoreSelector)) return;
    if (this.ctx.keepSelector) {
      try {
        if (img.closest(this.ctx.keepSelector) || img.matches(this.ctx.keepSelector)) return;
      } catch {
        /* 选择器无效 */
      }
    }
    this.io.observe(img);
  }

  private handle(img: HTMLImageElement): void {
    if (!img.complete || img.naturalWidth === 0) {
      img.addEventListener('load', () => this.ctx.guard.run('img', () => this.handle(img)), { once: true });
      return;
    }
    const url = img.currentSrc || img.src;
    if (!url) return;
    const backdrop = isImgBackdrop(img);
    this.schedule(async () => {
      const cls = await this.classifyImg(url, img, backdrop);
      if ((img.currentSrc || img.src) !== url) return;
      this.counts[cls]++;
      if (cls === 'keep') {
        if (img.hasAttribute(ATTR)) img.removeAttribute(ATTR);
      } else {
        // 文字底图压得比普通白底图更暗：普通白底图（截图）要看得清内容，底图要让上面的文字看得清
        img.setAttribute(ATTR, backdrop && cls === 'dim' ? 'backdrop' : cls);
        this.tracked.push(new WeakRef(img));
      }
    });
  }

  /** 并发上限 4 */
  private schedule(task: () => Promise<void>): void {
    const run = () => {
      this.active++;
      task()
        .catch((e) => this.ctx.guard.error(e, 'img'))
        .finally(() => {
          this.active--;
          const next = this.queue.shift();
          if (next) next();
        });
    };
    if (this.active < 4) run();
    else this.queue.push(run);
  }

  private classifyImg(url: string, img: HTMLImageElement, backdrop: boolean): Promise<ImageClass> {
    const key = (backdrop ? 'b|' : '') + url;
    let p = this.cache.get(key);
    if (!p) {
      p = this.localClassify(img, backdrop).then((local) => {
        if (local) return local;
        if (!backdrop && obviouslyKeep(url, img.naturalWidth, img.naturalHeight, this.ctx.settings.dimImages)) return 'keep';
        return this.remoteClassify(url, backdrop);
      });
      this.cache.set(key, p);
    }
    return p;
  }

  /** CSS 背景图分类（按是否文字底图分开缓存） */
  private classifyBg(url: string, backdrop: boolean): Promise<ImageClass> {
    const key = (backdrop ? 'b|' : '') + url;
    let p = this.cache.get(key);
    if (!p) {
      p = this.remoteClassify(url, backdrop);
      this.cache.set(key, p);
    }
    return p;
  }

  /** 同源 / data: / blob: 图片直接在本地采样；跨域图片会污染 canvas，返回 null 交给后台 */
  private async localClassify(img: HTMLImageElement, backdrop: boolean): Promise<ImageClass | null> {
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    if (!nw || !nh) return 'keep';
    const scale = Math.min(1, 64 / Math.max(nw, nh));
    const w = Math.max(1, Math.round(nw * scale));
    const h = Math.max(1, Math.round(nh * scale));
    try {
      const canvas = new OffscreenCanvas(w, h);
      const g = canvas.getContext('2d', { willReadFrequently: true });
      if (!g) return null;
      g.drawImage(img, 0, 0, w, h);
      const data = g.getImageData(0, 0, w, h).data;
      return classify(computeStats(data, w, h, nw, nh), this.ctx.settings.dimImages, backdrop);
    } catch {
      return null;
    }
  }

  /** 不经后台直接采样：data: / blob: / 同源图片可以；跨域图片画上画布后读不出像素，返回 null */
  private async classifyUrlLocal(url: string, backdrop: boolean): Promise<ImageClass | null> {
    let same = false;
    try {
      const u = new URL(url, location.href);
      same = u.protocol === 'data:' || u.protocol === 'blob:' || u.origin === location.origin;
    } catch {
      return null;
    }
    if (!same || /^data:image\/svg|\.svg(\?|#|$)/i.test(url)) return null;
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch {
      return null;
    }
    return this.localClassify(img, backdrop);
  }

  private async remoteClassify(url: string, backdrop = false): Promise<ImageClass> {
    // data: / 同源图片在本地就能采样（打包进样式表的小底图多半是 data: URL，以前一律当作不处理）
    const local = await this.classifyUrlLocal(url, backdrop);
    if (local) return local;
    if (!/^https?:/i.test(url)) return 'keep';
    await pageLoaded();
    if (this.stopped) return 'keep';
    try {
      const res = (await chrome.runtime.sendMessage({ type: 'analyze-image', url, dimImages: this.ctx.settings.dimImages, backdrop })) as AnalyzeResponse;
      return res?.ok && res.cls ? res.cls : 'keep';
    } catch {
      return 'keep';
    }
  }

  /** CSS 背景图：只处理当前页面真的用到的选择器，反转类生成反转后的 data URL 打补丁 */
  onBgImage(hit: BgImageHit, root: Document | ShadowRoot): void {
    if (this.stopped || this.bgCount >= MAX_BG_ANALYSIS) return;
    const key = hit.selector + '|' + hit.url;
    if (this.bgSeen.has(key)) return;
    this.bgSeen.add(key);
    // 推迟到空闲时，避免拖慢首屏
    idle(() => this.ctx.guard.run('bg-img', () => this.checkBg(hit, root)));
  }

  /** 选择器在页面上有没有命中元素；没命中的先挂起，等 DOM 有新增再查 */
  private checkBg(hit: BgImageHit, root: Document | ShadowRoot): void {
    if (this.stopped || this.bgCount >= MAX_BG_ANALYSIS) return;
    const pseudo = pseudoOf(hit.selector);
    let els: Element[] = [];
    let valid = true;
    try {
      const sel = hit.selector.replace(/::?(before|after|first-line|first-letter|placeholder|marker|selection|-webkit-[\w-]+)/g, '');
      els = Array.from(root.querySelectorAll(sel)).slice(0, 8);
    } catch {
      valid = false;
    }
    if (valid && !els.length) {
      if (this.pendingBg.length < 500) this.pendingBg.push({ hit, root });
      return;
    }
    this.bgCount++;
    this.schedule(async () => {
      // 文字底图要先拿到图的原始尺寸，判断 background-size: auto 时图铺开了多大
      let backdrop = false;
      if (els.length) {
        const natural = await naturalSize(hit.url);
        backdrop = els.some((el) => el.isConnected && isBgBackdrop(el, pseudo, natural));
      }
      const cls = await this.classifyBg(hit.url, backdrop);
      if (this.stopped) return;
      if (cls === 'dim') {
        // 大面积浅色背景图（如 B 站动态页底图）、文字底图：叠一层半透明黑压暗，不动图本身
        this.rootOf(root)?.addPatch(hit, dimmedBg(hit.url));
        return;
      }
      if (cls !== 'invert') return;
      const res = (await chrome.runtime.sendMessage({ type: 'invert-image', url: hit.url })) as InvertResponse;
      if (res?.ok && res.dataUrl) this.rootOf(root)?.addPatch(hit, `url("${res.dataUrl}")`);
    });
  }

  /** DOM 有新增元素：过一会儿把挂起的背景图规则再查一遍（合并成一次，不在每批变更里都查） */
  domChanged(): void {
    if (this.stopped || !this.pendingBg.length || this.pendingTimer) return;
    this.pendingTimer = window.setTimeout(() => {
      this.pendingTimer = 0;
      const list = this.pendingBg;
      this.pendingBg = [];
      idle(() =>
        this.ctx.guard.run('bg-img', () => {
          for (const { hit, root } of list) this.checkBg(hit, root);
        }),
      );
    }, 400);
  }

  /** 内联背景图：分类后通过 apply 写回 background-image */
  onInlineBg(el: HTMLElement, url: string, apply: (image: string) => void): void {
    if (this.stopped || this.bgCount >= MAX_BG_ANALYSIS || this.inlineSeen.has(el)) return;
    this.inlineSeen.add(el);
    this.bgCount++;
    this.schedule(async () => {
      // 等一个空闲再量几何：内联样式往往在元素插进页面的同一批变更里处理，这时文字可能还没排版
      await new Promise<void>((r) => idle(r));
      const backdrop = el.isConnected && isBgBackdrop(el, null, await naturalSize(url));
      const cls = await this.classifyBg(url, backdrop);
      if (this.stopped || !el.isConnected) return;
      if (cls === 'dim') {
        apply(dimmedBg(url));
      } else if (cls === 'invert') {
        const res = (await chrome.runtime.sendMessage({ type: 'invert-image', url })) as InvertResponse;
        if (!this.stopped && res?.ok && res.dataUrl) apply(`url("${res.dataUrl}")`);
      }
    });
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.pendingTimer);
    this.pendingBg = [];
    this.io.disconnect();
    for (const ref of this.tracked) ref.deref()?.removeAttribute(ATTR);
    this.tracked = [];
  }
}

function idle(cb: () => void): void {
  if ('requestIdleCallback' in window) requestIdleCallback(cb, { timeout: 3000 });
  else setTimeout(cb, 200);
}

/** 大面积浅色背景图：叠一层半透明黑压暗，不动图本身 */
function dimmedBg(url: string): string {
  const safe = url.replace(/["\\\n]/g, encodeURIComponent);
  return `linear-gradient(rgba(0,0,0,.78),rgba(0,0,0,.78)),url("${safe}")`;
}

/** 所有根共用的媒体样式：分类结果 -> 滤镜；站点规则的 invert 选择器；图片整体亮度 */
export function mediaCss(invertSelectors: string[], imageBrightness = 100): string {
  const b = Math.min(100, Math.max(30, imageBrightness)) / 100;
  let css =
    `[${ATTR}="invert"]{filter:invert(1) hue-rotate(180deg) !important}\n` +
    `[${ATTR}="dim"]{filter:brightness(${round2(0.8 * b)}) contrast(1.1) !important}\n` +
    // 文字底图：压到和深色背景同一档，上面提亮后的文字才读得清
    `[${ATTR}="backdrop"]{filter:brightness(${round2(0.22 * b)}) !important}\n`;
  // 不加 !important、用 :where 压低优先级：页面自己给图片设的滤镜优先
  if (b < 1) css += `:where(img:not([${ATTR}])){filter:brightness(${round2(b)})}\n`;
  for (const sel of invertSelectors) css += `${sel}{filter:invert(1) hue-rotate(180deg) !important}\n`;
  return css;
}

function round2(v: number): string {
  return String(Math.round(v * 100) / 100);
}
