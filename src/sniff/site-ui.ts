/**
 * 弹窗和侧边面板共用的“站点适配”区块：B 站视频的分 P、清晰度、下载按钮，以及封面、字幕、弹幕。
 * 两边各自提供样式（类名前缀 st-）。
 */
import type { SiteState } from './site';
import { fmtSize } from './format';

export type SiteAction = { what: 'video'; part: number; qn: number } | { what: 'cover'; part: number } | { what: 'danmaku'; part: number } | { what: 'subtitle'; part: number; lang: string };

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

/** 记住用户在这一页选的分 P 和清晰度，重绘时不跳回去 */
const picked = new Map<string, { part?: number; qn?: number }>();

export function siteBlock(state: SiteState, canDownload: boolean, act: (a: SiteAction) => void): HTMLElement {
  const box = el('div', 'st');
  if ('loading' in state) {
    box.append(el('div', 'st-sub', '正在读取 B 站视频信息…'));
    return box;
  }
  if ('error' in state) {
    box.append(el('div', 'st-sub st-warn', `读取 B 站视频信息失败：${state.error}`));
    return box;
  }
  const s = state.info;
  const key = `${s.title}|${s.parts.length}`;
  const mem = picked.get(key) ?? {};
  picked.set(key, mem);

  const head = el('div', 'st-head');
  head.append(el('span', 'st-badge', s.kind === 'bangumi' ? 'B站番剧' : 'B站'), el('span', 'st-title', s.title));
  head.title = s.title;
  box.append(head);
  const codec = s.qualities.find((q) => q.available)?.codec;
  const meta = [s.owner && `UP 主：${s.owner}`, codec && `视频 ${codec}`, s.audio && `音频 ${s.audio}`].filter(Boolean).join(' · ');
  if (meta) box.append(el('div', 'st-sub', meta));

  if (s.drm) {
    box.append(el('div', 'st-sub st-warn', '这个视频是 DRM 加密的版权内容，无法下载。'));
    return box;
  }
  if (s.preview) box.append(el('div', 'st-sub st-warn', '当前账号只能看试看片段，只能下载试看部分。'));

  let part = mem.part ?? s.parts[s.current]?.index ?? 1;
  if (s.parts.length > 1) {
    const sel = el('select', 'st-sel');
    sel.setAttribute('aria-label', s.kind === 'bangumi' ? '选集' : '分P');
    for (const p of s.parts) {
      const o = el('option', '', `${s.kind === 'bangumi' ? '第' : 'P'}${p.index}${s.kind === 'bangumi' ? '集' : ''} ${p.title}`.trim());
      o.value = String(p.index);
      o.selected = p.index === part;
      sel.append(o);
    }
    sel.addEventListener('change', () => (mem.part = part = Number(sel.value)));
    box.append(sel);
  }

  const avail = s.qualities.filter((q) => q.available);
  let qn = mem.qn && avail.some((q) => q.qn === mem.qn) ? mem.qn : avail[0]?.qn;
  const row = el('div', 'st-row');
  const sel = el('select', 'st-sel');
  sel.setAttribute('aria-label', '清晰度');
  for (const q of s.qualities) {
    const extra = q.available ? (part === s.parts[s.current]?.index && q.size ? `约 ${fmtSize(q.size)}` : '') : q.reason ?? '';
    const o = el('option', '', `${q.label}${extra ? ` · ${extra}` : ''}`);
    o.value = String(q.qn);
    o.disabled = !q.available;
    o.selected = q.qn === qn;
    sel.append(o);
  }
  sel.addEventListener('change', () => (mem.qn = qn = Number(sel.value)));
  const dl = el('button', 'st-btn primary', '下载视频');
  dl.type = 'button';
  dl.disabled = !canDownload || !qn;
  dl.addEventListener('click', () => qn && act({ what: 'video', part, qn }));
  row.append(sel, dl);
  box.append(row);
  if (!avail.length) box.append(el('div', 'st-sub st-warn', '当前账号没有可下载的清晰度。'));

  const extras = el('div', 'st-acts');
  const link = (text: string, a: () => SiteAction) => {
    const b = el('button', 'st-link', text);
    b.type = 'button';
    b.disabled = !canDownload;
    b.addEventListener('click', () => act(a()));
    extras.append(b);
  };
  if (s.cover) link('封面', () => ({ what: 'cover', part }));
  for (const sub of s.subtitles) link(`字幕 ${sub.label}`, () => ({ what: 'subtitle', part, lang: sub.lang }));
  link('弹幕 XML', () => ({ what: 'danmaku', part }));
  box.append(extras);
  return box;
}
