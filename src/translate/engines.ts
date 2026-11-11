/** 翻译引擎：统一接口为“一组 HTML 片段 -> 同样数量的译文”，只在后台 Service Worker 里调用 */
import { engineLang } from './lang';
import type { EngineId, TranslateSettings, TranslatedItem } from './settings';

const TIMEOUT = 20000;

interface Limits {
  /** 单次请求的字符数上限 */
  chars: number;
  /** 单次请求的片段数上限 */
  items: number;
}

export const LIMITS: Record<EngineId, Limits> = {
  google: { chars: 4500, items: 60 },
  microsoft: { chars: 9000, items: 100 },
  deepl: { chars: 20000, items: 50 },
  llm: { chars: 3000, items: 30 },
};

/** 按引擎的限制把片段切成多批，保持顺序；单个超长片段独占一批 */
export function chunk(texts: string[], limit: Limits): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  let size = 0;
  for (const t of texts) {
    if (cur.length && (size + t.length > limit.chars || cur.length >= limit.items)) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(t);
    size += t.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

async function request(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, credentials: 'omit' });
    if (!res.ok) {
      const body = (await res.text().catch(() => '')).slice(0, 200);
      throw new Error(`HTTP ${res.status}${body ? ` ${body}` : ''}`);
    }
    return res;
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw new Error('请求超时');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ---- Google ----

/** 解析 translate_a/t 的返回：sl=auto 时每项是 [译文, 源语言]，否则是字符串 */
export function parseGoogle(data: unknown, n: number): TranslatedItem[] {
  let arr = data as unknown[];
  if (!Array.isArray(arr)) throw new Error('Google 返回格式异常');
  // 只有一个片段时，部分版本直接返回 [译文, 源语言]
  if (n === 1 && arr.length === 2 && typeof arr[0] === 'string' && typeof arr[1] === 'string') arr = [arr];
  if (arr.length !== n) throw new Error('Google 返回数量不一致');
  return arr.map((it) => {
    if (typeof it === 'string') return { text: it };
    if (Array.isArray(it) && typeof it[0] === 'string') return { text: it[0], src: typeof it[1] === 'string' ? it[1] : undefined };
    throw new Error('Google 返回格式异常');
  });
}

async function google(texts: string[], to: string): Promise<TranslatedItem[]> {
  const body = new URLSearchParams();
  for (const t of texts) body.append('q', t);
  const url = `https://translate.googleapis.com/translate_a/t?client=gtx&sl=auto&tl=${encodeURIComponent(to)}&format=html`;
  const res = await request(url, { method: 'POST', body });
  return parseGoogle(await res.json(), texts.length);
}

// ---- 微软（Edge 内置翻译同款接口，免密钥） ----

let msToken: { value: string; expires: number } | null = null;

async function microsoftToken(): Promise<string> {
  if (msToken && msToken.expires > Date.now()) return msToken.value;
  const res = await request('https://edge.microsoft.com/translate/auth', { method: 'GET' });
  const value = (await res.text()).trim();
  // 令牌有效期 10 分钟，留出余量
  msToken = { value, expires: Date.now() + 8 * 60 * 1000 };
  return value;
}

async function microsoft(texts: string[], to: string): Promise<TranslatedItem[]> {
  const call = async () =>
    request(`https://api-edge.cognitive.microsofttranslator.com/translate?api-version=3.0&textType=html&to=${encodeURIComponent(to)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await microsoftToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(texts.map((Text) => ({ Text }))),
    });
  let res: Response;
  try {
    res = await call();
  } catch (e) {
    // 令牌过期：换一个再试一次
    if (!/HTTP 40[13]/.test(String(e))) throw e;
    msToken = null;
    res = await call();
  }
  const data = (await res.json()) as Array<{ translations?: Array<{ text: string }>; detectedLanguage?: { language: string } }>;
  if (!Array.isArray(data) || data.length !== texts.length) throw new Error('微软翻译返回数量不一致');
  return data.map((d) => ({ text: d.translations?.[0]?.text ?? '', src: d.detectedLanguage?.language }));
}

// ---- DeepL（需要用户自己的 API 密钥） ----

async function deepl(texts: string[], to: string, key: string): Promise<TranslatedItem[]> {
  if (!key) throw new Error('未填写 DeepL API 密钥');
  const host = key.trim().endsWith(':fx') ? 'api-free.deepl.com' : 'api.deepl.com';
  const res = await request(`https://${host}/v2/translate`, {
    method: 'POST',
    headers: { Authorization: `DeepL-Auth-Key ${key.trim()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: texts, target_lang: to, tag_handling: 'html' }),
  });
  const data = (await res.json()) as { translations?: Array<{ text: string; detected_source_language?: string }> };
  const tr = data.translations;
  if (!Array.isArray(tr) || tr.length !== texts.length) throw new Error('DeepL 返回数量不一致');
  return tr.map((t) => ({ text: t.text, src: t.detected_source_language }));
}

// ---- AI 大模型（OpenAI 兼容的 chat/completions） ----

export function llmPrompt(target: string): string {
  return [
    `You are a professional translator. Translate every item of the JSON array the user sends into ${target}.`,
    'Rules:',
    '- Reply with a JSON array of strings only, the same length and order as the input. No explanations, no code fences.',
    '- Items are HTML fragments. Keep every tag and its attributes exactly (for example <a i="1">…</a>); translate only the text, and move a tag together with the words it wraps.',
    '- Copy any element marked translate="no" unchanged, including its content.',
    '- Translate naturally and fluently, as a native speaker would write it. Keep proper nouns, code, and product names when they are normally left untranslated.',
    `- If an item is already in ${target}, return it unchanged.`,
  ].join('\n');
}

/** 从模型回复里取出 JSON 数组（容忍代码块包裹和前后说明文字） */
export function parseLlm(content: string, n: number): TranslatedItem[] {
  const start = content.indexOf('[');
  const end = content.lastIndexOf(']');
  if (start < 0 || end <= start) throw new Error('模型返回的不是 JSON 数组');
  let arr: unknown;
  try {
    arr = JSON.parse(content.slice(start, end + 1));
  } catch {
    throw new Error('模型返回的 JSON 无法解析');
  }
  if (!Array.isArray(arr) || arr.length !== n || arr.some((x) => typeof x !== 'string')) throw new Error('模型返回数量不一致');
  return (arr as string[]).map((text) => ({ text }));
}

async function llm(texts: string[], to: string, cfg: TranslateSettings['llm']): Promise<TranslatedItem[]> {
  if (!cfg.apiKey) throw new Error('未填写 AI 大模型的 API 密钥');
  const res = await request(`${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey.trim()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: llmPrompt(to) },
        { role: 'user', content: JSON.stringify(texts) },
      ],
    }),
  });
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return parseLlm(data.choices?.[0]?.message?.content ?? '', texts.length);
}

/** 用指定引擎翻译一批（调用方负责切批） */
export function translateBatch(engine: EngineId, texts: string[], target: string, s: TranslateSettings): Promise<TranslatedItem[]> {
  const to = engineLang(engine, target);
  switch (engine) {
    case 'google':
      return google(texts, to);
    case 'microsoft':
      return microsoft(texts, to);
    case 'deepl':
      return deepl(texts, to, s.deeplKey);
    case 'llm':
      return llm(texts, to, s.llm);
  }
}
