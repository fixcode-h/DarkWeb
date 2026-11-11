/** 语言表与各引擎的语言代码映射、“已是目标语言”的快速判断 */
import type { EngineId } from './settings';

export const LANGS: Array<[code: string, name: string]> = [
  ['zh-CN', '简体中文'],
  ['zh-TW', '繁體中文'],
  ['en', 'English'],
  ['ja', '日本語'],
  ['ko', '한국어'],
  ['fr', 'Français'],
  ['de', 'Deutsch'],
  ['es', 'Español'],
  ['ru', 'Русский'],
  ['pt', 'Português'],
  ['it', 'Italiano'],
  ['ar', 'العربية'],
  ['vi', 'Tiếng Việt'],
  ['th', 'ไทย'],
  ['id', 'Bahasa Indonesia'],
  ['tr', 'Türkçe'],
];

export function langName(code: string): string {
  return LANGS.find((l) => l[0] === code)?.[1] ?? code;
}

const MS: Record<string, string> = { 'zh-CN': 'zh-Hans', 'zh-TW': 'zh-Hant' };
const DEEPL: Record<string, string> = { 'zh-CN': 'ZH-HANS', 'zh-TW': 'ZH-HANT', en: 'EN-US', pt: 'PT-BR' };

export function engineLang(engine: EngineId, code: string): string {
  if (engine === 'microsoft') return MS[code] ?? code;
  if (engine === 'deepl') return DEEPL[code] ?? code.toUpperCase();
  if (engine === 'llm') return langName(code);
  return code;
}

/** 把各引擎返回的源语言代码归一成基础语言：zh-Hans / ZH / zh-CN -> zh */
export function baseLang(code: string | undefined): string {
  return (code || '').toLowerCase().split(/[-_]/)[0];
}

/** 引擎识别的源语言与目标语言相同（不需要显示译文） */
export function sameLang(src: string | undefined, target: string): boolean {
  const s = baseLang(src);
  return !!s && s === baseLang(target);
}

const HAN = /\p{Script=Han}/gu;
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/gu;
const HANGUL = /\p{Script=Hangul}/gu;
const CYRILLIC = /\p{Script=Cyrillic}/gu;
const ARABIC = /\p{Script=Arabic}/gu;
const THAI = /\p{Script=Thai}/gu;
const LETTER = /\p{L}/gu;

const count = (s: string, re: RegExp): number => s.match(re)?.length ?? 0;

/**
 * 不发请求就能确定“这段文字已经是目标语言”的情况，只对文字系统独特的语言做判断；
 * 拉丁字母语言之间分不出来，交给引擎的语言识别。
 */
export function looksLikeTarget(text: string, target: string): boolean {
  const letters = count(text, LETTER);
  if (!letters) return true;
  const ratio = (re: RegExp) => count(text, re) / letters;
  switch (baseLang(target)) {
    case 'zh':
      // 含假名的是日文
      return ratio(HAN) > 0.6 && count(text, KANA) === 0;
    case 'ja':
      return count(text, KANA) > 0 && ratio(HAN) + ratio(KANA) > 0.6;
    case 'ko':
      return ratio(HANGUL) > 0.6;
    case 'ru':
      return ratio(CYRILLIC) > 0.6;
    case 'ar':
      return ratio(ARABIC) > 0.6;
    case 'th':
      return ratio(THAI) > 0.6;
    default:
      return false;
  }
}

/** 值得翻译：至少包含两个字母（纯数字、标点、单个符号不翻） */
export function worthTranslating(text: string): boolean {
  return count(text, LETTER) >= 2;
}
