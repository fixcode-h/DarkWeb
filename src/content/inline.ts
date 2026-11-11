/**
 * 内联样式与 SVG 颜色属性（style=""、fill=""、bgcolor="" 等）。
 * 原值记在 WeakMap 里，关闭时逐个还原。
 */
import { isIgnored, type Ctx } from './context';

type Orig = Map<string, [string, string]>;

const SVG_ATTRS = ['fill', 'stroke', 'stop-color'] as const;

export class InlineStyler {
  private originals = new WeakMap<Element, Orig>();
  private touched: WeakRef<Element>[] = [];
  private lastAttr = new WeakMap<Element, string | null>();
  /** 我们写进去的值，用来识别“页面改过”还是“还是我们的值”，避免重复转换 */
  private written = new WeakMap<Element, Map<string, string>>();
  private churn = new WeakMap<Element, { n: number; t: number }>();
  private iconCache = new WeakMap<SVGSVGElement, boolean>();
  count = 0;
  /** 内联 style 里的单张背景图（如 B 站动态页底图 <div class="bg" style="background-image:url(...)">） */
  onBgUrl: ((el: HTMLElement, url: string) => void) | null = null;

  constructor(private ctx: Ctx) {}

  /** 处理一个元素（不含子孙） */
  process(el: Element): void {
    if (!(el instanceof HTMLElement || el instanceof SVGElement)) return;
    if (el.hasAttribute('data-drak')) return;
    const styleAttr = el.getAttribute('style');
    const svg = el instanceof SVGElement;
    const hasLegacy = !svg && (el.hasAttribute('bgcolor') || (el.localName === 'font' && el.hasAttribute('color')));
    const hasSvgAttr = svg && SVG_ATTRS.some((a) => el.hasAttribute(a));
    if (!styleAttr && !hasLegacy && !hasSvgAttr) return;
    if (this.lastAttr.has(el) && this.lastAttr.get(el) === styleAttr) return; // 我们自己写的
    if (isIgnored(el, this.ctx.ignoreSelector)) return;
    if (this.isChurning(el)) return;

    const style = (el as HTMLElement).style;
    let orig = this.originals.get(el);
    let written = this.written.get(el);
    const record = (prop: string) => {
      if (!orig) {
        orig = new Map();
        this.originals.set(el, orig);
        this.touched.push(new WeakRef(el));
      }
      // 每次都以页面当前写入的值为准
      orig.set(prop, [style.getPropertyValue(prop), style.getPropertyPriority(prop)]);
    };
    const write = (prop: string, value: string, priority = '') => {
      style.setProperty(prop, value, priority);
      if (!written) {
        written = new Map();
        this.written.set(el, written);
      }
      written.set(prop, style.getPropertyValue(prop));
    };
    const isOurs = (prop: string) => written !== undefined && written.get(prop) === style.getPropertyValue(prop);

    if (styleAttr) {
      const onBg = this.onBgUrl && el instanceof HTMLElement ? (url: string) => this.onBgUrl!(el, url) : undefined;
      const decls = this.ctx.rewriter.collect(style, { base: el.baseURI }, onBg);
      for (const d of decls) {
        if (d.value === d.original || isOurs(d.prop)) continue;
        record(d.prop);
        write(d.prop, d.value, d.important ? 'important' : '');
      }
    }
    if (hasSvgAttr) {
      const role = this.isIcon(el as SVGElement) ? 'fg' : 'bg';
      for (const a of SVG_ATTRS) {
        const v = el.getAttribute(a);
        if (!v || (style.getPropertyValue(a) && !isOurs(a))) continue;
        const t = this.ctx.tx.transform(v, a === 'stop-color' ? 'bg' : role);
        if (t) {
          if (!isOurs(a)) record(a);
          write(a, t);
        }
      }
    }
    if (hasLegacy) {
      const bg = el.getAttribute('bgcolor');
      if (bg && (!style.backgroundColor || isOurs('background-color'))) {
        const t = this.ctx.tx.transform(bg, 'bg');
        if (t) {
          if (!isOurs('background-color')) record('background-color');
          write('background-color', t);
        }
      }
      const fc = el.localName === 'font' ? el.getAttribute('color') : null;
      if (fc && (!style.color || isOurs('color'))) {
        const t = this.ctx.tx.transform(fc, 'fg');
        if (t) {
          if (!isOurs('color')) record('color');
          write('color', t);
        }
      }
    }
    this.lastAttr.set(el, el.getAttribute('style'));
    this.count++;
  }

  /** 元素当前的 style 属性是否就是我们上次写入的结果（用来区分页面自己的改动） */
  wroteLast(el: Element): boolean {
    return this.lastAttr.has(el) && this.lastAttr.get(el) === el.getAttribute('style');
  }

  /** 自检发现的亮区：强制改背景 */
  force(el: Element, prop: string, value: string): void {
    if (!(el instanceof HTMLElement)) return;
    const style = el.style;
    let orig = this.originals.get(el);
    if (!orig) {
      orig = new Map();
      this.originals.set(el, orig);
      this.touched.push(new WeakRef(el));
    }
    if (!orig.has(prop)) orig.set(prop, [style.getPropertyValue(prop), style.getPropertyPriority(prop)]);
    style.setProperty(prop, value, 'important');
    let written = this.written.get(el);
    if (!written) {
      written = new Map();
      this.written.set(el, written);
    }
    written.set(prop, style.getPropertyValue(prop));
    this.lastAttr.set(el, el.getAttribute('style'));
  }

  /** 同一元素 1 秒内被来回改写超过 5 次：判定为动画或抢写，放弃 */
  private isChurning(el: Element): boolean {
    const now = performance.now();
    const c = this.churn.get(el);
    if (!c || now - c.t > 1000) {
      this.churn.set(el, { n: 1, t: now });
      return false;
    }
    c.n++;
    return c.n > 5;
  }

  private isIcon(el: SVGElement): boolean {
    const owner = el instanceof SVGSVGElement ? el : el.ownerSVGElement;
    if (!owner) return true;
    const hit = this.iconCache.get(owner);
    if (hit !== undefined) return hit;
    const w = parseFloat(owner.getAttribute('width') || '');
    const h = parseFloat(owner.getAttribute('height') || '');
    let icon: boolean;
    if (!isNaN(w) && !isNaN(h) && !/%/.test((owner.getAttribute('width') || '') + (owner.getAttribute('height') || ''))) {
      icon = Math.max(w, h) <= 48;
    } else {
      const r = owner.getBoundingClientRect();
      icon = r.width === 0 || Math.max(r.width, r.height) <= 48;
    }
    this.iconCache.set(owner, icon);
    return icon;
  }

  restore(): void {
    for (const ref of this.touched) {
      const el = ref.deref() as HTMLElement | undefined;
      if (!el) continue;
      const orig = this.originals.get(el);
      if (!orig) continue;
      for (const [prop, [v, p]] of orig) {
        if (v) el.style.setProperty(prop, v, p);
        else el.style.removeProperty(prop);
      }
      if (el.getAttribute('style') === '') el.removeAttribute('style');
      this.originals.delete(el);
      this.lastAttr.delete(el);
      this.written.delete(el);
    }
    this.touched = [];
  }
}
