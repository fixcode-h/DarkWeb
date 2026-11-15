/**
 * 页面侧边的翻译快捷按钮（静态内容脚本，只在顶层页面运行）。
 *
 * 贴在屏幕右边缘的半个标签，鼠标移上去整个滑出；点一下翻译，再点一下显示原文；
 * 按住可以上下拖动（始终吸附在右边缘）。
 * 下面跟一列同样贴边的小按钮，点了直接生效：阅读模式、屏蔽页面元素、本站暗色开关；鼠标移到这一列上时全部滑出，
 * 最后出现一个“本站隐藏”。只放常用的、一次一用的功能：字体排版、护眼滤镜、自定义 CSS 这类设一次就不动的留在设置页。
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
import { SETTINGS_KEY, normalizeSettings, siteModeFor, type Settings } from '../shared/settings';
import { CSS, ICONS, TOOLS_HTML } from './fab-style';

const DRAG_THRESHOLD = 5;

class Fab {
  private host: HTMLElement | null = null;
  private wrap!: HTMLElement;
  private btn!: HTMLButtonElement;
  private root!: ShadowRoot;
  private hover = false;
  private settings!: TranslateSettings;
  private readonly site = siteKeyOf(location.host);
  private state: PageState = { active: false, busy: false };
  /** 暗色模式设置，用来显示“本站暗色”开关的状态 */
  private dark: Settings | null = null;
  private closeTimer = 0;

  async init(): Promise<void> {
    this.settings = await loadTranslate();
    this.dark = normalizeSettings((await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY]);
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
      if (area === 'local' && changes[SETTINGS_KEY]) {
        this.dark = normalizeSettings(changes[SETTINGS_KEY].newValue);
        this.render();
      }
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
        <button class="tab btn" type="button" aria-label="翻译此页面"><span class="ring"></span><span class="label">译</span></button>
        ${TOOLS_HTML}
      </div>`;
    this.wrap = root.querySelector('.wrap')!;
    this.btn = root.querySelector('.btn')!;
    this.host = host;

    this.root = root;
    // 鼠标在这一列按钮上就全部滑出；键盘用 Tab 走进来时也滑出，焦点离开整列才收起。
    // 鼠标点过按钮后焦点会留在按钮上（不是 :focus-visible），这时只看鼠标，否则移开后收不回去
    this.wrap.addEventListener('pointerenter', () => {
      this.hover = true;
      this.open(true);
    });
    this.wrap.addEventListener('pointerleave', () => {
      this.hover = false;
      if (!this.wrap.querySelector(':focus-visible')) this.open(false);
    });
    this.wrap.addEventListener('focusin', () => this.open(true));
    this.wrap.addEventListener('focusout', (e) => {
      if (!this.hover && !this.wrap.contains(e.relatedTarget as Node | null)) this.open(false);
    });
    this.btn.addEventListener('pointerdown', (e) => this.drag(e));
    this.btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.toggle();
      }
    });
    this.wrap.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('.tool, .hide');
      if (!el || el.getAttribute('aria-disabled') === 'true') return;
      const act = el.dataset.act;
      if (act === 'reader' || act === 'picker') {
        // 阅读模式盖住整页、点选屏蔽要点页面元素：先把按钮收回去
        this.close();
        void chrome.runtime.sendMessage({ type: 'enh:run', tool: act }).catch(() => {});
      } else if (act === 'dark') void chrome.runtime.sendMessage({ type: 'fab:toggle-dark' }).catch(() => {});
      else if (act === 'site') void this.save({ hiddenSites: [...this.settings.fab.hiddenSites.filter((s) => s !== this.site), this.site] });
    });
  }

  private close(): void {
    clearTimeout(this.closeTimer);
    this.wrap.classList.remove('open');
    (this.root.activeElement as HTMLElement | null)?.blur();
  }

  private open(on: boolean): void {
    clearTimeout(this.closeTimer);
    if (on) this.wrap.classList.add('open');
    // 稍等再收起，鼠标在按钮之间移动时不会闪
    else this.closeTimer = window.setTimeout(() => this.wrap.classList.remove('open'), 250);
  }

  /** 始终贴在右边缘，只记上下位置 */
  private place(y: number): void {
    this.wrap.style.top = `${Math.round(y * 1000) / 10}vh`;
    this.wrap.classList.toggle('up', y > 0.6);
  }

  private render(): void {
    if (!this.host) return;
    this.wrap.classList.toggle('on', this.state.active);
    this.wrap.classList.toggle('busy', this.state.busy);
    const label = this.state.active ? '显示原文' : '翻译此页面';
    this.btn.setAttribute('aria-label', label);
    this.btn.title = `${label}（Alt+Shift+T）\n按住可拖动`;
    this.btn.querySelector('.label')!.textContent = this.state.active ? '原' : '译';

    // 本站暗色：全局开着且本站没被关掉就算开。月亮 = 开着，太阳 = 本站关了；全局关了这里开不了
    const d = this.dark;
    const darkOn = !!d && d.enabled && siteModeFor(d, location.host) !== 'off';
    const off = !!d && !d.enabled;
    const dark = this.wrap.querySelector<HTMLElement>('[data-act="dark"]')!;
    dark.classList.toggle('dark-on', darkOn);
    dark.innerHTML = darkOn || off ? ICONS.moon : ICONS.sun;
    dark.setAttribute('aria-checked', String(darkOn));
    dark.setAttribute('aria-disabled', String(off));
    dark.setAttribute('aria-label', '本站暗色');
    dark.dataset.tip = off ? '暗色模式已全局关闭\n在扩展弹窗里打开' : `本站暗色：${darkOn ? '已开启，点击关闭' : '已关闭，点击开启'}\nAlt+Shift+D`;
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
