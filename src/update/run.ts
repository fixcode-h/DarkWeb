/**
 * 检查更新的执行部分：请求 GitHub、存结果、更新图标角标。
 * 后台定时检查和设置页的“检查更新”按钮都调这里（扩展页面里也能直接用 chrome.action / storage）。
 */
import { RELEASES_API, UPDATE_KEY, buildState, hasUpdate, type GhRelease, type UpdateState } from './check';

/** 安装来源：解压安装可以覆盖文件后在设置页重新加载；其余要去扩展管理页处理 */
export type InstallKind = 'unpacked' | 'other';

export async function installKind(): Promise<InstallKind> {
  try {
    const self = await chrome.management.getSelf();
    return self.installType === 'development' ? 'unpacked' : 'other';
  } catch {
    return 'other';
  }
}

export function currentVersion(): string {
  return chrome.runtime.getManifest().version;
}

export async function loadState(): Promise<UpdateState | null> {
  const data = await chrome.storage.local.get(UPDATE_KEY);
  return (data[UPDATE_KEY] as UpdateState | undefined) ?? null;
}

/** 有新版时在工具栏图标上显示一个“新”字 */
export async function refreshBadge(state?: UpdateState | null): Promise<void> {
  const s = state === undefined ? await loadState() : state;
  const on = hasUpdate(s, currentVersion());
  await chrome.action.setBadgeText({ text: on ? '新' : '' });
  if (on) await chrome.action.setBadgeBackgroundColor({ color: '#257de0' });
}

/** 向 GitHub 查一次最新版本并保存。失败时保留上次的结果，只记下错误 */
export async function checkNow(): Promise<UpdateState> {
  const current = currentVersion();
  let state: UpdateState;
  try {
    const res = await fetch(RELEASES_API, { headers: { accept: 'application/vnd.github+json' }, cache: 'no-store' });
    if (res.status === 403 || res.status === 429) throw new Error('GitHub 访问太频繁，请稍后再试');
    if (!res.ok) throw new Error(`GitHub 返回 ${res.status}`);
    const list = (await res.json()) as GhRelease[];
    if (!Array.isArray(list)) throw new Error('GitHub 返回的内容无法识别');
    state = buildState(list, current);
  } catch (e) {
    const prev = await loadState();
    const msg = e instanceof TypeError ? '连不上 GitHub，请检查网络' : (e as Error).message || String(e);
    state = {
      ...(prev && prev.current === current
        ? prev
        : { latest: null, downloadUrl: null, downloadName: null, releasePage: '', newer: [] }),
      checkedAt: Date.now(),
      current,
      error: msg,
    } as UpdateState;
  }
  await chrome.storage.local.set({ [UPDATE_KEY]: state });
  await refreshBadge(state);
  return state;
}
