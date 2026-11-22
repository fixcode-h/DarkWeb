import { describe, expect, it } from 'vitest';
import { md5 } from '../../src/sniff/md5';
import { mixinKey, signWbi } from '../../src/sniff/bili/wbi';
import { estimate, parsePlayurl, pickTrack, toSrt } from '../../src/sniff/bili/parse';
import { biliInfo, isBiliPage, pickAudio } from '../../src/sniff/site';
import type { BiliMedia } from '../../src/sniff/bili/api';

describe('B 站：签名', () => {
  it('md5', () => {
    expect(md5('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5('The quick brown fox jumps over the lazy dog')).toBe('9e107d9d372bb6826bd81d3542a419d6');
    expect(md5('中文'.repeat(40))).toHaveLength(32);
  });

  it('WBI 签名和文档示例一致', () => {
    const key = mixinKey('https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png', 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png');
    expect(key).toBe('ea1db124af3c7062474693fa704f4ff8');
    expect(signWbi({ foo: '114', bar: '514', zab: 1919810 }, key, 1702204169000)).toBe('bar=514&foo=114&wts=1702204169&zab=1919810&w_rid=8f6f2b5b3d485fe1886cec6a0be8c5d4');
  });
});

/** 照着未登录时真实接口返回的结构裁剪 */
const PLAYURL = {
  timelength: 60_000,
  accept_quality: [116, 80, 64, 32, 16],
  accept_description: ['1080P 60帧', '1080P 高清', '720P 准高清', '480P 标清', '360P 流畅'],
  support_formats: [
    { quality: 116, new_description: '1080P 60帧', need_login: true },
    { quality: 80, new_description: '1080P 高清', need_login: true },
    { quality: 64, new_description: '720P 准高清', need_login: true },
    { quality: 32, new_description: '480P 标清' },
    { quality: 16, new_description: '360P 流畅' },
  ],
  dash: {
    duration: 60,
    video: [
      { id: 32, codecid: 7, codecs: 'avc1.64001F', baseUrl: 'https://upos.example/32-avc.m4s', backupUrl: ['https://bak/32-avc.m4s'], bandwidth: 400_000, width: 852, height: 480 },
      { id: 32, codecid: 12, codecs: 'hev1.1.6.L120.90', baseUrl: 'https://upos.example/32-hevc.m4s', bandwidth: 250_000, width: 852, height: 480 },
      { id: 32, codecid: 13, codecs: 'av01.0.04M.08', base_url: 'https://upos.example/32-av1.m4s', bandwidth: 200_000 },
      { id: 16, codecid: 7, codecs: 'avc1.64001E', baseUrl: 'https://upos.example/16-avc.m4s', bandwidth: 200_000 },
    ],
    audio: [
      { id: 30216, codecs: 'mp4a.40.2', baseUrl: 'https://upos.example/a64.m4s', bandwidth: 65_000 },
      { id: 30280, codecs: 'mp4a.40.2', baseUrl: 'https://upos.example/a192.m4s', bandwidth: 175_000 },
    ],
    flac: { audio: { id: 30251, codecs: 'fLaC', baseUrl: 'https://upos.example/flac.m4s', bandwidth: 900_000 } },
  },
};

describe('B 站：播放地址解析', () => {
  const s = parsePlayurl(PLAYURL);

  it('清晰度从高到低，拿不到的标原因', () => {
    expect(s.qualities.map((q) => q.qn)).toEqual([116, 80, 64, 32, 16]);
    expect(s.qualities.filter((q) => q.available).map((q) => q.qn)).toEqual([32, 16]);
    expect(s.qualities[0].reason).toBe('需大会员');
    expect(s.qualities[1].reason).toBe('需登录');
    expect(Object.keys(s.qualities[3].tracks).sort()).toEqual(['av1', 'avc', 'hevc']);
    expect(s.drm).toBe(false);
    expect(s.durationMs).toBe(60_000);
  });

  it('按偏好选编码，没有就退回 AVC', () => {
    const q32 = s.qualities[3];
    expect(pickTrack(q32, 'hevc')?.track.url).toBe('https://upos.example/32-hevc.m4s');
    expect(pickTrack(q32, 'smallest')?.codec).toBe('av1');
    expect(pickTrack(q32, 'av1')?.track.url).toBe('https://upos.example/32-av1.m4s');
    expect(pickTrack(s.qualities[4], 'hevc')?.codec).toBe('avc');
    expect(pickTrack(s.qualities[0], 'avc')).toBeNull();
  });

  it('音轨：标准音轨优先于无损', () => {
    expect(s.audios[0].label).toBe('Hi-Res 无损');
    expect(pickAudio({ streams: s })?.id).toBe(30280);
  });

  it('DRM 和试看', () => {
    expect(parsePlayurl({ ...PLAYURL, is_drm: true }).drm).toBe(true);
    expect(parsePlayurl({ video_info: PLAYURL, is_preview: 1 }).preview).toBe(true);
  });

  it('摘要里带预计大小', () => {
    const m: BiliMedia = { kind: 'video', title: 't', parts: [{ cid: 1, index: 1, title: '', bvid: 'BV1xx411c7mD' }], current: 0, streams: s };
    const info = biliInfo(m, 'avc');
    const q = info.qualities.find((x) => x.qn === 32)!;
    expect(q.codec).toBe('AVC');
    expect(q.size).toBe(estimate(400_000 + 175_000, 60_000));
    expect(info.audio).toBe('192K');
    expect(info.qualities[0].available).toBe(false);
  });
});

describe('B 站：其他', () => {
  it('识别视频和番剧页面', () => {
    expect(isBiliPage('https://www.bilibili.com/video/BV1xx411c7mD/?p=2')).toBe(true);
    expect(isBiliPage('https://www.bilibili.com/bangumi/play/ep12345')).toBe(true);
    expect(isBiliPage('https://www.bilibili.com/zh-Hans/video/BV1xx411c7mD/')).toBe(true);
    expect(isBiliPage('https://www.bilibili.com/')).toBe(false);
    expect(isBiliPage('https://evil.com/www.bilibili.com/video/BV1xx411c7mD')).toBe(false);
  });

  it('CC 字幕转 SRT', () => {
    expect(toSrt([{ from: 0.5, to: 2, content: '你好' }, { from: 3661.25, to: 3662, content: 'b' }])).toBe('1\n00:00:00,500 --> 00:00:02,000\n你好\n\n2\n01:01:01,250 --> 01:01:02,000\nb\n');
  });
});
