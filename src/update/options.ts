/**
 * 设置页的“版本与更新”卡片。
 * Chrome 不允许扩展替换自己的安装包：商店版交给浏览器更新；解压安装的版本下载新 zip，
 * 用户解压覆盖原文件夹后，在这里点“重新加载”就能换上新版（不用再去 chrome://extensions）。
 */
import { PENDING_KEY, RELEASES_PAGE, hasUpdate, type UpdateState } from './check';
import { checkNow, currentVersion, installKind, loadState, storeCheck, type InstallKind } from './run';

const root = document.getElementById('update');

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}

function when(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const KIND_TEXT: Record<InstallKind, string> = {
  store: '从应用商店安装，浏览器会自动更新',
  unpacked: '以“加载已解压的扩展程序”方式安装',
  other: '从安装包安装',
};

let busy = false;

async function render(note = ''): Promise<void> {
  if (!root) return;
  const kind = await installKind();
  const current = currentVersion();
  const head = el('div', { className: 'upd-head' },
    el('div', {}, el('div', { className: 'upd-version' }, `当前版本 ${current}`), el('div', { className: 'hint' }, KIND_TEXT[kind])),
  );
  const body: Node[] = [];

  if (kind === 'store') {
    const pending = (await chrome.storage.local.get(PENDING_KEY))[PENDING_KEY] as string | undefined;
    if (pending) {
      body.push(el('p', { className: 'upd-status' }, `新版本 ${pending} 已下载好，重启扩展后生效。`));
      head.append(btn('立即重启以更新', true, () => chrome.runtime.reload()));
    } else {
      head.append(btn('检查更新', true, async () => {
        const r = await storeCheck();
        const text = {
          update_available: '发现新版本，浏览器正在下载，下载完这里会出现“立即重启以更新”。',
          no_update: '已是最新版本。',
          throttled: '刚检查过，浏览器限制了检查频率，请过几分钟再试。',
          error: '检查失败，请稍后再试。',
        }[r];
        void render(text);
      }));
    }
  } else {
    const s = await loadState();
    const fresh = s && s.current === current ? s : null;
    head.append(btn(busy ? '正在检查…' : '检查更新', !hasUpdate(fresh, current), async () => {
      busy = true;
      void render();
      const r = await checkNow();
      busy = false;
      void render(r.error ? '' : hasUpdate(r, current) ? '' : '已是最新版本。');
    }, busy));
    if (fresh?.error) body.push(el('p', { className: 'errors' }, `检查失败：${fresh.error}`));
    if (fresh && hasUpdate(fresh, current)) body.push(...updateBlock(fresh, kind));
    else if (fresh && !fresh.error) body.push(el('p', { className: 'hint' }, `上次检查 ${when(fresh.checkedAt)}，已是最新版本。`));
  }
  if (note) body.unshift(el('p', { className: 'upd-status' }, note));
  root.replaceChildren(el('h2', {}, '版本与更新'), head, ...body);
}

function btn(text: string, primary: boolean, onClick: () => void, disabled = false): HTMLButtonElement {
  const b = el('button', { type: 'button', textContent: text, disabled });
  if (primary) b.className = 'primary';
  b.addEventListener('click', onClick);
  return b;
}

function updateBlock(s: UpdateState, kind: InstallKind): Node[] {
  const out: Node[] = [];
  const latest = s.newer[0];
  out.push(el('p', { className: 'upd-status' }, `发现新版本 ${latest.version}`, s.newer.length > 1 ? `（比当前新 ${s.newer.length} 个版本）` : ''));

  // 改动列表：每个版本一组，新的在前
  const list = el('div', { className: 'upd-changes' });
  for (const r of s.newer) {
    const ul = el('ul');
    let parent: HTMLUListElement | null = null;
    for (const c of r.changes) {
      const li = el('li', {}, c.text);
      if (c.level === 1 && ul.lastElementChild) {
        if (!parent || parent.parentElement !== ul.lastElementChild) {
          parent = el('ul');
          ul.lastElementChild.append(parent);
        }
        parent.append(li);
      } else {
        parent = null;
        ul.append(li);
      }
    }
    if (!r.changes.length) ul.append(el('li', { className: 'hint' }, '这个版本没有写改动说明'));
    list.append(el('div', { className: 'upd-release' }, el('a', { href: r.url, target: '_blank', rel: 'noopener', className: 'upd-tag' }, r.version), ul));
  }
  out.push(list);

  const actions = el('div', { className: 'actions' });
  if (s.downloadUrl) {
    actions.append(btn(`下载 ${s.downloadName ?? '新版安装包'}`, true, () => void chrome.tabs.create({ url: s.downloadUrl!, active: false })));
  }
  actions.append(el('a', { href: s.releasePage || RELEASES_PAGE, target: '_blank', rel: 'noopener' }, '在 GitHub 查看'));
  out.push(actions);

  if (kind === 'unpacked') {
    out.push(
      el('ol', { className: 'upd-steps' },
        el('li', {}, '下载上面的 zip，解压后把里面的文件全部复制到当前扩展所在的文件夹，覆盖旧文件。'),
        el('li', {}, '回到这里点“重新加载”，新版立即生效，设置都会保留。'),
      ),
      el('div', { className: 'actions' }, btn('我已覆盖文件，重新加载', false, () => chrome.runtime.reload())),
    );
  } else {
    out.push(el('p', { className: 'hint' }, '下载后打开 chrome://extensions，把 zip 解压到原来的文件夹覆盖旧文件再点刷新；包里的扩展 ID 固定，设置会保留。'));
  }
  return out;
}

void render();
// 后台定时检查完会写存储；页面开着时跟着刷新
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === 'local' && !busy && Object.keys(ch).some((k) => k.startsWith('drak-update'))) void render();
});
if (location.hash === '#update') root?.scrollIntoView({ block: 'start' });
