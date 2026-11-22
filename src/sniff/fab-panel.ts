/**
 * 侧边快捷按钮列里的“嗅探”按钮和它的资源面板（由 translate/fab.ts 挂载）。
 * 点一下开始嗅探当前页面；在嗅探时再点打开资源列表，可以直接下载。
 */
import { SNIFF_KEY, loadSniff, normalizeSniff } from './settings';
import { displayName, fmtSize, tagOf } from './format';
import type { SniffState } from './background';

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
/** Lucide 的 download 图标 */
export const SNIFF_ICON = svg('<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>');

export const SNIFF_CSS = `
.tab[hidden] { display: none; }
.tool.sniff-on { color: var(--accent-text); }
.count {
  position: absolute; left: -4px; top: -4px; min-width: 16px; height: 16px; padding: 0 4px; box-sizing: border-box; border-radius: 8px;
  background: var(--accent); color: var(--on-accent); font: 600 10px/16px system-ui, sans-serif; text-align: center;
}
.count:empty { display: none; }
.panel {
  position: absolute; right: 52px; width: 300px; max-height: min(420px, 70vh); display: flex; flex-direction: column;
  background: var(--card); color: var(--fg); border: 1px solid var(--edge); border-radius: 10px; box-shadow: var(--shadow-pop);
  -webkit-user-select: text; user-select: text; cursor: auto;
}
.panel[hidden] { display: none; }
.p-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px 8px; border-bottom: 1px solid var(--edge); }
.p-head b { font-weight: 600; font-size: 13px; }
.p-head .sp { flex: 1; }
.p-link { all: unset; cursor: pointer; color: var(--accent-text); font-size: 12px; }
.p-link:hover { text-decoration: underline; }
.p-list { overflow: auto; padding: 4px 12px; }
.p-row { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-top: 1px solid var(--edge); }
.p-row:first-child { border-top: 0; }
.p-tag { font: 10px/16px ui-monospace, Menlo, Consolas, monospace; padding: 0 5px; border-radius: 4px; border: 1px solid var(--edge); color: var(--muted); flex: none; }
.p-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.p-size { color: var(--subtle); font-size: 11px; flex: none; }
.p-dl { all: unset; cursor: pointer; width: 24px; height: 24px; border-radius: 6px; display: grid; place-items: center; color: var(--muted); flex: none; }
.p-dl:hover { background: var(--hover); color: var(--fg); }
.p-dl svg { width: 14px; height: 14px; }
.p-empty, .p-foot { color: var(--subtle); font-size: 12px; line-height: 1.6; }
.p-empty { padding: 10px 0; }
.p-foot { padding: 8px 12px 10px; border-top: 1px solid var(--edge); }
.p-foot:empty { display: none; }
.p-warn { color: #e49c06; }
/* 面板开着时不显示按钮的提示文字，免得盖住面板 */
.pinned .tab::after { display: none; }
`;

export const SNIFF_TOOL_HTML = `<button class="tab tool" type="button" data-act="sniff" style="--i:3" aria-label="嗅探本页资源" hidden>${SNIFF_ICON}<span class="count"></span></button>`;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = '') => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  return e;
};

export class SniffTool {
  private enabled = false;
  private active = false;
  private count = 0;
  private drm = false;
  private panel!: HTMLElement;
  private btn!: HTMLElement;
  private note = '';

  constructor(private readonly onChange: () => void, private readonly keepOpen: (on: boolean) => void) {}

  async init(): Promise<void> {
    this.enabled = (await loadSniff()).enabled;
    chrome.storage.onChanged.addListener((c, area) => {
      if (area !== 'local' || !c[SNIFF_KEY]) return;
      this.enabled = normalizeSniff(c[SNIFF_KEY].newValue).enabled;
      if (!this.enabled) this.closePanel();
      this.render();
    });
    chrome.runtime.onMessage.addListener((m: { type?: string; active?: boolean; count?: number; drm?: boolean }) => {
      if (m?.type !== 'sniff:update') return;
      this.active = !!m.active;
      this.count = m.count ?? 0;
      this.drm = !!m.drm;
      if (!this.active) this.closePanel();
      else if (!this.panel?.hidden) void this.fill();
      this.render();
    });
    if (this.enabled) {
      const s = (await chrome.runtime.sendMessage({ type: 'sniff:state' }).catch(() => null)) as SniffState | null;
      if (s) Object.assign(this, { active: s.active, count: s.items.length, drm: s.drm });
    }
  }

