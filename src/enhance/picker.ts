/**
 * 屏蔽页面元素（按需注入：右键“屏蔽页面元素”、快捷键）。
 *
 * 鼠标移到哪个元素就框出哪个，点一下选中；工具条上可以“扩大到上一层”“缩小”，
 * 确认后把选择器存进当前站点的屏蔽规则，page.ts 用样式表把它隐藏，下次打开同一网站也生效。
 * 工具条放在 Shadow DOM 里，配色照 AgentPanel。
 */
import { siteKeyOf } from '../shared/settings';
import { ENHANCE_KEY, forSite, normalizeEnhance, saveEnhance } from './settings';
import { selectorFor } from './selector';

const CSS = `
:host { all: initial; }
.root {
  --pop: #262626; --fg: #ececec; --muted: #c6c6c6; --subtle: #9c9c9c;
  --edge: rgb(255 255 255 / .1); --hover: rgb(255 255 255 / .07); --active: rgb(255 255 255 / .11);
  --accent: #257de0; --on-accent: #fff; --danger: #e5484d;
  --shadow-pop: 0 8px 24px rgb(0 0 0 / .32), 0 2px 6px rgb(0 0 0 / .2);
  --ease-snap: cubic-bezier(.32, .72, 0, 1);
  font: 13px/1.4 system-ui, -apple-system, "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif; color: var(--fg); color-scheme: dark;
}
@media (prefers-color-scheme: light) {
  .root { --pop: #fff; --fg: #191919; --muted: #404040; --subtle: #666; --edge: rgb(0 0 0 / .1); --hover: rgb(0 0 0 / .05); --active: rgb(0 0 0 / .09);
    --shadow-pop: 0 8px 24px rgb(0 0 0 / .12), 0 2px 6px rgb(0 0 0 / .08); color-scheme: light; }
}
.box { position: fixed; pointer-events: none; border: 2px solid var(--danger); background: color-mix(in srgb, var(--danger) 14%, transparent);
  border-radius: 4px; transition: all 60ms linear; display: none; }
.box.locked { border-style: solid; background: color-mix(in srgb, var(--danger) 26%, transparent); }
.tag { position: fixed; pointer-events: none; display: none; max-width: 420px; padding: 2px 6px; border-radius: 5px; background: var(--danger); color: #fff;
  font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bar {
  position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); display: flex; align-items: center; gap: 4px; padding: 6px;
  background: var(--pop); border: 1px solid var(--edge); border-radius: 10px; box-shadow: var(--shadow-pop); animation: up 120ms var(--ease-snap);
}
@keyframes up { from { opacity: 0; transform: translate(-50%, 6px); } }
.hint { padding: 0 8px; color: var(--muted); white-space: nowrap; }
.bar button { all: unset; box-sizing: border-box; cursor: pointer; height: 30px; padding: 0 10px; border-radius: 7px; color: var(--fg); white-space: nowrap; transition: background 60ms; }
.bar button:hover, .bar button:focus-visible { background: var(--hover); }
.bar button:active { background: var(--active); }
.bar button:disabled { opacity: .4; cursor: default; background: none; }
.bar button.primary { background: var(--accent); color: var(--on-accent); }
.bar button.primary:hover { background: color-mix(in srgb, var(--accent), #fff 10%); }
.sep { width: 1px; height: 18px; background: var(--edge); margin: 0 2px; }
@media (prefers-reduced-motion: reduce) { .box, .bar { transition: none; animation: none; } }
`;

interface PickerApi {
  toggle(): void;
}

class Picker implements PickerApi {
  private host: HTMLElement | null = null;
  private root!: HTMLElement;
  private box!: HTMLElement;
  private tag!: HTMLElement;
  private hint!: HTMLElement;
  private target: Element | null = null;
  /** 选中后用“扩大”走过的路径，用于“缩小”退回 */
  private trail: Element[] = [];
  private locked = false;
  /** 本站已隐藏的规则数 */
  private count = 0;
  private readonly site = siteKeyOf(location.host);

  toggle(): void {
    if (this.host) this.stop();
    else this.start();
  }

