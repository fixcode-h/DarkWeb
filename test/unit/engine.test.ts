import { describe, expect, it } from 'vitest';
import { contrastRatio, oklchToRgb, parseColor, rgbToOklch } from '../../src/content/engine/color';
import { ColorTransformer, buildTheme, mapBgLightness, transformRgba } from '../../src/content/engine/transform';
import { channelVarCandidates, rewriteValue, roleOfProperty, splitTopLevel } from '../../src/content/engine/css-value';

const theme = buildTheme();
const tx = () => new ColorTransformer(theme);
const L = (s: string) => rgbToOklch(parseColor(s)!).l;

describe('parseColor', () => {
  it('parses common syntaxes', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('#0000')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(parseColor('rgba(0, 0, 0, .5)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
    expect(parseColor('rgb(255 0 0 / 50%)')).toEqual({ r: 255, g: 0, b: 0, a: 0.5 });
    expect(parseColor('White')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    const h = parseColor('hsl(120, 100%, 50%)')!;
    expect(Math.round(h.g)).toBe(255);
  });
  it('rejects what it cannot handle', () => {
    expect(parseColor('currentColor')).toBeNull();
    expect(parseColor('rgb(var(--x))')).toBeNull();
    expect(parseColor('color(display-p3 1 0 0)')).toBeNull();
    expect(parseColor('#ggg')).toBeNull();
  });
});

describe('modern color functions', () => {
  const near = (c: string, hex: string) => {
    const a = parseColor(c)!;
    const b = parseColor(hex)!;
    expect(a).not.toBeNull();
    expect(Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b)).toBeLessThan(6);
  };
  it('parses oklch / oklab / lab / lch / hwb', () => {
    near('oklch(1 0 0)', '#ffffff');
    near('oklch(100% 0 0)', '#ffffff');
    near('oklch(0.628 0.2577 29.23)', '#ff0000');
    near('oklch(0.985 0.002 247.839)', '#f9fafb'); // Tailwind v4 gray-50
    near('oklab(0.628 0.2249 0.1258)', '#ff0000');
    near('lab(54.29 80.82 69.91)', '#ff0000');
    near('lab(100 0 0)', '#ffffff');
    near('lch(54.29 106.84 40.85)', '#ff0000');
    near('hwb(0 0% 0%)', '#ff0000');
    near('hwb(0 100% 0%)', '#ffffff');
    expect(parseColor('oklch(0.5 0.1 200 / 50%)')!.a).toBe(0.5);
  });
  it('rewrites oklch backgrounds to dark', () => {
    const r = rewriteValue('oklch(0.985 0.002 247.839)', 'bg', tx());
    expect(r.hits).toBe(1);
    expect(L(r.text)).toBeLessThan(0.3);
  });
});

describe('var() alpha', () => {
  it('rewrites Tailwind v3 colors whose alpha is a variable', () => {
    const r = rewriteValue('rgb(255 255 255/var(--tw-bg-opacity))', 'bg', tx());
    expect(r.hits).toBe(1);
    expect(r.text).toMatch(/^rgb\(\d+ \d+ \d+ \/ var\(--tw-bg-opacity\)\)$/);
    expect(L(r.text.replace(/\/ var\([^)]*\)/, ''))).toBeLessThan(0.3);
    const f = rewriteValue('rgb(35 39 47 / var(--tw-text-opacity, 1))', 'fg', tx());
    expect(L(f.text.replace(/\/ var\([^)]*\)/, ''))).toBeGreaterThan(0.7);
  });
  it('handles legacy rgba with a variable alpha', () => {
    const r = rewriteValue('rgba(255, 255, 255, var(--a))', 'bg', tx());
    expect(r.text).toMatch(/\/ var\(--a\)\)$/);
  });
});

