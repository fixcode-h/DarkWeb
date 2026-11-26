import { describe, expect, it } from 'vitest';
import { classify, type ImageStats } from '../../src/shared/image-stats';
import { bgCoverage, pseudoOf } from '../../src/content/backdrop';

const stats = (p: Partial<ImageStats>): ImageStats => ({ transparent: 0, lightness: 0.95, spread: 0.03, colorfulness: 0.05, width: 150, height: 50, ...p });
const cs = (p: Record<string, string>) => ({ backgroundRepeat: 'no-repeat', backgroundSize: 'auto', ...p }) as unknown as CSSStyleDeclaration;

describe('文字底图分类', () => {
  it('小的浅色底图：普通图片不动，文字底图压暗', () => {
    expect(classify(stats({}), true)).toBe('keep');
    expect(classify(stats({}), true, true)).toBe('dim');
  });
  it('底部渐隐的半透明头图也压暗', () => {
    expect(classify(stats({ transparent: 0.4, width: 800, height: 240 }), true)).toBe('keep');
    expect(classify(stats({ transparent: 0.4, width: 800, height: 240 }), true, true)).toBe('dim');
  });
  it('关掉“白底图降亮度”也照样压暗文字底图', () => {
    expect(classify(stats({}), false, true)).toBe('dim');
  });
  it('深色照片、对比强烈的照片不压暗', () => {
    expect(classify(stats({ lightness: 0.45, spread: 0.2 }), true, true)).toBe('keep');
    expect(classify(stats({ lightness: 0.78, spread: 0.35 }), true, true)).toBe('keep');
  });
  it('透明底深色图标仍然反转', () => {
    expect(classify(stats({ transparent: 0.6, lightness: 0.1 }), true, true)).toBe('invert');
  });
});

describe('背景图铺开的范围', () => {
  it('cover、平铺、百分比铺满', () => {
    expect(bgCoverage(cs({ backgroundSize: 'cover' }), 300, 100)).toBe(1);
    expect(bgCoverage(cs({ backgroundRepeat: 'repeat' }), 300, 100, { w: 10, h: 10 })).toBe(1);
    expect(bgCoverage(cs({ backgroundSize: '100% 100%' }), 300, 100, { w: 10, h: 10 })).toBe(1);
  });
  it('不平铺的小图标只占一小块', () => {
    expect(bgCoverage(cs({ backgroundSize: '20px' }), 300, 100, { w: 16, h: 16 })).toBeLessThan(0.05);
    expect(bgCoverage(cs({}), 300, 100, { w: 16, h: 16 })).toBeLessThan(0.05);
  });
  it('宽度铺满、高度按比例的头图', () => {
    expect(bgCoverage(cs({ backgroundSize: '100% auto' }), 800, 160, { w: 800, h: 240 })).toBe(1);
    expect(bgCoverage(cs({ backgroundRepeat: 'repeat-x' }), 800, 400, { w: 10, h: 100 })).toBeCloseTo(0.25);
  });
  it('只认 ::before / ::after', () => {
    expect(pseudoOf('.a::before')).toBe('::before');
    expect(pseudoOf('.a:after')).toBe('::after');
    expect(pseudoOf('.a:hover')).toBeNull();
  });
});
