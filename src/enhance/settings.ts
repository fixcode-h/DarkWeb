/**
 * 阅读增强的设置：划词翻译、字体与排版、护眼滤镜。
 * 单独的存储键，与暗色模式、网页翻译的设置互不影响。
 */
export type SelectionTrigger = 'icon' | 'auto';
export type FontFamily = '' | 'sans' | 'serif' | 'kai' | 'custom';
export type FilterMode = 'off' | 'warm' | 'dim' | 'gray';

export interface EnhanceSettings {
  selection: {
    enabled: boolean;
    /** icon：选中后先出现小图标，点了再翻译；auto：松开鼠标立即翻译 */
    trigger: SelectionTrigger;
  };
  font: {
    family: FontFamily;
    /** family 为 custom 时使用的字体名，逗号分隔 */
    custom: string;
    /** 段落行高，0 为不改 */
    lineHeight: number;
    /** 文字稍微加粗（细字体在暗色背景下更清楚） */
    bolder: boolean;
  };
  filter: {
    mode: FilterMode;
    /** 强度 5-80（百分比） */
    strength: number;
  };
  /** 这些站点上不启用阅读增强（站点键：域名[:端口]） */
  disabledSites: string[];
  /** 阅读模式的排版偏好 */
  reader: ReaderPrefs;
  /** 按站点隐藏的元素（CSS 选择器），由“屏蔽页面元素”点选生成，也可在设置页编辑 */
  hideRules: Record<string, string[]>;
  /** 按站点追加的自定义 CSS */
  siteCss: Record<string, string>;
  /** 输入框翻译：在输入框里连按三次空格，把已输入的内容译成 target */
  input: { enabled: boolean; target: string };
  /** 视频双语字幕（YouTube）：在原字幕下方显示译文，译成翻译设置里的目标语言 */
  subtitles: { enabled: boolean };
}

export type ReaderTheme = 'auto' | 'dark' | 'light' | 'sepia';
export interface ReaderPrefs {
  /** 正文字号 px */
  fontSize: number;
  /** 栏宽 px */
  width: number;
  font: 'sans' | 'serif';
  theme: ReaderTheme;
}

export const ENHANCE_KEY = 'enhance';

export const DEFAULT_ENHANCE: EnhanceSettings = {
  selection: { enabled: true, trigger: 'icon' },
  font: { family: '', custom: '', lineHeight: 0, bolder: false },
  filter: { mode: 'off', strength: 30 },
  disabledSites: [],
  reader: { fontSize: 18, width: 720, font: 'sans', theme: 'auto' },
  hideRules: {},
  siteCss: {},
  input: { enabled: true, target: 'en' },
  subtitles: { enabled: false },
};

export const READER_FONT_SIZES = [14, 16, 18, 20, 22, 24, 28] as const;
export const READER_WIDTHS = [560, 640, 720, 840, 960] as const;
const MAX_CSS = 20000;
const MAX_RULES = 200;

export const LINE_HEIGHTS = [0, 1.6, 1.8, 2] as const;

export const FONT_STACKS: Record<Exclude<FontFamily, '' | 'custom'>, string> = {
  sans: '"PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", system-ui, sans-serif',
  serif: '"Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", "SimSun", Georgia, serif',
  kai: '"LXGW WenKai", "Kaiti SC", "STKaiti", "KaiTi", serif',
};

const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v ? (v as Record<string, unknown>) : {});
const pick = <T extends string>(v: unknown, allowed: readonly T[], dflt: T): T => (allowed.includes(v as T) ? (v as T) : dflt);
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);

export function normalizeEnhance(raw: unknown): EnhanceSettings {
  const r = obj(raw);
  const sel = obj(r.selection);
  const font = obj(r.font);
  const filter = obj(r.filter);
  const d = DEFAULT_ENHANCE;
  const lh = Number(font.lineHeight);
  const strength = Number(filter.strength);
  return {
    selection: {
      enabled: bool(sel.enabled, d.selection.enabled),
      trigger: pick(sel.trigger, ['icon', 'auto'] as const, d.selection.trigger),
    },
    font: {
      family: pick(font.family, ['', 'sans', 'serif', 'kai', 'custom'] as const, d.font.family),
      // 只留字体名里正常会出现的字符，避免拼进样式表时跳出 font-family 声明
      custom: typeof font.custom === 'string' ? font.custom.replace(/[^\p{L}\p{N} ,"'_-]/gu, '').slice(0, 200) : '',
      lineHeight: (LINE_HEIGHTS as readonly number[]).includes(lh) ? lh : 0,
      bolder: bool(font.bolder, d.font.bolder),
    },
    filter: {
      mode: pick(filter.mode, ['off', 'warm', 'dim', 'gray'] as const, d.filter.mode),
      strength: isFinite(strength) ? Math.round(Math.min(80, Math.max(5, strength))) : d.filter.strength,
    },
    disabledSites: Array.isArray(r.disabledSites)
      ? [...new Set(r.disabledSites.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim().toLowerCase()))]
      : [],
    reader: normalizeReader(r.reader),
    hideRules: normalizeHideRules(r.hideRules),
    siteCss: normalizeSiteCss(r.siteCss),
    input: {
      enabled: bool(obj(r.input).enabled, d.input.enabled),
      target: typeof obj(r.input).target === 'string' && /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(obj(r.input).target as string) ? (obj(r.input).target as string) : d.input.target,
    },
    subtitles: { enabled: bool(obj(r.subtitles).enabled, d.subtitles.enabled) },
  };
}

function nearest(v: unknown, list: readonly number[], d: number): number {
  const n = Number(v);
  if (!isFinite(n)) return d;
  return list.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a));
}

