import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { detect, isYouTubeHost, totalSize } from '../../src/sniff/detect';
import { DEFAULT_SNIFF, normalizeSniff, renderFilename, sanitizeName } from '../../src/sniff/settings';
import { parseM3u8, seqIv } from '../../src/sniff/hls';
import { fillTemplate, parseDuration, parseMpd } from '../../src/sniff/dash';
import { children, mergeFmp4, scan } from '../../src/sniff/mp4';

const media = join(__dirname, '../fixtures/media');
const opt = { types: DEFAULT_SNIFF.types, minBytes: 200 * 1024 };

describe('资源嗅探：识别', () => {
  it('按类型和扩展名识别', () => {
    expect(detect('https://a.com/v.mp4?x=1', 'video/mp4', 5e6, opt)).toEqual({ kind: 'video', ext: 'mp4' });
    expect(detect('https://a.com/play', 'application/vnd.apple.mpegurl', undefined, opt)).toEqual({ kind: 'hls', ext: 'm3u8' });
    expect(detect('https://a.com/x/master.m3u8', 'text/plain', 300, opt)?.kind).toBe('hls');
    expect(detect('https://a.com/m.mpd', 'application/dash+xml', 1000, opt)?.kind).toBe('dash');
    expect(detect('https://a.com/s.mp3', 'application/octet-stream', 3e6, opt)).toEqual({ kind: 'audio', ext: 'mp3' });
    expect(detect('https://a.com/stream', 'audio/mpeg', 3e6, opt)).toEqual({ kind: 'audio', ext: 'mp3' });
  });
  it('分片、小文件、图片默认不列', () => {
    expect(detect('https://a.com/seg1.ts', 'video/mp2t', 1e6, opt)).toBeNull();
    expect(detect('https://a.com/ad.mp4', 'video/mp4', 50_000, opt)).toBeNull();
    expect(detect('https://a.com/chunk-1.m4s', 'video/iso.segment', 600_000, opt)).toBeNull();
    expect(detect('https://a.com/x.jpg', 'image/jpeg', 5e6, opt)).toBeNull();
    expect(detect('blob:https://a.com/1', 'video/mp4', 5e6, opt)).toBeNull();
  });
  it('B 站那样的大 m4s 算视频', () => {
    expect(detect('https://upos.bilivideo.com/x/123-1-30080.m4s?e=1', 'video/mp4', 80e6, opt)?.ext).toBe('m4s');
  });
  it('从 Content-Range 取总大小', () => {
    expect(totalSize([{ name: 'Content-Range', value: 'bytes 0-999/123456' }, { name: 'content-length', value: '1000' }], 206)).toBe(123456);
    expect(totalSize([{ name: 'content-length', value: '1000' }], 206)).toBeUndefined();
    expect(totalSize([{ name: 'content-length', value: '1000' }])).toBe(1000);
  });
  it('YouTube 相关域名', () => {
    expect(isYouTubeHost('www.youtube.com')).toBe(true);
    expect(isYouTubeHost('rr3---sn-x.googlevideo.com')).toBe(true);
    expect(isYouTubeHost('notyoutube.com')).toBe(false);
  });
});

describe('资源嗅探：设置与文件名', () => {
  it('非法值回到默认', () => {
    expect(normalizeSniff(undefined)).toEqual(DEFAULT_SNIFF);
    const s = normalizeSniff({ enabled: true, concurrency: 7, minSizeKB: -1, bili: { codec: 'x' } });
    expect(s.enabled).toBe(true);
    expect(s.concurrency).toBe(6);
    expect(s.minSizeKB).toBe(200);
    expect(s.bili.codec).toBe('avc');
  });
  it('文件名去掉非法字符', () => {
    expect(sanitizeName('a/b:c*d?"<>|. ')).toBe('a／b：c＊d？＂＜＞｜');
    expect(sanitizeName('con')).toBe('_con');
  });
  it('模板里没有值的变量连同分隔符去掉', () => {
    expect(renderFilename('{标题} - {分P}', { 标题: '小森林' })).toBe('小森林');
    expect(renderFilename('{标题} - {分P}.{扩展名}', { 标题: '小森林', 分P: 'P2 浇水' })).toBe('小森林 - P2 浇水');
    expect(renderFilename('{日期} {标题}', { 标题: 'x' }, new Date(2026, 0, 5))).toBe('2026-01-05 x');
  });
});

describe('资源嗅探：HLS', () => {
  it('主列表按清晰度排序', () => {
    const p = parseM3u8('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360\nlow/i.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080,AUDIO="a"\nhi/i.m3u8\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="中文",DEFAULT=YES,URI="aud/i.m3u8"', 'https://x.com/v/master.m3u8');
    expect(p.type).toBe('master');
    if (p.type !== 'master') return;
    expect(p.variants[0]).toMatchObject({ url: 'https://x.com/v/hi/i.m3u8', height: 1080, audio: 'a' });
    expect(p.media[0].url).toBe('https://x.com/v/aud/i.m3u8');
  });
  it('AES-128 加密列表', () => {
    const p = parseM3u8(readFileSync(join(media, 'hls-aes/index.m3u8'), 'utf8'), 'https://x.com/h/index.m3u8');
    if (p.type !== 'media') throw new Error();
    expect(p.live).toBe(false);
    expect(p.drm).toBe(false);
    expect(p.segments).toHaveLength(3);
    expect(p.segments[0].key?.url).toBe('https://x.com/h/key.bin');
    expect(p.segments[0].key?.iv?.[15]).toBe(1);
  });
  it('SAMPLE-AES / 非 identity 密钥算 DRM', () => {
    const p = parseM3u8('#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://x",KEYFORMAT="com.apple.streamingkeydelivery"\n#EXTINF:4,\na.ts\n#EXT-X-ENDLIST', 'https://x.com/');
    expect(p.type === 'media' && p.drm).toBe(true);
  });
  it('fMP4 分片带 EXT-X-MAP，BYTERANGE', () => {
    const p = parseM3u8('#EXTM3U\n#EXT-X-MAP:URI="v.mp4",BYTERANGE="800@0"\n#EXTINF:2,\n#EXT-X-BYTERANGE:1000@800\nv.mp4\n#EXTINF:2,\n#EXT-X-BYTERANGE:1200\nv.mp4\n#EXT-X-ENDLIST', 'https://x.com/a/');
    if (p.type !== 'media') throw new Error();
    expect(p.fmp4).toBe(true);
    expect(p.segments[0].map).toEqual({ url: 'https://x.com/a/v.mp4', range: { length: 800, offset: 0 } });
    expect(p.segments[1].range).toEqual({ length: 1200, offset: 1800 });
  });
  it('默认 IV 是分片序号', () => {
    expect([...seqIv(258).slice(12)]).toEqual([0, 0, 1, 2]);
  });
});

