/** 检查更新的后台部分：每天自动查一次 GitHub。由 sw.ts 以 import 引入 */
import { PENDING_KEY, UPDATE_KEY } from './check';
import { checkNow, installKind, refreshBadge } from './run';

const ALARM = 'drak-update-check';

async function arm(): Promise<void> {
  // 商店版由浏览器自己更新，不去打扰 GitHub
  if ((await installKind()) === 'store') return;
  const a = await chrome.alarms.get(ALARM);
  if (!a) chrome.alarms.create(ALARM, { delayInMinutes: 1, periodInMinutes: 24 * 60 });
}

chrome.runtime.onInstalled.addListener(async () => {
  // 升级后旧的检查结果作废，角标跟着消失；下一次定时检查再重新查
  await chrome.storage.local.remove([UPDATE_KEY, PENDING_KEY]);
  await refreshBadge(null);
  await arm();
});
chrome.runtime.onStartup.addListener(() => {
  void arm();
  void refreshBadge();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) void checkNow();
});

// 商店版：新包已下载好。不自动重启（会打断正在用的页面），记下来让用户在设置页点“立即重启”
chrome.runtime.onUpdateAvailable.addListener((details) => {
  void chrome.storage.local.set({ [PENDING_KEY]: details.version });
});
