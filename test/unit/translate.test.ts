import { describe, expect, it } from 'vitest';
import { LIMITS, chunk, parseGoogle, parseLlm } from '../../src/translate/engines';
import { engineLang, looksLikeTarget, sameLang, worthTranslating } from '../../src/translate/lang';
import { parseSites } from '../../src/translate/options';
import { DEFAULT_TRANSLATE, normalizeTranslate, siteKeyOf } from '../../src/translate/settings';

describe('翻译：语言判断', () => {
  it('已是目标语言的文字不再翻译', () => {
    expect(looksLikeTarget('这一段已经是中文，不需要翻译。', 'zh-CN')).toBe(true);
    expect(looksLikeTarget('Hello world', 'zh-CN')).toBe(false);
    expect(looksLikeTarget('使用 React 和 TypeScript 开发', 'zh-CN')).toBe(false);
    // 日文含大量汉字，但有假名，不能当成中文
    expect(looksLikeTarget('日本語の文章です', 'zh-CN')).toBe(false);
    expect(looksLikeTarget('日本語の文章です', 'ja')).toBe(true);
    expect(looksLikeTarget('한국어 문장입니다', 'ko')).toBe(true);
    // 拉丁字母语言之间分不出来，交给引擎
    expect(looksLikeTarget('Hello world', 'en')).toBe(false);
  });
  it('纯数字和符号不值得翻译', () => {
    expect(worthTranslating('2024-01-01 12:30')).toBe(false);
    expect(worthTranslating('→ ¥ 99.00')).toBe(false);
    expect(worthTranslating('OK')).toBe(true);
  });
  it('源语言与目标语言相同', () => {
    expect(sameLang('zh-Hans', 'zh-CN')).toBe(true);
    expect(sameLang('ZH', 'zh-TW')).toBe(true);
    expect(sameLang('en', 'zh-CN')).toBe(false);
    expect(sameLang(undefined, 'en')).toBe(false);
  });
  it('各引擎的语言代码', () => {
    expect(engineLang('google', 'zh-CN')).toBe('zh-CN');
    expect(engineLang('microsoft', 'zh-CN')).toBe('zh-Hans');
    expect(engineLang('microsoft', 'zh-TW')).toBe('zh-Hant');
    expect(engineLang('deepl', 'zh-CN')).toBe('ZH-HANS');
    expect(engineLang('deepl', 'en')).toBe('EN-US');
    expect(engineLang('deepl', 'ja')).toBe('JA');
    expect(engineLang('llm', 'zh-CN')).toBe('简体中文');
  });
});

describe('翻译：引擎', () => {
  it('按字符数和片段数切批，保持顺序', () => {
    const texts = ['a'.repeat(6), 'b'.repeat(6), 'c'.repeat(6), 'd'];
    expect(chunk(texts, { chars: 12, items: 10 })).toEqual([[texts[0], texts[1]], [texts[2], texts[3]]]);
    expect(chunk(texts, { chars: 100, items: 3 })).toEqual([texts.slice(0, 3), [texts[3]]]);
    // 单个超长片段独占一批，不丢
    expect(chunk(['x'.repeat(50), 'y'], { chars: 10, items: 10 })).toEqual([['x'.repeat(50)], ['y']]);
    expect(chunk([], LIMITS.google)).toEqual([]);
  });
  it('解析 Google 返回', () => {
    expect(parseGoogle([['你好', 'en'], ['世界', 'fr']], 2)).toEqual([{ text: '你好', src: 'en' }, { text: '世界', src: 'fr' }]);
    expect(parseGoogle(['你好', '世界'], 2)).toEqual([{ text: '你好' }, { text: '世界' }]);
    expect(parseGoogle([['你好', 'en']], 1)).toEqual([{ text: '你好', src: 'en' }]);
    expect(() => parseGoogle([['你好', 'en']], 2)).toThrow();
    expect(() => parseGoogle({ error: 1 }, 1)).toThrow();
  });
  it('解析大模型回复', () => {
    expect(parseLlm('["你好","世界"]', 2)).toEqual([{ text: '你好' }, { text: '世界' }]);
    expect(parseLlm('好的：\n```json\n["<a i=\\"0\\">你好</a>"]\n```', 1)).toEqual([{ text: '<a i="0">你好</a>' }]);
    expect(() => parseLlm('["只有一个"]', 2)).toThrow();
    expect(() => parseLlm('抱歉，我无法翻译', 1)).toThrow();
  });
});

describe('翻译：设置', () => {
  it('补全缺省并丢弃非法值', () => {
    expect(normalizeTranslate(undefined)).toEqual(DEFAULT_TRANSLATE);
    const s = normalizeTranslate({ engine: 'nope', mode: 'replace', autoSites: ['a.com', 1, ''], llm: { apiKey: 'k' } });
    expect(s.engine).toBe('google');
    expect(s.mode).toBe('replace');
    expect(s.autoSites).toEqual(['a.com']);
    expect(s.llm).toEqual({ ...DEFAULT_TRANSLATE.llm, apiKey: 'k' });
  });
  it('站点按 域名 或 IP:端口 识别', () => {
    expect(siteKeyOf('www.Example.com')).toBe('example.com');
    expect(siteKeyOf('192.168.1.10:8080')).toBe('192.168.1.10:8080');
    expect(parseSites('https://www.example.com/a/b?c=1\n192.168.1.10:8080/admin\n example.com \nlocalhost:3000')).toEqual([
      'example.com',
      '192.168.1.10:8080',
      'localhost:3000',
    ]);
  });
});