describe('资源嗅探：DASH', () => {
  it('时长与模板', () => {
    expect(parseDuration('PT1H2M3.5S')).toBe(3723.5);
    expect(fillTemplate('c-$RepresentationID$-$Number%05d$-$Time$-$$.m4s', { id: 'v1', bandwidth: 1, number: 7, time: 900 })).toBe('c-v1-00007-900-$.m4s');
  });
  it('解析 ffmpeg 生成的 SegmentTimeline', () => {
    const m = parseMpd(readFileSync(join(media, 'dash/stream.mpd'), 'utf8'), 'https://x.com/d/stream.mpd');
    expect(m.live).toBe(false);
    expect(m.videos[0].init?.url).toBe('https://x.com/d/init-stream0.m4s');
    expect(m.videos[0].segments.map((s) => s.url.split('/').pop())).toEqual(['chunk-stream0-00001.m4s', 'chunk-stream0-00002.m4s', 'chunk-stream0-00003.m4s']);
    expect(m.audios[0].segments).toHaveLength(4);
  });
  it('BaseURL、SegmentList、DRM', () => {
    const m = parseMpd(`<?xml version="1.0"?><MPD type="static" mediaPresentationDuration="PT10S"><BaseURL>https://cdn.x.com/v/</BaseURL><Period>
      <AdaptationSet mimeType="video/mp4"><ContentProtection schemeIdUri="urn:uuid:edef8ba9"/><Representation id="v" bandwidth="1" height="720"><BaseURL>v.mp4</BaseURL><SegmentBase indexRange="0-100"/></Representation></AdaptationSet>
      <AdaptationSet mimeType="audio/mp4"><Representation id="a" bandwidth="2"><SegmentList><Initialization sourceURL="a/init.mp4"/><SegmentURL media="a/1.m4s"/><SegmentURL media="a/2.m4s"/></SegmentList></Representation></AdaptationSet>
    </Period></MPD>`, 'https://x.com/m.mpd');
    expect(m.videos[0]).toMatchObject({ drm: true, segments: [{ url: 'https://cdn.x.com/v/v.mp4' }] });
    expect(m.audios[0].init?.url).toBe('https://cdn.x.com/v/a/init.mp4');
    expect(m.audios[0].segments[1].url).toBe('https://cdn.x.com/v/a/2.m4s');
  });
});

describe('资源嗅探：合并分片 MP4', () => {
  it('视频轨和音频轨合成一个文件', async () => {
    const v = new Blob([readFileSync(join(media, 'track-video.m4s'))]);
    const a = new Blob([readFileSync(join(media, 'track-audio.m4s'))]);
    const info = { tracks: 0, fragments: 0 };
    const out = await mergeFmp4([v, a], info);
    expect(info.tracks).toBe(2);
    const boxes = await scan(out);
    expect(boxes[0].type).toBe('ftyp');
    expect(boxes[1].type).toBe('moov');
    const moov = new Uint8Array(await out.slice(boxes[1].start, boxes[1].start + boxes[1].size).arrayBuffer());
    expect(children(moov, 8).filter((b) => b.type === 'trak')).toHaveLength(2);
    expect(boxes.filter((b) => b.type === 'moof').length).toBe(info.fragments);
    // 有 ffprobe 时再确认一遍真能解出两路流、时长 3 秒
    let probe = '';
    try {
      const file = join(tmpdir(), `drak-merge-${process.pid}.mp4`);
      writeFileSync(file, new Uint8Array(await out.arrayBuffer()));
      probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type:format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
    } catch {
      return;
    }
    expect(probe).toMatch(/video/);
    expect(probe).toMatch(/audio/);
    expect(Number(probe.trim().split('\n').pop())).toBeGreaterThan(2.5);
  });
  it('DASH 分片拼接后合并', async () => {
    const part = (f: string) => readFileSync(join(media, 'dash', f));
    const v = new Blob(['init-stream0.m4s', 'chunk-stream0-00001.m4s', 'chunk-stream0-00002.m4s', 'chunk-stream0-00003.m4s'].map(part));
    const a = new Blob(['init-stream1.m4s', 'chunk-stream1-00001.m4s', 'chunk-stream1-00002.m4s', 'chunk-stream1-00003.m4s', 'chunk-stream1-00004.m4s'].map(part));
    const info = { tracks: 0, fragments: 0 };
    await mergeFmp4([v, a], info);
    expect(info).toEqual({ tracks: 2, fragments: 7 });
  });
});
