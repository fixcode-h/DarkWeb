/**
 * 从网络请求（地址、Content-Type、大小）判断是不是可下载的媒体。纯函数，后台和单元测试共用。
 */
import type { SniffType } from './settings';

export type MediaKind = SniffType;

export interface Detected {
  kind: MediaKind;
  ext: string;
}

const EXT_KIND: Record<string, MediaKind> = {
  mp4: 'video', m4v: 'video', webm: 'video', mkv: 'video', mov: 'video', flv: 'video', ogv: 'video', m4s: 'video',
  mp3: 'audio', m4a: 'audio', aac: 'audio', ogg: 'audio', oga: 'audio', opus: 'audio', wav: 'audio', flac: 'audio', weba: 'audio',
  m3u8: 'hls', mpd: 'dash',
  jpg: 'image', jpeg: 'image', png: 'image', webp: 'image', gif: 'image', avif: 'image',
};

const MIME_EXT: Record<string, string> = {
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/x-flv': 'flv', 'video/flv': 'flv', 'video/quicktime': 'mov', 'video/x-matroska': 'mkv', 'video/ogg': 'ogv',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'audio/opus': 'opus',
  'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/flac': 'flac', 'audio/x-flac': 'flac', 'audio/webm': 'weba',
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif',
};

const HLS_MIME = new Set(['application/vnd.apple.mpegurl', 'application/x-mpegurl', 'audio/mpegurl', 'audio/x-mpegurl', 'application/mpegurl']);
const DASH_MIME = new Set(['application/dash+xml']);
/** 分片本身不单独列出：它们属于某个 m3u8 / mpd */
const SEGMENT_MIME = new Set(['video/mp2t', 'video/iso.segment', 'audio/iso.segment']);
const GENERIC_MIME = new Set(['', 'application/octet-stream', 'binary/octet-stream', 'application/binary', 'text/plain']);
/** m4s 多半是 DASH 分片；B 站把整条音 / 视频轨放在一个 m4s 里，用总大小区分 */
const M4S_MIN = 2 * 1024 * 1024;

export function extOf(url: string): string {
  try {
    const path = new URL(url).pathname;
    const m = /\.([a-z0-9]{2,5})$/i.exec(path);
    return m ? m[1].toLowerCase() : '';
  } catch {
    return '';
  }
}

/** Content-Range 里的总大小，没有就用 Content-Length（只对 200 响应有意义） */
export function totalSize(headers: { name: string; value?: string }[] | undefined, status = 200): number | undefined {
  let len: number | undefined;
  for (const h of headers ?? []) {
    const n = h.name.toLowerCase();
    if (n === 'content-range') {
      const m = /\/(\d+)\s*$/.exec(h.value ?? '');
      if (m) return Number(m[1]);
    } else if (n === 'content-length' && status === 200) {
      const v = Number(h.value);
      if (Number.isFinite(v)) len = v;
    }
  }
  return len;
}

export function headerValue(headers: { name: string; value?: string }[] | undefined, name: string): string {
  return headers?.find((h) => h.name.toLowerCase() === name)?.value ?? '';
}

export interface DetectOptions {
  types: Record<MediaKind, boolean>;
  minBytes: number;
}

export function detect(url: string, contentType: string, size: number | undefined, opt: DetectOptions): Detected | null {
  if (!/^https?:/i.test(url)) return null;
  const mime = contentType.split(';')[0].trim().toLowerCase();
  const ext = extOf(url);
  let kind: MediaKind | undefined;
  let outExt = ext;

  if (HLS_MIME.has(mime) || ext === 'm3u8') {
    kind = 'hls';
    outExt = 'm3u8';
  } else if (DASH_MIME.has(mime) || ext === 'mpd') {
    kind = 'dash';
    outExt = 'mpd';
  } else if (SEGMENT_MIME.has(mime) || ext === 'ts') {
    return null;
  } else if (ext === 'm4s') {
    if ((size ?? 0) < M4S_MIN) return null;
    kind = 'video';
  } else if (mime.startsWith('video/') || mime.startsWith('audio/') || mime.startsWith('image/')) {
    kind = mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'image';
    // 地址里的扩展名和类型一致时用地址里的，否则按类型取
    if (!ext || EXT_KIND[ext] !== kind) outExt = MIME_EXT[mime] ?? (kind === 'audio' ? 'mp3' : kind === 'image' ? 'jpg' : 'mp4');
  } else if (GENERIC_MIME.has(mime) && EXT_KIND[ext]) {
    kind = EXT_KIND[ext];
  }
  if (!kind || !opt.types[kind]) return null;
  if (kind !== 'hls' && kind !== 'dash' && size !== undefined && size < opt.minBytes) return null;
  // 大小未知的图片多半是小图标，不列
  if (kind === 'image' && size === undefined) return null;
  return { kind, ext: outExt };
}

/** 商店版不对 YouTube 做任何嗅探（应用商店政策），完整版由 YouTube 适配器接管 */
export function isYouTubeHost(host: string): boolean {
  return /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com|googlevideo\.com|ytimg\.com)$/i.test(host);
}

export function hostOf(url: string | undefined): string {
  try {
    return url ? new URL(url).hostname : '';
  } catch {
    return '';
  }
}
