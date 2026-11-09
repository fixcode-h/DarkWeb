/**
 * 图片分析（设计文档第 4 节）：照片不动，透明底深色图形反转，大面积白底图降亮度。
 * 只分析进入视口附近的图片；跨域图片交给后台拉取采样。
 */
import { classify, computeStats, type ImageClass } from '../shared/image-stats';
import type { AnalyzeResponse, InvertResponse } from '../shared/messages';
import type { BgImageHit } from './engine/rewriter';
import { isIgnored, type Ctx } from './context';
import type { RootSheets } from './sheets';

const ATTR = 'data-drak-img';
const MAX_BG_ANALYSIS = 60;

export class MediaAnalyzer {
  private cache = new Map<string, Promise<ImageClass>>();
  private io: IntersectionObserver;
  private tracked: WeakRef<Element>[] = [];
  private bgSeen = new Set<string>();
  private bgCount = 0;
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
    this.schedule(async () => {
      const cls = await this.classifyImg(url, img);
      if ((img.currentSrc || img.src) !== url) return;
      this.counts[cls]++;
      if (cls === 'keep') {
        if (img.hasAttribute(ATTR)) img.removeAttribute(ATTR);
      } else {
        img.setAttribute(ATTR, cls);
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

  private classifyImg(url: string, img: HTMLImageElement): Promise<ImageClass> {
    let p = this.cache.get(url);
    if (!p) {
      p = this.localClassify(img).then((local) => local ?? this.remoteClassify(url));
      this.cache.set(url, p);
    }
    return p;
  }

  /** 同源 / data: / blob: 图片直接在本地采样；跨域图片会污染 canvas，返回 null 交给后台 */
  private async localClassify(img: HTMLImageElement): Promise<ImageClass | null> {
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
      return classify(computeStats(data, w, h, nw, nh), this.ctx.settings.dimImages);
    } catch {
      return null;
    }
  }

  private async remoteClassify(url: string): Promise<ImageClass> {
    if (!/^https?:/i.test(url)) return 'keep';
    try {
      const res = (await chrome.runtime.sendMessage({ type: 'analyze-image', url, dimImages: this.ctx.settings.dimImages })) as AnalyzeResponse;
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
    const idle = (cb: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(cb, { timeout: 3000 }) : setTimeout(cb, 200));
    idle(() =>
      this.ctx.guard.run('bg-img', () => {
        let used = true;
        try {
          used = !!root.querySelector(hit.selector.replace(/::?(before|after|first-line|first-letter|placeholder|marker|selection|-webkit-[\w-]+)/g, ''));
        } catch {
          used = true;
        }
        if (!used || this.bgCount >= MAX_BG_ANALYSIS) return;
        this.bgCount++;
        this.schedule(async () => {
          let p = this.cache.get(hit.url);
          if (!p) {
            p = this.remoteClassify(hit.url);
            this.cache.set(hit.url, p);
          }
          const cls = await p;
          if (cls !== 'invert') return;
          const res = (await chrome.runtime.sendMessage({ type: 'invert-image', url: hit.url })) as InvertResponse;
          if (res?.ok && res.dataUrl) this.rootOf(root)?.addPatch(hit, res.dataUrl);
        });
      }),
    );
  }

  stop(): void {
    this.stopped = true;
    this.io.disconnect();
    for (const ref of this.tracked) ref.deref()?.removeAttribute(ATTR);
    this.tracked = [];
  }
}

/** 所有根共用的媒体样式：分类结果 -> 滤镜；站点规则的 invert 选择器 */
export function mediaCss(invertSelectors: string[]): string {
  let css =
    `[${ATTR}="invert"]{filter:invert(1) hue-rotate(180deg) !important}\n` +
    `[${ATTR}="dim"]{filter:brightness(.8) contrast(1.1) !important}\n`;
  for (const sel of invertSelectors) css += `${sel}{filter:invert(1) hue-rotate(180deg) !important}\n`;
  return css;
}