describe('channel variables (shadcn / Geist / Tailwind)', () => {
  it('detects channel-only values', () => {
    expect(channelVarCandidates('0 0% 100%').map((x) => x[0])).toEqual(['hsl']);
    expect(channelVarCandidates('0, 0%, 98%').map((x) => x[0])).toEqual(['hsl']);
    expect(channelVarCandidates('255 255 255').map((x) => x[0])).toEqual(['rgb']);
    expect(channelVarCandidates('1px 2px 3px')).toEqual([]);
    expect(channelVarCandidates('#fff')).toEqual([]);
    expect(channelVarCandidates('0')).toEqual([]);
  });
  it('rewrites the use site to the shadow variable with the original as fallback', () => {
    expect(rewriteValue('hsl(var(--background))', 'bg', tx()).text).toBe('var(--drak-bg-hsl---background, hsl(var(--background)))');
    expect(rewriteValue('hsla(var(--x-value), 1)', 'fg', tx()).text).toBe('var(--drak-fg-hsl---x-value, hsla(var(--x-value), 1))');
    expect(rewriteValue('hsl(var(--primary) / 0.5)', 'bg', tx()).text).toBe(
      'color-mix(in srgb, var(--drak-bg-hsl---primary, hsl(var(--primary))) 50%, transparent)',
    );
    expect(rewriteValue('rgb(var(--c) / var(--tw-bg-opacity))', 'bg', tx()).text).toBe(
      'color-mix(in srgb, var(--drak-bg-rgb---c, rgb(var(--c))) calc(var(--tw-bg-opacity) * 100%), transparent)',
    );
  });
});

describe('OKLCH round trip', () => {
  it('is stable for sRGB colors', () => {
    for (const c of ['#056de8', '#fb7299', '#121212', '#f6f6f6', '#00aeec']) {
      const rgb = parseColor(c)!;
      const back = oklchToRgb(rgbToOklch(rgb));
      expect(Math.abs(back.r - rgb.r)).toBeLessThan(1);
      expect(Math.abs(back.g - rgb.g)).toBeLessThan(1);
      expect(Math.abs(back.b - rgb.b)).toBeLessThan(1);
    }
  });
});

describe('background mapping', () => {
  it('turns white into dark and keeps the card/page layering visible', () => {
    const card = mapBgLightness(1, theme);
    const page = mapBgLightness(L('#f6f6f6'), theme);
    expect(card).toBeCloseTo(theme.bgMin, 3);
    // 线性反转只有 ~0.007 的差，γ 曲线应放大到 >= 0.02
    expect(Math.abs(page - card)).toBeGreaterThanOrEqual(0.02);
  });
  it('keeps already dark backgrounds dark', () => {
    const out = transformRgba(parseColor('#222')!, 'bg', theme);
    expect(rgbToOklch(out).l).toBeLessThan(0.3);
  });
  it('keeps brand hue for accent buttons', () => {
    const blue = parseColor('#056de8')!;
    const o = rgbToOklch(transformRgba(blue, 'bg', theme));
    expect(Math.abs(o.h - rgbToOklch(blue).h)).toBeLessThan(2);
    expect(o.c).toBeGreaterThan(0.1);
    // 按钮上的白字仍可读
    expect(contrastRatio(oklchToRgb(o), { r: 255, g: 255, b: 255, a: 1 })).toBeGreaterThanOrEqual(3);
  });
});

