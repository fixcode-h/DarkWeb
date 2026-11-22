/**
 * Markdown 检测（静态内容脚本，document_start，只在顶层页面运行）。
 * 绝大多数页面在第一行判断就返回；只有浏览器直接显示的 .md 源文件才读设置、请后台注入渲染器（markdown.js）。
 * 先在根元素上标 data-drak-md=pending，暗色引擎看到后让位；不接管时改成 off，引擎照常处理纯文本页。
 */
import { isMarkdownDocument, MD_ATTR } from './match';
import { loadMarkdown, shouldRender } from './settings';

(() => {
  if (window !== window.top) return;
  if (!isMarkdownDocument(location.href, document.contentType)) return;
  const html = document.documentElement;
  if (html.hasAttribute(MD_ATTR)) return;
  html.setAttribute(MD_ATTR, 'pending');
  // 渲染前先藏起原始文本，免得先闪一下源码
  const hide = document.createElement('style');
  hide.textContent = `html[${MD_ATTR}="pending"] body { visibility: hidden !important; }`;
  html.appendChild(hide);

  const giveUp = () => {
    html.setAttribute(MD_ATTR, 'off');
    hide.remove();
  };
  const ready = new Promise<void>((resolve) => {
    if (document.readyState !== 'loading') resolve();
    else document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
  });

  void loadMarkdown()
    .then(async (s) => {
      if (!shouldRender(s, location.href)) return giveUp();
      await ready;
      // 浏览器按纯文本显示时，body 里只有一个 <pre>；不是这个结构（比如服务器返回的其实是网页）就不管
      const body = document.body;
      const pre = body?.children.length === 1 && body.firstElementChild?.tagName === 'PRE';
      if (!pre) return giveUp();
      const res = (await chrome.runtime.sendMessage({ type: 'md:render' })) as { ok?: boolean } | undefined;
      if (!res?.ok) giveUp();
    })
    .catch(giveUp);
})();
