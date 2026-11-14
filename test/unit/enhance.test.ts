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
