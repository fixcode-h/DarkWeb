import { describe, expect, it } from 'vitest';
import { BUILTIN_RULES } from '../../src/shared/builtin-rules';
import { parseUserRules, resolveRule } from '../../src/shared/rules';

describe('native.cookie', () => {
  it('知乎内置规则带 themeApp cookie', () => {
    expect(resolveRule('zhuanlan.zhihu.com', BUILTIN_RULES).native?.cookie).toEqual(['themeApp', 'dark']);
  });

  it('接受合法的 cookie 规则', () => {
    const r = parseUserRules(JSON.stringify([{ match: ['a.com'], mode: 'native', native: { cookie: ['theme', 'dark'] } }]));
    expect(r.errors).toEqual([]);
    expect(r.rules[0].native?.cookie).toEqual(['theme', 'dark']);
  });

  it('拒绝能注入 cookie 属性的值', () => {
    const r = parseUserRules(JSON.stringify([{ match: ['a.com'], native: { cookie: ['theme', 'dark; domain=.com'] } }]));
    expect(r.rules).toEqual([]);
    expect(r.errors[0]).toMatch(/native\.cookie/);
  });
});
