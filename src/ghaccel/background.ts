/**
 * GitHub 加速下载的后台部分：点“加速”时探一下节点通不通（内容脚本跨域请求会被拦，放在后台做）。
 * 结果缓存 5 分钟，连点多个附件不会反复探。由 sw.ts 以 import 引入。
 */
import { normalizeNodeUrl } from './settings';

const TTL = 5 * 60 * 1000;
const TIMEOUT = 3000;
const cache = new Map<string, { ok: boolean; at: number }>();

export async function probeNode(node: string): Promise<boolean> {
  const hit = cache.get(node);
  if (hit && Date.now() - hit.at < TTL) return hit.ok;
  let ok: boolean;
  try {
    const r = await fetch(node, { method: 'HEAD', cache: 'no-store', credentials: 'omit', redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT) });
    ok = r.status < 500;
  } catch {
    ok = false;
  }
  cache.set(node, { ok, at: Date.now() });
  return ok;
}

chrome.runtime.onMessage.addListener((msg: { type?: string; node?: unknown }, _sender, sendResponse) => {
  if (msg?.type !== 'gha:probe') return false;
  const node = normalizeNodeUrl(msg.node);
  // 只探规范的 https 节点地址
  if (!node || node !== msg.node) {
    sendResponse({ ok: true });
    return false;
  }
  probeNode(node).then((ok) => sendResponse({ ok }));
  return true;
});
