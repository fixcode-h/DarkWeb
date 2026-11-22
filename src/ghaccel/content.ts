/**
 * GitHub 加速下载：在 github.com 的下载入口旁加“⚡ 加速”，或直接把原下载链接改走加速节点。
 * 覆盖：Code 下拉的 Download ZIP 和 HTTPS clone 地址、Releases 附件与源码包、Tags 页源码包、单文件页 Raw。
 * GitHub 的下拉菜单、Release 附件都是点开或滚到时才生成，站内跳转也不刷新页面，所以用 MutationObserver 持续补。
 * 不点就不发任何请求；点击时（开了回退）先让后台探一下节点，不通就改用原链接。
 */
import { ACCEL_KEY, activeNode, nodeHost, normalizeAccel, proxify, type AccelSettings } from './settings';

const MARK = 'data-drak-gha';
const ORIG = 'data-drak-gha-orig';
const STYLE_ID = 'drak-gha-style';

let settings: AccelSettings = normalizeAccel(undefined);
let node = activeNode(settings);

const BOLT =
  '<svg class="drak-gha-bolt" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M9.6.3a.75.75 0 0 1 .4.8L9.1 6h3.65a.75.75 0 0 1 .58 1.22l-6.5 8a.75.75 0 0 1-1.32-.6L6.4 10H2.75a.75.75 0 0 1-.58-1.22l6.5-8A.75.75 0 0 1 9.6.3Z"/></svg>';

const CSS = `
.drak-gha-bolt { flex: none; vertical-align: text-bottom; }
a.drak-gha-btn {
  display: inline-flex; align-items: center; gap: 3px; height: 24px; padding: 0 8px; margin-left: 8px;
  border-radius: 6px; font-size: 12px; font-weight: 600; line-height: 1; white-space: nowrap; text-decoration: none !important;
  color: var(--fgColor-attention, #9a6700); background: var(--bgColor-attention-muted, rgba(212,167,44,.15));
  border: 1px solid var(--borderColor-attention-muted, rgba(212,167,44,.4));
}
a.drak-gha-btn:hover { background: var(--bgColor-attention-emphasis, #9a6700); color: var(--fgColor-onEmphasis, #fff); border-color: transparent; }
a.drak-gha-btn .drak-gha-bolt { width: 12px; height: 12px; }
a.drak-gha-inline { margin-left: 4px; height: 20px; padding: 0 6px; }
li.drak-gha-item a, li.drak-gha-item a [data-component="ActionList.Item.Label"] { color: var(--fgColor-attention, #9a6700) !important; font-weight: 600; }
li.drak-gha-item .drak-gha-node { font-weight: 400; }
li.drak-gha-item a:hover { background: var(--bgColor-attention-muted, rgba(212,167,44,.15)) !important; }
.drak-gha-node {
  margin-left: auto; padding: 0 5px; border: 1px solid var(--borderColor-default, #d1d9e0); border-radius: 4px;
  font: 11px/16px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--fgColor-muted, #59636e); font-weight: 400;
}
.drak-gha-clone { display: flex; align-items: center; gap: 8px; margin: -2px 0 8px; font-size: 12px; color: var(--fgColor-muted, #59636e); }
.drak-gha-clone a.drak-gha-btn { margin-left: 0; }
.drak-gha-toast {
  position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 2147483647;
  padding: 8px 14px; border-radius: 8px; font: 13px/1.5 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  color: var(--fgColor-default, #1f2328); background: var(--overlay-bgColor, #fff);
  box-shadow: 0 0 0 1px var(--borderColor-default, #d1d9e0), 0 8px 24px rgba(0,0,0,.2);
}
`;

function isPrivateRepo(): boolean {
  const m = document.querySelector<HTMLMetaElement>('meta[name="octolytics-dimension-repository_public"]');
  return m?.content === 'false';
}

