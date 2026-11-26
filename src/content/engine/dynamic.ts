/**
 * 运行时才知道的颜色：用 CSS 相对颜色语法（`oklch(from <颜色> l c h / alpha)`）让浏览器自己套映射。
 *
 * 有的网站颜色通道是算出来的，样式表里读不出具体颜色，例如 JetBrains（RescUI）
 * `rgba(calc(25 + var(--k, 0)*230), …, 0.7)`：主题系数为 0 时是深灰字，为 1 时是白字；
 * 还有 `rgb(from #000 r g b / .75)` 这类相对颜色。以前这类颜色原样保留，深色背景上的深色字就看不见了
 * （下拉菜单里的菜单项只有悬停时才看得清）。
 *
 * 这里把 transform.ts 里按角色的映射逐段翻译成 calc()：分支用 0/1 阶跃函数 step(x) = clamp(0, x*1e4, 1) 混合，
 * 幂函数用 pow()（Chrome 120 起支持，manifest 的最低版本也是 120）。结果和静态映射一致，见 e2e 的逐色对照。
 */
import type { Role, Theme } from './transform';

/** 数字保留 4 位小数，避免 1e-7 这类科学计数法写进 CSS */
const n = (v: number): string => String(Math.round(v * 10000) / 10000);

/** x > 0 时为 1，否则为 0（x 是 calc 表达式） */
const step = (x: string): string => `clamp(0, (${x}) * 10000, 1)`;

/** a + k * (b - a)，k 为 0/1 阶跃时等于按条件二选一 */
const mix = (a: string, b: string, k: string): string => `(${a} + (${k}) * ((${b}) - (${a})))`;

/** 浅色背景用 γ 幂曲线压到深色区间；深色背景按比例缩放（mapBgLightness） */
function bgLightness(l: string, t: Theme): string {
  const hi = `(${n(t.bgMin)} + ${n(t.bgMax - t.bgMin)} * pow(clamp(0, (1 - ${l}) * 2, 1), ${n(t.gamma)}))`;
  const lo = `(${l} * ${n(t.bgMax / 0.5)})`;
  return mix(lo, hi, step(`${l} - 0.4999`));
}

/** 文字亮度（mapFgLightness）：0–0.6 幂曲线、0.6–0.85 线性降到 dim、0.85 以上逐渐回到原亮度 */
function fgLightness(l: string, t: Theme): string {
  const dim = Math.max(t.fgMin - 0.07, t.bgMax + 0.28);
  return (
    `(${n(t.fgMax)} - pow(min(${l}, 0.6) / 0.6, 1.6) * ${n(t.fgMax - t.fgMin)}` +
    ` + ${n((dim - t.fgMin) / 0.25)} * clamp(0, ${l} - 0.6, 0.25)` +
    // 0.85 以上：dim·(1-k) + L·k，k = (L-0.85)/0.15
    ` + max(0, ${l} - 0.85) / 0.15 * (${l} - ${n(dim)}))`
  );
}

interface Channels {
  l: string;
  c: string;
  a: string;
}

