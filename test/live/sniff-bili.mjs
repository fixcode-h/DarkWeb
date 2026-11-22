// B 站适配器的真实站点验收（需要能访问 bilibili.com）：未登录状态下取视频信息、下载 360P 并合并、封面和弹幕。
// 用法：npm run build && node test/live/sniff-bili.mjs [视频地址]
import { chromium } from 'playwright';
import { cpSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const results = [];
const check = (name, ok, detail = '') => {
  results.push(!!ok);
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`);
};

const ext = mkdtempSync(join(tmpdir(), 'drak-bili-ext-'));
cpSync(join(root, 'dist'), ext, { recursive: true });
const manifest = JSON.parse(readFileSync(join(ext, 'manifest.json'), 'utf8'));
manifest.permissions.push('downloads');
delete manifest.optional_permissions;
writeFileSync(join(ext, 'manifest.json'), JSON.stringify(manifest));
const downloads = mkdtempSync(join(tmpdir(), 'drak-bili-dl-'));
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'drak-bili-')), {
  channel: 'chromium',
  headless: true,
  acceptDownloads: true,
  downloadsPath: downloads,
  locale: 'zh-CN',
  env: { ...process.env, LANG: 'C.UTF-8' },
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
try {
  const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
  const extId = new URL(sw.url()).host;
  await sw.evaluate(() => chrome.storage.local.set({ 'drak-sniff': { enabled: true, fab: true } }));
  const page = await ctx.newPage();
  // 冷启动直接进视频页偶尔被风控，先访问首页
  await page.goto('https://www.bilibili.com/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  let target = process.argv[2];
  if (!target) {
    const pop = await page.evaluate(async () => (await (await fetch('https://api.bilibili.com/x/web-interface/popular?ps=20&pn=1', { credentials: 'include' })).json()));
    // 挑一个短一点的，下载快
    const v = pop.data.list.filter((x) => x.duration < 400).sort((a, b) => a.duration - b.duration)[0] ?? pop.data.list[0];
    target = `https://www.bilibili.com/video/${v.bvid}/`;
  }
  console.log('视频', target);
  await page.goto(target, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const ui = await ctx.newPage();
  await ui.goto(`chrome-extension://${extId}/popup.html`);
  const tabs = await ui.evaluate(async () => (await chrome.tabs.query({})).map((t) => [t.id, t.url]));
  const tabId = tabs.find(([, u]) => /bilibili\.com\/([A-Za-z-]+\/)?(video|bangumi)\//.test(u ?? ''))?.[0];
  if (tabId === undefined) throw new Error(`找不到视频标签页：${JSON.stringify(tabs)}`);
  const send = (msg) => ui.evaluate((m) => chrome.runtime.sendMessage(m), { ...msg, tabId });

  await send({ type: 'sniff:start' });
  let st;
  for (let i = 0; i < 40; i++) {
    st = await send({ type: 'sniff:state' });
    if (st.site && !('loading' in st.site)) break;
    await page.waitForTimeout(250);
  }
  const info = st.site?.info;
  check('读到视频信息', !!info, JSON.stringify(st.site ?? null).slice(0, 300));
  if (!info) throw new Error('stop');
  check('清晰度列表（未登录只有低清可用）', info.qualities.some((q) => q.available) && info.qualities.some((q) => !q.available), info.qualities.map((q) => `${q.label}${q.available ? '' : `(${q.reason})`}`).join(' / '));

  if (process.env.DEBUG_FETCH) {
    await page.addScriptTag({ path: join(ext, 'sniff-bili.js') });
    const m = await page.evaluate(() => globalThis.__drakBili.resolve(location.href));
    const u = [...m.streams.qualities].reverse().find((x) => x.available).tracks.avc.url;
    const out = await sw.evaluate(async (u) => {
      const o = [];
      for (const [n, init] of [['plain', {}], ['cred', { credentials: 'include' }], ['omit', { credentials: 'omit' }], ['cred-nostore', { credentials: 'include', cache: 'no-store' }]]) {
        try { const r = await fetch(u, { ...init, headers: { Range: 'bytes=0-99' } }); o.push([n, r.status]); } catch (e) { o.push([n, String(e)]); }
      }
      return o;
    }, u);
    console.log('SW fetch', u.slice(8, 40), JSON.stringify(out));
  }
  const low = [...info.qualities].reverse().find((q) => q.available);
  const r = await send({ type: 'sniff:site', action: { what: 'video', part: info.parts[info.current].index, qn: low.qn } });
  check('开始下载', r.ok, r.error ?? '');
  let task;
  for (let i = 0; i < 600; i++) {
    st = await send({ type: 'sniff:state' });
    task = st.tasks[0];
    if (['done', 'error', 'canceled'].includes(task?.stage)) break;
    await page.waitForTimeout(500);
  }
  const [d] = task?.downloadId !== undefined ? await ui.evaluate((id) => chrome.downloads.search({ id }), task.downloadId) : [];
  for (let i = 0; i < 40 && d && d.state !== 'complete'; i++) await page.waitForTimeout(250);
  const file = d?.filename;
  let probe = '';
  try {
    probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name:format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).replace(/\n/g, ' ');
  } catch (e) {
    probe = String(e).slice(0, 200);
  }
  check('下载并合并成一个 MP4（有视频和音频）', task?.stage === 'done' && file && existsSync(file) && /video/.test(probe) && /audio/.test(probe), `${task?.stage} ${task?.error ?? ''} ${task?.file} ${file && existsSync(file) ? statSync(file).size : ''} ${probe}`);

  for (const what of ['cover', 'danmaku']) {
    const res = await send({ type: 'sniff:site', action: { what, part: info.parts[info.current].index } });
    check(`下载${what === 'cover' ? '封面' : '弹幕'}`, res.ok, res.error ?? '');
  }
  await page.waitForTimeout(2000);
  const files = await ui.evaluate(() => chrome.downloads.search({ orderBy: ['-startTime'] }));
  check('封面和弹幕文件已保存', files.filter((f) => f.state === 'complete').length >= 3, files.map((f) => `${f.filename.split('/').pop()} ${f.state} ${f.error ?? ''}`).join(' | '));

  // 视频上的悬浮按钮
  await page.bringToFront();
  const box = await page.locator('video').first().boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(process.env.SHOT_DIR ?? downloads, 'bili-hover.png') });
  }
  check('页面上的视频可见（悬浮按钮截图）', !!box);
  if (process.env.SHOT_DIR) {
    // 弹窗和侧边面板里的 B 站区块（截图人工看）
    await page.keyboard.press('Escape');
    await page.mouse.move(1268, 328);
    await page.waitForTimeout(400);
    await page.mouse.click(1264, 328);
    await page.waitForTimeout(1000);
    await page.screenshot({ path: join(process.env.SHOT_DIR, 'bili-panel.png') });
    await ui.setViewportSize({ width: 380, height: 900 });
    await ui.goto(`chrome-extension://${extId}/popup.html?tab=${tabId}`);
    await ui.waitForTimeout(800);
    await ui.screenshot({ path: join(process.env.SHOT_DIR, 'bili-popup.png'), fullPage: true });
  }
} catch (e) {
  if (String(e) !== 'Error: stop') check('运行', false, String(e));
} finally {
  await ctx.close();
}
console.log(`\n${results.filter(Boolean).length}/${results.length} 通过`);
process.exit(results.every(Boolean) ? 0 : 1);
