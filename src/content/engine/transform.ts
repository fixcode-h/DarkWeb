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
}

export interface ThemeOptions {
  /** 0-100，默认 50：背景亮度 */
  brightness: number;
  /** 0-100，默认 50：文字亮度/对比度 */
  contrast: number;
}

export const DEFAULT_THEME_OPTIONS: ThemeOptions = { brightness: 50, contrast: 50 };

export function buildTheme(opts: ThemeOptions = DEFAULT_THEME_OPTIONS): Theme {
  const b = clamp(opts.brightness, 0, 100) / 100;
  const c = clamp(opts.contrast, 0, 100) / 100;
  const bgMin = 0.16 + 0.08 * b; // 默认 0.20
  const bgMax = bgMin + 0.19; // 默认 0.39
  const fgMax = 0.85 + 0.12 * c; // 默认 0.91
  // 保证最亮背景 + 最暗文字仍有 >= 4.5:1
  const fgMin = Math.max(fgMax - 0.18, bgMax + 0.39);
  return {
    bgMin,
    bgMax,
    fgMin: Math.min(fgMin, fgMax),
    fgMax,
    borderMin: bgMin + 0.13,
    borderMax: bgMin + 0.38,
    gamma: 0.6,
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
