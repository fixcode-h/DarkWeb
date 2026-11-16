/**
 * 检查更新的后台部分：每天自动查一次 GitHub。由 sw.ts 以 import 引入。
 * 商店包出包时 __DRAK_STORE__ 被 esbuild 的 define 换成字面量 true（见 scripts/build.mjs），
 * 下面整段连同用到的检查代码在压缩时被剔除：商店版由浏览器自动更新，不访问 GitHub。
 * 直接写这个常量、不经过别的模块转一手，压缩器才认得出是死代码。
 */
import { UPDATE_KEY } from './check';
import { checkNow, refreshBadge } from './run';

declare const __DRAK_STORE__: boolean;

const ALARM = 'drak-update-check';

async function arm(): Promise<void> {
  const a = await chrome.alarms.get(ALARM);
  if (!a) chrome.alarms.create(ALARM, { delayInMinutes: 1, periodInMinutes: 24 * 60 });
}

if (!__DRAK_STORE__) {
  chrome.runtime.onInstalled.addListener(async () => {
    // 升级后旧的检查结果作废，角标跟着消失；下一次定时检查再重新查
    await chrome.storage.local.remove(UPDATE_KEY);
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
}
