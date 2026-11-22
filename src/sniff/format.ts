/** 弹窗、侧边面板共用的显示格式 */
export function fmtSize(n: number | undefined): string {
  if (!n) return '';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/** 列表里显示的名字：地址最后一段，去掉查询参数 */
export function displayName(url: string): string {
  try {
    const u = new URL(url);
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '') || u.hostname;
    return last.length > 48 ? `${last.slice(0, 22)}…${last.slice(-22)}` : last;
  } catch {
    return url;
  }
}

export const KIND_LABEL: Record<string, string> = { video: '视频', audio: '音频', hls: 'HLS', dash: 'DASH', image: '图片' };

export function tagOf(kind: string, ext: string): string {
  return kind === 'hls' ? 'M3U8' : kind === 'dash' ? 'MPD' : ext.toUpperCase();
}
