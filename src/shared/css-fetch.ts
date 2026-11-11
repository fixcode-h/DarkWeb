/**
 * 拉取跨域样式表文本并展开一层 @import（构造样式表不支持 @import）。
 * 后台和内容脚本共用：后台不受 CORS 限制但请求不带页面的 Referer，
 * 有防盗链的 CDN（如少数派的 post.sspai.com）会拒绝；这时内容脚本以页面身份按 CORS 再拉一次。
 */
import type { FetchCssResponse } from './messages';

export const MAX_CSS_BYTES = 4 * 1024 * 1024;
export const FETCH_TIMEOUT = 8000;

export async function fetchWithLimit(url: string, maxBytes: number, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const len = Number(res.headers.get('content-length') || 0);
    if (len > maxBytes) throw new Error('too large');
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchCssText(url: string, init: RequestInit): Promise<FetchCssResponse> {
  if (!/^https?:/i.test(url)) return { ok: false, error: 'bad url' };
  try {
    const res = await fetchWithLimit(url, MAX_CSS_BYTES, init);
    let text = await res.text();
    if (text.length > MAX_CSS_BYTES) return { ok: false, error: 'too large' };
    const imports = Array.from(text.matchAll(/@import\s+(?:url\()?\s*["']?([^"')\s;]+)["']?\s*\)?([^;]*);/g));
    for (const m of imports.slice(0, 10)) {
      try {
        const child = new URL(m[1], url).href;
        const r = await fetchWithLimit(child, MAX_CSS_BYTES, init);
        let t = await r.text();
        const media = m[2].trim();
        if (media && !/^layer/.test(media)) t = `@media ${media} {\n${t}\n}`;
        text = t + '\n' + text;
      } catch {
        /* 子表失败就跳过 */
      }
    }
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
