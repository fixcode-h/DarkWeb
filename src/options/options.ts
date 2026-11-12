import { BUILTIN_RULES } from '../shared/builtin-rules';
import { parseUserRules } from '../shared/rules';
import { CACHE_PREFIX, SETTINGS_KEY, normalizeSettings, parseClock, type Settings, type SiteMode } from '../shared/settings';
import { mountAppearance, type AppearanceControls } from '../ui/appearance';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const MODE_TEXT: Record<Exclude<SiteMode, 'auto'>, string> = {
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
let appearance: AppearanceControls;

async function save(patch: Partial<Settings>): Promise<void> {
  settings = { ...settings, ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  render();
}

function flash(id: string, text: string, ok = true): void {
  const el = $(id);
  el.className = ok ? 'ok' : 'errors';
  el.textContent = text;
}

function render(): void {
  $<HTMLInputElement>('enabled').checked = settings.enabled;
  $<HTMLInputElement>('followSystem').checked = settings.followSystem;
  $<HTMLInputElement>('scheduleEnabled').checked = settings.scheduleEnabled;
  $<HTMLInputElement>('dimImages').checked = settings.dimImages;
  $<HTMLInputElement>('skipDarkPages').checked = settings.skipDarkPages;
  $<HTMLInputElement>('scheduleStart').value = settings.scheduleStart;
  $<HTMLInputElement>('scheduleEnd').value = settings.scheduleEnd;
  $('times').classList.toggle('muted', !settings.scheduleEnabled);
  appearance.update(settings);
  renderSites();
}

function renderSites(): void {
  const tbody = $('sites').querySelector('tbody')!;
  tbody.textContent = '';
  const entries = Object.entries(settings.siteModes).sort((a, b) => a[0].localeCompare(b[0]));
  $('noSites').style.display = entries.length ? 'none' : '';
  const setMode = (host: string, mode: SiteMode | null) => {
    const siteModes = { ...settings.siteModes };
    if (mode === null || mode === 'auto') delete siteModes[host];
    else siteModes[host] = mode;
    void save({ siteModes });
  };
  for (const [host, mode] of entries) {
    const tr = document.createElement('tr');
    const a = document.createElement('td');
    a.textContent = host;
    const b = document.createElement('td');
    const sel = document.createElement('select');
    for (const [value, text] of Object.entries(MODE_TEXT)) sel.add(new Option(text, value));
    sel.value = mode;
    sel.addEventListener('change', () => setMode(host, sel.value as SiteMode));
    b.appendChild(sel);
    const c = document.createElement('td');
    const btn = document.createElement('button');
    btn.textContent = '恢复自动';
    btn.addEventListener('click', () => setMode(host, null));
    c.appendChild(btn);
    tr.append(a, b, c);
    tbody.appendChild(tr);
  }
}

function fmtBytes(n: number): string {
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

async function cacheKeys(): Promise<string[]> {
  const all = await chrome.storage.local.get(null);
  return Object.keys(all).filter((k) => k.startsWith(CACHE_PREFIX));
}

async function renderCache(): Promise<void> {
  const keys = await cacheKeys();
  const bytes = keys.length ? await chrome.storage.local.getBytesInUse(keys) : 0;
  $('cacheMsg').className = 'hint';
  $('cacheMsg').textContent = keys.length ? `${keys.length} 个网站，共 ${fmtBytes(bytes)}` : '暂无缓存';
}

async function load(): Promise<void> {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  settings = normalizeSettings(data[SETTINGS_KEY]);
  $<HTMLTextAreaElement>('rules').value = settings.userRules;
  $('builtin').textContent = JSON.stringify(BUILTIN_RULES, null, 2);
  appearance = mountAppearance($('appearance'), settings, (patch) => void save(patch));
  render();
  void renderCache();

  for (const id of ['enabled', 'followSystem', 'scheduleEnabled', 'dimImages', 'skipDarkPages'] as const) {
    $<HTMLInputElement>(id).addEventListener('change', (e) => void save({ [id]: (e.target as HTMLInputElement).checked } as Partial<Settings>));
  }
  for (const id of ['scheduleStart', 'scheduleEnd'] as const) {
    $<HTMLInputElement>(id).addEventListener('change', (e) => {
      const v = (e.target as HTMLInputElement).value;
      if (parseClock(v) !== null) void save({ [id]: v } as Partial<Settings>);
    });
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[SETTINGS_KEY]) return;
    const next = normalizeSettings(changes[SETTINGS_KEY].newValue);
    const rulesEl = $<HTMLTextAreaElement>('rules');
    // 规则文本框里没有未保存的修改时才跟着刷新
    if (rulesEl.value === settings.userRules) rulesEl.value = next.userRules;
    settings = next;
    render();
  });
}

$('saveRules').addEventListener('click', async () => {
  const text = $<HTMLTextAreaElement>('rules').value;
  const parsed = parseUserRules(text);
  $('rulesErr').textContent = parsed.errors.join('\n');
  if (parsed.errors.length && !parsed.rules.length && text.trim() !== '[]' && text.trim() !== '') {
    $('rulesMsg').textContent = '';
    return;
  }
  await save({ userRules: text.trim() || '[]' });
  flash('rulesMsg', parsed.errors.length ? `已保存，${parsed.rules.length} 条生效，有问题的条目已忽略` : `已保存，${parsed.rules.length} 条生效`);
});

$('example').addEventListener('click', () => {
  $<HTMLTextAreaElement>('rules').value = JSON.stringify(EXAMPLE, null, 2);
});

$('clearCache').addEventListener('click', async () => {
  const keys = await cacheKeys();
  await chrome.storage.local.remove(keys);
  flash('cacheMsg', `已清空 ${keys.length} 个网站的缓存`);
});

$('shortcuts').addEventListener('click', () => void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));

$('exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ drak: 1, settings }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `drak-settings-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  flash('backupMsg', '已导出');
});

$('importBtn').addEventListener('click', () => $<HTMLInputElement>('importFile').click());
$<HTMLInputElement>('importFile').addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text()) as { drak?: number; settings?: unknown };
    if (!data || typeof data !== 'object' || data.drak !== 1 || typeof data.settings !== 'object' || !data.settings) {
      throw new Error('不是 Drak 导出的设置文件');
    }
    const all = normalizeSettings(data.settings) as unknown as Record<string, unknown>;
    // 只取已知的设置项，文件里多出来的字段不写进存储
    const next = Object.fromEntries(Object.keys(settings).map((k) => [k, all[k]])) as unknown as Settings;
    // 规则里有不合法的条目就不导入规则，其余照常
    const parsed = parseUserRules(next.userRules);
    if (parsed.errors.length) next.userRules = JSON.stringify(parsed.rules, null, 2);
    // 站点模式只保留合法的取值
    next.siteModes = Object.fromEntries(
      Object.entries(next.siteModes).filter(([h, m]) => /^[a-z0-9.:[\]-]+$/i.test(h) && m in MODE_TEXT),
    );
    await save(next);
    $<HTMLTextAreaElement>('rules').value = next.userRules;
    flash('backupMsg', parsed.errors.length ? '已导入，有问题的规则条目已忽略' : '已导入');
  } catch (err) {
    flash('backupMsg', `导入失败：${(err as Error).message}`, false);
  }
});

void load();
