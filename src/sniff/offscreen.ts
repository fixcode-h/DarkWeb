/**
 * 离屏文档：下载 HLS / DASH 分片、AES-128 解密、TS 转 MP4、合并音视频，最后生成 Blob 交给后台保存。
 * 放在这里而不是 Service Worker 里：Service Worker 会被浏览器随时回收，长任务在这里才稳。
 */
import { Transmuxer } from 'mux.js/lib/mp4/transmuxer.js';
import { parseM3u8, seqIv, type ByteRange, type HlsSegment } from './hls';
import { parseMpd, type DashTrack } from './dash';
import { mergeFmp4 } from './mp4';
import type { FromOffscreen, Job, OffscreenMsg, Stage } from './jobs';

const running = new Map<string, AbortController>();

function send(msg: FromOffscreen): Promise<unknown> {
  return chrome.runtime.sendMessage(msg).catch(() => undefined);
}

class Canceled extends Error {}

class Progress {
  private last = 0;
  done = 0;
  total = 0;
  bytes = 0;
  stage: Stage = 'download';
  constructor(private readonly id: string) {}
  set(stage: Stage, total?: number): void {
    this.stage = stage;
    if (total !== undefined) {
      this.total = total;
      this.done = 0;
    }
    this.flush(true);
  }
  add(bytes: number): void {
    this.done++;
    this.bytes += bytes;
    this.flush();
  }
  flush(force = false): void {
    const now = Date.now();
    if (!force && now - this.last < 300) return;
    this.last = now;
    void send({ type: 'sniff:progress', id: this.id, stage: this.stage, done: this.done, total: this.total, bytes: this.bytes });
  }
}