  /** Fab 建好 Shadow DOM 后调用 */
  mount(wrap: HTMLElement): void {
    this.btn = wrap.querySelector('[data-act="sniff"]')!;
    this.panel = el('div', 'panel');
    this.panel.hidden = true;
    this.panel.addEventListener('click', (e) => e.stopPropagation());
    wrap.append(this.panel);
    document.addEventListener('keydown', (e) => e.key === 'Escape' && this.closePanel());
    document.addEventListener('pointerdown', (e) => {
      // 点到页面其他地方就收起（Shadow DOM 里的点击 target 是宿主元素）
      if (!this.panel.hidden && !e.composedPath().includes(wrap)) this.closePanel();
    });
    this.render();
  }

  render(): void {
    if (!this.btn) return;
    this.btn.hidden = !this.enabled;
    this.btn.classList.toggle('sniff-on', this.active);
    this.btn.querySelector('.count')!.textContent = this.active && this.count ? String(Math.min(this.count, 99)) : '';
    this.btn.dataset.tip = this.active ? `正在嗅探：找到 ${this.count} 个资源\n点击查看` : '嗅探本页的视频和音频\n点了才开始';
    this.btn.setAttribute('aria-pressed', String(this.active));
    this.onChange();
  }

  async click(): Promise<void> {
    if (!this.active) {
      this.note = '';
      const s = (await chrome.runtime.sendMessage({ type: 'sniff:start' }).catch(() => null)) as SniffState | null;
      if (!s) return;
      Object.assign(this, { active: s.active, count: s.items.length, drm: s.drm });
      this.render();
      if (!s.active) return;
    }
    if (this.panel.hidden) await this.openPanel();
    else this.closePanel();
  }

  private async openPanel(): Promise<void> {
    this.panel.hidden = false;
    const up = this.btn.getBoundingClientRect().top > window.innerHeight * 0.55;
    this.panel.style.top = up ? '' : `${this.btn.offsetTop}px`;
    this.panel.style.bottom = up ? `${(this.btn.offsetParent as HTMLElement).offsetHeight - this.btn.offsetTop - this.btn.offsetHeight}px` : '';
    this.btn.parentElement?.classList.add('pinned');
    this.keepOpen(true);
    await this.fill();
  }

  closePanel(): void {
    if (!this.panel || this.panel.hidden) return;
    this.panel.hidden = true;
    this.btn.parentElement?.classList.remove('pinned');
    this.keepOpen(false);
  }

  private async fill(): Promise<void> {
    const s = (await chrome.runtime.sendMessage({ type: 'sniff:state' }).catch(() => null)) as SniffState | null;
    if (!s) return;
    const head = el('div', 'p-head');
    head.append(el('b', '', '资源'), el('span', 'p-size', String(s.items.length)), el('span', 'sp'));
    const stop = el('button', 'p-link', '停止嗅探');
    stop.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ type: 'sniff:stop' }).catch(() => {});
      this.closePanel();
    });
    head.append(stop);
    const list = el('div', 'p-list');
    if (!s.items.length) {
      list.append(el('div', 'p-empty', s.drm ? '这个页面的播放器使用了 DRM 加密，无法下载。' : '还没有找到。播放一下视频，资源会出现在这里；如果视频早就加载完了，刷新页面再试。'));
    }
    for (const it of s.items) {
      const row = el('div', 'p-row');
      row.title = it.url;
      const dl = el('button', 'p-dl');
      dl.innerHTML = SNIFF_ICON;
      dl.setAttribute('aria-label', '下载');
      dl.addEventListener('click', async () => {
        const r = (await chrome.runtime.sendMessage({ type: 'sniff:download', url: it.url }).catch((e) => ({ ok: false, error: String(e) }))) as { ok: boolean; error?: string };
        this.note = r.ok ? '已开始下载，进度可以在扩展弹窗的“任务”里看。' : `下载失败：${r.error ?? '未知错误'}`;
        void this.fill();
      });
      row.append(el('span', 'p-tag', tagOf(it.kind, it.ext)), el('span', 'p-name', displayName(it.url)), el('span', 'p-size', fmtSize(it.size)), dl);
      list.append(row);
    }
    const foot = el('div', 'p-foot');
    if (s.drm && s.items.length) foot.append(el('div', 'p-warn', '检测到 DRM 加密，加密的流无法下载。'));
    if (this.note) foot.append(el('div', '', this.note));
    this.panel.replaceChildren(head, list, foot);
  }
}
