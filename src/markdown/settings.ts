/**
 * Markdown 文件渲染 / 编辑的设置。单独的存储键，和暗色、翻译、阅读增强的设置互不影响。
 */
export type MdView = 'read' | 'split' | 'source';
export type MdTheme = 'auto' | 'dark' | 'light' | 'sepia';

export interface MarkdownSettings {
  /** 自动渲染 Markdown 文件 */
  enabled: boolean;
  /** 也渲染网络上的 .md（关闭后只渲染本地 file://） */
  remote: boolean;
  /** 打开时先进入的视图 */
  view: MdView;
  /** 标题多于 3 个时显示目录 */
  toc: boolean;
  /** 未保存的修改暂存在本地 */
  drafts: boolean;
  /** 分栏时预览跟着源码滚动 */
  syncScroll: boolean;
  /** 编辑器字号 px */
  editorFontSize: number;
  /** 阅读字号 px */
  fontSize: number;
  /** 正文栏宽 px */
  width: number;
  /** auto：Drak 暗色生效时深色，否则跟随系统 */
  theme: MdTheme;
}

export const MD_KEY = 'markdown';
export const MD_FONT_SIZES = [13, 14, 15, 16, 17, 18, 20, 22] as const;
export const MD_WIDTHS = [680, 760, 880, 1040] as const;
export const MD_EDITOR_SIZES = [12, 13, 14, 15, 16, 18] as const;

export const DEFAULT_MARKDOWN: MarkdownSettings = {
  enabled: true,
  remote: true,
  view: 'read',
  toc: true,
  drafts: true,
  syncScroll: true,
  editorFontSize: 14,
  fontSize: 16,
  width: 760,
  theme: 'auto',
};

const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v ? (v as Record<string, unknown>) : {});
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const pick = <T>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);

export function normalizeMarkdown(raw: unknown): MarkdownSettings {
  const r = obj(raw);
  const d = DEFAULT_MARKDOWN;
  return {
    enabled: bool(r.enabled, d.enabled),
    remote: bool(r.remote, d.remote),
    view: pick(r.view, ['read', 'split', 'source'] as const, d.view),
    toc: bool(r.toc, d.toc),
    drafts: bool(r.drafts, d.drafts),
    syncScroll: bool(r.syncScroll, d.syncScroll),
    editorFontSize: pick(r.editorFontSize, MD_EDITOR_SIZES, d.editorFontSize),
    fontSize: pick(r.fontSize, MD_FONT_SIZES, d.fontSize),
    width: pick(r.width, MD_WIDTHS, d.width),
    theme: pick(r.theme, ['auto', 'dark', 'light', 'sepia'] as const, d.theme),
  };
}

export async function loadMarkdown(): Promise<MarkdownSettings> {
  const data = await chrome.storage.local.get(MD_KEY);
  return normalizeMarkdown(data[MD_KEY]);
}

export async function saveMarkdown(s: MarkdownSettings): Promise<void> {
  await chrome.storage.local.set({ [MD_KEY]: s });
}

/** 这个地址按设置要不要接管 */
export function shouldRender(s: MarkdownSettings, url: string): boolean {
  if (!s.enabled) return false;
  if (/^file:/i.test(url)) return true;
  return s.remote;
}

/** 列表里的相邻一档（到头不动） */
export function stepIn<T extends number>(list: readonly T[], cur: T, dir: 1 | -1): T {
  const i = list.indexOf(cur);
  const j = Math.min(list.length - 1, Math.max(0, (i < 0 ? 0 : i) + dir));
  return list[j];
}
