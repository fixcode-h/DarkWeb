/** 网页翻译的设置：单独的存储键，与暗色模式设置互不影响 */
export type EngineId = 'google' | 'microsoft' | 'deepl' | 'llm';
export type DisplayMode = 'bilingual' | 'replace';
export type BilingualStyle = 'plain' | 'dim' | 'underline' | 'highlight';

export interface LlmConfig {
  /** OpenAI 兼容接口地址，例如 https://api.openai.com/v1 */
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface TranslateSettings {
  engine: EngineId;
  /** 目标语言（BCP-47，见 lang.ts 的 LANGS） */
  target: string;
  mode: DisplayMode;
  style: BilingualStyle;
  /** 所选引擎失败时自动改用另一个免费引擎（Google <-> 微软） */
  fallback: boolean;
  /** 打开即自动翻译的站点（域名或 IP:端口，不含 www.） */
  autoSites: string[];
  deeplKey: string;
  llm: LlmConfig;
}

export const TRANSLATE_KEY = 'translate';

export const DEFAULT_TRANSLATE: TranslateSettings = {
  engine: 'google',
  target: 'zh-CN',
  mode: 'bilingual',
  style: 'dim',
  fallback: true,
  autoSites: [],
  deeplKey: '',
  llm: { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini' },
};

export const ENGINE_NAMES: Record<EngineId, string> = {
  google: 'Google 翻译',
  microsoft: '微软翻译',
  deepl: 'DeepL',
  llm: 'AI 大模型',
};

const pick = <T extends string>(v: unknown, allowed: readonly T[], dflt: T): T =>
  allowed.includes(v as T) ? (v as T) : dflt;
const str = (v: unknown, dflt: string): string => (typeof v === 'string' ? v : dflt);

export function normalizeTranslate(raw: unknown): TranslateSettings {
  const r = (typeof raw === 'object' && raw ? raw : {}) as Partial<TranslateSettings>;
  const d = DEFAULT_TRANSLATE;
  const llm = (typeof r.llm === 'object' && r.llm ? r.llm : {}) as Partial<LlmConfig>;
  return {
    engine: pick(r.engine, ['google', 'microsoft', 'deepl', 'llm'] as const, d.engine),
    target: str(r.target, d.target) || d.target,
    mode: pick(r.mode, ['bilingual', 'replace'] as const, d.mode),
    style: pick(r.style, ['plain', 'dim', 'underline', 'highlight'] as const, d.style),
    fallback: typeof r.fallback === 'boolean' ? r.fallback : d.fallback,
    autoSites: Array.isArray(r.autoSites) ? r.autoSites.filter((x): x is string => typeof x === 'string' && !!x) : [],
    deeplKey: str(r.deeplKey, ''),
    llm: {
      baseUrl: str(llm.baseUrl, d.llm.baseUrl).trim() || d.llm.baseUrl,
      apiKey: str(llm.apiKey, ''),
      model: str(llm.model, d.llm.model).trim() || d.llm.model,
    },
  };
}

export async function loadTranslate(): Promise<TranslateSettings> {
  const data = await chrome.storage.local.get(TRANSLATE_KEY);
  return normalizeTranslate(data[TRANSLATE_KEY]);
}

export async function saveTranslate(s: TranslateSettings): Promise<void> {
  await chrome.storage.local.set({ [TRANSLATE_KEY]: s });
}

/** 站点标识与“本站关闭”一致：域名[:端口] 或 IP[:端口]，去掉 www. 和默认端口 */
export { siteKeyOf } from '../shared/settings';

// ---- 消息 ----
export interface TranslateRequest {
  type: 'tr:translate';
  texts: string[];
  to: string;
  engine: EngineId;
}
export interface TranslatedItem {
  text: string;
  /** 引擎识别出的源语言（没有就为空） */
  src?: string;
}
export interface TranslateResponse {
  ok: boolean;
  items?: TranslatedItem[];
  /** 首选引擎失败、自动换用备用引擎时，首选引擎的错误信息 */
  note?: string;
  /** 实际使用的引擎（可能是自动切换后的） */
  engine?: EngineId;
  error?: string;
}
export interface PageStatus {
  active: boolean;
  total: number;
  done: number;
  engine: EngineId | null;
  error: string;
}
export type PageCommand = { type: 'tr:start' } | { type: 'tr:stop' } | { type: 'tr:toggle' } | { type: 'tr:status' };