  private start(): void {
    this.host = document.createElement('div');
    this.host.setAttribute('data-drak-picker', '');
    this.host.style.cssText = 'all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;';
    const shadow = this.host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${CSS}</style><div class="root">
      <div class="box"></div><div class="tag"></div>
      <div class="bar" style="pointer-events:auto" role="toolbar" aria-label="屏蔽页面元素">
        <span class="hint"></span>
        <button data-act="up" title="选中外面一层">扩大</button>
        <button data-act="down" title="退回里面一层">缩小</button>
        <span class="sep"></span>
        <button data-act="hide" class="primary">隐藏</button>
        <button data-act="reset" title="恢复本站隐藏的所有元素">全部恢复</button>
        <button data-act="exit">退出</button>
      </div></div>`;
    this.root = shadow.querySelector('.root')!;
    this.box = shadow.querySelector('.box')!;
    this.tag = shadow.querySelector('.tag')!;
    this.hint = shadow.querySelector('.hint')!;
    shadow.querySelector('.bar')!.addEventListener('click', (e) => {
      const act = (e.target as Element).closest('button')?.getAttribute('data-act');
      if (act) void this.act(act);
    });
    document.documentElement.appendChild(this.host);
    document.addEventListener('mousemove', this.onMove, true);
    document.addEventListener('click', this.onClick, true);
    document.addEventListener('keydown', this.onKey, true);
    window.addEventListener('scroll', this.redraw, true);
    void this.refreshHint();
    this.render();
  }

  private stop(): void {
    document.removeEventListener('mousemove', this.onMove, true);
    document.removeEventListener('click', this.onClick, true);
    document.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('scroll', this.redraw, true);
    this.host?.remove();
    this.host = null;
    this.target = null;
    this.trail = [];
    this.locked = false;
  }

  private isOurs(e: Event): boolean {
    return !!this.host && e.composedPath().includes(this.host);
  }

  private pickable(el: Element | null): el is Element {
    return !!el && el !== document.documentElement && el !== document.body && !el.closest('[data-drak-picker]');
  }

  private readonly onMove = (e: MouseEvent): void => {
    if (this.locked || this.isOurs(e)) return;
    // 宿主自己 pointer-events: none，elementFromPoint 拿到的就是页面元素
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (this.pickable(el) && el !== this.target) {
      this.target = el;
      this.render();
    }
  };

  private readonly onClick = (e: MouseEvent): void => {
    if (this.isOurs(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!this.pickable(el)) return;
    this.target = el;
    this.trail = [];
    this.locked = true;
    this.render();
  };

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (this.locked) {
        this.locked = false;
        this.render();
      } else this.stop();
    } else if (e.key === 'Enter' && this.locked) {
      e.preventDefault();
      void this.act('hide');
    }
  };

  private readonly redraw = (): void => this.render();

  private render(): void {
    const el = this.target;
    this.box.classList.toggle('locked', this.locked);
    const up = this.root.querySelector('[data-act="up"]') as HTMLButtonElement;
    const down = this.root.querySelector('[data-act="down"]') as HTMLButtonElement;
    const hide = this.root.querySelector('[data-act="hide"]') as HTMLButtonElement;
    up.disabled = !this.locked || !this.pickable(el?.parentElement ?? null);
    down.disabled = !this.locked || !this.trail.length;
    hide.disabled = !this.locked;
    (this.root.querySelector('[data-act="reset"]') as HTMLButtonElement).disabled = !this.count;
    this.hint.textContent = this.locked
      ? '确认隐藏这个元素？按 Enter 确认，Esc 重选'
      : `点选要隐藏的元素${this.count ? `（本站已隐藏 ${this.count} 个）` : ''}`;
    if (!el || !el.isConnected) {
      this.box.style.display = this.tag.style.display = 'none';
      return;
    }
    const r = el.getBoundingClientRect();
    Object.assign(this.box.style, { display: 'block', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    this.tag.textContent = selectorFor(el);
    Object.assign(this.tag.style, { display: 'block', left: `${Math.max(4, r.left)}px`, top: `${r.top > 24 ? r.top - 22 : r.bottom + 4}px` });
  }

  private async load() {
    return normalizeEnhance((await chrome.storage.local.get(ENHANCE_KEY))[ENHANCE_KEY]);
  }

  private async refreshHint(): Promise<void> {
    this.count = forSite((await this.load()).hideRules, this.site).flat().length;
    this.render();
  }

  private async act(a: string): Promise<void> {
    if (a === 'exit') return this.stop();
    if (a === 'up' && this.target?.parentElement && this.pickable(this.target.parentElement)) {
      this.trail.push(this.target);
      this.target = this.target.parentElement;
    }
    if (a === 'down' && this.trail.length) this.target = this.trail.pop()!;
    if (a === 'hide' && this.target && this.site) {
      const sel = selectorFor(this.target);
      const s = await this.load();
      const list = s.hideRules[this.site] ?? [];
      if (!list.includes(sel)) s.hideRules[this.site] = [...list, sel];
      await saveEnhance(s);
      this.target = null;
      this.locked = false;
    }
    if (a === 'reset' && this.site) {
      const s = await this.load();
      for (const k of Object.keys(s.hideRules)) if (this.site === k || this.site.endsWith(`.${k}`)) delete s.hideRules[k];
      await saveEnhance(s);
    }
    this.render();
    await this.refreshHint();
  }
}

const w = window as unknown as { __drakPicker?: PickerApi };
(w.__drakPicker ??= new Picker()).toggle();
