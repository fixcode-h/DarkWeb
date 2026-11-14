/**
 * 检查更新的纯逻辑：版本比较、解析 GitHub Releases、整理改动列表。
 * 不碰 chrome.*，方便单元测试；后台和页面都从这里取。
 */

export const REPO = 'fixcode-h/DarkWeb';
export const RELEASES_API = `https://api.github.com/repos/${REPO}/releases?per_page=30`;
export const RELEASES_PAGE = `https://github.com/${REPO}/releases`;
export const UPDATE_KEY = 'drak-update';
/** 商店版：浏览器已下载好、等待重启生效的新版本号 */
export const PENDING_KEY = 'drak-update-pending';

/** GitHub Releases 接口里我们用到的字段 */
export interface GhRelease {
  tag_name: string;
  name?: string | null;
  body?: string | null;
  html_url: string;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string | null;
  assets?: { name: string; browser_download_url: string; size?: number }[];
}

/** 一个比当前新的版本 */
export interface ReleaseInfo {
  version: string;
  url: string;
  publishedAt: string | null;
  /** 改动列表，每项是一行；level 1 是某个 PR 下面的具体提交 */
  changes: { text: string; level: 0 | 1 }[];
}

/** 存在 chrome.storage.local 的检查结果 */
export interface UpdateState {
  checkedAt: number;
  /** 检查时扩展自己的版本；装了新版后据此判断结果已过期 */
  current: string;
  latest: string | null;
  /** 解压安装用的包（带 key 的那个，覆盖后扩展 ID 不变） */
  downloadUrl: string | null;
  downloadName: string | null;
  releasePage: string;
  /** 比当前新的版本，新的在前 */
  newer: ReleaseInfo[];
  error?: string;
}

/** 把 "v0.3.0.14" / "0.3.0" 解析成数字数组；不是版本号返回 null */
export function parseVersion(v: string): number[] | null {
  const m = /^v?(\d+(?:\.\d+){0,3})$/.exec(v.trim());
  return m ? m[1].split('.').map(Number) : null;
}

/** a 比 b 新返回正数，相同返回 0；缺的位按 0 算（0.3.0 等于 0.3.0.0） */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a) ?? [];
  const pb = parseVersion(b) ?? [];
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/**
 * 从发布说明里取改动列表：只要列表项，跳过标题、“相对上一个包…”和“安装”一节。
 * 说明由 scripts/release-notes.mjs 生成，格式是 "- 标题（#PR）" 加缩进的 "  - 提交"。
 */
export function parseChanges(body: string | null | undefined): ReleaseInfo['changes'] {
  const out: ReleaseInfo['changes'] = [];
  let skip = false;
  for (const raw of (body ?? '').split(/\r?\n/)) {
    if (/^#{1,6}\s/.test(raw)) {
      skip = /安装|install/i.test(raw);
      continue;
    }
    if (skip) continue;
    const m = /^(\s*)[-*]\s+(.+)$/.exec(raw);
    if (!m) continue;
    out.push({ text: m[2].trim(), level: m[1].length >= 2 ? 1 : 0 });
  }
  return out;
}

/** 解压安装用的包：drak-<版本>.zip，不要 -store.zip（不带 key，装上去会变成另一个扩展） */
export function pickAsset(r: GhRelease): { name: string; url: string } | null {
  const zips = (r.assets ?? []).filter((a) => a.name.endsWith('.zip'));
  const a = zips.find((x) => !x.name.endsWith('-store.zip')) ?? null;
  return a ? { name: a.name, url: a.browser_download_url } : null;
}

/** 由接口返回的发布列表算出检查结果 */
export function buildState(releases: GhRelease[], current: string, now = Date.now()): UpdateState {
  const valid = releases
    .filter((r) => !r.draft && !r.prerelease && parseVersion(r.tag_name))
    .sort((a, b) => compareVersions(b.tag_name, a.tag_name));
  const newer = valid.filter((r) => compareVersions(r.tag_name, current) > 0);
  const top = valid[0];
  const asset = newer[0] ? pickAsset(newer[0]) : null;
  return {
    checkedAt: now,
    current,
    latest: top ? top.tag_name.replace(/^v/, '') : null,
    downloadUrl: asset?.url ?? null,
    downloadName: asset?.name ?? null,
    releasePage: newer[0]?.html_url ?? RELEASES_PAGE,
    newer: newer.map((r) => ({
      version: r.tag_name.replace(/^v/, ''),
      url: r.html_url,
      publishedAt: r.published_at ?? null,
      changes: parseChanges(r.body),
    })),
  };
}

/** 检查结果是否表示有新版（扩展已经升级过的旧结果不算） */
export function hasUpdate(s: UpdateState | null | undefined, current: string): boolean {
  return !!s && s.newer.length > 0 && !!s.latest && compareVersions(s.latest, current) > 0;
}
