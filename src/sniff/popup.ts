/**
 * 弹窗里的“资源”卡片：开始 / 停止嗅探本页，列出找到的资源并下载；“任务”页签看下载和合并进度。
 * 没开启资源嗅探时只显示一行开启提示（可以关掉）。
 */
import { loadSniff, saveSniff } from './settings';
import { displayName, fmtSize, tagOf } from './format';
import type { SniffState } from './background';
import type { Task } from './jobs';

const slot = document.getElementById('sniffSlot');
let tabId: number | undefined;
let view: 'items' | 'tasks' = 'items';
let note = '';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function button(text: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', cls, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

const ask = <T>(msg: object) => chrome.runtime.sendMessage({ ...msg, tabId }) as Promise<T>;

async function grantDownloads(): Promise<boolean> {
  try {
    return await chrome.permissions.request({ permissions: ['downloads'] });
  } catch {
    return false;
  }
}

const STAGE: Record<string, string> = { queued: '排队中', download: '下载中', merge: '合并中', save: '保存中', done: '已完成', error: '失败', canceled: '已取消' };

function taskRow(t: Task): HTMLElement {
  const row = el('div', 'sn-task');
  const head = el('div', 'sn-task-head');
  head.append(el('span', 'sn-task-name', t.file ?? t.name), el('span', `sn-badge ${t.stage}`, STAGE[t.stage] ?? t.stage));
  row.append(head);
  const live = ['queued', 'download', 'merge', 'save'].includes(t.stage);
  if (live) {
    const pct = t.total ? Math.min(100, Math.round((t.done / t.total) * 100)) : 0;
    const bar = el('div', 'sn-bar');
    const fill = el('i');
    fill.style.width = `${t.stage === 'merge' || t.stage === 'save' ? 100 : pct}%`;
    if (t.stage === 'merge' || t.stage === 'save') bar.classList.add('busy');
    bar.append(fill);
    const meta = el('div', 'sn-meta');
    const seg = t.downloadId === undefined && t.total ? `分片 ${t.done} / ${t.total} · ` : '';
    meta.textContent = t.stage === 'merge' ? '合并音视频，不重新编码' : `${seg}${fmtSize(t.bytes) || '0 KB'}${t.speed ? ` · ${fmtSize(t.speed)}/s` : ''}`;
    const foot = el('div', 'sn-task-foot');
    foot.append(meta, button('取消', 'link', () => void ask({ type: 'sniff:cancel', id: t.id }).then(render)));
    row.append(bar, foot);
  } else {
    const foot = el('div', 'sn-task-foot');
    foot.append(el('span', 'sn-meta', t.stage === 'error' ? (t.error ?? '') : t.note ?? (t.bytes ? fmtSize(t.bytes) : '')));
    if (t.stage === 'done') foot.append(button('打开文件夹', 'link', () => void chrome.runtime.sendMessage({ type: 'sniff:show', id: t.id })));
    row.append(foot);
  }
  return row;
}

async function render(): Promise<void> {
  if (!slot) return;
  const settings = await loadSniff();
  const s = await ask<SniffState>({ type: 'sniff:state' }).catch(() => null);
  if (!s) return;
  const card = el('section', 'card sniff');

  if (!settings.enabled) {
    if (settings.promptDismissed) return void slot.replaceChildren();
    const row = el('div', 'sn-intro');
    const text = el('div', 'sn-intro-text');
    text.append(el('div', 'sn-title', '资源嗅探'), el('div', 'hint', '按需嗅探网页里的视频和音频并下载'));
    row.append(
      text,
      button('开启', 'primary', async () => {
        await saveSniff({ enabled: true });
        await grantDownloads();
        void render();
      }),
      button('×', 'sn-x', async () => {
        await saveSniff({ promptDismissed: true });
        void render();
      }),
    );
    row.lastElementChild!.setAttribute('aria-label', '不再提示');
    card.append(row);
    return void slot.replaceChildren(card);
  }

  const head = el('div', 'sn-head');
  head.append(el('h2', '', '资源'));
  if (s.active || s.tasks.length) {
    const seg = el('div', 'seg sn-tabs');
    const mk = (v: typeof view, label: string) => {
      const b = button(label, view === v ? 'on' : '', () => {
        view = v;
        void render();
      });
      return b;
    };
    const liveTasks = s.tasks.filter((t) => !['done', 'error', 'canceled'].includes(t.stage)).length;
    seg.append(mk('items', `本页 ${s.items.length}`), mk('tasks', `任务 ${liveTasks || s.tasks.length}`));
    head.append(seg);
  }
  card.append(head);

  if (!s.canDownload) {
    const n = el('div', 'note');
    n.append('下载需要“管理下载内容”权限。 ');
    n.append(button('授权', 'link', async () => {
      await grantDownloads();
      void render();
    }));
    card.append(n);
  }

  if (view === 'tasks' && s.tasks.length) {
    const list = el('div', 'sn-tasks');
    s.tasks.forEach((t) => list.append(taskRow(t)));
    card.append(list);
    if (s.tasks.some((t) => ['done', 'error', 'canceled'].includes(t.stage))) {
      const foot = el('div', 'sn-foot');
      foot.append(button('清除已结束的任务', 'link', () => void ask({ type: 'sniff:clear' }).then(render)));
      card.append(foot);
    }
    return void slot.replaceChildren(card);
  }

  if (!s.supported) {
    card.append(el('p', 'hint', '这个页面不支持资源嗅探。'));
    return void slot.replaceChildren(card);
  }
  if (!s.active) {
    const row = el('div', 'sn-start');
    row.append(
      el('span', 'hint', '点了才开始监听本页的媒体请求'),
      button('开始嗅探', 'primary', async () => {
        await ask({ type: 'sniff:start' });
        view = 'items';
        void render();
      }),
    );
    card.append(row);
    return void slot.replaceChildren(card);
  }

  const list = el('div', 'sn-list');
  if (!s.items.length) list.append(el('p', 'hint sn-empty', s.drm ? '这个页面的播放器使用了 DRM 加密，无法下载。' : '还没有找到。播放一下视频；如果视频早就加载完了，刷新页面再试。'));
  for (const it of s.items) {
    const row = el('div', 'sn-row');
    row.title = it.url;
    row.append(el('span', 'sn-tag', tagOf(it.kind, it.ext)), el('span', 'sn-name', displayName(it.url)), el('span', 'sn-size', fmtSize(it.size)));
    const dl = button('↓', 'sn-dl', async () => {
      const r = await ask<{ ok: boolean; error?: string }>({ type: 'sniff:download', url: it.url }).catch((e) => ({ ok: false, error: String(e) }));
      note = r.ok ? '' : `下载失败：${r.error}`;
      if (r.ok) view = 'tasks';
      void render();
    });
    dl.setAttribute('aria-label', '下载');
    dl.disabled = !s.canDownload;
    row.append(dl);
    list.append(row);
  }
  card.append(list);
  const foot = el('div', 'sn-foot');
  if (s.drm && s.items.length) foot.append(el('span', 'sn-warn', '检测到 DRM 加密，加密的流无法下载'));
  if (note) foot.append(el('span', 'errors', note));
  foot.append(el('span', 'sn-sp'), button('停止嗅探', 'link', () => void ask({ type: 'sniff:stop' }).then(render)));
  card.append(foot);
  slot.replaceChildren(card);
}

async function init(): Promise<void> {
  if (!slot) return;
  // ?tab= 给端到端测试用：把弹窗当普通页面打开时，“当前标签页”是它自己
  const forced = Number(new URLSearchParams(location.search).get('tab'));
  const [tab] = forced ? [] : await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = forced || tab?.id;
  await render();
  // 列表和任务进度变了就刷新
  let timer = 0;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && !changes['drak-sniff']) return;
    if (area === 'session' && !Object.keys(changes).some((k) => k === 'sniff-tasks' || k === `sniff-tab-${tabId}` || k === 'sniff-active')) return;
    clearTimeout(timer);
    timer = window.setTimeout(render, 100);
  });
}

void init();
