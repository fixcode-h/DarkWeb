/**
 * 清洗渲染出的 HTML 再放进页面。Markdown 里允许写 HTML（很多 README 用 <p align>、<details>、<img>），
 * 但不能让文件里的 <script>、onerror、javascript: 链接在页面里执行。
 * 和阅读模式的 sanitizeArticle 思路一样（惰性文档里解析、白名单过滤、importNode 复制），
 * 区别是这里要保留 id / class / data-line，并允许本地文件页面引用同目录的 file:// 图片和链接。
 */
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'FRAME', 'FRAMESET', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'LINK', 'META', 'BASE', 'NOSCRIPT', 'TEMPLATE', 'SLOT', 'APPLET', 'PORTAL']);
const ATTRS = new Set([
  'href', 'src', 'srcset', 'sizes', 'alt', 'title', 'width', 'height', 'colspan', 'rowspan', 'lang', 'dir', 'datetime', 'cite', 'start', 'reversed',
  'align', 'valign', 'open', 'id', 'class', 'name', 'role', 'aria-checked', 'aria-hidden', 'controls', 'poster', 'loop', 'muted',
  'data-line', 'data-task', 'data-lang',
  'viewbox', 'd', 'fill', 'stroke', 'stroke-width', 'cx', 'cy', 'r', 'x', 'y', 'rx', 'ry', 'points', 'transform', 'xmlns',
]);
const URL_ATTRS = new Set(['href', 'src', 'poster', 'cite']);

/** 允许的地址：http(s)、mailto、本页锚点；本地文件页面再加 file:；图片还允许 data:image */
export function safeUrl(v: string, base: string, isMedia: boolean): string | null {
  const raw = v.trim();
  if (raw.startsWith('#')) return raw;
  try {
    const u = new URL(raw, base);
    const p = u.protocol;
    if (p === 'http:' || p === 'https:') return u.href;
    if (p === 'file:' && base.startsWith('file:')) return u.href;
    if (!isMedia && p === 'mailto:') return u.href;
    if (isMedia && p === 'data:' && /^data:image\/(png|jpe?g|gif|webp|avif|bmp)[;,]/i.test(raw)) return raw;
  } catch {
    /* 坏地址 */
  }
  return null;
}

export function sanitizeMarkdownHtml(html: string, base: string): DocumentFragment {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}`, 'text/html');
  const walk = (root: ParentNode) => {
    for (const el of Array.from(root.children)) {
      if (DROP.has(el.tagName.toUpperCase())) {
        el.remove();
        continue;
      }
      for (const a of Array.from(el.attributes)) {
        const name = a.name.toLowerCase();
        if (!ATTRS.has(name)) {
          el.removeAttribute(a.name);
          continue;
        }
        if (URL_ATTRS.has(name)) {
          const u = safeUrl(a.value, base, name !== 'href');
          if (u) el.setAttribute(a.name, u);
          else el.removeAttribute(a.name);
        } else if (name === 'srcset') {
          const ok = a.value.split(',').every((part) => !!safeUrl(part.trim().split(/\s+/)[0] ?? '', base, true));
          if (!ok) el.removeAttribute(a.name);
        }
      }
      // SVG 里的 <a xlink:href> 已在上面去掉；<use> 引外部文件也不需要
      if (el.tagName === 'A') {
        const href = el.getAttribute('href') ?? '';
        if (href && !href.startsWith('#')) {
          // 链到别的 .md 在本页打开（同样会被渲染），其他链接新标签页
          if (!/\.(md|markdown)(#|\?|$)/i.test(href)) el.setAttribute('target', '_blank');
          el.setAttribute('rel', 'noopener noreferrer');
        }
      }
      if (el.tagName === 'IMG') el.setAttribute('loading', 'lazy');
      walk(el);
    }
  };
  walk(doc.body);
  const out = document.createDocumentFragment();
  for (const n of Array.from(doc.body.childNodes)) out.appendChild(document.importNode(n, true));
  return out;
}
