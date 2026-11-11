export type SiteMode = 'auto' | 'dynamic' | 'native' | 'filter' | 'off';

export type ThemeId = 'default' | 'black' | 'soft' | 'warm' | 'blue';
export const THEME_IDS: ThemeId[] = ['default', 'black', 'soft', 'warm', 'blue'];

export interface Settings {
  /** 全局开关 */
  enabled: boolean;
  /** 只在系统处于深色模式时启用 */
  followSystem: boolean;
  /** 0-100 背景亮度 */
  brightness: number;
  /** 0-100 文字对比度 */
  contrast: number;
  /** 配色主题 */
  theme: ThemeId;
  /** 0-100 色彩饱和度，50 为保持原样 */
  saturation: number;
  /** 30-100 图片整体亮度（%），100 为不压暗 */
  imageBrightness: number;
  /** 大面积白底图降亮度 */
  dimImages: boolean;
  /** 只在指定时段启用 */
  scheduleEnabled: boolean;
  /** 时段起止，'HH:MM'；起点晚于终点表示跨午夜 */
  scheduleStart: string;
  scheduleEnd: string;
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
  theme: 'default',
  saturation: 50,
  imageBrightness: 100,
  dimImages: true,
  scheduleEnabled: false,
  scheduleStart: '20:00',
  scheduleEnd: '07:00',
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
  s.saturation = clampNum(s.saturation, 0, 100, 50);
  s.imageBrightness = clampNum(s.imageBrightness, 30, 100, 100);
  if (!THEME_IDS.includes(s.theme)) s.theme = 'default';
  s.scheduleEnabled = s.scheduleEnabled === true;
  if (parseClock(s.scheduleStart) === null) s.scheduleStart = DEFAULT_SETTINGS.scheduleStart;
  if (parseClock(s.scheduleEnd) === null) s.scheduleEnd = DEFAULT_SETTINGS.scheduleEnd;
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

/** 'HH:MM' -> 当天第几分钟；格式不对返回 null */
export function parseClock(v: unknown): number | null {
  const m = typeof v === 'string' ? /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(v) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** 定时启用：当前是否落在启用时段内（未开启定时则恒为 true） */
export function scheduleActive(s: Settings, now: Date = new Date()): boolean {
  if (!s.scheduleEnabled) return true;
  const a = parseClock(s.scheduleStart);
  const b = parseClock(s.scheduleEnd);
  if (a === null || b === null || a === b) return true;
  const t = now.getHours() * 60 + now.getMinutes();
  return a < b ? t >= a && t < b : t >= a || t < b;
}

/** 距离下一次定时切换还有多少毫秒（未开启定时返回 null） */
export function msToNextScheduleEdge(s: Settings, now: Date = new Date()): number | null {
  if (!s.scheduleEnabled) return null;
  const a = parseClock(s.scheduleStart);
  const b = parseClock(s.scheduleEnd);
  if (a === null || b === null || a === b) return null;
  const t = now.getHours() * 60 + now.getMinutes();
  const mins = Math.min(...[a, b].map((e) => (e - t + 1440) % 1440 || 1440));
  return mins * 60_000 - now.getSeconds() * 1000 - now.getMilliseconds();
}

/** 影响生成样式的设置签名：缓存按它失效 */
export function themeSignature(s: Settings): string {
  return [s.theme, s.brightness, s.contrast, s.saturation].join('.');
}
