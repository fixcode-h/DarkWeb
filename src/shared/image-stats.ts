/**
 * 图片采样统计与分类（设计文档 4.1）。纯函数，内容脚本和后台共用。
 */

export type ImageClass = 'keep' | 'invert' | 'dim';

export interface ImageStats {
  /** 透明像素占比 */
  transparent: number;
  /** 不透明像素平均亮度 0-1（感知亮度近似） */
  lightness: number;
  /** 亮度标准差 */
  spread: number;
  /** 平均彩度（0-1） */
  colorfulness: number;
  width: number;
  height: number;
}

export function computeStats(data: Uint8ClampedArray, width: number, height: number, naturalW: number, naturalH: number): ImageStats {
  let transparent = 0;
  let sumL = 0;
  let sumL2 = 0;
  let sumC = 0;
  let opaque = 0;
  const n = width * height;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const a = data[o + 3];
    if (a < 40) {
      transparent++;
      continue;
    }
    const r = data[o] / 255;
    const g = data[o + 1] / 255;
    const b = data[o + 2] / 255;
    // 相对亮度的立方根 ≈ OKLab L
    const y = 0.2126 * r * r + 0.7152 * g * g + 0.0722 * b * b;
    const l = Math.cbrt(y);
    sumL += l;
    sumL2 += l * l;
    sumC += Math.max(r, g, b) - Math.min(r, g, b);
    opaque++;
  }
  const mean = opaque ? sumL / opaque : 0;
  const variance = opaque ? Math.max(0, sumL2 / opaque - mean * mean) : 0;
  return {
    transparent: n ? transparent / n : 0,
    lightness: mean,
    spread: Math.sqrt(variance),
    colorfulness: opaque ? sumC / opaque : 0,
    width: naturalW,
    height: naturalH,
  };
}

export function classify(s: ImageStats, dimImages: boolean): ImageClass {
  // 透明底 + 深色单色图形：图标、公式、线稿
  if (s.transparent > 0.3 && s.lightness < 0.4 && s.colorfulness < 0.15) return 'invert';
  // 大面积白底平涂图：截图、白底图表
  if (
    dimImages &&
    s.transparent < 0.05 &&
    s.lightness > 0.85 &&
    s.spread < 0.25 &&
    s.width * s.height >= 200 * 200
  ) {
    return 'dim';
  }
  return 'keep';
}

/** SVG 文本的启发式分类：没有显式浅色/彩色填充的单色深色图形视为需要反转 */
export function classifySvgText(text: string): ImageClass {
  if (text.length > 400_000) return 'keep';
  if (/<image\b/i.test(text)) return 'keep';
  const colors: string[] = [];
  const re = /(?:fill|stroke|stop-color|color)\s*[:=]\s*["']?\s*(#[0-9a-f]{3,8}|rgba?\([^)]*\)|[a-z]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) colors.push(m[1].toLowerCase());
  const meaningful = colors.filter((c) => c !== 'none' && c !== 'transparent' && c !== 'inherit');
  if (meaningful.length === 0) return 'invert'; // 默认填充是黑色
  let dark = 0;
  for (const c of meaningful) {
    if (c === 'currentcolor' || c === 'black') {
      dark++;
      continue;
    }
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})/.exec(c);
    if (hex) {
      const h = hex[1].length === 3 ? hex[1].replace(/./g, (x) => x + x) : hex[1];
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max < 110 && max - min < 40) dark++;
    }
  }
  return dark === meaningful.length ? 'invert' : 'keep';
}
