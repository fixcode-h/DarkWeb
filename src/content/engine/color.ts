/**
 * 颜色解析与 sRGB <-> OKLCH 转换。
 * 纯函数，不依赖浏览器 API，便于单元测试。
 */

export interface RGBA {
  r: number; // 0-255
  g: number;
  b: number;
  a: number; // 0-1
}

export interface OKLCH {
  l: number; // 0-1
  c: number; // >= 0
  h: number; // 0-360
  a: number; // 0-1
}

// CSS 命名颜色（CSS Color 4）
const NAMED_HEX: Record<string, string> = {
  aliceblue: 'f0f8ff', antiquewhite: 'faebd7', aqua: '00ffff', aquamarine: '7fffd4', azure: 'f0ffff',
  beige: 'f5f5dc', bisque: 'ffe4c4', black: '000000', blanchedalmond: 'ffebcd', blue: '0000ff',
  blueviolet: '8a2be2', brown: 'a52a2a', burlywood: 'deb887', cadetblue: '5f9ea0', chartreuse: '7fff00',
  chocolate: 'd2691e', coral: 'ff7f50', cornflowerblue: '6495ed', cornsilk: 'fff8dc', crimson: 'dc143c',
  cyan: '00ffff', darkblue: '00008b', darkcyan: '008b8b', darkgoldenrod: 'b8860b', darkgray: 'a9a9a9',
  darkgreen: '006400', darkgrey: 'a9a9a9', darkkhaki: 'bdb76b', darkmagenta: '8b008b', darkolivegreen: '556b2f',
  darkorange: 'ff8c00', darkorchid: '9932cc', darkred: '8b0000', darksalmon: 'e9967a', darkseagreen: '8fbc8f',
  darkslateblue: '483d8b', darkslategray: '2f4f4f', darkslategrey: '2f4f4f', darkturquoise: '00ced1',
  darkviolet: '9400d3', deeppink: 'ff1493', deepskyblue: '00bfff', dimgray: '696969', dimgrey: '696969',
  dodgerblue: '1e90ff', firebrick: 'b22222', floralwhite: 'fffaf0', forestgreen: '228b22', fuchsia: 'ff00ff',
  gainsboro: 'dcdcdc', ghostwhite: 'f8f8ff', gold: 'ffd700', goldenrod: 'daa520', gray: '808080',
  green: '008000', greenyellow: 'adff2f', grey: '808080', honeydew: 'f0fff0', hotpink: 'ff69b4',
  indianred: 'cd5c5c', indigo: '4b0082', ivory: 'fffff0', khaki: 'f0e68c', lavender: 'e6e6fa',
  lavenderblush: 'fff0f5', lawngreen: '7cfc00', lemonchiffon: 'fffacd', lightblue: 'add8e6', lightcoral: 'f08080',
  lightcyan: 'e0ffff', lightgoldenrodyellow: 'fafad2', lightgray: 'd3d3d3', lightgreen: '90ee90', lightgrey: 'd3d3d3',
  lightpink: 'ffb6c1', lightsalmon: 'ffa07a', lightseagreen: '20b2aa', lightskyblue: '87cefa',
  lightslategray: '778899', lightslategrey: '778899', lightsteelblue: 'b0c4de', lightyellow: 'ffffe0',
  lime: '00ff00', limegreen: '32cd32', linen: 'faf0e6', magenta: 'ff00ff', maroon: '800000',
  mediumaquamarine: '66cdaa', mediumblue: '0000cd', mediumorchid: 'ba55d3', mediumpurple: '9370db',
  mediumseagreen: '3cb371', mediumslateblue: '7b68ee', mediumspringgreen: '00fa9a', mediumturquoise: '48d1cc',
  mediumvioletred: 'c71585', midnightblue: '191970', mintcream: 'f5fffa', mistyrose: 'ffe4e1', moccasin: 'ffe4b5',
  navajowhite: 'ffdead', navy: '000080', oldlace: 'fdf5e6', olive: '808000', olivedrab: '6b8e23',
  orange: 'ffa500', orangered: 'ff4500', orchid: 'da70d6', palegoldenrod: 'eee8aa', palegreen: '98fb98',
  paleturquoise: 'afeeee', palevioletred: 'db7093', papayawhip: 'ffefd5', peachpuff: 'ffdab9', peru: 'cd853f',
  pink: 'ffc0cb', plum: 'dda0dd', powderblue: 'b0e0e6', purple: '800080', rebeccapurple: '663399',
  red: 'ff0000', rosybrown: 'bc8f8f', royalblue: '4169e1', saddlebrown: '8b4513', salmon: 'fa8072',
  sandybrown: 'f4a460', seagreen: '2e8b57', seashell: 'fff5ee', sienna: 'a0522d', silver: 'c0c0c0',
  skyblue: '87ceeb', slateblue: '6a5acd', slategray: '708090', slategrey: '708090', snow: 'fffafa',
  springgreen: '00ff7f', steelblue: '4682b4', tan: 'd2b48c', teal: '008080', thistle: 'd8bfd8',
  tomato: 'ff6347', turquoise: '40e0d0', violet: 'ee82ee', wheat: 'f5deb3', white: 'ffffff',
  whitesmoke: 'f5f5f5', yellow: 'ffff00', yellowgreen: '9acd32',
};