function normalizeReader(raw: unknown): ReaderPrefs {
  const r = obj(raw);
  const d = DEFAULT_ENHANCE.reader;
  return {
    fontSize: nearest(r.fontSize, READER_FONT_SIZES, d.fontSize),
    width: nearest(r.width, READER_WIDTHS, d.width),
    font: pick(r.font, ['sans', 'serif'] as const, d.font),
    theme: pick(r.theme, ['auto', 'dark', 'light', 'sepia'] as const, d.theme),
  };
}

/**
 * 选择器要能安全地拼进样式表：不能带花括号、分号、注释或 @ 规则，
 * 否则一条坏规则就能跳出 { display: none } 改写整页。
 */
export function safeSelector(sel: unknown): string {
  if (typeof sel !== 'string') return '';
  const t = sel.trim();
  if (!t || t.length > 500 || /[{};@]|\/\*|\*\/|<\//.test(t)) return '';
  return t;
}

function normalizeHideRules(raw: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [site, list] of Object.entries(obj(raw))) {
    if (!site || !Array.isArray(list)) continue;
    const sels = [...new Set(list.map(safeSelector).filter(Boolean))].slice(0, MAX_RULES);
    if (sels.length) out[site.toLowerCase()] = sels;
  }
  return out;
}

function normalizeSiteCss(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [site, css] of Object.entries(obj(raw))) {
    if (!site || typeof css !== 'string' || !css.trim()) continue;
    // 不让自定义 CSS 提前结束 <style>
    out[site.toLowerCase()] = css.replace(/<\/style/gi, '').slice(0, MAX_CSS);
  }
  return out;
}

/** 当前站点适用的条目：站点键本身或它的上级域名 */
export function forSite<T>(map: Record<string, T>, site: string): T[] {
  return Object.keys(map)
    .filter((k) => site === k || site.endsWith(`.${k}`))
    .sort((a, b) => a.length - b.length)
    .map((k) => map[k]);
}

/** 屏蔽规则 + 自定义 CSS 合成的样式表 */
export function siteRulesCss(s: EnhanceSettings, site: string): string {
  const sels = forSite(s.hideRules, site).flat();
  const parts: string[] = [];
  // 每条选择器单独一条规则：浏览器不认识的一条不会连累其他条
  for (const sel of sels) parts.push(`${sel} { display: none !important; }`);
  parts.push(...forSite(s.siteCss, site));
  return parts.join('\n');
}

export async function loadEnhance(): Promise<EnhanceSettings> {
  const data = await chrome.storage.local.get(ENHANCE_KEY);
  return normalizeEnhance(data[ENHANCE_KEY]);
}

export async function saveEnhance(s: EnhanceSettings): Promise<void> {
  await chrome.storage.local.set({ [ENHANCE_KEY]: s });
}

/** 字体名：自定义时给每个名字加引号，最后补一个通用字体兜底 */
export function fontStack(s: EnhanceSettings['font']): string {
  if (s.family === '') return '';
  if (s.family !== 'custom') return FONT_STACKS[s.family];
  const names = s.custom
    .split(',')
    .map((n) => n.trim().replace(/^["']|["']$/g, '').replace(/["']/g, ''))
    .filter(Boolean);
  return names.length ? `${names.map((n) => `"${n}"`).join(', ')}, sans-serif` : '';
}

/**
 * 字体与排版的样式表。代码、公式、图标字体不改字体：图标字体的 ::before 继承自元素本身，
 * 元素被排除后伪元素也保持原样。
 */
export function fontCss(s: EnhanceSettings['font']): string {
  const rules: string[] = [];
  const stack = fontStack(s);
  const skip =
    'pre, pre *, code, code *, kbd, kbd *, samp, samp *, tt, var, math, math *, svg, svg *, ' +
    '[class*="icon" i], [class*="fa-"], [class^="fa "], [class~="fa"], [class*="glyph" i], ' +
    '.material-icons, .material-symbols-outlined, .material-symbols-rounded, .codicon, .octicon';
  if (stack) rules.push(`:where(body, body :not(${skip})) { font-family: ${stack} !important; }`);
  if (s.lineHeight) rules.push(`:where(p, li, dd, blockquote, figcaption) { line-height: ${s.lineHeight} !important; }`);
  if (s.bolder) rules.push(`:where(body) { -webkit-text-stroke: 0.25px currentColor; }`);
  return rules.join('\n');
}

/** 护眼滤镜覆盖层的内联样式；off 返回空串 */
export function filterStyle(f: EnhanceSettings['filter']): string {
  const a = f.strength / 100;
  const base = 'position:fixed;inset:0;pointer-events:none;z-index:2147483645;';
  switch (f.mode) {
    case 'warm':
      // 正片叠底一层橙色：去掉一部分蓝光，白底变成暖黄
      return `${base}background:rgb(255 140 30 / ${(a * 0.6).toFixed(3)});mix-blend-mode:multiply;`;
    case 'dim':
      return `${base}background:rgb(0 0 0 / ${(a * 0.75).toFixed(3)});`;
    case 'gray':
      return `${base}backdrop-filter:grayscale(${Math.min(1, a * 1.25).toFixed(3)});`;
    default:
      return '';
  }
}

export function enhanceActiveOn(s: EnhanceSettings, site: string): boolean {
  if (!site) return false;
  return !s.disabledSites.some((d) => site === d || site.endsWith(`.${d}`));
}

/** 设置页里一行一个站点的文本 -> 站点键列表 */
export function parseSiteLines(text: string, keyOf: (input: string) => string): string[] {
  return [...new Set(text.split(/[\s,，]+/).map((l) => keyOf(l.trim())).filter(Boolean))];
}
