/** Markdown 渲染的后台部分：检测脚本发现 .md 源文件后，把渲染器注入到那一页。由 sw.ts 以 import 引入 */

// md:render 注入渲染器；md:mermaid 是渲染页发现有 mermaid 代码块时，再注入画图库
const FILES: Record<string, string> = { 'md:render': 'markdown.js', 'md:mermaid': 'markdown-mermaid.js' };

chrome.runtime.onMessage.addListener((msg: { type?: string }, sender, sendResponse) => {
  const file = FILES[msg?.type ?? ''];
  if (!file) return false;
  const tabId = sender.tab?.id;
  if (tabId === undefined) return false;
  chrome.scripting
    .executeScript({ target: { tabId, frameIds: [sender.frameId ?? 0] }, files: [file] })
    .then(() => sendResponse({ ok: true }))
    .catch(() => sendResponse({ ok: false }));
  return true;
});

export {};
