/**
 * 按颜色角色在 OKLCH 空间做亮度映射（设计文档第 3 节）。
 */
import { formatRgba, oklchToRgb, parseColor, rgbToOklch, type OKLCH, type RGBA } from './color';

export type Role = 'bg' | 'fg' | 'border' | 'shadow';

export interface Theme {
  bgMin: number;
  bgMax: number;
  fgMin: number;
  fgMax: number;
  borderMin: number;
  borderMax: number;
  gamma: number;
  /** 中性色（背景、边框）染上的色相与彩度；彩度为 0 表示不染色 */
  tintHue: number;
  tintChroma: number;
  /** 中性文字染上的彩度 */
  fgTintChroma: number;
  /** 输出彩度的缩放，1 为保持原样 */
  sat: number;
}

export type ThemePreset = 'default' | 'black' | 'soft' | 'warm' | 'blue';

interface Preset {
  /** brightness=0 时页面底色的亮度 */
  bgBase: number;
  /** brightness 0-100 能再抬高多少 */
  bgSpan: number;
  hue: number;
  chroma: number;
  fgChroma: number;
}

export const THEME_PRESETS: Record<ThemePreset, Preset> = {
  // 底色亮度 = bgBase + bgSpan × 背景亮度/100；滑杆 50 时与旧版一致，范围放宽到原来的 2.5 倍，拖动能明显看出变化
  default: { bgBase: 0.1, bgSpan: 0.2, hue: 0, chroma: 0, fgChroma: 0 },
  // 纯黑：默认亮度下白底直接映射到 #000，适合 OLED 屏；层级靠 γ 曲线拉开
  black: { bgBase: -0.1, bgSpan: 0.2, hue: 0, chroma: 0, fgChroma: 0 },
  // 柔和灰：底色更亮，明暗反差小
  soft: { bgBase: 0.19, bgSpan: 0.2, hue: 0, chroma: 0, fgChroma: 0 },
  // 暖色护眼：棕调底色 + 米色文字，减少蓝光
  warm: { bgBase: 0.13, bgSpan: 0.2, hue: 65, chroma: 0.018, fgChroma: 0.03 },
  // 午夜蓝
  blue: { bgBase: 0.11, bgSpan: 0.2, hue: 260, chroma: 0.03, fgChroma: 0.015 },
};

export interface ThemeOptions {
  /** 0-100，默认 50：背景亮度 */
  brightness: number;
  /** 0-100，默认 50：文字亮度/对比度 */
  contrast: number;
  /** 配色主题，默认 'default' */
  theme?: ThemePreset;
  /** 0-100，默认 50：色彩饱和度 */
  saturation?: number;
}

export const DEFAULT_THEME_OPTIONS: ThemeOptions = { brightness: 50, contrast: 50 };