async function fetchBytes(url: string, signal: AbortSignal, range?: ByteRange): Promise<Uint8Array> {
  let err: unknown;
  for (let i = 0; i < 4; i++) {
    if (signal.aborted) throw new Canceled();
    try {
      const headers: HeadersInit = range ? { Range: `bytes=${range.offset}-${range.offset + range.length - 1}` } : {};
      const res = await fetch(url, { credentials: 'include', signal, headers, cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      if (signal.aborted) throw new Canceled();
      err = e;
      if (/HTTP (401|403|404|410)/.test(String(e))) break;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
  throw new Error(`下载失败：${err instanceof Error ? err.message : String(err)}（${new URL(url).host}）`);
}

const CHUNK = 4 << 20;

/**
 * 分段下载一个大文件：先请求开头一段拿到总大小，剩下的按 4 MB 一段并发下载。
 * 有的 CDN（B 站）不带 Range 的整文件请求直接拒绝，分段也更快、出错重试的代价更小。
 */
async function fetchChunked(url: string, signal: AbortSignal, conc: number, p: Progress): Promise<Blob> {
  let first: Response | null = null;
  let err: unknown;
  for (let i = 0; i < 3 && !first; i++) {
    if (signal.aborted) throw new Canceled();
    try {
      const res = await fetch(url, { credentials: 'include', signal, headers: { Range: `bytes=0-${CHUNK - 1}` }, cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      first = res;
    } catch (e) {
      if (signal.aborted) throw new Canceled();
      err = e;
      if (/HTTP (401|403|404|410)/.test(String(e))) break;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
  if (!first) throw new Error(`下载失败：${err instanceof Error ? err.message : String(err)}（${new URL(url).host}）`);
  const head = new Uint8Array(await first.arrayBuffer());
  const total = Number(/\/(\d+)$/.exec(first.headers.get('content-range') ?? '')?.[1]);
  // 服务器不支持 Range，直接给了整个文件
  if (first.status === 200 || !total || head.length >= total) {
    p.total++;
    p.add(head.length);
    return new Blob([head as BlobPart]);
  }
  const ranges: ByteRange[] = [];
  for (let o = head.length; o < total; o += CHUNK) ranges.push({ offset: o, length: Math.min(CHUNK, total - o) });
  p.total += ranges.length + 1;
  p.add(head.length);
  const parts = await pool(ranges, conc, signal, async (r) => {
    const d = await fetchBytes(url, signal, r);
    p.add(d.length);
    return d;
  });
  return new Blob([head as BlobPart, ...(parts as BlobPart[])]);
}

async function fetchText(url: string, signal: AbortSignal): Promise<string> {
  return new TextDecoder().decode(await fetchBytes(url, signal));
}

/** 按顺序返回结果的并发池 */
async function pool<T, R>(items: T[], n: number, signal: AbortSignal, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      if (signal.aborted) throw new Canceled();
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

function hostsOf(urls: string[]): string[] {
  return [...new Set(urls.map((u) => new URL(u).hostname))];
}

/** 让后台给这些域名的请求补上原页面的 Referer，然后再下载 */
async function allowHosts(id: string, urls: string[]): Promise<void> {
  await send({ type: 'sniff:hosts', id, hosts: hostsOf(urls) });
}

// ---- HLS ----

async function hlsTrack(job: Job, url: string, signal: AbortSignal, p: Progress, offset: number): Promise<{ parts: Uint8Array[]; fmp4: boolean; segs: number }> {
  const pl = parseM3u8(await fetchText(url, signal), url);
  if (pl.type !== 'media') throw new Error('播放列表格式不对');
  if (pl.drm) throw new Error('加密内容（DRM），无法下载');
  if (pl.live) throw new Error('这是直播流，暂不支持下载');
  if (!pl.segments.length) throw new Error('播放列表里没有分片');
  const keyUrls = [...new Set(pl.segments.map((s) => s.key?.url).filter((u): u is string => !!u))];
  const mapKeys = [...new Map(pl.segments.filter((s) => s.map).map((s) => [`${s.map!.url}|${s.map!.range?.offset}`, s.map!])).values()];
  await allowHosts(job.id, [...pl.segments.map((s) => s.url), ...keyUrls, ...mapKeys.map((m) => m.url)]);
  const keys = new Map<string, CryptoKey>();
  for (const k of keyUrls) {
    const raw = await fetchBytes(k, signal);
    if (raw.length !== 16) throw new Error('AES-128 密钥长度不对');
    keys.set(k, await crypto.subtle.importKey('raw', raw, 'AES-CBC', false, ['decrypt']));
  }
  const inits = new Map<string, Uint8Array>();
  for (const m of mapKeys) inits.set(`${m.url}|${m.range?.offset}`, await fetchBytes(m.url, signal, m.range));
  p.total = offset + pl.segments.length;
  const decrypt = async (s: HlsSegment, data: Uint8Array) => {
    if (!s.key) return data;
    const key = keys.get(s.key.url)!;
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv: s.key.iv ?? seqIv(s.seq) }, key, data));
  };
  const segs = await pool(pl.segments, job.concurrency, signal, async (s) => {
    const data = await decrypt(s, await fetchBytes(s.url, signal, s.range));
    p.add(data.length);
    return data;
  });
  const parts: Uint8Array[] = [];
  let lastMap = '';
  pl.segments.forEach((s, i) => {
    const mk = s.map ? `${s.map.url}|${s.map.range?.offset}` : '';
    // 初始化段只在第一次出现或换了的时候写（码率切换的列表会换）
    if (mk && mk !== lastMap) parts.push(inits.get(mk)!);
    lastMap = mk;
    parts.push(segs[i]);
  });
  return { parts, fmp4: pl.fmp4, segs: pl.segments.length };
}

function transmux(parts: Uint8Array[]): Uint8Array[] {
  const out: Uint8Array[] = [];
  const t = new Transmuxer({ remux: true });
  let first = true;
  t.on('data', (seg) => {
    if (first) out.push(new Uint8Array(seg.initSegment));
    first = false;
    out.push(new Uint8Array(seg.data));
  });
  for (const p of parts) {
    t.push(p);
    t.flush();
  }
  return out;
}

async function runHls(job: Job, signal: AbortSignal, p: Progress): Promise<FromOffscreen & { type: 'sniff:save' }> {
  await allowHosts(job.id, [job.url]);
  const top = parseM3u8(await fetchText(job.url, signal), job.url);
  let videoUrl = job.url;
  let audioUrl: string | undefined;
  if (top.type === 'master') {
    const v = top.variants[0];
    if (!v) throw new Error('主播放列表里没有可用的码率');
    videoUrl = v.url;
    const group = top.media.filter((m) => m.type === 'AUDIO' && m.group === v.audio && m.url);
    audioUrl = (group.find((m) => m.isDefault) ?? group[0])?.url;
  }
  p.set('download', 0);
  const video = await hlsTrack(job, videoUrl, signal, p, 0);
  const audio = audioUrl ? await hlsTrack(job, audioUrl, signal, p, video.segs) : undefined;
  p.set('merge');
  if (video.fmp4) {
    const v = new Blob(video.parts as BlobPart[]);
    const out = audio?.fmp4 ? await mergeFmp4([v, new Blob(audio.parts as BlobPart[])]) : v;
    return save(job, [{ blob: out, ext: 'mp4' }]);
  }
  const mp4 = transmux(video.parts);
  if (!mp4.length) {
    // mux.js 只认 H.264 / AAC；别的编码原样保存 TS，播放器一般都能播
    return save(job, [{ blob: new Blob(video.parts as BlobPart[], { type: 'video/mp2t' }), ext: 'ts' }], '编码不是 H.264 / AAC，已原样保存为 TS 文件');
  }
  let out = new Blob(mp4 as BlobPart[], { type: 'video/mp4' });
  if (audio) {
    const a = audio.fmp4 ? new Blob(audio.parts as BlobPart[]) : new Blob(transmux(audio.parts) as BlobPart[]);
    out = await mergeFmp4([out, a]);
  }
  return save(job, [{ blob: out, ext: 'mp4' }]);
}

// ---- DASH ----

const isWebm = (t: DashTrack) => /webm/i.test(t.mime ?? '') || /\.webm(\?|$)/i.test(t.init?.url ?? t.segments[0]?.url ?? '');

async function dashTrack(job: Job, t: DashTrack, signal: AbortSignal, p: Progress): Promise<Blob> {
  const list = [...(t.init ? [t.init] : []), ...t.segments];
  await allowHosts(job.id, list.map((s) => s.url));
  const parts = await pool(list, job.concurrency, signal, async (s) => {
    const d = await fetchBytes(s.url, signal, s.range);
    p.add(d.length);
    return d;
  });
  return new Blob(parts as BlobPart[]);
}

async function runDash(job: Job, signal: AbortSignal, p: Progress): Promise<FromOffscreen & { type: 'sniff:save' }> {
  await allowHosts(job.id, [job.url]);
  const m = parseMpd(await fetchText(job.url, signal), job.url);
  if (m.live) throw new Error('这是直播流，暂不支持下载');
  const video = m.videos.find((v) => !v.drm);
  if (!video && !m.audios.find((a) => !a.drm)) throw new Error(m.videos.length || m.audios.length ? '加密内容（DRM），无法下载' : 'MPD 里没有音视频轨道');
  if (video && m.videos[0].drm) throw new Error('加密内容（DRM），无法下载');
  // 音频尽量选和视频同一种封装
  const audios = m.audios.filter((a) => !a.drm);
  const audio = video ? (audios.find((a) => isWebm(a) === isWebm(video)) ?? audios[0]) : audios[0];
  const tracks = [video, audio].filter((t): t is DashTrack => !!t);
  p.set('download', tracks.reduce((n, t) => n + t.segments.length + (t.init ? 1 : 0), 0));
  const blobs: Blob[] = [];
  for (const t of tracks) blobs.push(await dashTrack(job, t, signal, p));
  p.set('merge');
  const webm = tracks.map(isWebm);
  if (!webm.some(Boolean)) return save(job, [{ blob: await mergeFmp4(blobs), ext: tracks.length > 1 || video ? 'mp4' : 'm4a' }]);
  // WebM 的音视频合并要用 ffmpeg.wasm（只在完整版），这里分两个文件保存
  return save(
    job,
    tracks.map((t, i) => ({ blob: blobs[i], ext: webm[i] ? (t.kind === 'video' ? 'webm' : 'weba') : t.kind === 'video' ? 'mp4' : 'm4a', suffix: tracks.length > 1 ? (t.kind === 'video' ? '（视频）' : '（音频）') : undefined })),
    tracks.length > 1 ? 'WebM 格式的音视频分成了两个文件保存' : undefined,
  );
}

// ---- 整个文件的音视频轨（站点适配器给出的） ----

async function runTracks(job: Job, signal: AbortSignal, p: Progress): Promise<FromOffscreen & { type: 'sniff:save' }> {
  const urls = job.tracks ?? [];
  await allowHosts(job.id, [...urls, ...(job.backups ?? []).flat()]);
  p.set('download', 0);
  const blobs: Blob[] = [];
  for (const [i, u] of urls.entries()) {
    let d: Blob | null = null;
    let err: unknown;
    for (const alt of [u, ...(job.backups?.[i] ?? [])]) {
      const mark = { total: p.total, done: p.done, bytes: p.bytes };
      try {
        d = await fetchChunked(alt, signal, job.concurrency, p);
        break;
      } catch (e) {
        if (e instanceof Canceled || signal.aborted) throw new Canceled();
        err = e;
        // 换备用地址重新下载这一条，进度退回去
        Object.assign(p, mark);
      }
    }
    if (!d) throw err;
    blobs.push(d);
  }
  p.set('merge');
  return save(job, [{ blob: await mergeFmp4(blobs), ext: 'mp4' }]);
}

function save(job: Job, files: { blob: Blob; ext: string; suffix?: string }[], note?: string): FromOffscreen & { type: 'sniff:save' } {
  return { type: 'sniff:save', id: job.id, files: files.map((f) => ({ url: URL.createObjectURL(f.blob), ext: f.ext, suffix: f.suffix })), note };
}

async function run(job: Job): Promise<void> {
  const ac = new AbortController();
  running.set(job.id, ac);
  const p = new Progress(job.id);
  try {
    const r = job.kind === 'hls' ? await runHls(job, ac.signal, p) : job.kind === 'dash' ? await runDash(job, ac.signal, p) : await runTracks(job, ac.signal, p);
    if (ac.signal.aborted) throw new Canceled();
    p.set('save');
    await send(r);
  } catch (e) {
    const canceled = e instanceof Canceled || ac.signal.aborted;
    await send({ type: 'sniff:error', id: job.id, error: canceled ? '已取消' : e instanceof Error ? e.message : String(e), canceled });
  } finally {
    running.delete(job.id);
  }
}

chrome.runtime.onMessage.addListener((msg: OffscreenMsg, _s, reply) => {
  if (msg?.target !== 'sniff-offscreen') return false;
  if (msg.type === 'run') void run(msg.job);
  else if (msg.type === 'cancel') running.get(msg.id)?.abort();
  else if (msg.type === 'revoke') URL.revokeObjectURL(msg.url);
  reply({ ok: true, running: running.size });
  return false;
});
