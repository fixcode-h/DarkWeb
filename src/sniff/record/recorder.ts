/**
 * 边播边录的扩展端（隔离环境，document_start 注入）：收集 hook 发来的数据，停止时合并成一个文件保存。
 * 数据只在这个标签页的内存里，合并后用页面里的下载链接保存，不经过网络。
 */
import { REC_CHANNEL, REC_FLAG, armed, type HookMsg } from './shared';
import { mergeFmp4 } from '../mp4';
import { mergeWebm } from '../webm';

interface Track {
  mime: string;
  chunks: ArrayBuffer[];
  bytes: number;
}

declare global {
  interface Window {
    __drakRecorder?: boolean;
  }
}

if (armed() && !window.__drakRecorder) {
  window.__drakRecorder = true;
  const tracks = new Map<number, Track>();
  let drm = false;
  let stopped = false;
  const started = Date.now();

  window.addEventListener('message', (e) => {
    if (e.source !== window || stopped) return;
    const m = e.data as HookMsg;
    if (!m || m[REC_CHANNEL] !== 1) return;
    if (m.t === 'sb') tracks.set(m.id, { mime: m.mime, chunks: [], bytes: 0 });
    else if (m.t === 'data') {
      const t = tracks.get(m.id);
      if (t) {
        t.chunks.push(m.buf);
        t.bytes += m.buf.byteLength;
      }
    } else if (m.t === 'drm') {
      drm = true;
      void finish(null);
    }
  });

  const total = () => [...tracks.values()].reduce((n, t) => n + t.bytes, 0);
  const video = () => [...document.querySelectorAll('video')].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];

  const timer = setInterval(() => {
    const v = video();
    void chrome.runtime
      .sendMessage({ type: 'sniff:rec-progress', bytes: total(), tracks: [...tracks.values()].filter((t) => t.bytes).length, time: v?.currentTime ?? 0, duration: Number.isFinite(v?.duration) ? v!.duration : 0 })
      .catch(() => {});
  }, 1000);

  async function merge(): Promise<{ blob: Blob; ext: string }[]> {
    const list = [...tracks.values()].filter((t) => t.bytes);
    if (!list.length) throw new Error('没有录到数据：这个播放器可能没用 MediaSource，试试直接嗅探');
    // 视频轨放前面
    list.sort((a, b) => Number(/^audio/.test(a.mime)) - Number(/^audio/.test(b.mime)));
    const blobs = list.map((t) => new Blob(t.chunks));
    const webm = list.map((t) => /webm/i.test(t.mime));
    if (webm.every(Boolean)) return [{ blob: await mergeWebm(blobs), ext: list.some((t) => /^video/.test(t.mime)) ? 'webm' : 'weba' }];
    if (!webm.some(Boolean)) return [{ blob: await mergeFmp4(blobs), ext: list.some((t) => /^video/.test(t.mime)) ? 'mp4' : 'm4a' }];
    return list.map((t, i) => ({ blob: blobs[i], ext: webm[i] ? 'webm' : 'mp4' }));
  }

  function save(blob: Blob, file: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file;
    a.style.display = 'none';
    document.documentElement.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  async function finish(name: string | null): Promise<void> {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    try {
      sessionStorage.removeItem(REC_FLAG);
    } catch {
      /* 忽略 */
    }
    if (drm || name === null) {
      tracks.clear();
      void chrome.runtime.sendMessage({ type: 'sniff:rec-done', ok: false, error: drm ? '加密内容（DRM），无法录制' : '已取消' }).catch(() => {});
      return;
    }
    try {
      const files = await merge();
      let bytes = 0;
      files.forEach((f, i) => {
        bytes += f.blob.size;
        save(f.blob, `${name}${files.length > 1 ? `（${i + 1}）` : ''}.${f.ext}`);
      });
      void chrome.runtime.sendMessage({ type: 'sniff:rec-done', ok: true, file: `${name}.${files[0].ext}`, bytes, seconds: (Date.now() - started) / 1000 }).catch(() => {});
    } catch (e) {
      void chrome.runtime.sendMessage({ type: 'sniff:rec-done', ok: false, error: e instanceof Error ? e.message : String(e) }).catch(() => {});
    } finally {
      tracks.clear();
    }
  }

  chrome.runtime.onMessage.addListener((m: { type?: string; name?: string }) => {
    if (m?.type === 'sniff:rec-stop') void finish(m.name ?? 'video');
    else if (m?.type === 'sniff:rec-cancel') void finish(null);
  });
}
