/**
 * 弹窗和设置页共用的外观控件：配色主题、亮度 / 对比度 / 饱和度 / 图片亮度滑块。
 */
import { ColorTransformer, buildTheme } from '../content/engine/transform';
import { DEFAULT_SETTINGS, THEME_IDS, type Settings, type ThemeId } from '../shared/settings';

export const THEME_TEXT: Record<ThemeId, string> = {
  default: '默认',
  black: '纯黑',
  soft: '柔和',
  warm: '暖色',
  blue: '午夜蓝',
};

type SliderKey = 'brightness' | 'contrast' | 'saturation' | 'imageBrightness';

const SLIDERS: { key: SliderKey; label: string; min: number; max: number; unit: string }[] = [
  { key: 'brightness', label: '背景亮度', min: 0, max: 100, unit: '' },
  { key: 'contrast', label: '文字对比度', min: 0, max: 100, unit: '' },
  { key: 'saturation', label: '色彩饱和度', min: 0, max: 100, unit: '' },
  { key: 'imageBrightness', label: '图片亮度', min: 30, max: 100, unit: '%' },
];

const APPEARANCE_KEYS = ['theme', ...SLIDERS.map((s) => s.key)] as const;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text) el.textContent = text;
  return el;
}

export interface AppearanceControls {
  /** 设置从外部变化（其他页面、导入）后刷新控件 */
  update(s: Settings): void;
}

/**
 * 在 container 里渲染外观控件。save 由调用方负责写存储；滑块拖动时已做防抖。
 */
export function mountAppearance(
  container: HTMLElement,
  initial: Settings,
  save: (patch: Partial<Settings>) => void,
): AppearanceControls {
  let cur = initial;
  container.textContent = '';

  // ---- 主题色块 ----
  const themes = h('div', 'themes');
  themes.setAttribute('role', 'radiogroup');
  themes.setAttribute('aria-label', '配色主题');
  const themeBtns = new Map<ThemeId, HTMLButtonElement>();
  for (const id of THEME_IDS) {
    const b = h('button', 'theme');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    const sw = h('span', 'swatch');
    sw.append(h('span', 'swatch-card'), h('span', 'swatch-text', 'Aa'));
    b.append(sw, h('span', 'theme-name', THEME_TEXT[id]));
    b.addEventListener('click', () => {
      if (cur.theme === id) return;
      cur = { ...cur, theme: id };
      paint();
      save({ theme: id });
    });
    themeBtns.set(id, b);
    themes.appendChild(b);
  }
  container.appendChild(themes);

  // ---- 滑块 ----
  const inputs = new Map<SliderKey, { input: HTMLInputElement; out: HTMLElement; unit: string }>();
  let timer = 0;
  let pending: Partial<Settings> = {};
  for (const def of SLIDERS) {
    const row = h('label', 'slider');
    const head = h('span', 'slider-head');
    const out = h('output', 'slider-value');
    head.append(h('span', '', def.label), out);
    const input = h('input');
    input.type = 'range';
    input.min = String(def.min);
    input.max = String(def.max);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      cur = { ...cur, [def.key]: v };
      pending[def.key] = v;
      paint();
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        const p = pending;
        pending = {};
        save(p);
      }, 120);
    });
    // 双击滑块恢复这一项的默认值
    input.addEventListener('dblclick', () => {
      input.value = String(DEFAULT_SETTINGS[def.key]);
      input.dispatchEvent(new Event('input'));
    });
    row.append(head, input);
    container.appendChild(row);
    inputs.set(def.key, { input, out, unit: def.unit });
  }

  const reset = h('button', 'link reset', '恢复默认外观');
  reset.type = 'button';
  reset.addEventListener('click', () => {
    const patch: Partial<Settings> = {};
    for (const k of APPEARANCE_KEYS) (patch as Record<string, unknown>)[k] = DEFAULT_SETTINGS[k];
    cur = { ...cur, ...patch };
    paint();
    save(patch);
  });
  container.appendChild(reset);

  function paint(): void {
    for (const [id, b] of themeBtns) {
      // 色块用真实的配色引擎算出来，和页面上看到的一致
      const tx = new ColorTransformer(buildTheme({ ...cur, theme: id }));
      b.style.setProperty('--sw-bg', tx.transform('#f4f4f4', 'bg'));
      b.style.setProperty('--sw-card', tx.transform('#ffffff', 'bg'));
      b.style.setProperty('--sw-line', tx.transform('#e2e2e2', 'border'));
      b.style.setProperty('--sw-fg', tx.transform('#1a1a1a', 'fg'));
      const on = cur.theme === id;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    }
    let isDefault = cur.theme === DEFAULT_SETTINGS.theme;
    for (const [key, { input, out, unit }] of inputs) {
      if (Number(input.value) !== cur[key]) input.value = String(cur[key]);
      out.textContent = `${cur[key]}${unit}`;
      const min = Number(input.min);
      input.style.setProperty('--fill', `${((cur[key] - min) / (Number(input.max) - min)) * 100}%`);
      if (cur[key] !== DEFAULT_SETTINGS[key]) isDefault = false;
    }
    reset.hidden = isDefault;
  }
  paint();

  return {
    update(s) {
      // 拖动中还没落盘的值优先，避免滑块被旧值拽回去
      cur = { ...s, ...pending };
      paint();
    },
  };
}