function makeBtn(href: string, orig: string, text: string, extraClass = ''): HTMLAnchorElement {
  const a = document.createElement('a');
  a.className = `drak-gha-btn ${extraClass}`.trim();
  a.href = href;
  a.rel = 'noreferrer nofollow';
  a.setAttribute(MARK, 'btn');
  a.setAttribute(ORIG, orig);
  a.title = `经 ${nodeHost(node)} 加速下载（第三方代理）\n${href}`;
  a.innerHTML = BOLT;
  a.append(text);
  return a;
}

/** 原链接改走加速（替换模式） */
function rewrite(a: HTMLAnchorElement): void {
  const target = proxify(a.href, node);
  if (!target) return;
  // 记下原始的 href 属性（可能是相对地址），恢复时原样写回
  a.setAttribute(ORIG, a.getAttribute('href') ?? a.href);
  a.setAttribute(MARK, 'rewritten');
  a.href = target;
  a.title = `经 ${nodeHost(node)} 加速下载（第三方代理）`;
}

/** Code 下拉里的 Download ZIP：后面插一行“⚡ 加速下载 ZIP” */
function handleCodeMenu(a: HTMLAnchorElement): void {
  const li = a.closest('li');
  if (!li || li.nextElementSibling?.classList.contains('drak-gha-item')) return;
  const target = proxify(a.href, node);
  if (!target) return;
  if (settings.mode === 'replace') return rewrite(a);
  const item = li.cloneNode(true) as HTMLLIElement;
  item.classList.add('drak-gha-item');
  item.removeAttribute('id');
  const link = item.querySelector('a')!;
  for (const el of [link, ...Array.from(link.querySelectorAll('[id]'))]) el.removeAttribute('id');
  link.removeAttribute('aria-labelledby');
  link.href = target;
  link.rel = 'noreferrer nofollow';
  link.setAttribute(MARK, 'btn');
  link.setAttribute(ORIG, a.href);
  link.title = `经 ${nodeHost(node)} 加速下载（第三方代理）`;
  const icon = link.querySelector('svg');
  if (icon) icon.outerHTML = BOLT;
  const label = link.querySelector('[data-component="ActionList.Item.Label"]') ?? link.querySelector('span:last-child');
  if (label) {
    label.textContent = '加速下载 ZIP';
    const tag = document.createElement('span');
    tag.className = 'drak-gha-node';
    tag.textContent = nodeHost(node);
    label.parentElement?.append(tag);
    (label.parentElement as HTMLElement | null)?.style.setProperty('display', 'flex');
  }
  li.after(item);
}

/** HTTPS clone 地址下面加“⚡ 复制加速 clone 地址” */
function handleClone(input: HTMLInputElement): void {
  const box = input.parentElement;
  if (!box || box.nextElementSibling?.classList.contains('drak-gha-clone')) return;
  const target = proxify(input.value, node);
  if (!target) return;
  const row = document.createElement('div');
  row.className = 'drak-gha-clone';
  row.setAttribute(MARK, 'clone');
  const btn = makeBtn(target, input.value, '复制加速 clone 地址');
  btn.setAttribute(MARK, 'copy');
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    void navigator.clipboard.writeText(target).then(
      () => toast('已复制加速地址，可以直接 git clone'),
      () => toast(target),
    );
  });
  const host = document.createElement('span');
  host.className = 'drak-gha-node';
  host.style.marginLeft = '0';
  host.textContent = nodeHost(node);
  row.append(btn, host);
  box.after(row);
}

/** Releases 附件、源码包所在的一行：右侧加按钮 */
function handleAssetRow(a: HTMLAnchorElement, row: HTMLElement): void {
  if (row.querySelector(`[${MARK}="btn"]`)) return;
  const target = proxify(a.href, node);
  if (!target) return;
  if (settings.mode === 'replace') return rewrite(a);
  const slot = (row.lastElementChild as HTMLElement | null) ?? row;
  slot.append(makeBtn(target, a.href, '加速'));
}

