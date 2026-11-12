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
  /** 网站自己已是深色时自动跳过（关掉则一律按插件配色处理） */
  skipDarkPages: boolean;
  /** 只在指定时段启用 */
  scheduleEnabled: boolean;
  /** 时段起止，'HH:MM'；起点晚于终点表示跨午夜 */
  scheduleStart: string;
  scheduleEnd: string;
  /** 使用远程规则（预留，首版只用内置规则） */
  remoteRules: boolean;
  /**
   * 按站点覆盖模式，'off' 表示该站关闭。键是站点键（见 siteKeyOf）：域名或 IP，非默认端口时带 `:端口`，
   * 如 'zhihu.com'、'192.168.1.10:8080'、'localhost:3000'。不含协议、路径和查询串。
   */
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
  skipDarkPages: true,
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
  s.skipDarkPages = s.skipDarkPages !== false;
  if (parseClock(s.scheduleStart) === null) s.scheduleStart = DEFAULT_SETTINGS.scheduleStart;
  if (parseClock(s.scheduleEnd) === null) s.scheduleEnd = DEFAULT_SETTINGS.scheduleEnd;
  s.siteModes = normalizeSiteModes(s.siteModes);
  if (typeof s.userRules !== 'string') s.userRules = '[]';
  return s;
}

function clampNum(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = typeof v === 'number' && isFinite(v) ? v : dflt;
  return Math.min(hi, Math.max(lo, n));
}

const SITE_MODES: readonly string[] = ['dynamic', 'native', 'filter', 'off'];
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * 站点键：从网址或主机名里取出“域名[:端口]”或“IP[:端口]”。
 * 协议、路径、查询串、开头的 www. 都去掉；http 的 80、https 的 443 视为默认端口不写。无法识别时返回空串。
 *   https://www.zhihu.com/question/1?x=1 -> zhihu.com
 *   http://192.168.1.10:8080/admin       -> 192.168.1.10:8080
 *   localhost:3000                       -> localhost:3000
 */
export function siteKeyOf(input: string): string {
  let text = String(input ?? '').trim().toLowerCase();
  if (!text) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(text)) text = 'http://' + text;
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return '';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
  let name = u.hostname.replace(/\.$/, '');
  if (name.startsWith('www.') && name.indexOf('.', 4) > 0) name = name.slice(4);
  if (!name) return '';
  const port = u.port === '80' || u.port === '443' ? '' : u.port;
  return port ? `${name}:${port}` : name;
}

/** 拆成 [主机名, 端口]，端口可能为空串。IPv6 主机名带方括号 */
export function splitSiteKey(key: string): [string, string] {
  const m = /^(.*):(\d+)$/.exec(key);
  return m && !m[1].endsWith(':') ? [m[1], m[2]] : [key, ''];
}

/** IP 或单段主机名（localhost、内网机器名）：没有“上级域名”可回退 */
function isBareHost(name: string): boolean {
  return IPV4.test(name) || name.startsWith('[') || !name.includes('.');
}

/** 旧数据迁移 + 清洗：键统一成站点键（旧版可能存了带 www. 的主机名或整条网址），丢掉非法项 */
function normalizeSiteModes(raw: unknown): Record<string, SiteMode> {
  const out: Record<string, SiteMode> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== 'string' || !SITE_MODES.includes(v)) continue;
    const key = siteKeyOf(k);
    // 多条旧记录归并到同一个键时，“关闭”优先
    if (key && (!(key in out) || v === 'off')) out[key] = v as SiteMode;
  }
  return out;
}

/**
 * 查站点模式。host 可以是 location.host 或整条网址。
 * 端口是站点的一部分：'192.168.1.10:8080' 只管这个端口，不带端口的键只管默认端口。
 * 域名逐级回退到上级域名（www.zhihu.com -> zhihu.com，端口保持不变）；IP 和 localhost 只精确匹配。
 */
export function siteModeFor(settings: Settings, host: string): SiteMode {
  const [name, port] = splitSiteKey(siteKeyOf(host));
  if (!name) return 'auto';
  const suffix = port ? `:${port}` : '';
  if (isBareHost(name)) return settings.siteModes[name + suffix] ?? 'auto';
  const parts = name.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const m = settings.siteModes[parts.slice(i).join('.') + suffix];
    if (m) return m;
  }
  return 'auto';
}

/**
 * 站点键对应的内容脚本排除规则（match pattern）。
 * Chrome 的 match pattern 不写端口时匹配所有端口，而带端口的写法只在协议明确时合法，所以 http/https 各写一条。
 */
export function excludePatternsFor(key: string): string[] {
  const [name, port] = splitSiteKey(key);
  if (!/^(\[[0-9a-f:.]+\]|[a-z0-9]([a-z0-9.-]*[a-z0-9])?)$/.test(name)) return [];
  const hosts = isBareHost(name) ? [name] : [name, `*.${name}`];
  const out: string[] = [];
  for (const h of hosts) out.push(`http://${h}:${port || '80'}/*`, `https://${h}:${port || '443'}/*`);
  return out;
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
