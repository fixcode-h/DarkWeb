import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { isWebm, mergeWebm } from '../../src/sniff/webm';

const media = join(__dirname, '../fixtures/media');
const load = (f: string) => new Blob([readFileSync(join(media, f))]);

function probe(buf: Uint8Array): string | null {
  const file = join(tmpdir(), `drak-webm-${Date.now()}.webm`);
  writeFileSync(file, buf);
  try {
    return execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name:format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  } catch (e) {
    // 没装 ffprobe 时跳过这一步；装了但解析失败要报出来
    if ((e as { code?: string }).code === 'ENOENT') return null;
    throw e;
  }
}

describe('WebM 合并', () => {
  it('视频 + 音频合成一个文件，两路流都在', async () => {
    const out = new Uint8Array(await (await mergeWebm([load('track-video.webm'), load('track-audio.webm')])).arrayBuffer());
    expect(isWebm(out)).toBe(true);
    const p = probe(out);
    if (p !== null) {
      expect(p).toContain('vp9');
      expect(p).toContain('opus');
      expect(Number(p.trim().split('\n').pop())).toBeGreaterThan(2.5);
    }
  });

  it('边播边录的流：初始化数据和分段重复出现时去重', async () => {
    const v = readFileSync(join(media, 'track-video.webm'));
    const twice = new Blob([v, v]);
    const out = new Uint8Array(await (await mergeWebm([twice, load('track-audio.webm')])).arrayBuffer());
    const once = new Uint8Array(await (await mergeWebm([load('track-video.webm'), load('track-audio.webm')])).arrayBuffer());
    expect(out.length).toBe(once.length);
  });

  it('不是 WebM 时报错', async () => {
    await expect(mergeWebm([load('track-video.m4s')])).rejects.toThrow('不是有效的 WebM');
  });
});
