import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, excludePatternsFor, normalizeSettings, siteKeyOf, siteModeFor, type Settings } from '../../src/shared/settings';

const withModes = (siteModes: Record<string, unknown>): Settings => normalizeSettings({ ...DEFAULT_SETTINGS, siteModes });

describe('siteKeyOf', () => {
  it('只保留域名，去掉协议、路径、查询串和 www.', () => {
    expect(siteKeyOf('https://www.zhihu.com/question/123?x=1#a')).toBe('zhihu.com');
    expect(siteKeyOf('HTTP://Example.COM/')).toBe('example.com');
    expect(siteKeyOf('zhuanlan.zhihu.com')).toBe('zhuanlan.zhihu.com');
  });

  it('IP 和 localhost 保留非默认端口', () => {
    expect(siteKeyOf('http://192.168.1.10:8080/admin/index.html')).toBe('192.168.1.10:8080');
    expect(siteKeyOf('localhost:3000')).toBe('localhost:3000');
    expect(siteKeyOf('http://[::1]:5173/')).toBe('[::1]:5173');
  });

  it('默认端口不写', () => {
    expect(siteKeyOf('http://192.168.1.10:80/')).toBe('192.168.1.10');
    expect(siteKeyOf('https://example.com:443/a')).toBe('example.com');
  });

  it('无法识别的输入返回空串', () => {
    expect(siteKeyOf('')).toBe('');
    expect(siteKeyOf('chrome://extensions')).toBe('');
    expect(siteKeyOf('file:///tmp/a.html')).toBe('');
  });
});

describe('siteModeFor', () => {
  it('同一站点的任何页面都命中', () => {
    const s = withModes({ 'zhihu.com': 'off' });
    expect(siteModeFor(s, 'https://www.zhihu.com/question/1')).toBe('off');
    expect(siteModeFor(s, 'zhuanlan.zhihu.com')).toBe('off');
    expect(siteModeFor(s, 'notzhihu.com')).toBe('auto');
  });

  it('端口不同算不同站点', () => {
    const s = withModes({ '192.168.1.10:8080': 'off' });
    expect(siteModeFor(s, '192.168.1.10:8080')).toBe('off');
    expect(siteModeFor(s, 'http://192.168.1.10:8080/a/b?c=1')).toBe('off');
    expect(siteModeFor(s, '192.168.1.10:9090')).toBe('auto');
    expect(siteModeFor(s, '192.168.1.10')).toBe('auto');
  });

  it('localhost 这类单段主机名可以关闭（旧版永远匹配不到）', () => {
    const s = withModes({ 'localhost:3000': 'off', intranet: 'filter' });
    expect(siteModeFor(s, 'http://localhost:3000/app')).toBe('off');
    expect(siteModeFor(s, 'http://localhost:5173/')).toBe('auto');
    expect(siteModeFor(s, 'http://intranet/wiki')).toBe('filter');
  });

  it('IP 不按“上级域名”回退', () => {
    const s = withModes({ '1.10': 'off', '168.1.10': 'off' });
    expect(siteModeFor(s, '192.168.1.10')).toBe('auto');
  });

  it('子域名回退时端口保持不变', () => {
    const s = withModes({ 'example.com:8443': 'off' });
    expect(siteModeFor(s, 'https://a.example.com:8443/x')).toBe('off');
    expect(siteModeFor(s, 'https://a.example.com/x')).toBe('auto');
  });
});

describe('旧数据迁移', () => {
  it('整条网址、带 www. 的主机名统一成站点键', () => {
    const s = withModes({
      'https://www.example.com/some/page?id=1': 'off',
      'www.zhihu.com': 'dynamic',
      'http://10.0.0.2:8080/admin': 'filter',
    });
    expect(s.siteModes).toEqual({ 'example.com': 'off', 'zhihu.com': 'dynamic', '10.0.0.2:8080': 'filter' });
  });

  it('归并到同一个键时“关闭”优先，非法项丢弃', () => {
    const s = withModes({ 'www.a.com': 'dynamic', 'a.com': 'off', 'b.com': 'bogus', 'chrome://x': 'off', 'c.com': 1 });
    expect(s.siteModes).toEqual({ 'a.com': 'off' });
  });
});

describe('excludePatternsFor', () => {
  it('域名：默认端口，含子域名', () => {
    expect(excludePatternsFor('zhihu.com')).toEqual([
      'http://zhihu.com:80/*',
      'https://zhihu.com:443/*',
      'http://*.zhihu.com:80/*',
      'https://*.zhihu.com:443/*',
    ]);
  });

  it('IP:端口：只排除这个端口', () => {
    expect(excludePatternsFor('192.168.1.10:8080')).toEqual(['http://192.168.1.10:8080/*', 'https://192.168.1.10:8080/*']);
  });

  it('不合法的键不生成规则', () => {
    expect(excludePatternsFor('a b')).toEqual([]);
    expect(excludePatternsFor('*')).toEqual([]);
  });
});
