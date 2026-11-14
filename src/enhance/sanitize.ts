/**
 * 把 Readability 抽出的正文 HTML 变成可以安全放进页面的节点。
 * Shadow DOM 里的 <script> 不会执行，但 onerror 之类的事件属性、javascript: 链接会，
 * 所以只留白名单里的标签和属性。
 */
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'FRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'LINK', 'META', 'BASE', 'NOSCRIPT', 'TEMPLATE', 'SLOT']);
const ATTRS = new Set(['href', 'src', 'srcset', 'sizes', 'alt', 'title', 'width', 'height', 'colspan', 'rowspan', 'lang', 'dir', 'datetime', 'cite', 'start', 'type', 'controls', 'poster', 'viewbox', 'd', 'fill', 'stroke']);

function safeUrl(v: string, base: string, allowData: boolean): string | null {
  try {
    const u = new URL(v, base);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
    if (allowData && u.protocol === 'data:' && /^data:image\/(png|jpe?g|gif|webp|avif)[;,]/i.test(v)) return v;
  } catch {
    /* 坏地址 */
  }
  return null;
}

export function sanitizeArticle(html: string, base: string): DocumentFragment {
  // 在独立的惰性文档里解析和清洗，最后 importNode 复制成新节点：
  // 新节点只带清洗后剩下的属性，不会把解析时挂上的事件处理器带进页面
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
        if (name === 'href' || name === 'src' || name === 'poster' || name === 'cite') {
          const u = safeUrl(a.value, base, name !== 'href');
          if (u) el.setAttribute(a.name, u);
          else el.removeAttribute(a.name);
        } else if (name === 'srcset') {
          // srcset 里每一项都要是 http(s)
          const ok = a.value.split(',').every((part) => !!safeUrl(part.trim().split(/\s+/)[0] ?? '', base, true));
          if (!ok) el.removeAttribute(a.name);
        }
      }
      if (el.tagName === 'A') {
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener noreferrer');
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
