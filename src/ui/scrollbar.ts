/**
 * 悬浮滚动条：隐藏系统滚动条（宽、浅灰、带上下箭头，还占掉一条内容宽度），
 * 改成浮在内容上的细条。平时 4px、半透明，滚动时出现，停下 1 秒后淡出；
 * 鼠标移到右边缘变粗，可以拖动，也可以点轨道跳转。只管整页滚动（弹窗就是整页滚动）。
 * top / bottom 传固定在顶部、底部的元素，滚动条只画在它们之间。
 */
export function mountOverlayScrollbar(opts: { top?: HTMLElement | null; bottom?: HTMLElement | null } = {}): void {
  const root = document.documentElement;
  root.classList.add('ov-scroll');
  const track = document.createElement('div');
  track.className = 'ov-track';
  track.setAttribute('aria-hidden', 'true');
  const thumb = document.createElement('div');
  thumb.className = 'ov-thumb';
  track.append(thumb);
  document.body.append(track);

  let hideTimer = 0;
  let thumbH = 0;
  let trackH = 0;

  const max = () => root.scrollHeight - root.clientHeight;

  function layout(): void {
    const top = opts.top?.offsetHeight ?? 0;
    const bottom = opts.bottom && getComputedStyle(opts.bottom).position === 'sticky' ? opts.bottom.offsetHeight : 0;
    track.style.top = `${top + 4}px`;
    track.style.bottom = `${bottom + 4}px`;
    trackH = Math.max(0, root.clientHeight - top - bottom - 8);
    const m = max();
    track.hidden = m <= 1;
    if (m <= 1) return;
    thumbH = Math.max(28, (trackH * root.clientHeight) / root.scrollHeight);
    thumb.style.height = `${thumbH}px`;
    position();
  }

  function position(): void {
    const m = max();
    const y = m > 0 ? (root.scrollTop / m) * (trackH - thumbH) : 0;
    thumb.style.transform = `translateY(${y}px)`;
    opts.top?.classList.toggle('scrolled', root.scrollTop > 0);
  }

  function flash(): void {
    track.classList.add('show');
    clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => track.classList.remove('show'), 1000);
  }

  window.addEventListener('scroll', () => {
    position();
    flash();
  }, { passive: true });
  window.addEventListener('resize', layout);
  new ResizeObserver(layout).observe(document.body);

  track.addEventListener('pointerenter', () => track.classList.add('hover'));
  track.addEventListener('pointerleave', () => track.classList.remove('hover'));

  // 拖动滑块
  thumb.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    thumb.setPointerCapture(e.pointerId);
    track.classList.add('drag');
    const startY = e.clientY;
    const startTop = root.scrollTop;
    const ratio = max() / Math.max(1, trackH - thumbH);
    const move = (ev: PointerEvent) => root.scrollTo({ top: startTop + (ev.clientY - startY) * ratio });
    const up = () => {
      track.classList.remove('drag');
      thumb.removeEventListener('pointermove', move);
      thumb.removeEventListener('pointerup', up);
      thumb.removeEventListener('pointercancel', up);
    };
    thumb.addEventListener('pointermove', move);
    thumb.addEventListener('pointerup', up);
    thumb.addEventListener('pointercancel', up);
  });

  // 点轨道：滑块中心跳到点击位置
  track.addEventListener('pointerdown', (e) => {
    if (e.target !== track) return;
    const rect = track.getBoundingClientRect();
    const y = e.clientY - rect.top - thumbH / 2;
    root.scrollTo({ top: (Math.max(0, y) / Math.max(1, trackH - thumbH)) * max(), behavior: 'smooth' });
  });

  layout();
}