/** 其他位置（Tags 页源码包、单文件 Raw）：紧跟在原按钮后面 */
function handleInline(a: HTMLAnchorElement, after: Element): void {
  const next = after.nextElementSibling;
  if (next?.getAttribute(MARK) === 'btn') return;
  const target = proxify(a.href, node);
  if (!target) return;
  if (settings.mode === 'replace') return rewrite(a);
  after.after(makeBtn(target, a.href, '加速', 'drak-gha-inline'));
}

function scan(): void {
  if (!settings.enabled || (settings.skipPrivate && isPrivateRepo())) return;
  const dl = 'a[href*="/archive/"], a[href*="/releases/download/"]';
  for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>(dl))) {
    if (a.hasAttribute(MARK) || a.closest(`[${MARK}]`)) continue;
    if (a.closest('li[data-component="ActionList.Item"]')) handleCodeMenu(a);
    else if (a.closest('li.Box-row')) handleAssetRow(a, a.closest('li.Box-row')!);
    else handleInline(a, a);
  }
  for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[data-testid="raw-button"]'))) {
    if (a.hasAttribute(MARK)) continue;
    const group = a.closest('[class*="ButtonGroup-ButtonGroup"]') ?? a;
    handleInline(a, group);
  }
  for (const input of Array.from(document.querySelectorAll<HTMLInputElement>('input#clone-with-https'))) handleClone(input);
}

/** 关掉或换节点时，把页面恢复原样再重新扫 */
function reset(): void {
  for (const el of Array.from(document.querySelectorAll(`[${MARK}]`))) {
    const kind = el.getAttribute(MARK);
    if (kind === 'rewritten') {
      el.setAttribute('href', el.getAttribute(ORIG)!);
      el.removeAttribute(MARK);
      el.removeAttribute(ORIG);
      el.removeAttribute('title');
    } else if (kind === 'clone') el.remove();
    else (el.closest('li.drak-gha-item') ?? el).remove();
  }
}

let toastTimer = 0;
function toast(text: string): void {
  let t = document.querySelector<HTMLElement>('.drak-gha-toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'drak-gha-toast';
    t.setAttribute('role', 'status');
    document.body.append(t);
  }
  t.textContent = text;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t?.remove(), 3200);
}

function go(url: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noreferrer';
  // Raw 文件是文本，直接打开会离开当前页，放到新标签页
  if (/\/(raw|blob)\/|githubusercontent\.com/.test(url)) a.target = '_blank';
  a.click();
}

/** 开了回退时，点加速前让后台探一下节点；不通就用原链接 */
document.addEventListener(
  'click',
  (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.<HTMLAnchorElement>(`a[${MARK}="btn"], a[${MARK}="rewritten"]`);
    if (!a || !settings.fallback) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const target = a.href;
    const orig = new URL(a.getAttribute(ORIG)!, location.href).href;
    chrome.runtime
      .sendMessage({ type: 'gha:probe', node })
      .then((r: { ok?: boolean } | undefined) => r?.ok !== false)
      .catch(() => true)
      .then((ok) => {
        if (ok) go(target);
        else {
          toast(`加速节点 ${nodeHost(node)} 暂时连不上，已改用 GitHub 原链接下载`);
          go(orig);
        }
      });
  },
  true,
);

let pending = 0;
function schedule(): void {
  if (pending) return;
  pending = window.setTimeout(() => {
    pending = 0;
    scan();
  }, 150);
}

function apply(next: AccelSettings): void {
  settings = next;
  node = activeNode(next);
  reset();
  scan();
}

async function init(): Promise<void> {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    (document.head ?? document.documentElement).append(style);
  }
  const data = await chrome.storage.local.get(ACCEL_KEY);
  apply(normalizeAccel(data[ACCEL_KEY]));
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[ACCEL_KEY]) apply(normalizeAccel(changes[ACCEL_KEY].newValue));
  });
}

void init();