function mapRole(role: Role, t: Theme): Channels {
  switch (role) {
    case 'bg': {
      // 半透明深色 -> 同透明度的浅色叠加层；彩色 -> 保留色相压亮度；其余按背景曲线
      const overlay = `${step('0.4 - alpha')} * ${step('0.4 - l')}`;
      const accent = `${step('c - 0.1')} * ${step('l - 0.4')}`;
      const l = mix(mix(bgLightness('l', t), 'clamp(0.44, l, 0.6)', accent), '1', overlay);
      const c = mix(mix('min(c * 0.75, 0.06)', 'c * 0.88', accent), 'min(c, 0.02)', overlay);
      const a = mix('alpha', 'min(1, alpha * 1.2)', overlay);
      return { l, c, a };
    }
    case 'fg': {
      // 半透明深色字（rgba(0,0,0,.45)）先按白底合成再映射，输出不透明色；完全透明的保持透明
      const dark = `${step('0.5 - l')} * ${step('alpha')}`;
      const eff = `(l + ${dark} * (1 - alpha) * (1 - l))`;
      const accent = step('c - 0.1');
      const accentL = `clamp(0.7, max(${eff}, 0.7 + (0.7 - ${eff}) * 0.25), 0.9)`;
      const l = mix(fgLightness(eff, t), accentL, accent);
      const c = `(c * (1 - 0.1 * ${accent}))`;
      const a = `(alpha + ${dark} * (1 - alpha))`;
      return { l, c, a };
    }
    case 'border': {
      const overlay = `${step('1 - alpha')} * ${step('0.4 - l')}`;
      const accent = `${step('c - 0.1')} * ${step('l - 0.4')}`;
      const neutral = `clamp(${n(t.borderMin)}, ${n(t.borderMin)} + 0.5 * (1 - l), ${n(t.borderMax)})`;
      const l = mix(mix(neutral, 'clamp(0.5, l, 0.7)', accent), '1', overlay);
      const c = mix(mix('min(c * 0.6, 0.06)', 'c * 0.9', accent), 'min(c, 0.02)', overlay);
      const a = mix('alpha', `clamp(0.1, alpha * 1.6, 0.5) * ${step('alpha')}`, overlay);
      return { l, c, a };
    }
    case 'shadow': {
      const l = mix('l * 0.5', '0.08', step('l - 0.6'));
      return { l, c: 'min(c, 0.04)', a: 'clamp(0, alpha * 1.5, 0.8)' };
    }
  }
}

const ROLES: Role[] = ['bg', 'fg', 'border', 'shadow'];

/** 某个角色某个通道的映射公式所在的变量名 */
const varName = (role: Role, ch: 'l' | 'c' | 'h' | 'a'): string => `--drak-dyn-${role}-${ch}`;

/**
 * 四种角色的映射公式，写成 :root 上的变量（放在站点样式表里，随主题生成）。
 * 公式里的 l、c、h、alpha 是相对颜色的通道关键字：var() 是按记号原样替换的，替换进 `oklch(from X …)` 后才求值，
 * 所以公式只写一份，每处颜色只引用变量（JetBrains 首页三百多处这样的颜色，每处都展开公式要多出几十万字的样式）。
 */
export function dynamicVarsCss(t: Theme): string {
  let out = '';
  for (const role of ROLES) {
    const ch = mapRole(role, t);
    let c = t.sat !== 1 ? `(${ch.c}) * ${n(t.sat)}` : ch.c;
    let h = 'h';
    // 主题染色：接近中性的颜色染上主题色相（transformOklch 里的同一规则）
    const tint = (role === 'fg' ? t.fgTintChroma : role === 'shadow' ? 0 : t.tintChroma) * Math.min(1, t.sat);
    if (tint > 0) {
      h = mix('h', n(role === 'fg' ? t.fgTintHue : t.tintHue), step(`${n(tint)} - (${c})`));
      c = `max(${c}, ${n(tint)})`;
    }
    out += `${varName(role, 'l')}:calc(${ch.l});${varName(role, 'c')}:calc(${c});${varName(role, 'h')}:calc(${h});${varName(role, 'a')}:calc(${ch.a});`;
  }
  return out;
}

/** 把一个运行时才能确定的颜色表达式包成按角色映射后的相对颜色（公式见 dynamicVarsCss） */
export function dynamicColor(color: string, role: Role): string {
  const v = (ch: 'l' | 'c' | 'h' | 'a') => `var(${varName(role, ch)})`;
  return `oklch(from ${color} ${v('l')} ${v('c')} ${v('h')} / ${v('a')})`;
}

/** 颜色函数里是不是含有只有运行时才知道的部分（calc()、var()、相对颜色的 from） */
export function isRuntimeColor(inner: string): boolean {
  return /\b(var|calc|env|attr|min|max|clamp)\(|^\s*from\s/i.test(inner);
}
