import type { ColorTransformer } from './engine/transform';
import type { SheetRewriter, BgImageHit } from './engine/rewriter';
import type { EffectiveRule } from '../shared/rules';
import type { Settings } from '../shared/settings';
import type { Guard } from './guard';

/** 内容脚本各模块共享的运行时上下文 */
export interface Ctx {
  settings: Settings;
  rule: EffectiveRule;
  tx: ColorTransformer;
  rewriter: SheetRewriter;
  guard: Guard;
  /** 站点规则 ignore 合并后的选择器，空串表示没有 */
  ignoreSelector: string;
  /** 站点规则 keepImage 合并后的选择器 */
  keepSelector: string;
  fetchCss(url: string): Promise<string | null>;
  /** 已经拉取完成的跨域样式表文本（未完成返回 undefined） */
  peekCss(url: string): string | null | undefined;
  onBgImage(hit: BgImageHit, root: Document | ShadowRoot): void;
  /** 我们自己创建的样式表，扫描时要排除 */
  own: WeakSet<CSSStyleSheet>;
}

/** 元素是否落在 ignore 区域里（跨 Shadow DOM 边界向上找） */
export function isIgnored(el: Element, sel: string): boolean {
  if (!sel) return false;
  let cur: Element | null = el;
  while (cur) {
    try {
      if (cur.closest(sel)) return true;
    } catch {
      return false;
    }
    const root = cur.getRootNode();
    cur = root instanceof ShadowRoot ? root.host : null;
  }
  return false;
}
