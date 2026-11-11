/**
 * 页面侧边的翻译快捷按钮（静态内容脚本，只在顶层页面运行）。
 *
 * 平时半隐藏贴在屏幕边缘，鼠标移上去滑出；点一下翻译，再点一下显示原文；
 * 按住可以上下拖动，松手吸附到最近的一侧；悬停时旁边出现“本站隐藏”“全部隐藏”。
 * 按钮放在封闭的 Shadow DOM 里，页面样式和暗色配色都碰不到它。
 */
import {
  STATE_EVENT,
  TRANSLATE_KEY,
  loadTranslate,
  normalizeTranslate,
  saveTranslate,
  siteKeyOf,
  type FabSettings,
  type PageState,
  type PageStatus,
  type TranslateSettings,
} from './settings';

const SIZE = 36;
const DRAG_THRESHOLD = 5;

const CSS = `
:host { all: initial; }
.wrap {
  position: fixed; z-index: 2147483646; top: 0; display: flex; align-items: center; gap: 6px;
  transform: translateY(-50%); font: 12px/1.4 system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  transition: left .18s ease, right .18s ease, opacity .18s;
  -webkit-user-select: none; user-select: none;
}
.wrap.right { right: ${-SIZE / 2 + 4}px; flex-direction: row-reverse; }
.wrap.left { left: ${-SIZE / 2 + 4}px; flex-direction: row; }
.wrap.open.right, .wrap.dragging.right, .wrap.on.right { right: 8px; }
.wrap.open.left, .wrap.dragging.left, .wrap.on.left { left: 8px; }
.wrap:not(.open):not(.on):not(.dragging) { opacity: .55; }
.btn {
  position: relative; width: ${SIZE}px; height: ${SIZE}px; border-radius: 50%; border: 1px solid #3a3d44; padding: 0;
  background: #1f2125; color: #e8e9eb; box-shadow: 0 4px 14px rgba(0, 0, 0, .28); cursor: pointer;
  display: grid; place-items: center; font-weight: 700; font-size: 14px; letter-spacing: -.02em; touch-action: none;
  transition: background .12s, transform .12s;
}
.btn:hover { background: #2a2d33; }
.btn:active { transform: scale(.94); }
.dragging .btn { cursor: grabbing; transform: scale(1.06); }
.on .btn { background: #f2c94c; border-color: #f2c94c; color: #2a2206; }
.btn:focus-visible { outline: 2px solid #f2c94c; outline-offset: 2px; }
.ring {
  position: absolute; inset: -3px; border-radius: 50%; border: 2px solid transparent; border-top-color: #f2c94c;
  opacity: 0; animation: spin .8s linear infinite;
}
.on .ring { border-top-color: #1f2125; }
.busy .ring { opacity: 1; }
@keyframes spin { to { transform: rotate(360deg); } }
.menu { display: none; flex-direction: column; gap: 4px; }
.open:not(.dragging) .menu { display: flex; }
.menu button {
  all: unset; cursor: pointer; padding: 3px 8px; border-radius: 6px; white-space: nowrap;
  background: #1f2125; color: #c9ccd2; border: 1px solid #3a3d44; box-shadow: 0 2px 8px rgba(0, 0, 0, .25);
}
.menu button:hover { color: #fff; background: #2a2d33; }
@media print { .wrap { display: none; } }
`;

class Fab {
  private host: HTMLElement | null = null;
  private wrap!: HTMLElement;
  private btn!: HTMLButtonElement;
  private settings!: TranslateSettings;
  private readonly site = siteKeyOf(location.host);
  private state: PageState = { active: false, busy: false };
  private closeTimer = 0;

