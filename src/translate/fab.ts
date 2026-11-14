/**
 * 页面侧边的翻译快捷按钮（静态内容脚本，只在顶层页面运行）。
 *
 * 贴在屏幕右边缘的半个标签，鼠标移上去整个滑出；点一下翻译，再点一下显示原文；
 * 按住可以上下拖动（始终吸附在右边缘）；悬停时左边出现“本站隐藏”“全部隐藏”。
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
/** 平时露出的宽度：贴在右边缘的半个标签，鼠标移上去整个滑出 */
const PEEK = 22;
const DRAG_THRESHOLD = 5;

// 配色、圆角、动效照 AgentPanel 的默认配色（Claude Code）：中性灰面板、蓝色强调、10px 浮层圆角、120ms snap 进场
const CSS = `
:host { all: initial; }
.wrap {
  --card: #1f1f1f; --pop: #303030; --fg: #ececec; --muted: #c6c6c6; --subtle: #9c9c9c;
  --edge: rgb(255 255 255 / .1); --hover: rgb(255 255 255 / .07); --active: rgb(255 255 255 / .11);
  --accent: #257de0; --accent-text: #6aabf1; --on-accent: #fff;
  --shadow-pop: 0 8px 24px rgb(0 0 0 / .32), 0 2px 6px rgb(0 0 0 / .2);
  --ease-snap: cubic-bezier(.32, .72, 0, 1); --ease-spring: cubic-bezier(.34, 1.3, .64, 1);
  position: fixed; z-index: 2147483646; top: 0; right: 0; display: flex; flex-direction: row-reverse; align-items: center; gap: 8px;
  transform: translateY(-50%); font: 13px/1.4 system-ui, -apple-system, "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif;
  -webkit-user-select: none; user-select: none; color-scheme: dark;
}
@media (prefers-color-scheme: light) {
  .wrap {
    --card: #fff; --pop: #fff; --fg: #191919; --muted: #404040; --subtle: #666;
    --edge: rgb(0 0 0 / .1); --hover: rgb(0 0 0 / .05); --active: rgb(0 0 0 / .09); --accent-text: #1757ac;
    --shadow-pop: 0 8px 24px rgb(0 0 0 / .12), 0 2px 6px rgb(0 0 0 / .08);
    color-scheme: light;
  }
}
.btn {
  position: relative; box-sizing: border-box; width: ${SIZE + 6}px; height: ${SIZE}px; border-radius: ${SIZE / 2}px 0 0 ${SIZE / 2}px; padding: 0 6px 0 0;
  border: 1px solid var(--edge); border-right: 0; background: var(--card); color: var(--muted);
  box-shadow: var(--shadow-pop); cursor: pointer;
  display: grid; place-items: center; font-weight: 600; font-size: 14px; touch-action: none;
  transform: translateX(${SIZE + 6 - PEEK}px); opacity: .6;
  transition: transform 200ms var(--ease-snap), opacity 120ms, background 60ms, color 60ms;
}
.btn::before { content: ""; position: absolute; inset: 0; border-radius: inherit; background: transparent; transition: background 60ms; }
.label { position: relative; transition: transform 200ms var(--ease-spring); }
.open .btn, .on .btn, .dragging .btn { transform: none; opacity: 1; }
.btn:hover { color: var(--fg); }
.btn:hover::before { background: var(--hover); }
.btn:active::before { background: var(--active); }
.btn:active .label { transform: scale(.9); transition-duration: 60ms; }
.dragging .btn { cursor: grabbing; }
.on .btn { background: var(--accent); border-color: transparent; color: var(--on-accent); }
.on .btn:hover::before { background: rgb(255 255 255 / .1); }
.btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.ring {
  position: absolute; inset: 5px 11px 5px 5px; border-radius: 50%; border: 2px solid transparent; border-top-color: var(--accent);
  opacity: 0; transition: opacity 120ms; animation: spin .8s linear infinite;
}
.on .ring { border-top-color: var(--on-accent); }
.busy .ring { opacity: 1; }
@keyframes spin { to { transform: rotate(360deg); } }
.menu {
  display: flex; flex-direction: column; padding: 4px; border-radius: 10px;
  background: var(--pop); border: 1px solid var(--edge); box-shadow: var(--shadow-pop);
  opacity: 0; visibility: hidden; pointer-events: none; transform: scale(.96); transform-origin: right center;
  transition: opacity 60ms, transform 60ms, visibility 0s 60ms;
}
.open:not(.dragging) .menu {
  opacity: 1; visibility: visible; pointer-events: auto; transform: none;
  transition: opacity 120ms var(--ease-snap), transform 120ms var(--ease-snap), visibility 0s;
}
.menu button {
  all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; gap: 10px;
  padding: 8px 10px; border-radius: 7px; white-space: nowrap; color: var(--fg); transition: background 60ms;
}
.menu svg { width: 14px; height: 14px; flex: none; color: var(--subtle); }
.menu button:hover, .menu button:focus-visible { background: var(--hover); }
.menu button:active { background: var(--active); }
@media (prefers-reduced-motion: reduce) { .btn, .menu, .label, .open:not(.dragging) .menu { transition: none; } }
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
    this.place(this.settings.fab.y);
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
      <div class="wrap" part="wrap">
        <button class="btn" type="button" aria-label="翻译此页面"><span class="ring"></span><span class="label">译</span></button>
        <div class="menu">
          <button type="button" data-act="site"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6 0 9.5 7 9.5 7a17 17 0 0 1-2.6 3.4M6.6 6.6C3.9 8.4 2.5 12 2.5 12S6 19 12 19a9.6 9.6 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>本站隐藏</button>
          <button type="button" data-act="all"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v8"/><path d="M6.3 6.3a8 8 0 1 0 11.4 0"/></svg>全部隐藏</button>
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

  /** 始终贴在右边缘，只记上下位置 */
  private place(y: number): void {
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
      this.place(clampY(ev.clientY / window.innerHeight));
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
      void this.save({ side: 'right', y: clampY(ev.clientY / window.innerHeight) });
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