export function buildTheme(opts: ThemeOptions = DEFAULT_THEME_OPTIONS): Theme {
  const b = clamp(opts.brightness, 0, 100) / 100;
  const c = clamp(opts.contrast, 0, 100) / 100;
  const p = THEME_PRESETS[opts.theme ?? 'default'] ?? THEME_PRESETS.default;
  const s = clamp(opts.saturation ?? 50, 0, 100);
  const bgMin = Math.max(0, p.bgBase + p.bgSpan * b); // 默认 0.20
  const bgMax = bgMin + 0.19; // 默认 0.39
  // 文字对比度：0 -> 0.79（柔和），50 -> 0.91（默认），100 -> 1（纯白）；文字层级的跨度也随之收放
  // 背景调得很亮时文字至少要比背景亮出一截，对比度调到最低也保证可读
  const fgMax = Math.min(1, Math.max(0.91 + 0.24 * (c - 0.5), bgMax + 0.39));
  // 保证最亮背景 + 最暗文字仍有 >= 4.5:1
  const fgMin = Math.max(fgMax - (0.1 + 0.16 * c), bgMax + 0.39);
  return {
    bgMin,
    bgMax,
    fgMin: Math.min(fgMin, fgMax),
    fgMax,
    // 纯黑主题下底色亮度为 0，边框至少要到 0.28 才看得见
    borderMin: Math.max(bgMin + 0.13, 0.28),
    borderMax: Math.max(bgMin + 0.38, 0.5),
    gamma: 0.6,
    tintHue: p.hue,
    tintChroma: p.chroma,
    fgTintChroma: p.fgChroma,
    // 0 -> 灰度，50 -> 原样，100 -> 1.4 倍
    sat: s <= 50 ? s / 50 : 1 + ((s - 50) / 50) * 0.4,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

const ACCENT_CHROMA = 0.1;

/** 浅色背景用 γ<1 的幂函数压到深色区间，放大“白”和“近白”之间的层级差 */
export function mapBgLightness(L: number, t: Theme): number {
  if (L >= 0.5) {
    const x = clamp((1 - L) / 0.5, 0, 1);
    return t.bgMin + (t.bgMax - t.bgMin) * Math.pow(x, t.gamma);
  }
  return L * (t.bgMax / 0.5);
}

export function mapFgLightness(L: number, t: Theme): number {
  if (L <= 0.6) return t.fgMax - (L / 0.6) * (t.fgMax - t.fgMin);
  return Math.max(L, t.fgMin);
}

export function mapBorderLightness(L: number, t: Theme): number {
  return clamp(t.borderMin + 0.5 * (1 - L), t.borderMin, t.borderMax);
}

/** 半透明深色叠在白底上的等效亮度（近似） */
function compositeOnWhite(L: number, a: number): number {
  return 1 - a * (1 - L);
}

export function transformOklch(o: OKLCH, role: Role, t: Theme): OKLCH {
  const out = mapRole(o, role, t);
  if (t.sat !== 1) out.c *= t.sat;
  // 主题染色：只动接近中性的颜色，品牌色和强调色不受影响
  const tint = role === 'fg' ? t.fgTintChroma : role === 'shadow' ? 0 : t.tintChroma;
  if (tint > 0 && out.c < tint) {
    out.c = tint;
    out.h = t.tintHue;
  }
  return out;
}

function mapRole(o: OKLCH, role: Role, t: Theme): OKLCH {
  const { l, c, h, a } = o;
  switch (role) {
    case 'bg': {
      // 半透明深色（悬停底色、分割遮罩）-> 同透明度的浅色叠加层
      if (a < 0.4 && l < 0.4) {
        return { l: 1, c: Math.min(c, 0.02), h, a: clamp(a * 1.2, 0, 1) };
      }
      if (c >= ACCENT_CHROMA && l >= 0.4) {
        return { l: clamp(l, 0.45, 0.62), c, h, a };
      }
      return { l: mapBgLightness(l, t), c: Math.min(c * 0.6, 0.08), h, a };
    }
    case 'fg': {
      if (c >= ACCENT_CHROMA) {
        const L = a < 1 ? compositeOnWhite(l, a) : l;
        const nl = L >= 0.7 ? L : 0.7 + (0.7 - L) * 0.25;
        return { l: clamp(nl, 0.7, 0.92), c, h, a: a < 1 ? Math.max(a, 0.85) : a };
      }
      if (a < 1 && l < 0.5) {
        // rgba(0,0,0,.45) 这类次要文字：按白底合成后的亮度映射，输出不透明色
        return { l: mapFgLightness(compositeOnWhite(l, a), t), c: Math.min(c, 0.05), h, a: a === 0 ? 0 : 1 };
      }
      return { l: mapFgLightness(l, t), c, h, a };
    }
    case 'border': {
      if (a < 1 && l < 0.4) {
        return { l: 1, c: Math.min(c, 0.02), h, a: a === 0 ? 0 : clamp(a * 1.6, 0.1, 0.5) };
      }
      if (c >= ACCENT_CHROMA && l >= 0.4) {
        return { l: clamp(l, 0.5, 0.72), c, h, a };
      }
      return { l: mapBorderLightness(l, t), c: Math.min(c * 0.6, 0.08), h, a };
    }
    case 'shadow': {
      const nl = l > 0.6 ? 0.08 : l * 0.5;
      return { l: nl, c: Math.min(c, 0.04), h, a: a === 0 ? 0 : clamp(a * 1.5, 0, 0.8) };
    }
  }
}

export function transformRgba(rgba: RGBA, role: Role, t: Theme): RGBA {
  return oklchToRgb(transformOklch(rgbToOklch(rgba), role, t));
}

/**
 * 带缓存的颜色字符串转换。无法解析或完全透明时返回 null（调用方保留原值）。
 */
export class ColorTransformer {
  private cache = new Map<string, string | null>();
  constructor(public theme: Theme) {}

  setTheme(theme: Theme): void {
    this.theme = theme;
    this.cache.clear();
  }

  transform(color: string, role: Role): string | null {
    const key = role + '|' + color;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    let out: string | null = null;
    const rgba = parseColor(color);
    if (rgba && rgba.a > 0) {
      out = formatRgba(transformRgba(rgba, role, this.theme));
    }
    if (this.cache.size > 20000) this.cache.clear();
    this.cache.set(key, out);
    return out;
  }
}
