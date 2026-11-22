/**
 * HLS（m3u8）播放列表解析。只支持未加密和 AES-128 整段加密；SAMPLE-AES、FairPlay 等算 DRM，不下载。
 */
export interface ByteRange {
  offset: number;
  length: number;
}

export interface HlsKey {
  method: 'AES-128';
  url: string;
  /** 没写 IV 时为 null，按分片序号生成 */
  iv: Uint8Array | null;
}

export interface HlsSegment {
  url: string;
  duration: number;
  seq: number;
  range?: ByteRange;
  key?: HlsKey;
  /** fMP4 分片的初始化段（EXT-X-MAP） */
  map?: { url: string; range?: ByteRange };
}

export interface HlsVariant {
  url: string;
  bandwidth: number;
  width?: number;
  height?: number;
  codecs?: string;
  audio?: string;
}

export interface HlsRendition {
  type: string;
  group: string;
  name: string;
  url?: string;
  isDefault: boolean;
  language?: string;
}

export type HlsPlaylist =
  | { type: 'master'; variants: HlsVariant[]; media: HlsRendition[] }
  | { type: 'media'; segments: HlsSegment[]; live: boolean; drm: boolean; duration: number; fmp4: boolean };

/** 解析 `A=1,B="x,y"` 这样的属性列表 */
export function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out[m[1]] = m[2].startsWith('"') ? m[2].slice(1, -1) : m[2];
  return out;
}

function resolve(u: string, base: string): string {
  try {
    return new URL(u, base).href;
  } catch {
    return u;
  }
}

function parseRange(s: string, prevEnd: number): ByteRange {
  const [len, off] = s.split('@');
  return { length: Number(len), offset: off !== undefined ? Number(off) : prevEnd };
}

function hexIv(s: string): Uint8Array | null {
  const h = s.replace(/^0x/i, '');
  if (!/^[0-9a-f]{1,32}$/i.test(h)) return null;
  const p = h.padStart(32, '0');
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(p.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** 没写 IV 时，用分片序号的 16 字节大端表示 */
export function seqIv(seq: number): Uint8Array {
  const iv = new Uint8Array(16);
  let n = seq;
  for (let i = 15; i >= 12 && n > 0; i--) {
    iv[i] = n & 0xff;
    n = Math.floor(n / 256);
  }
  return iv;
}

export function parseM3u8(text: string, base: string): HlsPlaylist {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines[0]?.startsWith('#EXTM3U')) throw new Error('不是 m3u8 播放列表');

  if (lines.some((l) => l.startsWith('#EXT-X-STREAM-INF'))) {
    const variants: HlsVariant[] = [];
    const media: HlsRendition[] = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.startsWith('#EXT-X-STREAM-INF:')) {
        const a = parseAttrs(l.slice(18));
        const uri = lines.slice(i + 1).find((x) => !x.startsWith('#'));
        if (!uri) continue;
        const [w, h] = (a.RESOLUTION ?? '').split('x').map(Number);
        variants.push({
          url: resolve(uri, base),
          bandwidth: Number(a['AVERAGE-BANDWIDTH'] ?? a.BANDWIDTH) || 0,
          width: w || undefined,
          height: h || undefined,
          codecs: a.CODECS,
          audio: a.AUDIO,
        });
      } else if (l.startsWith('#EXT-X-MEDIA:')) {
        const a = parseAttrs(l.slice(13));
        media.push({
          type: a.TYPE ?? '',
          group: a['GROUP-ID'] ?? '',
          name: a.NAME ?? '',
          url: a.URI ? resolve(a.URI, base) : undefined,
          isDefault: a.DEFAULT === 'YES',
          language: a.LANGUAGE,
        });
      }
    }
    // 同一个地址只留一条（有的列表给同一路流写多条不同 CODECS）
    const seen = new Set<string>();
    const uniq = variants.filter((v) => !seen.has(v.url) && seen.add(v.url));
    uniq.sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || b.bandwidth - a.bandwidth);
    return { type: 'master', variants: uniq, media };
  }

  const segments: HlsSegment[] = [];
  let seq = 0;
  let duration = 0;
  let key: HlsKey | undefined;
  let map: HlsSegment['map'];
  let drm = false;
  let live = true;
  let nextDur = 0;
  let range: ByteRange | undefined;
  let prevEnd = 0;
  for (const l of lines) {
    if (l.startsWith('#EXT-X-MEDIA-SEQUENCE:')) seq = Number(l.slice(22)) || 0;
    else if (l.startsWith('#EXT-X-ENDLIST')) live = false;
    else if (l.startsWith('#EXT-X-PLAYLIST-TYPE:VOD')) live = false;
    else if (l.startsWith('#EXTINF:')) nextDur = parseFloat(l.slice(8)) || 0;
    else if (l.startsWith('#EXT-X-BYTERANGE:')) range = parseRange(l.slice(17), prevEnd);
    else if (l.startsWith('#EXT-X-KEY:') || l.startsWith('#EXT-X-SESSION-KEY:')) {
      const a = parseAttrs(l.slice(l.indexOf(':') + 1));
      const method = (a.METHOD ?? 'NONE').toUpperCase();
      const format = (a.KEYFORMAT ?? 'identity').toLowerCase();
      if (method === 'NONE') key = undefined;
      else if (method === 'AES-128' && format === 'identity' && a.URI) key = { method: 'AES-128', url: resolve(a.URI, base), iv: a.IV ? hexIv(a.IV) : null };
      else drm = true;
    } else if (l.startsWith('#EXT-X-MAP:')) {
      const a = parseAttrs(l.slice(11));
      if (a.URI) map = { url: resolve(a.URI, base), range: a.BYTERANGE ? parseRange(a.BYTERANGE, 0) : undefined };
    } else if (!l.startsWith('#')) {
      segments.push({ url: resolve(l, base), duration: nextDur, seq, range, key, map });
      duration += nextDur;
      if (range) prevEnd = range.offset + range.length;
      seq++;
      nextDur = 0;
      range = undefined;
    }
  }
  return { type: 'media', segments, live, drm, duration, fmp4: !!map || segments.some((s) => /\.(m4s|mp4|cmf[va])(\?|$)/i.test(s.url)) };
}
