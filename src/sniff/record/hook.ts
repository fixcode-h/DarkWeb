/**
 * 边播边录的页面端（MAIN 环境，document_start 注入）：记下播放器喂给 MediaSource 的每一段数据，复制一份交给扩展。
 * 只在 sessionStorage 有录制标记的标签页上生效；不改变播放器的行为，数据照常送进 SourceBuffer。
 */
import { REC_CHANNEL, armed, type HookMsg } from './shared';

declare global {
  interface Window {
    __drakRecHook?: boolean;
  }
}

if (armed() && !window.__drakRecHook && typeof SourceBuffer !== 'undefined') {
  window.__drakRecHook = true;
  type Body = HookMsg extends infer M ? (M extends HookMsg ? Omit<M, typeof REC_CHANNEL> : never) : never;
  const post = (m: Body, transfer?: Transferable[]) => window.postMessage({ ...m, [REC_CHANNEL]: 1 }, location.origin, transfer);
  const ids = new WeakMap<SourceBuffer, number>();
  let n = 0;

  const add = MediaSource.prototype.addSourceBuffer;
  MediaSource.prototype.addSourceBuffer = function (this: MediaSource, mime: string) {
    const sb = add.call(this, mime);
    const id = ++n;
    ids.set(sb, id);
    post({ t: 'sb', id, mime });
    return sb;
  };

  const append = SourceBuffer.prototype.appendBuffer;
  SourceBuffer.prototype.appendBuffer = function (this: SourceBuffer, data: BufferSource) {
    const id = ids.get(this);
    if (id) {
      try {
        const view = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        const copy = view.slice().buffer;
        post({ t: 'data', id, buf: copy }, [copy]);
      } catch {
        /* 复制失败就不录这一段，不影响播放 */
      }
    }
    return append.call(this, data);
  };

  // 加密内容：播放器一请求许可证就告诉扩展停止
  document.addEventListener('encrypted', () => post({ t: 'drm' }), true);
}
