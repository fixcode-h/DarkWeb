import { describe, expect, it } from 'vitest';
import { accelerable, activeNode, DEFAULT_ACCEL, normalizeAccel, normalizeNodeUrl, proxify } from '../../src/ghaccel/settings';

const NODE = 'https://v6.gh-proxy.org/';

describe('GitHub 加速：链接改写', () => {
  it('源码包、Release 附件、Raw、clone 地址都能加速', () => {
    expect(proxify('/cli/cli/archive/refs/heads/trunk.zip', NODE)).toBe('https://v6.gh-proxy.org/https://github.com/cli/cli/archive/refs/heads/trunk.zip');
    expect(proxify('https://github.com/o/r/archive/refs/tags/v1.0.tar.gz', NODE)).toBe(`${NODE}https://github.com/o/r/archive/refs/tags/v1.0.tar.gz`);
    expect(proxify('/o/r/releases/download/v2.4.0/app-mac.dmg', NODE)).toBe(`${NODE}https://github.com/o/r/releases/download/v2.4.0/app-mac.dmg`);
    expect(proxify('/o/r/raw/refs/heads/main/a/b.txt', NODE)).toBe(`${NODE}https://github.com/o/r/raw/refs/heads/main/a/b.txt`);
    expect(proxify('https://raw.githubusercontent.com/o/r/main/x.sh', NODE)).toBe(`${NODE}https://raw.githubusercontent.com/o/r/main/x.sh`);
    expect(proxify('https://github.com/o/my.repo.git', NODE)).toBe(`${NODE}https://github.com/o/my.repo.git`);
  });

  it('普通页面链接、其他网站、带查询参数的链接不加速', () => {
    expect(accelerable('/o/r')).toBeNull();
    expect(accelerable('/o/r/releases')).toBeNull();
    expect(accelerable('/o/r/releases/tag/v1')).toBeNull();
    expect(accelerable('/o/r/archive/refs/heads/main')).toBeNull();
    expect(accelerable('https://example.com/o/r/archive/x.zip')).toBeNull();
    expect(accelerable('https://raw.githubusercontent.com/o/r/main/x?token=ABC')).toBeNull();
    expect(accelerable('http://github.com/o/r/releases/download/v1/a.zip')).toBeNull();
    expect(accelerable('javascript:alert(1)')).toBeNull();
  });

  it('去掉锚点', () => {
    expect(accelerable('/o/r/releases/download/v1/a.zip#x')).toBe('https://github.com/o/r/releases/download/v1/a.zip');
  });
});

describe('GitHub 加速：设置', () => {
  it('默认开启，节点 v6.gh-proxy.org，添加按钮', () => {
    const s = normalizeAccel(undefined);
    expect(s).toEqual(DEFAULT_ACCEL);
    expect(activeNode(s)).toBe(NODE);
    expect(s.mode).toBe('add');
  });

  it('自定义节点规范成 https 并补斜杠，不合法的回到默认', () => {
    expect(normalizeNodeUrl('my.proxy.dev')).toBe('https://my.proxy.dev/');
    expect(normalizeNodeUrl('https://a.b/gh')).toBe('https://a.b/gh/');
    expect(normalizeNodeUrl('http://a.b/')).toBe('');
    expect(normalizeNodeUrl('https://u:p@a.b/')).toBe('');
    expect(normalizeNodeUrl('https://a.b/?x=1')).toBe('');
    const s = normalizeAccel({ node: 'custom', custom: 'a.b' });
    expect(activeNode(s)).toBe('https://a.b/');
    expect(normalizeAccel({ node: 'custom', custom: 'http://x' }).node).toBe(NODE);
    expect(normalizeAccel({ node: 'https://evil.example/' }).node).toBe(NODE);
  });
});
