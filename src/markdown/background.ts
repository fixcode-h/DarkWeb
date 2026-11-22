/** Markdown 渲染的后台部分：检测脚本发现 .md 源文件后，把渲染器注入到那一页。由 sw.ts 以 import 引入 */

chrome.runtime.onMessage.addListener((msg: { type?: string }, sender, sendResponse) => {
  if (msg?.type !== 'md:render') return false;
  const tabId = sender.tab?.id;
  if (tabId === undefined) return false;
  chrome.scripting
    .executeScript({ target: { tabId, frameIds: [sender.frameId ?? 0] }, files: ['markdown.js'] })
    .then(() => sendResponse({ ok: true }))
    .catch(() => sendResponse({ ok: false }));
  return true;
});

export {};
