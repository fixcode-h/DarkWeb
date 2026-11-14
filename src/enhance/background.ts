/** 阅读增强的后台部分：右键菜单（翻译选中的文字、阅读模式、屏蔽页面元素）与快捷键。由 sw.ts 以 import 引入 */
const MENU_SELECTION = 'drak-translate-selection';
const MENU_READER = 'drak-reader';
const MENU_PICKER = 'drak-picker';
const PAGES = ['http://*/*', 'https://*/*'];

function createMenus(): void {
  const done = () => void chrome.runtime.lastError;
  chrome.contextMenus?.create({ id: MENU_SELECTION, title: '翻译选中的文字', contexts: ['selection'], documentUrlPatterns: PAGES }, done);
  chrome.contextMenus?.create({ id: MENU_READER, title: '阅读模式', contexts: ['page'], documentUrlPatterns: PAGES }, done);
  chrome.contextMenus?.create({ id: MENU_PICKER, title: '屏蔽页面元素…', contexts: ['page', 'image', 'link'], documentUrlPatterns: PAGES }, done);
}
chrome.runtime.onInstalled.addListener(createMenus);
chrome.runtime.onStartup.addListener(createMenus);

/** 注入阅读模式 / 元素屏蔽脚本：脚本自己判断是打开还是关闭 */
export async function runTool(tabId: number, tool: 'reader' | 'picker'): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: [tool === 'reader' ? 'enhance-reader.js' : 'enhance-picker.js'] });
    return true;
  } catch {
    // 浏览器受限页面（chrome://、商店页）
    return false;
  }
}

chrome.contextMenus?.onClicked.addListener((info, tab) => {
  if (tab?.id === undefined) return;
  if (info.menuItemId === MENU_SELECTION) {
    chrome.tabs.sendMessage(tab.id, { type: 'enh:translate-selection', text: info.selectionText ?? '' }, { frameId: 0 }).catch(() => {
      /* 页面还没加载完或是受限页面 */
    });
  } else if (info.menuItemId === MENU_READER) void runTool(tab.id, 'reader');
  else if (info.menuItemId === MENU_PICKER) void runTool(tab.id, 'picker');
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-reader' && command !== 'pick-element') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id !== undefined) await runTool(tab.id, command === 'toggle-reader' ? 'reader' : 'picker');
});

// 设置页 / 弹窗按钮：对当前标签页打开
chrome.runtime.onMessage.addListener((msg: { type?: string; tool?: string; tabId?: number }, _sender, sendResponse) => {
  if (msg?.type !== 'enh:run' || (msg.tool !== 'reader' && msg.tool !== 'picker') || typeof msg.tabId !== 'number') return false;
  runTool(msg.tabId, msg.tool).then((ok) => sendResponse({ ok }));
  return true;
});
