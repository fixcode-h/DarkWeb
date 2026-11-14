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
}

export const ENHANCE_KEY = 'enhance';

export const DEFAULT_ENHANCE: EnhanceSettings = {
  selection: { enabled: true, trigger: 'icon' },
  font: { family: '', custom: '', lineHeight: 0, bolder: false },
  filter: { mode: 'off', strength: 30 },
  disabledSites: [],
};

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
  };
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
