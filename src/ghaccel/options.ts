/**
 * 设置页的“GitHub 加速下载”卡片：开关、按钮位置、节点（含自建）与测速、回退、私有仓库。
 */
import { ACCEL_KEY, ACCEL_NODES, activeNode, normalizeAccel, normalizeNodeUrl, nodeHost, type AccelSettings } from './settings';
import { loadSpeed, measureAll, speedLevel, speedText, type SpeedResult } from './speed';

const root = document.getElementById('ghaccel');
let settings: AccelSettings = normalizeAccel(undefined);
let speed: SpeedResult | null = null;
let testing = false;
let customDraft: string | null = null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props) as HTMLElementTagNameMap[K];
  e.append(...kids);
  return e;
}

async function save(patch: Partial<AccelSettings>): Promise<void> {
  settings = normalizeAccel({ ...settings, ...patch });
  await chrome.storage.local.set({ [ACCEL_KEY]: settings });
  render();
}

function switchRow(title: string, sub: string, key: 'enabled' | 'fallback' | 'skipPrivate'): HTMLElement {
  const input = el('input', { type: 'checkbox', checked: settings[key] });
  input.addEventListener('change', () => void save({ [key]: input.checked }));
  return el('label', { className: 'opt' },
    el('span', {}, title, el('small', {}, sub)),
    el('span', { className: 'switch small' }, input, el('span')),
  );
}

function nodeRow(url: string, name: string, label: string, extra?: HTMLElement): HTMLElement {
  const value = url === 'custom' ? 'custom' : url;
  const real = url === 'custom' ? settings.custom : url;
  const ms = real ? speed?.ms[real] : undefined;
  const radio = el('input', { type: 'radio', name: 'ghaNode', value, checked: settings.node === value });
  radio.addEventListener('change', () => {
    if (value === 'custom' && !settings.custom) {
      customDraft = customDraft ?? '';
      render();
      root?.querySelector<HTMLInputElement>('.gha-custom input')?.focus();
      return;
    }
    void save({ node: value });
  });
  const level = speedLevel(ms);
  const pct = ms === undefined || ms < 0 ? 0 : Math.max(8, Math.min(100, 100 - ms / 30));
  return el('label', { className: `gha-node${settings.node === value ? ' on' : ''}` },
    radio,
    el('span', { className: 'gha-node-name' }, el('span', { className: 'gha-host' }, name), el('small', {}, label)),
    extra ?? el('span', { className: `gha-bar ${level}` }, el('i', { style: `width:${pct}%` })),
    el('span', { className: `gha-ms ${level}` }, speedText(ms)),
  );
}

function customInput(): HTMLElement {
  const input = el('input', { type: 'text', placeholder: 'https://your.proxy/', value: customDraft ?? settings.custom, spellcheck: false });
  const msg = el('span', { className: 'hint' });
  const commit = () => {
    const raw = input.value.trim();
    if (!raw) {
      customDraft = null;
      void save({ custom: '', node: settings.node === 'custom' ? ACCEL_NODES[0].url : settings.node });
      return;
    }
    const url = normalizeNodeUrl(raw);
    if (!url) {
      msg.textContent = '要填 https 开头的地址';
      msg.className = 'errors';
      return;
    }
    customDraft = null;
    void save({ custom: url, node: 'custom' });
  };
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commit();
  });
  return el('span', { className: 'gha-custom' }, input, msg);
}

function render(): void {
  if (!root) return;
  const seg = el('div', { className: 'seg gha-seg', role: 'radiogroup' });
  for (const [mode, text, title] of [
    ['add', '添加按钮', '在原下载入口旁加“⚡ 加速”，原下载保留'],
    ['replace', '替换链接', '原下载链接直接改走加速节点'],
  ] as const) {
    const b = el('button', { type: 'button', textContent: text, title, className: settings.mode === mode ? 'on' : '' });
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(settings.mode === mode));
    b.addEventListener('click', () => void save({ mode }));
    seg.append(b);
  }

  const test = el('button', { type: 'button', textContent: testing ? '测速中…' : '测速', disabled: testing });
  test.addEventListener('click', async () => {
    testing = true;
    render();
    const nodes = ACCEL_NODES.map((n) => n.url);
    if (settings.custom) nodes.push(settings.custom);
    speed = await measureAll(nodes);
    testing = false;
    render();
  });

  const nodes = el('div', { className: 'gha-nodes' },
    ...ACCEL_NODES.map((n, i) => nodeRow(n.url, nodeHost(n.url), i === 0 ? `${n.label}，默认` : n.label)),
    nodeRow('custom', '自定义', '自建 gh-proxy 填这里', customInput()),
  );

  const when = speed ? new Date(speed.at) : null;
  root.replaceChildren(
    el('h2', {}, 'GitHub 加速下载'),
    el('p', {}, '在 github.com 的下载入口旁加“⚡ 加速”，把链接改成 ', el('code', {}, '节点/https://github.com/…'), ' 去下载。覆盖源码 ZIP、Release 附件、Raw 文件和 clone 地址。'),
    switchRow('启用 GitHub 加速下载', '只在 github.com 生效，不改动其他网站', 'enabled'),
    el('div', { className: 'opt gha-static' },
      el('span', {}, '按钮位置', el('small', {}, '“添加按钮”保留原下载；“替换链接”让原下载按钮直接走加速')),
      seg,
    ),
    el('div', { className: 'gha-node-head' },
      el('span', {}, '加速节点', el('small', { className: 'hint' }, when ? `　上次测速 ${when.getMonth() + 1}-${when.getDate()} ${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}` : '')),
      test,
    ),
    nodes,
    switchRow('节点不可用时自动回退到原始链接', '点加速时先探一下节点，连不上就改用 GitHub 原地址下载', 'fallback'),
    switchRow('私有仓库不显示加速按钮', '代理拿不到你的 GitHub 登录状态，私有仓库加速必定失败', 'skipPrivate'),
    el('div', { className: 'gha-warn' },
      el('b', {}, '第三方代理提示：'),
      `加速下载时，下载地址和文件内容会经过所选节点（当前 ${nodeHost(activeNode(settings))}）。公共节点由第三方运营，Drak 无法保证它的可用性和内容完整性。下载可执行文件后，建议对照 Release 页面上的 sha256 校验。不点“加速”或“测速”时，Drak 不会访问任何节点。`,
    ),
  );
}

async function init(): Promise<void> {
  const data = await chrome.storage.local.get(ACCEL_KEY);
  settings = normalizeAccel(data[ACCEL_KEY]);
  speed = await loadSpeed();
  render();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[ACCEL_KEY]) return;
    const next = normalizeAccel(changes[ACCEL_KEY].newValue);
    if (JSON.stringify(next) === JSON.stringify(settings)) return;
    settings = next;
    render();
  });
}

void init();
