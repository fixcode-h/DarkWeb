/** 弹窗底部的“阅读增强”入口 */
document.getElementById('openEnhance')?.addEventListener('click', (e) => {
  e.preventDefault();
  void chrome.tabs.create({ url: chrome.runtime.getURL('enhance.html') });
});
