/**
 * 资源嗅探的设置。默认关闭：不开就不监听网络请求、不注入任何脚本，暗色和翻译不受影响。
 */
export const SNIFF_KEY = 'drak-sniff';

export type SniffType = 'video' | 'audio' | 'hls' | 'dash' | 'image';
export type BiliCodec = 'avc' | 'hevc' | 'av1' | 'smallest';

export interface SniffSettings {
  enabled: boolean;
  /** 视频右上角的悬浮下载按钮 */
  fab: boolean;
  types: Record<SniffType, boolean>;
  /** 小于此大小（KB）的音视频文件不列出，过滤广告、预览和碎片 */
  minSizeKB: number;
  /** 文件名模板，见 renderFilename */
  filename: string;
  /** 同时下载的分片数 */
  concurrency: 3 | 6 | 10;
  /** 弹窗里的“开启资源嗅探”提示被关掉了 */
  promptDismissed: boolean;
  bili: { enabled: boolean; codec: BiliCodec };
  youtube: { enabled: boolean };
}

export const DEFAULT_SNIFF: SniffSettings = {
  enabled: false,
  fab: false,
  types: { video: true, audio: true, hls: true, dash: true, image: false },
  minSizeKB: 200,
  filename: '{标题}',
  concurrency: 6,
  promptDismissed: false,
  bili: { enabled: true, codec: 'avc' },
  youtube: { enabled: false },
};

const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);

export function normalizeSniff(raw: unknown): SniffSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const d = DEFAULT_SNIFF;
  const types = { ...d.types };
  for (const k of Object.keys(types) as SniffType[]) types[k] = bool(r.types?.[k], d.types[k]);
  const min = Number(r.minSizeKB);
  const conc = Number(r.concurrency);
  const name = typeof r.filename === 'string' ? r.filename.trim().slice(0, 120) : '';
  const codec = r.bili?.codec;
  return {
    enabled: bool(r.enabled, d.enabled),
    fab: bool(r.fab, d.fab),
    types,
    minSizeKB: Number.isFinite(min) && min >= 0 && min <= 102400 ? Math.round(min) : d.minSizeKB,
    filename: name || d.filename,
    concurrency: conc === 3 || conc === 6 || conc === 10 ? conc : d.concurrency,
    promptDismissed: bool(r.promptDismissed, d.promptDismissed),
    bili: { enabled: bool(r.bili?.enabled, d.bili.enabled), codec: ['avc', 'hevc', 'av1', 'smallest'].includes(codec) ? codec : d.bili.codec },
    youtube: { enabled: bool(r.youtube?.enabled, d.youtube.enabled) },
  };
}

export async function loadSniff(): Promise<SniffSettings> {
  const data = await chrome.storage.local.get(SNIFF_KEY);
  return normalizeSniff(data[SNIFF_KEY]);
}

export async function saveSniff(patch: Partial<SniffSettings>): Promise<SniffSettings> {
  const next = normalizeSniff({ ...(await loadSniff()), ...patch });
  await chrome.storage.local.set({ [SNIFF_KEY]: next });
  return next;
}

/** Windows / macOS 都不允许的文件名字符换成全角或去掉，长度截到 120 */
export function sanitizeName(name: string): string {
  const s = name
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/]/g, '／')
    .replace(/:/g, '：')
    .replace(/\*/g, '＊')
    .replace(/\?/g, '？')
    .replace(/"/g, '＂')
    .replace(/</g, '＜')
    .replace(/>/g, '＞')
    .replace(/\|/g, '｜')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '');
  const cut = [...s].slice(0, 120).join('');
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(cut) ? `_${cut}` : cut;
}

export interface NameVars {
  标题: string;
  分P?: string;
  清晰度?: string;
  UP主?: string;
}

/** 按模板生成文件名（不含扩展名）；空变量连同它前面的“ - ”一起去掉 */
export function renderFilename(tpl: string, vars: NameVars, now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const all: Record<string, string> = {
    ...vars,
    日期: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
  } as Record<string, string>;
  let out = tpl.replace(/\{扩展名\}/g, '').replace(/\s*[-_·]\s*\{([^}]+)\}/g, (m, k) => (all[k] ? m.replace(`{${k}}`, all[k]) : ''));
  out = out.replace(/\{([^}]+)\}/g, (_m, k) => all[k] ?? '');
  out = sanitizeName(out.replace(/\.$/, ''));
  return out || sanitizeName(vars.标题) || 'video';
}
