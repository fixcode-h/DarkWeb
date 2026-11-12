/**
 * Guard：异常隔离、耗时预算、效果自检（设计文档第 8 节）。
 */
import { parseColor, relativeLuminance } from './engine/color';

export type TripReason = 'errors' | 'slow';

const MEDIA_TAGS = new Set(['img', 'video', 'canvas', 'picture', 'iframe', 'embed', 'object', 'svg']);

export class Guard {
  private errorTimes: number[] = [];
  errorCount = 0;
  lastErrors: string[] = [];
  timings: Record<string, number> = {};
  tripped: TripReason | null = null;
  /** 首次完整应用阶段的主线程累计耗时 */
  startupMs = 0;
  private startupOpen = true;
  /** 嵌套调用深度：只统计最外层，避免同一段耗时被重复累加（曾因此把普通页面误判为超慢页面） */
  private depth = 0;

  constructor(private onTrip: (reason: TripReason) => void) {}

  run<T>(name: string, fn: () => T): T | undefined {
    if (this.tripped === 'errors') return undefined;
    const t0 = performance.now();
    this.depth++;
    try {
      return fn();
    } catch (e) {
      this.error(e, name);
      return undefined;
    } finally {
      this.depth--;
      const dt = performance.now() - t0;
      this.timings[name] = (this.timings[name] || 0) + dt;
      if (this.startupOpen && this.depth === 0) {
        this.startupMs += dt;
        // 首次应用预算 80ms，超过 3 倍判定为超慢页面
        if (this.startupMs > 240 && !this.tripped) this.trip('slow');
      }
    }
  }

  endStartup(): void {
    this.startupOpen = false;
  }

  error(e: unknown, where: string): void {
    this.errorCount++;
    const msg = `${where}: ${e instanceof Error ? e.message : String(e)}`;
    this.lastErrors.push(msg);
    if (this.lastErrors.length > 20) this.lastErrors.shift();
    const now = Date.now();
    this.errorTimes.push(now);
    this.errorTimes = this.errorTimes.filter((t) => now - t < 60_000);
    if (this.errorTimes.length >= 20 && this.tripped !== 'errors') this.trip('errors');
  }

  private trip(reason: TripReason): void {
    this.tripped = reason;
    try {
      this.onTrip(reason);
    } catch {
      /* ignore */
    }
  }
}

export interface BrightSample {
  ratio: number;
  elements: Element[];
}

function effectiveBg(el: Element): { lum: number; el: Element } | null {
  let cur: Element | null = el;
  let depth = 0;
  while (cur && depth < 25) {
    const bg = getComputedStyle(cur).backgroundColor;
    const c = parseColor(bg);
    if (c && c.a > 0.5) return { lum: relativeLuminance(c), el: cur };
    const parent: Element | null = cur.parentElement;
    if (parent) cur = parent;
    else {
      const r = cur.getRootNode();
      cur = r instanceof ShadowRoot ? r.host : null;
    }
    depth++;
  }
  return null;
}

/**
 * 效果自检：在视口里取 5x5 网格点，找最上层的非媒体元素，读它的有效背景色。
 * 只读 25 个元素，开销很小。
 */
export function sampleBrightness(ignore: (el: Element) => boolean): BrightSample {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (!w || !h) return { ratio: 0, elements: [] };
  let bright = 0;
  let total = 0;
  const elements: Element[] = [];
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      const x = ((i + 0.5) / 5) * w;
      const y = ((j + 0.5) / 5) * h;
      const stack = document.elementsFromPoint(x, y);
      const top = stack.find((e) => !MEDIA_TAGS.has(e.localName) && !e.closest('svg'));
      if (!top || ignore(top)) continue;
      // 被图片/视频覆盖的点不计入
      if (stack[0] && MEDIA_TAGS.has(stack[0].localName)) continue;
      total++;
      const bg = effectiveBg(top);
      // 一路找不到背景就落到画布背景：用 html 的背景
      const lum = bg ? bg.lum : (() => {
        // 画布背景：html 没设背景时按 CSS 规则沿用 body 的背景
        let c = parseColor(getComputedStyle(document.documentElement).backgroundColor);
        if ((!c || c.a <= 0.5) && document.body) c = parseColor(getComputedStyle(document.body).backgroundColor);
        return c && c.a > 0.5 ? relativeLuminance(c) : 1;
      })();
      if (lum > 0.4) {
        bright++;
        if (bg && !elements.includes(bg.el)) elements.push(bg.el);
      }
    }
  }
  return { ratio: total ? bright / total : 0, elements };
}
