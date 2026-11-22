/**
 * DASH（mpd）解析：取第一个 Period，列出每路视频 / 音频的分片地址。
 * 支持 SegmentTemplate（$Number$ / $Time$ / SegmentTimeline）、SegmentList、SegmentBase / 单个 BaseURL。
 * 有 ContentProtection 的轨道算 DRM；type="dynamic" 是直播，不支持。
 */
import { kid, kids, parseXml, type XNode } from './xml';
import type { ByteRange } from './hls';

export interface DashSeg {
  url: string;
  range?: ByteRange;
}

export interface DashTrack {
  id: string;
  kind: 'video' | 'audio';
  bandwidth: number;
  width?: number;
  height?: number;
  codecs?: string;
  mime?: string;
  init?: DashSeg;
  segments: DashSeg[];
  drm: boolean;
}

export interface DashManifest {
  live: boolean;
  duration: number;
  videos: DashTrack[];
  audios: DashTrack[];
}

/** ISO 8601 时长：PT1H2M3.5S → 秒 */
export function parseDuration(s: string | undefined): number {
  if (!s) return 0;
  const m = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(s.trim());
  if (!m) return 0;
  return (Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0)) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
}

function join(base: string, rel: string | undefined): string {
  if (!rel) return base;
  try {
    return new URL(rel.trim(), base).href;
  } catch {
    return base;
  }
}

function parseRange(s: string | undefined): ByteRange | undefined {
  const m = /^(\d+)-(\d+)$/.exec(s ?? '');
  return m ? { offset: Number(m[1]), length: Number(m[2]) - Number(m[1]) + 1 } : undefined;
}

/** $RepresentationID$ / $Number%05d$ / $Time$ / $Bandwidth$ / $$ */
export function fillTemplate(t: string, v: { id: string; bandwidth: number; number?: number; time?: number }): string {
  return t.replace(/\$(RepresentationID|Number|Time|Bandwidth|)(?:%0(\d+)d)?\$/g, (_m, name: string, width?: string) => {
    if (!name) return '$';
    const val = name === 'RepresentationID' ? v.id : String(name === 'Number' ? v.number : name === 'Time' ? v.time : v.bandwidth);
    return width ? val.padStart(Number(width), '0') : val;
  });
}

/** 子元素覆盖父元素的同名属性（SegmentTemplate 可以写在 AdaptationSet 上，再由 Representation 补充） */
function merged(...nodes: (XNode | undefined)[]): Record<string, string> | undefined {
  const present = nodes.filter((n): n is XNode => !!n);
  if (!present.length) return undefined;
  return Object.assign({}, ...present.map((n) => n.attrs));
}

export function parseMpd(text: string, url: string): DashManifest {
  const doc = parseXml(text);
  const mpd = kid(doc, 'MPD');
  if (!mpd) throw new Error('不是 MPD 文件');
  const live = mpd.attrs.type === 'dynamic';
  const period = kid(mpd, 'Period');
  if (!period) throw new Error('MPD 里没有 Period');
  const duration = parseDuration(period.attrs.duration) || parseDuration(mpd.attrs.mediaPresentationDuration);
  const mpdBase = join(url, kid(mpd, 'BaseURL')?.text);
  const periodBase = join(mpdBase, kid(period, 'BaseURL')?.text);
  const videos: DashTrack[] = [];
  const audios: DashTrack[] = [];

  for (const as of kids(period, 'AdaptationSet')) {
    const asBase = join(periodBase, kid(as, 'BaseURL')?.text);
    const asDrm = kids(as, 'ContentProtection').length > 0;
    for (const rep of kids(as, 'Representation')) {
      const mime = rep.attrs.mimeType ?? as.attrs.mimeType ?? '';
      const type = as.attrs.contentType ?? mime.split('/')[0];
      if (type !== 'video' && type !== 'audio') continue;
      const id = rep.attrs.id ?? '';
      const bandwidth = Number(rep.attrs.bandwidth) || 0;
      const base = join(asBase, kid(rep, 'BaseURL')?.text);
      const track: DashTrack = {
        id,
        kind: type,
        bandwidth,
        width: Number(rep.attrs.width ?? as.attrs.width) || undefined,
        height: Number(rep.attrs.height ?? as.attrs.height) || undefined,
        codecs: rep.attrs.codecs ?? as.attrs.codecs,
        mime,
        segments: [],
        drm: asDrm || kids(rep, 'ContentProtection').length > 0,
      };

      const tplNode = kid(rep, 'SegmentTemplate') ?? kid(as, 'SegmentTemplate') ?? kid(period, 'SegmentTemplate');
      const tpl = merged(kid(period, 'SegmentTemplate'), kid(as, 'SegmentTemplate'), kid(rep, 'SegmentTemplate'));
      const list = kid(rep, 'SegmentList') ?? kid(as, 'SegmentList');
      const segBase = kid(rep, 'SegmentBase') ?? kid(as, 'SegmentBase');

      if (tpl && tplNode) {
        const vars = { id, bandwidth };
        if (tpl.initialization) track.init = { url: join(base, fillTemplate(tpl.initialization, vars)) };
        const timescale = Number(tpl.timescale) || 1;
        const start = tpl.startNumber !== undefined ? Number(tpl.startNumber) : 1;
        const timeline = kid(tplNode, 'SegmentTimeline') ??
          kid(kid(rep, 'SegmentTemplate'), 'SegmentTimeline') ?? kid(kid(as, 'SegmentTemplate'), 'SegmentTimeline');
        const media = tpl.media ?? '';
        if (timeline) {
          let t = 0;
          let n = start;
          for (const s of kids(timeline, 'S')) {
            if (s.attrs.t !== undefined) t = Number(s.attrs.t);
            const d = Number(s.attrs.d) || 0;
            const r = Number(s.attrs.r ?? 0);
            const count = r < 0 ? Math.ceil((duration * timescale - t) / d) : r + 1;
            for (let i = 0; i < count; i++) {
              track.segments.push({ url: join(base, fillTemplate(media, { ...vars, number: n++, time: t })) });
              t += d;
            }
          }
        } else if (tpl.duration) {
          const count = Math.ceil(duration / (Number(tpl.duration) / timescale));
          for (let i = 0; i < count; i++) track.segments.push({ url: join(base, fillTemplate(media, { ...vars, number: start + i, time: i * Number(tpl.duration) })) });
        }
      } else if (list) {
        const init = kid(list, 'Initialization');
        if (init) track.init = { url: join(base, init.attrs.sourceURL), range: parseRange(init.attrs.range) };
        for (const s of kids(list, 'SegmentURL')) track.segments.push({ url: join(base, s.attrs.media), range: parseRange(s.attrs.mediaRange) });
      } else {
        // SegmentBase 或只有 BaseURL：整条轨道就是一个文件，初始化段也在里面
        void segBase;
        track.segments.push({ url: base });
      }
      (type === 'video' ? videos : audios).push(track);
    }
  }
  videos.sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || b.bandwidth - a.bandwidth);
  audios.sort((a, b) => b.bandwidth - a.bandwidth);
  return { live, duration, videos, audios };
}
