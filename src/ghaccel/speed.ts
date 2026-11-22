/**
 * 节点测速：经节点取一个很小的 GitHub 文件，记下耗时。只在用户点“测速”时运行。
 * 结果存起来，弹窗和设置页显示上次测速的延迟。
 */
export const SPEED_KEY = 'ghaccelSpeed';
/** 测速用的小文件（几 KB），走一遍完整的代理链路 */
const SAMPLE = 'https://raw.githubusercontent.com/github/gitignore/main/README.md';
const TIMEOUT = 8000;

export interface SpeedResult {
  /** 节点地址 → 毫秒；-1 表示失败或超时 */
  ms: Record<string, number>;
  at: number;
}

export async function measure(node: string): Promise<number> {
  const t0 = performance.now();
  try {
    const r = await fetch(`${node}${SAMPLE}`, { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(TIMEOUT) });
    if (!r.ok) return -1;
    await r.arrayBuffer();
    return Math.max(1, Math.round(performance.now() - t0));
  } catch {
    return -1;
  }
}

export async function loadSpeed(): Promise<SpeedResult | null> {
  const d = await chrome.storage.local.get(SPEED_KEY);
  const v = d[SPEED_KEY] as SpeedResult | undefined;
  return v && typeof v === 'object' && v.ms ? v : null;
}

export async function measureAll(nodes: string[]): Promise<SpeedResult> {
  const entries = await Promise.all(nodes.map(async (n) => [n, await measure(n)] as const));
  const result = { ms: Object.fromEntries(entries), at: Date.now() };
  await chrome.storage.local.set({ [SPEED_KEY]: result });
  return result;
}

export function speedText(ms: number | undefined): string {
  if (ms === undefined) return '';
  return ms < 0 ? '不可用' : `${ms} ms`;
}

export function speedLevel(ms: number | undefined): 'good' | 'mid' | 'bad' | '' {
  if (ms === undefined) return '';
  if (ms < 0) return 'bad';
  return ms < 800 ? 'good' : ms < 2000 ? 'mid' : 'bad';
}
