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

  const fab = toggle('视频上的悬浮下载按钮', '鼠标停在视频上时，右上角出现“下载”按钮，点了开始嗅探', s.fab, (v) => save({ fab: v }));

  const bili = toggle('B 站', '在视频和番剧页面直接列出清晰度，下载后自动合并音视频；清晰度跟随你账号本来能看的', s.bili.enabled, (v) => save({ bili: { ...s.bili, enabled: v } }));
  const codec = el('div', 'seg');
  codec.style.width = '260px';
  for (const [k, label] of [['avc', 'AVC'], ['hevc', 'HEVC'], ['av1', 'AV1'], ['smallest', '最小']] as const) {
    const b = el('button', s.bili.codec === k ? 'on' : '', label);
    b.type = 'button';
    b.addEventListener('click', () => save({ bili: { ...s.bili, codec: k } }));
    codec.append(b);
  }
  const codecField = field('B 站视频编码（AVC 兼容性最好）', codec);
  codecField.classList.toggle('inactive', !s.bili.enabled);

  // 完整版（GitHub 上的普通包）才有 YouTube 和边播边录，商店版不显示
  const caps = (await chrome.runtime.sendMessage({ type: 'sniff:state' }).catch(() => null)) as { canRecord?: boolean } | null;
  const full = caps?.canRecord
    ? [
        toggle('YouTube', '允许在 YouTube 上嗅探；YouTube 的视频分段加载，用“边播边录”保存。只录播放器加载过的部分，会员和加密内容不行', s.youtube.enabled, (v) => save({ youtube: { enabled: v } })),
      ]
    : [];

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
    fab,
    el('h2', 'sub', '站点适配'),
    bili,
    codecField,
    ...full,
    warn,
  );
  root.classList.toggle('inactive', !s.enabled);
}

chrome.storage.onChanged.addListener((c, area) => {
  if (area === 'local' && c[SNIFF_KEY]) void render();
});
void render();
