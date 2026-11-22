/**
 * 视频右上角的悬浮“下载”按钮（设置里默认关）。鼠标停在够大的视频上时出现，点了开始嗅探并打开资源面板。
 * 不改页面的 DOM 树：按钮挂在 <html> 下的封闭 Shadow DOM 里，用 fixed 定位贴到视频右上角。
 */
const MIN_W = 240;
const MIN_H = 135;

const CSS = `
:host { all: initial; }
button {
  all: unset; box-sizing: border-box; position: fixed; display: none; align-items: center; gap: 5px; height: 28px; padding: 0 10px;
  border-radius: 8px; background: rgb(20 20 20 / .78); color: #fff; font: 600 12px/28px system-ui, sans-serif; cursor: pointer;
  box-shadow: 0 2px 8px rgb(0 0 0 / .35); backdrop-filter: blur(6px); transition: background .15s;
}
button.on { display: inline-flex; }
button:hover { background: rgb(37 125 224 / .95); }
button:focus-visible { outline: 2px solid #4c9bf5; outline-offset: 2px; }
svg { width: 14px; height: 14px; }
`;

export class VideoHover {
  private host: HTMLElement | null = null;
  private btn!: HTMLButtonElement;
  private video: HTMLVideoElement | null = null;
  private raf = 0;
  private hideTimer = 0;
  private x = 0;
  private y = 0;
  private on = false;

  constructor(private readonly icon: string, private readonly onClick: () => void) {}

  enable(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    if (on) {
      document.addEventListener('pointermove', this.move, { capture: true, passive: true });
      window.addEventListener('scroll', this.hide, { capture: true, passive: true });
    } else {
      document.removeEventListener('pointermove', this.move, { capture: true });
      window.removeEventListener('scroll', this.hide, { capture: true });
      this.host?.remove();
      this.host = null;
    }
  }

  private build(): void {
    const host = document.createElement('div');
    host.className = 'notranslate';
    host.setAttribute('translate', 'no');
    host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483646';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>${CSS}</style><button type="button" aria-label="下载这个视频">${this.icon}<span>下载</span></button>`;
    this.btn = root.querySelector('button')!;
    this.btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onClick();
    });
    // 按钮在视频上面：别让点击、按下传给播放器（暂停 / 全屏）
    for (const t of ['pointerdown', 'mousedown', 'dblclick'] as const) this.btn.addEventListener(t, (e) => e.stopPropagation());
    this.host = host;
  }

  private readonly move = (e: PointerEvent): void => {
    this.x = e.clientX;
    this.y = e.clientY;
    if (!this.raf) this.raf = requestAnimationFrame(this.check);
  };

  private readonly hide = (): void => {
    this.video = null;
    this.btn?.classList.remove('on');
  };

  private readonly check = (): void => {
    this.raf = 0;
    if (document.fullscreenElement) return this.hide();
    const hit = this.findVideo();
    if (hit) {
      clearTimeout(this.hideTimer);
      this.show(hit);
    } else if (this.video && !this.overButton()) {
      clearTimeout(this.hideTimer);
      this.hideTimer = window.setTimeout(this.hide, 300);
    }
  };

  private overButton(): boolean {
    if (!this.btn) return false;
    const r = this.btn.getBoundingClientRect();
    return this.x >= r.left && this.x <= r.right && this.y >= r.top && this.y <= r.bottom;
  }

  /** 页面上的播放器常用透明层盖住 video，所以按坐标找，而不是看事件目标 */
  private findVideo(): HTMLVideoElement | null {
    for (const v of document.querySelectorAll('video')) {
      const r = v.getBoundingClientRect();
      if (r.width < MIN_W || r.height < MIN_H) continue;
      if (this.x >= r.left && this.x <= r.right && this.y >= r.top && this.y <= r.bottom) return v;
    }
    return null;
  }

  private show(v: HTMLVideoElement): void {
    if (!this.host) this.build();
    if (!this.host!.isConnected) document.documentElement.appendChild(this.host!);
    this.video = v;
    const r = v.getBoundingClientRect();
    const top = Math.max(r.top, 0) + 10;
    this.btn.style.top = `${top}px`;
    this.btn.style.right = `${Math.max(document.documentElement.clientWidth - r.right, 0) + 10}px`;
    this.btn.classList.add('on');
  }
}