export function isNamedColor(word: string): boolean {
  const w = word.toLowerCase();
  return w in NAMED_HEX;
}

function parseHex(hex: string): RGBA | null {
  const h = hex.replace(/^#/, '');
  if (!/^[0-9a-f]+$/i.test(h)) return null;
  if (h.length === 3 || h.length === 4) {
    const r = parseInt(h[0] + h[0], 16);
    const g = parseInt(h[1] + h[1], 16);
    const b = parseInt(h[2] + h[2], 16);
    const a = h.length === 4 ? parseInt(h[3] + h[3], 16) / 255 : 1;
    return { r, g, b, a };
  }
  if (h.length === 6 || h.length === 8) {
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }
  return null;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 解析 rgb()/hsl() 参数：同时支持逗号写法和空格 + 斜杠写法 */
function splitArgs(body: string): string[] | null {
  const s = body.trim();
  if (s.includes(',')) {
    return s.split(',').map((x) => x.trim());
  }
  const [main, alpha] = s.split('/');
  const parts = main.trim().split(/\s+/);
  if (alpha !== undefined) parts.push(alpha.trim());
  return parts;
}

function parseNumberOrPercent(v: string, percentScale: number): number | null {
  if (v === 'none') return 0;
  if (v.endsWith('%')) {
    const n = parseFloat(v);
    return isNaN(n) ? null : (n / 100) * percentScale;
  }
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function parseAlpha(v: string | undefined): number | null {
  if (v === undefined) return 1;
  const n = parseNumberOrPercent(v, 1);
  return n === null ? null : clamp(n, 0, 1);
}

function parseHue(v: string): number | null {
  const n = parseFloat(v);
  if (isNaN(n)) return v === 'none' ? 0 : null;
  if (v.endsWith('turn')) return n * 360;
  if (v.endsWith('grad')) return n * 0.9;
  if (v.endsWith('rad')) return (n * 180) / Math.PI;
  return n;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/**
 * 解析一个完整的 CSS 颜色字符串。不支持的写法（lab()、color-mix()、系统色等）返回 null，
 * 调用方应原样保留。
 */
export function parseColor(input: string): RGBA | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (s[0] === '#') return parseHex(s);
  const named = NAMED_HEX[s];
  if (named) return parseHex(named);
  const m = /^(rgba?|hsla?|hwb|oklch|oklab|lch|lab)\((.*)\)$/.exec(s);
  if (!m) return null;
  if (m[2].includes('var(') || m[2].includes('calc(') || m[2].includes('from ')) return null;
  const args = splitArgs(m[2]);
  if (!args || args.length < 3 || args.length > 4) return null;
  const alpha = parseAlpha(args[3]);
  if (alpha === null) return null;
  if (m[1] !== 'rgb' && m[1] !== 'rgba' && m[1] !== 'hsl' && m[1] !== 'hsla') return parseModern(m[1], args, alpha);
  if (m[1].startsWith('rgb')) {
    const r = parseNumberOrPercent(args[0], 255);
    const g = parseNumberOrPercent(args[1], 255);
    const b = parseNumberOrPercent(args[2], 255);
    if (r === null || g === null || b === null) return null;
    return { r: clamp(r, 0, 255), g: clamp(g, 0, 255), b: clamp(b, 0, 255), a: alpha };
  }
  const h = parseHue(args[0]);
  const sat = parseNumberOrPercent(args[1], 1);
  const light = parseNumberOrPercent(args[2], 1);
  if (h === null || sat === null || light === null) return null;
  // hsl 的无单位写法按百分数处理（CSS Color 4 允许 number，但含义同百分比数值）
  const sv = args[1].endsWith('%') ? sat : sat / 100;
  const lv = args[2].endsWith('%') ? light : light / 100;
  const [r, g, b] = hslToRgb(h, clamp(sv, 0, 1), clamp(lv, 0, 1));
  return { r, g, b, a: alpha };
}

/** hwb() / oklch() / oklab() / lch() / lab()（Tailwind v4 等新框架大量使用） */
function parseModern(fn: string, args: string[], a: number): RGBA | null {
  if (fn === 'hwb') {
    const h = parseHue(args[0]);
    const w = parseNumberOrPercent(args[1], 1);
    const bl = parseNumberOrPercent(args[2], 1);
    if (h === null || w === null || bl === null) return null;
    let W = args[1].endsWith('%') ? w : w / 100;
    let B = args[2].endsWith('%') ? bl : bl / 100;
    if (W + B >= 1) {
      const g = (W / (W + B)) * 255;
      return { r: g, g, b: g, a };
    }
    const [r, g, b] = hslToRgb(h, 1, 0.5);
    const f = (v: number) => (v / 255) * (1 - W - B) * 255 + W * 255;
    return { r: f(r), g: f(g), b: f(b), a };
  }
  if (fn === 'oklch' || fn === 'oklab') {
    const L = parseNumberOrPercent(args[0], 1);
    if (L === null) return null;
    if (fn === 'oklch') {
      const c = parseNumberOrPercent(args[1], 0.4);
      const h = parseHue(args[2]);
      if (c === null || h === null) return null;
      return oklchToRgb({ l: L, c: Math.max(0, c), h, a });
    }
    const A = parseNumberOrPercent(args[1], 0.4);
    const B = parseNumberOrPercent(args[2], 0.4);
    if (A === null || B === null) return null;
    let h = (Math.atan2(B, A) * 180) / Math.PI;
    if (h < 0) h += 360;
    return oklchToRgb({ l: L, c: Math.hypot(A, B), h, a });
  }
  // CIE Lab / LCH（D50）
  const L = parseNumberOrPercent(args[0], 100);
  if (L === null) return null;
  let A: number, B: number;
  if (fn === 'lch') {
    const c = parseNumberOrPercent(args[1], 150);
    const h = parseHue(args[2]);
    if (c === null || h === null) return null;
    A = Math.max(0, c) * Math.cos((h * Math.PI) / 180);
    B = Math.max(0, c) * Math.sin((h * Math.PI) / 180);
  } else {
    const x = parseNumberOrPercent(args[1], 125);
    const y = parseNumberOrPercent(args[2], 125);
    if (x === null || y === null) return null;
    A = x;
    B = y;
  }
  return labToRgb(L, A, B, a);
}

function labToRgb(L: number, A: number, B: number, a: number): RGBA {
  const k = 24389 / 27;
  const e = 216 / 24389;
  const fy = (L + 16) / 116;
  const fx = fy + A / 500;
  const fz = fy - B / 200;
  const x = (fx ** 3 > e ? fx ** 3 : (116 * fx - 16) / k) * 0.3457 / 0.3585;
  const y = L > k * e ? fy ** 3 : L / k;
  const z = (fz ** 3 > e ? fz ** 3 : (116 * fz - 16) / k) * (1 - 0.3457 - 0.3585) / 0.3585;
  // XYZ(D50) -> 线性 sRGB(D65)，含 Bradford 适配
  const lr = 3.1341359569958707 * x - 1.6173863321612538 * y - 0.4906619460083532 * z;
  const lg = -0.978795502912089 * x + 1.916254567259524 * y + 0.03344273116131949 * z;
  const lb = 0.07195537988411677 * x - 0.2289768264158322 * y + 1.405386058324125 * z;
  const to = (v: number) => clamp(linearToSrgb(clamp(v, 0, 1)), 0, 255);
  return { r: to(lr), g: to(lg), b: to(lb), a };
}

// ---- sRGB <-> OKLab <-> OKLCH ----

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function linearToSrgb(v: number): number {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return c * 255;
}

export function rgbToOklch({ r, g, b, a }: RGBA): OKLCH {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.sqrt(A * A + B * B);
  let H = (Math.atan2(B, A) * 180) / Math.PI;
  if (H < 0) H += 360;
  return { l: L, c: C, h: H, a };
}

function oklchToLinear(L: number, C: number, H: number): [number, number, number] {
  const hr = (H * Math.PI) / 180;
  const A = C * Math.cos(hr);
  const B = C * Math.sin(hr);
  const l = Math.pow(L + 0.3963377774 * A + 0.2158037573 * B, 3);
  const m = Math.pow(L - 0.1055613458 * A - 0.0638541728 * B, 3);
  const s = Math.pow(L - 0.0894841775 * A - 1.291485548 * B, 3);
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function inGamut([r, g, b]: [number, number, number]): boolean {
  const e = 0.0001;
  return r >= -e && r <= 1 + e && g >= -e && g <= 1 + e && b >= -e && b <= 1 + e;
}

/** OKLCH -> sRGB，超出色域时二分降低色度（保持亮度和色相） */
export function oklchToRgb({ l, c, h, a }: OKLCH): RGBA {
  const L = clamp(l, 0, 1);
  let lin = oklchToLinear(L, c, h);
  if (!inGamut(lin)) {
    let lo = 0;
    let hi = c;
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear(L, mid, h))) lo = mid;
      else hi = mid;
    }
    lin = oklchToLinear(L, lo, h);
  }
  return {
    r: clamp(linearToSrgb(clamp(lin[0], 0, 1)), 0, 255),
    g: clamp(linearToSrgb(clamp(lin[1], 0, 1)), 0, 255),
    b: clamp(linearToSrgb(clamp(lin[2], 0, 1)), 0, 255),
    a,
  };
}

export function formatRgba({ r, g, b, a }: RGBA): string {
  const R = Math.round(r);
  const G = Math.round(g);
  const B = Math.round(b);
  if (a >= 1) return `rgb(${R}, ${G}, ${B})`;
  return `rgba(${R}, ${G}, ${B}, ${Math.round(a * 1000) / 1000})`;
}

/** WCAG 相对亮度 */
export function relativeLuminance({ r, g, b }: RGBA): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

export function contrastRatio(a: RGBA, b: RGBA): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
