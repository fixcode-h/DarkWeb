/** 设置页的“资源嗅探”卡片 */
import { DEFAULT_SNIFF, SNIFF_KEY, loadSniff, saveSniff, type SniffSettings, type SniffType } from './settings';

const root = document.getElementById('sniff');

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function toggle(label: string, hint: string, checked: boolean, onChange: (v: boolean) => void): HTMLLabelElement {
  const l = el('label', 'opt');
  const t = el('span', '', label);
  if (hint) t.append(el('small', '', hint));
  const sw = el('span', 'switch small');
  const input = el('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  sw.append(input, el('span'));
  l.append(t, sw);
  return l;
}

function field(label: string, control: HTMLElement): HTMLLabelElement {
  const l = el('label', 'field');
  l.append(el('span', '', label), control);
  return l;
}

const TYPES: [SniffType, string][] = [
  ['video', '视频文件'],
  ['audio', '音频'],
  ['hls', 'HLS m3u8'],
  ['dash', 'DASH mpd'],
  ['image', '大图片'],
];

async function render(): Promise<void> {
  if (!root) return;
  const s = await loadSniff();
  const save = (patch: Partial<SniffSettings>) => void saveSniff(patch);
  const intro = el('p', '', '识别网页里正在播放的视频和音频，方便保存到本地。默认不嗅探：在页面右侧的快捷按钮或弹窗里点“嗅探”后，才开始监听当前标签页。');

  const enable = toggle('启用资源嗅探', '开启后右侧快捷按钮里会多一个“嗅探”按钮；不点就不监听任何请求', s.enabled, async (v) => {
    await saveSniff({ enabled: v });
    if (v) await chrome.permissions.request({ permissions: ['downloads'] }).catch(() => false);
  });

  const types = el('div', 'sn-types');
  for (const [k, label] of TYPES) {
    const b = el('button', 'sn-chip', label);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(s.types[k]));
    b.addEventListener('click', () => save({ types: { ...s.types, [k]: !s.types[k] } }));
    types.append(b);
  }

  const min = el('input', 'sn-num');
  min.type = 'text';
  min.inputMode = 'numeric';
  min.value = String(s.minSizeKB);
  min.addEventListener('change', () => save({ minSizeKB: Number(min.value.replace(/\D/g, '')) || DEFAULT_SNIFF.minSizeKB }));

  const name = el('input');
  name.type = 'text';
  name.value = s.filename;
  name.placeholder = DEFAULT_SNIFF.filename;
  name.addEventListener('change', () => save({ filename: name.value }));

  const conc = el('div', 'seg');
  conc.style.width = '180px';
  for (const n of [3, 6, 10] as const) {
    const b = el('button', s.concurrency === n ? 'on' : '', String(n));
    b.type = 'button';
    b.addEventListener('click', () => save({ concurrency: n }));
    conc.append(b);
  }

  const warn = el('div', 'sn-warnbox');
  warn.append(el('b', '', '版权提示：'), '请只下载你有权保存的内容，仅供个人离线观看。Drak 不支持也不会尝试下载 DRM 加密、付费会员专享或需要绕过登录的内容。');

  root.replaceChildren(
    el('h2', '', '资源嗅探'),
    intro,
    enable,
    el('h2', 'sub', '识别的类型'),
    types,
    field('忽略小于此大小的文件（KB）', min),
    field('文件名（可用 {标题} {日期}）', name),
    field('同时下载的分片数', conc),
    warn,
  );
  root.classList.toggle('inactive', !s.enabled);
}

chrome.storage.onChanged.addListener((c, area) => {
  if (area === 'local' && c[SNIFF_KEY]) void render();
});
void render();
