/**
 * 站点适配器的结果（目前只有 B 站）：给弹窗和侧边面板显示的摘要。纯函数，方便单测。
 */
import type { BiliCodec } from './settings';
import type { BiliMedia } from './bili/api';
import { estimate, pickTrack } from './bili/parse';

export interface SiteQuality {
  qn: number;
  label: string;
  available: boolean;
  reason?: string;
  codec?: string;
  /** 预计大小（视频 + 音频），字节 */
  size?: number;
}

export interface SiteInfo {
  site: 'bili';
  kind: 'video' | 'bangumi';
  title: string;
  owner?: string;
  cover?: string;
  parts: { index: number; title: string }[];
  current: number;
  qualities: SiteQuality[];
  audio?: string;
  drm: boolean;
  preview: boolean;
  subtitles: { lang: string; label: string; url: string }[];
}

/** 站点适配器的状态：在取 / 取到了 / 出错 */
export type SiteState = { loading: true } | { info: SiteInfo } | { error: string };

const CODEC_LABEL = { avc: 'AVC', hevc: 'HEVC', av1: 'AV1' } as const;

/** 标准音轨（64K/132K/192K）优先，杜比和无损很多播放器放不了 */
export function pickAudio(m: Pick<BiliMedia, 'streams'>) {
  const a = m.streams.audios;
  return a.find((x) => [30280, 30232, 30216].includes(x.id)) ?? a[0];
}

export function biliInfo(m: BiliMedia, codec: BiliCodec, subtitles: SiteInfo['subtitles'] = []): SiteInfo {
  const audio = pickAudio(m);
  const dur = m.streams.durationMs;
  return {
    site: 'bili',
    kind: m.kind,
    title: m.title,
    owner: m.owner,
    cover: m.cover,
    parts: m.parts.map((p) => ({ index: p.index, title: p.title })),
    current: m.current,
    qualities: m.streams.qualities.map((q) => {
      const t = pickTrack(q, codec);
      return {
        qn: q.qn,
        label: q.label,
        available: q.available && !!t,
        reason: q.reason,
        codec: t ? CODEC_LABEL[t.codec] : undefined,
        size: t && dur ? estimate(t.track.bandwidth + (audio?.bandwidth ?? 0), dur) : undefined,
      };
    }),
    audio: audio?.label,
    drm: m.streams.drm,
    preview: m.streams.preview,
    subtitles,
  };
}

/** 支持适配的 B 站页面：普通视频和番剧 / 影视 */
export function isBiliPage(url: string | undefined): boolean {
  return !!url && /^https:\/\/(www\.|m\.)?bilibili\.com\/(?:[A-Za-z-]{2,8}\/)?(video\/BV[0-9A-Za-z]{10}|bangumi\/play\/(ep|ss)\d+)/.test(url);
}
