import { describe, expect, it } from 'vitest';
import { escapeHtml, selectionTarget } from '../../src/enhance/text';
import { siteKeyOf } from '../../src/shared/settings';
import { DEFAULT_ENHANCE, enhanceActiveOn, filterStyle, fontCss, fontStack, normalizeEnhance, parseSiteLines } from '../../src/enhance/settings';

describe('阅读增强：设置', () => {
  it('空值和非法值回到默认', () => {
    expect(normalizeEnhance(undefined)).toEqual(DEFAULT_ENHANCE);
    const s = normalizeEnhance({ selection: { trigger: 'x' }, font: { family: 'comic', lineHeight: 9 }, filter: { mode: 'neon', strength: 500 } });
    expect(s.selection.trigger).toBe('icon');
    expect(s.font.family).toBe('');
    expect(s.font.lineHeight).toBe(0);
    expect(s.filter.mode).toBe('off');
    expect(s.filter.strength).toBe(80);
  });
  it('自定义字体名里不能混进样式表语法', () => {
    const s = normalizeEnhance({ font: { family: 'custom', custom: 'Inter; } body { display:none' } });
    expect(s.font.custom).not.toMatch(/[;{}:]/);
    expect(fontStack(normalizeEnhance({ font: { family: 'custom', custom: 'LXGW WenKai, "Inter"' } }).font)).toBe('"LXGW WenKai", "Inter", sans-serif');
  });
  it('不修改时不生成样式', () => {
    expect(fontCss(DEFAULT_ENHANCE.font)).toBe('');
    expect(filterStyle(DEFAULT_ENHANCE.filter)).toBe('');
  });
  it('字体样式排除代码和图标', () => {
    const css = fontCss({ family: 'serif', custom: '', lineHeight: 1.8, bolder: false });
    expect(css).toContain('pre *');
    expect(css).toContain('.material-icons');
    expect(css).toContain('line-height: 1.8 !important');
  });
  it('滤镜不挡点击', () => {
    for (const mode of ['warm', 'dim', 'gray'] as const) expect(filterStyle({ mode, strength: 30 })).toContain('pointer-events:none');
  });
  it('排除网站含子域名', () => {
    const s = normalizeEnhance({ disabledSites: ['example.com'] });
    expect(enhanceActiveOn(s, 'example.com')).toBe(false);
    expect(enhanceActiveOn(s, 'docs.example.com')).toBe(false);
    expect(enhanceActiveOn(s, 'notexample.com')).toBe(true);
    expect(parseSiteLines('https://www.Example.com/a\n192.168.1.10:8080\n\n', siteKeyOf)).toEqual(['example.com', '192.168.1.10:8080']);
  });
});

describe('划词翻译', () => {
  it('选中的已是目标语言时反向翻译', () => {
    expect(selectionTarget('Hello world', 'zh-CN')).toBe('zh-CN');
    expect(selectionTarget('这是一段中文', 'zh-CN')).toBe('en');
  });
  it('纯文字转义成 HTML 片段', () => {
    expect(escapeHtml('a < b & c')).toBe('a &lt; b &amp; c');
  });
});

import { safeSelector, siteRulesCss } from '../../src/enhance/settings';
import { looksStable } from '../../src/enhance/selector';
describe('屏蔽规则与自定义 CSS', () => {
  it('选择器不能跳出规则', () => {
    expect(safeSelector('div.ad')).toBe('div.ad');
    expect(safeSelector('body { } * { display:none')).toBe('');
    expect(safeSelector('a; @import url(x)')).toBe('');
    expect(safeSelector('/* x */ div')).toBe('');
  });
  it('规则按站点和上级域名套用，坏规则丢弃', () => {
    const s = normalizeEnhance({
      hideRules: { 'example.com': ['#ad', 'x{}'], 'other.com': ['#o'] },
      siteCss: { 'news.example.com': 'p{color:red}</style><script>' },
    });
    const css = siteRulesCss(s, 'news.example.com');
    expect(css).toContain('#ad { display: none !important; }');
    expect(css).not.toContain('x{}');
    expect(css).not.toContain('#o');
    expect(css).not.toMatch(/<\/style/i);
    expect(siteRulesCss(s, 'example.org')).toBe('');
  });
  it('阅读偏好取最近的档位', () => {
    expect(normalizeEnhance({ reader: { fontSize: 18.4, width: 9999, font: 'x', theme: 'sepia' } }).reader).toEqual({ fontSize: 18, width: 960, font: 'sans', theme: 'sepia' });
  });
  it('哈希类名不当作稳定选择器', () => {
    expect(looksStable('ad-banner')).toBe(true);
    expect(looksStable('sidebar')).toBe(true);
    expect(looksStable('css-1x2y3z')).toBe(false);
    expect(looksStable('_3kF9aQ')).toBe(false);
    expect(looksStable('a1b2c3d4')).toBe(false);
    expect(looksStable('123')).toBe(false);
  });
});
