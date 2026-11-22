/**
 * 把 B 站播放地址接口的返回整理成“一个视频”：清晰度列表、每档的视频轨（按编码）、音频轨。纯函数，单元测试直接喂录下来的数据。
 */
import type { BiliCodec } from '../settings';

export interface BiliTrack {
  url: string;
  backup: string[];
  bandwidth: number;
  codecs: string;
  width?: number;
  height?: number;
}

export interface BiliQuality {
  qn: number;
  label: string;
  /** 当前账号拿得到这一档 */
  available: boolean;
  /** 拿不到的原因：需要登录 / 大会员 */
  reason?: string;
  /** 按编码分的视频轨，avc / hevc / av1 */
  tracks: Partial<Record<'avc' | 'hevc' | 'av1', BiliTrack>>;
}

export interface BiliStreams {
  durationMs: number;
  qualities: BiliQuality[];
  audios: (BiliTrack & { id: number; label: string })[];
  drm: boolean;
  /** 只能看试看片段（未购买的付费内容） */
  preview: boolean;
}

const CODEC_ID: Record<number, 'avc' | 'hevc' | 'av1'> = { 7: 'avc', 12: 'hevc', 13: 'av1' };

const AUDIO_LABEL: Record<number, string> = { 30216: '64K', 30232: '132K', 30280: '192K', 30250: '杜比全景声', 30251: 'Hi-Res 无损' };

function track(x: any): BiliTrack {
  return {
    url: x.baseUrl ?? x.base_url ?? '',
    backup: x.backupUrl ?? x.backup_url ?? [],
    bandwidth: Number(x.bandwidth) || 0,
    codecs: x.codecs ?? '',
    width: x.width || undefined,
    height: x.height || undefined,
  };
}

/** data：普通视频接口的 data，或番剧接口的 result / result.video_info */
export function parsePlayurl(data: any): BiliStreams {
  const d = data?.video_info ?? data ?? {};
  const dash = d.dash ?? {};
  const drm = !!(d.is_drm || data?.is_drm || d.drm_type || data?.drm_type || dash.video?.some?.((v: any) => /cenc|encv/i.test(v.codecs ?? '')));
  const byQn = new Map<number, BiliQuality>();
  const formats: any[] = d.support_formats ?? [];
  for (const f of formats) {
    byQn.set(f.quality, { qn: f.quality, label: f.new_description ?? f.display_desc ?? String(f.quality), available: false, tracks: {} });
  }
  (d.accept_quality ?? []).forEach((qn: number, i: number) => {
    if (!byQn.has(qn)) byQn.set(qn, { qn, label: d.accept_description?.[i] ?? String(qn), available: false, tracks: {} });
  });
  for (const v of dash.video ?? []) {
    const codec = CODEC_ID[v.codecid] ?? (/^avc/.test(v.codecs) ? 'avc' : /^(hev|hvc)/.test(v.codecs) ? 'hevc' : /^av01/.test(v.codecs) ? 'av1' : undefined);
    if (!codec) continue;
    const q: BiliQuality = byQn.get(v.id) ?? { qn: v.id, label: String(v.id), available: false, tracks: {} };
    q.available = true;
    q.tracks[codec] = track(v);
    byQn.set(v.id, q);
  }
  for (const q of byQn.values()) {
    if (q.available) continue;
    const f = formats.find((x) => x.quality === q.qn);
    q.reason = f?.need_vip || q.qn >= 112 ? '需大会员' : '需登录';
  }
  const audios = [...(dash.audio ?? []), ...(dash.dolby?.audio ?? []), ...(dash.flac?.audio ? [dash.flac.audio] : [])]
    .filter(Boolean)
    .map((a: any) => ({ ...track(a), id: a.id, label: AUDIO_LABEL[a.id] ?? `${Math.round((a.bandwidth || 0) / 1000)}K` }))
    .sort((a, b) => b.bandwidth - a.bandwidth);
  return {
    durationMs: Number(d.timelength ?? data?.timelength) || (Number(dash.duration) || 0) * 1000,
    qualities: [...byQn.values()].sort((a, b) => b.qn - a.qn),
    audios,
    drm,
    preview: !!(data?.is_preview || d.is_preview),
  };
}

/** 按偏好选编码；这一档没有偏好的编码就退回 AVC → HEVC → AV1 */
export function pickTrack(q: BiliQuality, pref: BiliCodec): { codec: 'avc' | 'hevc' | 'av1'; track: BiliTrack } | null {
  const all = (['avc', 'hevc', 'av1'] as const).filter((c) => q.tracks[c]).map((c) => ({ codec: c, track: q.tracks[c]! }));
  if (!all.length) return null;
  if (pref === 'smallest') return all.sort((a, b) => a.track.bandwidth - b.track.bandwidth)[0];
  return all.find((x) => x.codec === pref) ?? all[0];
}

/** 预计大小（字节）：码率 × 时长 */
export function estimate(bandwidth: number, durationMs: number): number {
  return Math.round((bandwidth * durationMs) / 8000);
}

/** B 站 CC 字幕（JSON）转 SRT */
export function toSrt(body: { from: number; to: number; content: string }[]): string {
  const t = (s: number) => {
    const ms = Math.round(s * 1000);
    const p = (n: number, w = 2) => String(n).padStart(w, '0');
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
  };
  return body.map((x, i) => `${i + 1}\n${t(x.from)} --> ${t(x.to)}\n${x.content}\n`).join('\n');
}
