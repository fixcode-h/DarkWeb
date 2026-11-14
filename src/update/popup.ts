/**
 * 弹窗里的更新入口：页脚上方一行“版本 x · 检查更新”；有新版时在顶部显示一条提示，点开设置页的“版本与更新”。
 * 提示条由脚本插入，弹窗的 HTML 只多两个挂载点，样式在 update.css，免得和弹窗整体样式的改动打架。
 */
import { hasUpdate } from './check';
import { checkNow, currentVersion, installKind, loadState } from './run';

const slot = document.getElementById('updateSlot');
const link = document.getElementById('checkUpdate');
const versionText = document.getElementById('updateVersion');

function openUpdatePage(): void {
  void chrome.tabs.create({ url: chrome.runtime.getURL('options.html#update') });
  window.close();
}

function show(text: string, action?: string): void {
  if (!slot) return;
  const note = document.createElement('div');
  note.className = 'upd-note';
  note.append(text);
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'link';
    b.textContent = action;
    b.addEventListener('click', openUpdatePage);
    note.append(' ', b);
  }
  slot.replaceChildren(note);
  slot.hidden = false;
}

async function init(): Promise<void> {
  const current = currentVersion();
  const kind = await installKind();
  if (versionText) versionText.textContent = `版本 ${current}`;
  const s = await loadState();
  if (kind !== 'store' && s && hasUpdate(s, current)) show(`有新版本 ${s.newer[0].version}`, '查看改动并更新');

  link?.addEventListener('click', async (e) => {
    e.preventDefault();
    // 商店版的检查和重启都在设置页里
    if (kind === 'store') return openUpdatePage();
    show('正在检查更新…');
    const r = await checkNow();
    if (r.error) show(`检查失败：${r.error}`);
    else if (hasUpdate(r, current)) show(`有新版本 ${r.newer[0].version}`, '查看改动并更新');
    else show(`已是最新版本 ${current}`);
  });
}

void init();
