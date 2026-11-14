/** 阅读增强的后台部分：右键“翻译选中的文字”。由 sw.ts 以 import 引入 */
const MENU_ID = 'drak-translate-selection';

function createMenu(): void {
  chrome.contextMenus?.create(
    { id: MENU_ID, title: '翻译选中的文字', contexts: ['selection'], documentUrlPatterns: ['http://*/*', 'https://*/*'] },
    () => void chrome.runtime.lastError,
  );
}
chrome.runtime.onInstalled.addListener(createMenu);
chrome.runtime.onStartup.addListener(createMenu);
chrome.contextMenus?.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || tab?.id === undefined) return;
  chrome.tabs.sendMessage(tab.id, { type: 'enh:translate-selection', text: info.selectionText ?? '' }, { frameId: 0 }).catch(() => {
    /* 页面还没加载完或是受限页面 */
  });
});
