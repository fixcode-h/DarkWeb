export type SiteMode = 'auto' | 'dynamic' | 'native' | 'filter' | 'off';

export interface Settings {
  /** 全局开关 */
  enabled: boolean;
  /** 只在系统处于深色模式时启用 */
  followSystem: boolean;
  /** 0-100 背景亮度 */
  brightness: number;
  /** 0-100 文字对比度 */
  contrast: number;
  /** 大面积白底图降亮度 */
  dimImages: boolean;
  /** 使用远程规则（预留，首版只用内置规则） */
  remoteRules: boolean;
  /** 按主机名覆盖模式，'off' 表示该站关闭 */
  siteModes: Record<string, SiteMode>;
  /** 用户站点规则（JSON 文本） */
  userRules: string;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  followSystem: false,
  brightness: 50,
  contrast: 50,
  dimImages: true,
  remoteRules: true,
  siteModes: {},
  userRules: '[]',
};

export const SETTINGS_KEY = 'settings';
export const CACHE_PREFIX = 'cache:';

export function normalizeSettings(raw: unknown): Settings {
  const s = { ...DEFAULT_SETTINGS, ...(typeof raw === 'object' && raw ? (raw as Partial<Settings>) : {}) };
  s.brightness = clampNum(s.brightness, 0, 100, 50);
  s.contrast = clampNum(s.contrast, 0, 100, 50);
  if (typeof s.siteModes !== 'object' || !s.siteModes) s.siteModes = {};
  if (typeof s.userRules !== 'string') s.userRules = '[]';
  return s;
}

function clampNum(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = typeof v === 'number' && isFinite(v) ? v : dflt;
  return Math.min(hi, Math.max(lo, n));
}

/** 站点模式按主机名逐级回退：www.zhihu.com -> zhihu.com */
export function siteModeFor(settings: Settings, host: string): SiteMode {
  const parts = host.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const h = parts.slice(i).join('.');
    const m = settings.siteModes[h];
    if (m) return m;
  }
  return 'auto';
}
