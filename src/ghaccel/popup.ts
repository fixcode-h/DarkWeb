/**
 * 弹窗里的“GitHub 加速下载”小卡片：只在当前标签页是 github.com 时出现，开关 + 切换节点。
 * 卡片由脚本插到站点卡片后面，弹窗 HTML 不用改。
 */
import { ACCEL_KEY, ACCEL_NODES, normalizeAccel, nodeHost, type AccelSettings } from './settings';
import { loadSpeed, speedText } from './speed';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props) as HTMLElementTagNameMap[K];
  e.append(...kids);
  return e;
}

async function init(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let host = '';
  try {
    host = tab?.url ? new URL(tab.url).host : '';
  } catch {
    /* 无效网址 */
  }
  if (host !== 'github.com') return;
  const anchor = document.querySelector('section.card.site');
  if (!anchor) return;

  const data = await chrome.storage.local.get(ACCEL_KEY);
  let settings: AccelSettings = normalizeAccel(data[ACCEL_KEY]);
  const speed = await loadSpeed();
  const save = async (patch: Partial<AccelSettings>) => {
    settings = normalizeAccel({ ...settings, ...patch });
    await chrome.storage.local.set({ [ACCEL_KEY]: settings });
    render();
  };

  const card = el('section', { className: 'card gha-card', id: 'ghaBox' });
  const toggle = el('input', { type: 'checkbox', id: 'ghaEnabled' });
  toggle.addEventListener('change', () => void save({ enabled: toggle.checked }));
  const badge = el('span', { className: 'gha-badge' });
  const select = el('select', { id: 'ghaNode' });
  select.setAttribute('aria-label', '加速节点');
  select.addEventListener('change', () => void save({ node: select.value }));
  const more = el('a', { href: '#', textContent: '设置' });
  more.addEventListener('click', (e) => {
    e.preventDefault();
    void chrome.tabs.create({ url: chrome.runtime.getURL('options.html#ghaccel') });
  });

  function render(): void {
    toggle.checked = settings.enabled;
    badge.textContent = settings.enabled ? '⚡ 已开启' : '已关闭';
    badge.classList.toggle('off', !settings.enabled);
    const opts = ACCEL_NODES.map((n) => ({ value: n.url, url: n.url }));
    if (settings.custom) opts.push({ value: 'custom', url: settings.custom });
    select.replaceChildren(...opts.map((o) => {
      const t = speedText(speed?.ms[o.url]);
      return el('option', { value: o.value, textContent: `${nodeHost(o.url)}${t ? ` · ${t}` : ''}`, selected: settings.node === o.value });
    }));
    select.disabled = !settings.enabled;
  }

  card.append(
    el('div', { className: 'gha-head' },
      el('h2', {}, 'GitHub 加速下载 ', badge),
      el('label', { className: 'switch small', title: '在 GitHub 的下载入口旁显示“⚡ 加速”' }, toggle, el('span')),
    ),
    el('div', { className: 'gha-line' }, el('span', {}, '节点'), select, more),
  );
  render();
  anchor.after(card);
}

void init();
