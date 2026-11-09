import { BUILTIN_RULES } from '../shared/builtin-rules';
import { parseUserRules } from '../shared/rules';
import { CACHE_PREFIX, SETTINGS_KEY, normalizeSettings, type Settings } from '../shared/settings';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const MODE_TEXT: Record<string, string> = {
  dynamic: '动态配色',
  native: '站点原生暗色',
  filter: '滤镜反色',
  off: '关闭',
};

const EXAMPLE = [
  {
    match: ['*.example.com'],
    mode: 'dynamic',
    ignore: ['.video-player'],
    invert: ['img.formula'],
    keepImage: ['img.qrcode'],
    vars: { '--page-bg': '#18191a' },
    css: '.header { border-bottom-color: #333; }',
  },
];

let settings: Settings;

async function load(): Promise<void> {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  settings = normalizeSettings(data[SETTINGS_KEY]);
  $<HTMLTextAreaElement>('rules').value = settings.userRules;
  $('builtin').textContent = JSON.stringify(BUILTIN_RULES, null, 2);
  renderSites();
}

function renderSites(): void {
  const tbody = $('sites').querySelector('tbody')!;
  tbody.textContent = '';
  const entries = Object.entries(settings.siteModes);
  $('noSites').style.display = entries.length ? 'none' : '';
  for (const [host, mode] of entries) {
    const tr = document.createElement('tr');
    const a = document.createElement('td');
    a.textContent = host;
    const b = document.createElement('td');
    b.textContent = MODE_TEXT[mode] ?? mode;
    const c = document.createElement('td');
    const btn = document.createElement('button');
    btn.textContent = '恢复自动';
    btn.addEventListener('click', async () => {
      const siteModes = { ...settings.siteModes };
      delete siteModes[host];
      settings = { ...settings, siteModes };
      await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
      renderSites();
    });
    c.appendChild(btn);
    tr.append(a, b, c);
    tbody.appendChild(tr);
  }
}

$('saveRules').addEventListener('click', async () => {
  const text = $<HTMLTextAreaElement>('rules').value;
  const parsed = parseUserRules(text);
  $('rulesErr').textContent = parsed.errors.join('\n');
  if (parsed.errors.length && !parsed.rules.length && text.trim() !== '[]' && text.trim() !== '') {
    $('rulesMsg').textContent = '';
    return;
  }
  settings = { ...settings, userRules: text.trim() || '[]' };
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  $('rulesMsg').className = 'ok';
  $('rulesMsg').textContent = parsed.errors.length ? `已保存，${parsed.rules.length} 条生效，有问题的条目已忽略` : `已保存，${parsed.rules.length} 条生效`;
});

$('example').addEventListener('click', () => {
  $<HTMLTextAreaElement>('rules').value = JSON.stringify(EXAMPLE, null, 2);
});

$('clearCache').addEventListener('click', async () => {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith(CACHE_PREFIX));
  await chrome.storage.local.remove(keys);
  $('cacheMsg').className = 'ok';
  $('cacheMsg').textContent = `已清空 ${keys.length} 个网站的缓存`;
});

load();
