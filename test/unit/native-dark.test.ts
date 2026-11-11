import { describe, expect, it } from 'vitest';
import { judgeDark, themeAttrChanged, usesDarkScheme, type PointSample } from '../../src/content/native-dark';

const pts = (n: number, bg: number, fg: number | null): PointSample[] => Array.from({ length: n }, () => ({ bg, fg }));

describe('usesDarkScheme', () => {
  it('只声明 dark', () => {
    expect(usesDarkScheme('dark', '', false)).toBe(true);
    expect(usesDarkScheme('normal', 'only dark', false)).toBe(true);
  });
  it('light dark 跟随系统', () => {
    expect(usesDarkScheme('light dark', '', true)).toBe(true);
    expect(usesDarkScheme('normal', 'light dark', false)).toBe(false);
  });
  it('没有声明或只有 light', () => {
    expect(usesDarkScheme('normal', '', true)).toBe(false);
    expect(usesDarkScheme('light', 'dark', true)).toBe(false);
  });
});

describe('judgeDark', () => {
  it('深色背景 + 浅色文字', () => {
    expect(judgeDark(pts(25, 0.01, 0.8), 0.01, 0.8, true)).toBe(true);
  });
  it('深灰主题（#36393f 一类）也算', () => {
    expect(judgeDark(pts(25, 0.04, 0.7), 0.04, 0.7, true)).toBe(true);
  });
  it('body 透明、深色画在包裹层上（画布是白的，但深色铺满文档）', () => {
    expect(judgeDark(pts(25, 0.01, 0.8), 1, 0, true)).toBe(true);
  });
  it('浅色网站的深色头图只盖住首屏：不算', () => {
    expect(judgeDark(pts(25, 0.01, 0.9), 1, 0, false)).toBe(false);
  });
  it('普通浅色页面', () => {
    expect(judgeDark(pts(25, 1, 0.02), 1, 0.02, true)).toBe(false);
  });
  it('还有一成以上的亮块（顶栏、卡片仍是白的）：不算', () => {
    expect(judgeDark([...pts(21, 0.01, 0.8), ...pts(4, 1, 0)], 0.01, 0.8, true)).toBe(false);
  });
  it('深底深字（不是暗色主题，只是黑色区块）：不算', () => {
    expect(judgeDark(pts(25, 0.01, 0.02), 0.01, 0.02, true)).toBe(false);
  });
  it('采样点太少时看画布和 body 文字', () => {
    expect(judgeDark(pts(2, 1, 0), 0.007, 1, true)).toBe(true);
    expect(judgeDark([], 1, 0, true)).toBe(false);
  });
});

describe('themeAttrChanged', () => {
  it('class 里主题相关的词变化', () => {
    expect(themeAttrChanged('class', 'app', 'app dark')).toBe(true);
    expect(themeAttrChanged('class', 'theme-light x', 'x theme-dark')).toBe(true);
    expect(themeAttrChanged('class', 'app', 'app modal-open')).toBe(false);
    expect(themeAttrChanged('class', 'a dark', 'dark a')).toBe(false);
  });
  it('data-theme 之类的属性', () => {
    expect(themeAttrChanged('data-theme', 'light', 'dark')).toBe(true);
    expect(themeAttrChanged('data-bs-theme', null, 'dark')).toBe(true);
    expect(themeAttrChanged('data-color-mode', 'auto', 'auto')).toBe(false);
    expect(themeAttrChanged('lang', 'zh', 'en')).toBe(false);
  });
  it('插件自己的属性不算', () => {
    expect(themeAttrChanged('data-drak-mode', null, 'dynamic')).toBe(false);
  });
  it('style 只看配色相关的声明', () => {
    expect(themeAttrChanged('style', '', 'overflow: hidden; padding-right: 15px')).toBe(false);
    expect(themeAttrChanged('style', 'color-scheme: light', 'color-scheme: dark')).toBe(true);
    expect(themeAttrChanged('style', null, 'background-color: #111')).toBe(true);
  });
});
