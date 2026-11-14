import { describe, expect, it } from 'vitest';
import { buildState, compareVersions, hasUpdate, parseChanges, pickAsset, type GhRelease } from '../../src/update/check';

const NOTES = `## Drak 0.3.0.15

相对上一个包（v0.3.0.14）的调整：

- 插件内置检查更新（#31）
  - 设置页加“版本与更新”
  - 弹窗底部加“检查更新”
- 修复百度首页暗色（#28）

### 安装

- 下载 zip 解压后加载
`;

function rel(tag: string, body = '', extra: Partial<GhRelease> = {}): GhRelease {
  return {
    tag_name: tag,
    body,
    html_url: `https://github.com/fixcode-h/DarkWeb/releases/tag/${tag}`,
    assets: [
      { name: `drak-${tag.slice(1)}-store.zip`, browser_download_url: `https://x/${tag}-store.zip` },
      { name: `drak-${tag.slice(1)}.zip`, browser_download_url: `https://x/${tag}.zip` },
    ],
    ...extra,
  };
}

describe('检查更新', () => {
  it('按数字比较版本，缺的位按 0 算', () => {
    expect(compareVersions('v0.3.0.15', '0.3.0.14')).toBeGreaterThan(0);
    expect(compareVersions('0.3.0.9', '0.3.0.10')).toBeLessThan(0);
    expect(compareVersions('0.3.0', '0.3.0.0')).toBe(0);
    expect(compareVersions('0.3.0.1', '0.3.0')).toBeGreaterThan(0);
  });

  it('改动列表只取列表项，跳过“安装”一节', () => {
    expect(parseChanges(NOTES)).toEqual([
      { text: '插件内置检查更新（#31）', level: 0 },
      { text: '设置页加“版本与更新”', level: 1 },
      { text: '弹窗底部加“检查更新”', level: 1 },
      { text: '修复百度首页暗色（#28）', level: 0 },
    ]);
  });

  it('下载带 key 的包，不选商店版', () => {
    expect(pickAsset(rel('v0.3.0.15'))?.name).toBe('drak-0.3.0.15.zip');
  });

  it('列出比当前新的所有版本，新的在前，忽略草稿和预发布', () => {
    const s = buildState(
      [rel('v0.3.0.13'), rel('v0.3.0.15', NOTES), rel('v0.3.0.14'), rel('v0.3.0.16', '', { prerelease: true }), rel('v0.4.0.1', '', { draft: true })],
      '0.3.0.13',
      1,
    );
    expect(s.latest).toBe('0.3.0.15');
    expect(s.newer.map((r) => r.version)).toEqual(['0.3.0.15', '0.3.0.14']);
    expect(s.downloadName).toBe('drak-0.3.0.15.zip');
    expect(s.newer[0].changes).toHaveLength(4);
    expect(hasUpdate(s, '0.3.0.13')).toBe(true);
    // 已经装上新版后，旧的检查结果不再算有更新
    expect(hasUpdate(s, '0.3.0.15')).toBe(false);
  });

  it('已是最新时没有下载地址', () => {
    const s = buildState([rel('v0.3.0.14')], '0.3.0.14');
    expect(s.newer).toEqual([]);
    expect(s.downloadUrl).toBeNull();
    expect(hasUpdate(s, '0.3.0.14')).toBe(false);
  });
});