describe('text contrast', () => {
  it('main and secondary text stay readable on every mapped background', () => {
    const bgs = ['#fff', '#f6f6f6', '#f0f2f5', '#e3e5e7', '#ddd'];
    const fgs = ['#000', '#121212', '#18191c', '#444', '#8590a6', '#9499a0', 'rgba(0,0,0,.45)'];
    for (const b of bgs) {
      const bg = transformRgba(parseColor(b)!, 'bg', theme);
      for (const f of fgs) {
        const fg = transformRgba(parseColor(f)!, 'fg', theme);
        expect(contrastRatio(fg, bg), `${f} on ${b}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it('keeps text hierarchy order', () => {
    const main = rgbToOklch(transformRgba(parseColor('#121212')!, 'fg', theme)).l;
    const sub = rgbToOklch(transformRgba(parseColor('#8590a6')!, 'fg', theme)).l;
    expect(main).toBeGreaterThan(sub);
  });
});

describe('borders', () => {
  it('light gray dividers stay visible against the page background', () => {
    const page = transformRgba(parseColor('#fff')!, 'bg', theme);
    for (const b of ['#ebebeb', '#f0f0f0', '#e3e5e7', '#ddd']) {
      const border = transformRgba(parseColor(b)!, 'border', theme);
      expect(rgbToOklch(border).l - rgbToOklch(page).l, b).toBeGreaterThanOrEqual(0.1);
    }
  });
  it('translucent black hairlines become translucent white', () => {
    const out = transformRgba(parseColor('rgba(0,0,0,.08)')!, 'border', theme);
    expect(out.r).toBeGreaterThan(200);
    expect(out.a).toBeGreaterThan(0.08);
  });
});

describe('rewriteValue', () => {
  it('rewrites colors inside gradients and shadows', () => {
    const r = rewriteValue('linear-gradient(180deg, #fff 0%, rgba(255,255,255,.5) 100%)', 'bg', tx());
    expect(r.hits).toBe(2);
    expect(r.text).not.toContain('#fff');
    const s = rewriteValue('0 1px 3px rgba(0, 0, 0, 0.1), inset 0 0 0 1px #eee', 'shadow', tx());
    expect(s.hits).toBe(2);
    expect(s.text).toContain('inset');
  });
  it('routes var() through role-specific shadow variables and keeps the fallback', () => {
    const r = rewriteValue('var(--bg1, #fff)', 'bg', tx());
    expect(r.text.startsWith('var(--drak-bg---bg1, var(--bg1,')).toBe(true);
    expect(r.text).not.toContain('#fff');
  });
  it('absolutizes urls and leaves non-color words alone', () => {
    const r = rewriteValue('url(img/a.png) no-repeat center / cover white', 'bg', tx(), 'https://a.com/css/x.css');
    expect(r.text).toContain('"https://a.com/css/img/a.png"');
    expect(r.text).toContain('no-repeat center / cover');
    expect(r.urls).toEqual(['img/a.png']);
  });
  it('does not touch hex-like words or identifiers', () => {
    const r = rewriteValue('1px solid var(--line) !important', 'border', tx());
    expect(r.text).toContain('solid');
    expect(rewriteValue('red-ish', 'fg', tx()).text).toBe('red-ish');
  });
});

describe('helpers', () => {
  it('splits on top level commas', () => {
    expect(splitTopLevel('a, rgb(1,2,3), b')).toEqual(['a', ' rgb(1,2,3)', ' b']);
  });
  it('maps properties to roles', () => {
    expect(roleOfProperty('border-top-color')).toBe('border');
    expect(roleOfProperty('border')).toBe('border');
    expect(roleOfProperty('border-radius')).toBeNull();
    expect(roleOfProperty('border-top-width')).toBeNull();
    expect(roleOfProperty('background')).toBe('bg');
    expect(roleOfProperty('width')).toBeNull();
  });
});

describe('theme presets', () => {
  const presets = ['default', 'black', 'soft', 'warm', 'blue'] as const;
  it('keeps text readable and dividers visible in every preset and brightness', () => {
    for (const p of presets) {
      for (const brightness of [0, 50, 100]) {
        const t = buildTheme({ brightness, contrast: 50, theme: p });
        const page = transformRgba(parseColor('#fff')!, 'bg', t);
        for (const b of ['#fff', '#f6f6f6', '#e3e5e7']) {
          const bg = transformRgba(parseColor(b)!, 'bg', t);
          for (const f of ['#121212', '#8590a6', 'rgba(0,0,0,.45)']) {
            expect(contrastRatio(transformRgba(parseColor(f)!, 'fg', t), bg), `${p}/${brightness}: ${f} on ${b}`).toBeGreaterThanOrEqual(4.5);
          }
        }
        const border = transformRgba(parseColor('#ebebeb')!, 'border', t);
        expect(rgbToOklch(border).l - rgbToOklch(page).l, `${p}/${brightness} border`).toBeGreaterThanOrEqual(0.1);
      }
    }
  });
  it('readability holds at every contrast setting', () => {
    for (const p of presets) {
      for (const brightness of [0, 100]) {
        for (const contrast of [0, 100]) {
          const t = buildTheme({ brightness, contrast, theme: p });
          const bg = transformRgba(parseColor('#e3e5e7')!, 'bg', t);
          for (const f of ['#121212', '#8590a6']) {
            expect(contrastRatio(transformRgba(parseColor(f)!, 'fg', t), bg), `${p}/${brightness}/${contrast}: ${f}`).toBeGreaterThanOrEqual(4.5);
          }
        }
      }
    }
  });
  it('brightness and contrast sliders make a visible difference', () => {
    const page = (brightness: number) => rgbToOklch(transformRgba(parseColor('#fff')!, 'bg', buildTheme({ brightness, contrast: 50 }))).l;
    expect(page(100) - page(0)).toBeGreaterThanOrEqual(0.18);
    const text = (contrast: number) => rgbToOklch(transformRgba(parseColor('#000')!, 'fg', buildTheme({ brightness: 50, contrast }))).l;
    expect(text(100) - text(0)).toBeGreaterThanOrEqual(0.18);
  });
  it('black maps a white page to pure black', () => {
    const out = transformRgba(parseColor('#fff')!, 'bg', buildTheme({ brightness: 50, contrast: 50, theme: 'black' }));
    expect(Math.max(out.r, out.g, out.b)).toBeLessThanOrEqual(1);
  });
  it('warm and blue tint neutral colors but leave accents alone', () => {
    const warm = buildTheme({ brightness: 50, contrast: 50, theme: 'warm' });
    const bg = transformRgba(parseColor('#fff')!, 'bg', warm);
    expect(bg.r).toBeGreaterThan(bg.b);
    const fg = transformRgba(parseColor('#121212')!, 'fg', warm);
    expect(fg.r).toBeGreaterThan(fg.b);
    const blue = buildTheme({ brightness: 50, contrast: 50, theme: 'blue' });
    const bbg = transformRgba(parseColor('#fff')!, 'bg', blue);
    expect(bbg.b).toBeGreaterThan(bbg.r);
    const accent = parseColor('#056de8')!;
    expect(transformRgba(accent, 'bg', warm)).toEqual(transformRgba(accent, 'bg', theme));
  });
  it('default preset output is unchanged by the new options', () => {
    expect(buildTheme({ brightness: 50, contrast: 50, theme: 'default', saturation: 50 })).toEqual(theme);
    expect(theme.bgMin).toBeCloseTo(0.2, 5);
  });
  it('saturation 0 turns accents gray, 100 makes them more vivid', () => {
    const accent = parseColor('#056de8')!;
    const gray = transformRgba(accent, 'bg', buildTheme({ brightness: 50, contrast: 50, saturation: 0 }));
    expect(Math.max(gray.r, gray.g, gray.b) - Math.min(gray.r, gray.g, gray.b)).toBeLessThan(2);
    // 用一个没顶到色域边界的颜色（#056de8 提亮后已是最大彩度）
    const muted = parseColor('#5b8fc7')!;
    const base = rgbToOklch(transformRgba(muted, 'fg', theme)).c;
    const vivid = rgbToOklch(transformRgba(muted, 'fg', buildTheme({ brightness: 50, contrast: 50, saturation: 100 }))).c;
    expect(vivid).toBeGreaterThan(base);
  });
});

describe('multi-layer background-image', () => {
  it('replaces omitted layers serialized as initial', async () => {
    const { fixInitialLayers } = await import('../../src/content/engine/rewriter');
    // 百度搜索框：background: linear-gradient(white, white) padding-box, transparent border-box
    expect(fixInitialLayers('linear-gradient(rgb(20, 22, 26), rgb(20, 22, 26)), initial')).toBe(
      'linear-gradient(rgb(20, 22, 26), rgb(20, 22, 26)), none',
    );
    expect(fixInitialLayers('initial, url("a.png")')).toBe('none, url("a.png")');
    expect(fixInitialLayers('initial')).toBe('initial');
    expect(fixInitialLayers('linear-gradient(red, blue)')).toBe('linear-gradient(red, blue)');
  });
});