  async init(): Promise<void> {
    this.settings = await loadTranslate();
    // 页面里可能已经有翻译脚本（自动翻译的站点、扩展重载）
    const tr = (window as unknown as { __drakTranslate?: { status(): PageStatus } }).__drakTranslate;
    if (tr) this.state.active = tr.status().active;
    document.addEventListener(STATE_EVENT, (e) => {
      try {
        this.state = JSON.parse(String((e as CustomEvent).detail)) as PageState;
      } catch {
        return;
      }
      this.render();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[TRANSLATE_KEY]) return;
      this.settings = normalizeTranslate(changes[TRANSLATE_KEY].newValue);
      this.sync();
    });
    document.addEventListener('fullscreenchange', () => this.sync());
    this.sync();
  }

  private visible(): boolean {
    const f = this.settings.fab;
    return f.enabled && !!this.site && !f.hiddenSites.includes(this.site) && !document.fullscreenElement;
  }

  /** 按设置挂上或撤掉按钮 */
  private sync(): void {
    if (!this.visible()) {
      this.host?.remove();
      return;
    }
    if (!this.host) this.build();
    // 挂在 <html> 下而不是 <body>：不改动页面自己的内容树
    if (!this.host!.isConnected) document.documentElement.appendChild(this.host!);
    this.place(this.settings.fab.side, this.settings.fab.y);
    this.render();
  }

  private build(): void {
    // div 宿主 + 封闭的 Shadow Root：页面脚本拿不到，暗色引擎也只处理带连字符的自定义元素
    const host = document.createElement('div');
    host.setAttribute('translate', 'no');
    host.className = 'notranslate';
    host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483646';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>${CSS}</style>
      <div class="wrap right" part="wrap">
        <button class="btn" type="button" aria-label="翻译此页面"><span class="ring"></span><span class="label">译</span></button>
        <div class="menu">
          <button type="button" data-act="site">本站隐藏</button>
          <button type="button" data-act="all">全部隐藏</button>
        </div>
      </div>`;
    this.wrap = root.querySelector('.wrap')!;
    this.btn = root.querySelector('.btn')!;
    this.host = host;

    this.wrap.addEventListener('pointerenter', () => this.open(true));
    this.wrap.addEventListener('pointerleave', () => this.open(false));
    this.btn.addEventListener('focus', () => this.open(true));
    this.btn.addEventListener('blur', () => this.open(false));
    this.btn.addEventListener('pointerdown', (e) => this.drag(e));
    this.btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.toggle();
      }
    });
    root.querySelector('.menu')!.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest('button')?.dataset.act;
      if (act === 'site') void this.save({ hiddenSites: [...this.settings.fab.hiddenSites.filter((s) => s !== this.site), this.site] });
      if (act === 'all') void this.save({ enabled: false });
    });
  }

  private open(on: boolean): void {
    clearTimeout(this.closeTimer);
    if (on) this.wrap.classList.add('open');
    // 稍等再收起，鼠标从按钮移到菜单时不会闪
    else this.closeTimer = window.setTimeout(() => this.wrap.classList.remove('open'), 250);
  }

  private place(side: FabSettings['side'], y: number): void {
    this.wrap.classList.toggle('right', side === 'right');
    this.wrap.classList.toggle('left', side === 'left');
    this.wrap.style.top = `${Math.round(y * 1000) / 10}vh`;
  }

  private render(): void {
    if (!this.host) return;
    this.wrap.classList.toggle('on', this.state.active);
    this.wrap.classList.toggle('busy', this.state.busy);
    const label = this.state.active ? '显示原文' : '翻译此页面';
    this.btn.setAttribute('aria-label', label);
    this.btn.title = `${label}（Alt+Shift+T）\n按住可拖动`;
    this.btn.querySelector('.label')!.textContent = this.state.active ? '原' : '译';
  }

  private toggle(): void {
    const tr = (window as unknown as { __drakTranslate?: { status(): PageStatus } }).__drakTranslate;
    // 先给出反馈，真正的状态由翻译脚本的事件更新
    this.state = { active: !(tr?.status().active ?? this.state.active), busy: !this.state.active };
    this.render();
    void chrome.runtime.sendMessage({ type: 'tr:toggle-self' }).catch(() => {});
  }

  private drag(e: PointerEvent): void {
    if (e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    this.btn.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
      moved = true;
      this.wrap.classList.add('dragging');
      const side = ev.clientX < window.innerWidth / 2 ? 'left' : 'right';
      this.place(side, clampY(ev.clientY / window.innerHeight));
    };
    const up = (ev: PointerEvent) => {
      this.btn.removeEventListener('pointermove', move);
      this.btn.removeEventListener('pointerup', up);
      this.btn.removeEventListener('pointercancel', up);
      this.wrap.classList.remove('dragging');
      if (!moved) {
        if (ev.type === 'pointerup') this.toggle();
        return;
      }
      const side = ev.clientX < window.innerWidth / 2 ? 'left' : 'right';
      void this.save({ side, y: clampY(ev.clientY / window.innerHeight) });
    };
    this.btn.addEventListener('pointermove', move);
    this.btn.addEventListener('pointerup', up);
    this.btn.addEventListener('pointercancel', up);
  }

  private async save(patch: Partial<FabSettings>): Promise<void> {
    // 以存储里的最新值为准，避免覆盖别处（设置页、其他标签页）刚做的改动
    const cur = await loadTranslate();
    this.settings = { ...cur, fab: { ...cur.fab, ...patch } };
    await saveTranslate(this.settings);
    this.sync();
  }
}

function clampY(y: number): number {
  return Math.min(0.95, Math.max(0.05, y));
}

const w = window as unknown as { __drakFab?: Fab };
if (window === window.top && /^https?:$/.test(location.protocol) && !w.__drakFab) {
  w.__drakFab = new Fab();
  void w.__drakFab.init();
}
