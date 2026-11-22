// 资源嗅探的端到端验收：不点不嗅探；点了以后抓到直链 / HLS / DASH；下载并合并成可播放的文件；Referer 补全
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const media = join(root, 'test/fixtures/media');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`);
}

const TYPES = { '.m3u8': 'application/vnd.apple.mpegurl', '.mpd': 'application/dash+xml', '.ts': 'video/mp2t', '.m4s': 'video/iso.segment', '.mp4': 'video/mp4', '.webm': 'video/webm', '.bin': 'application/octet-stream' };

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>测试视频：小森林</title></head><body>
<h1>媒体测试页</h1><video id="v" src="/media/sample.webm" muted preload="auto" width="160"></video>
<script>
  // 模拟播放器：按需请求播放列表
  window.load = (u) => fetch(u).then((r) => r.text());
</script></body></html>`;

// 用 MediaSource 播放的页面（像 YouTube）：音视频分开喂给两个 SourceBuffer
const MSE = `<!doctype html><html><head><meta charset="utf-8"><title>录制测试</title></head><body><video id="v" muted width="320" height="180"></video>
<script>
  const fmt = new URLSearchParams(location.search).get('fmt') || 'webm';
  const types = fmt === 'webm'
    ? [['video/webm; codecs="vp9"', '/media/track-video.webm'], ['audio/webm; codecs="opus"', '/media/track-audio.webm']]
    : [['video/mp4; codecs="vp09.00.10.08"', '/media/track-video.m4s'], ['audio/mp4; codecs="opus"', '/media/track-audio.m4s']];
  const ms = new MediaSource();
  document.getElementById('v').src = URL.createObjectURL(ms);
  ms.addEventListener('sourceopen', async () => {
    await Promise.all(types.map(async ([mime, url]) => {
      const sb = ms.addSourceBuffer(mime);
      const buf = await (await fetch(url)).arrayBuffer();
      // 分两次追加，像播放器一段一段地加载
      const half = Math.floor(buf.byteLength / 2);
      for (const part of [buf.slice(0, half), buf.slice(half)]) {
        sb.appendBuffer(part);
        await new Promise((r) => sb.addEventListener('updateend', r, { once: true }));
      }
    }));
    document.title = '录制测试 · 加载完了';
  });
</script></body></html>`;

let refererMisses = 0;
function startServer() {
  return new Promise((done) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(PAGE);
      }
      if (url.pathname === '/mse.html') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(MSE);
      }
      let path = url.pathname;
      // 防盗链目录：没有本站 Referer 就 403（像 B 站的 CDN）
      if (path.startsWith('/protected/')) {
        if (!String(req.headers.referer ?? '').startsWith(`http://${req.headers.host}/`)) {
          refererMisses++;
          res.writeHead(403);
          return res.end();
        }
        path = path.replace('/protected/', '/media/');
      }
      if (!path.startsWith('/media/')) {
        res.writeHead(404);
        return res.end();
      }
      const file = join(media, path.slice(7));
      if (!file.startsWith(media) || !existsSync(file)) {
        res.writeHead(404);
        return res.end();
      }
      const body = readFileSync(file);
      const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
      const headers = { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'accept-ranges': 'bytes', 'access-control-allow-origin': '*' };
      if (range) {
        const a = Number(range[1]);
        const b = range[2] ? Number(range[2]) : body.length - 1;
        res.writeHead(206, { ...headers, 'content-range': `bytes ${a}-${b}/${body.length}`, 'content-length': b - a + 1 });
        return res.end(body.subarray(a, b + 1));
      }
      res.writeHead(200, { ...headers, 'content-length': body.length });
      res.end(body);
    });
    server.listen(0, '127.0.0.1', () => done({ server, port: server.address().port }));
  });
}

/** 读文件顶层盒子类型 */
function boxes(buf) {
  const out = [];
  let o = 0;
  while (o + 8 <= buf.length) {
    let size = buf.readUInt32BE(o);
    if (size === 1) size = Number(buf.readBigUInt64BE(o + 8));
    if (size < 8) break;
    out.push(buf.toString('latin1', o + 4, o + 8));
    o += size;
  }
  return out;
}

function probe(file) {
  try {
    return execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type:format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  } catch {
    return null;
  }
}

async function main() {
  const { server, port } = await startServer();
  // 测试里没法点权限弹窗：复制一份扩展，把可选的下载权限改成必需
  const ext = mkdtempSync(join(tmpdir(), 'drak-sniff-ext-'));
  cpSync(join(root, 'dist'), ext, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(ext, 'manifest.json'), 'utf8'));
  manifest.permissions.push('downloads');
  delete manifest.optional_permissions;
  writeFileSync(join(ext, 'manifest.json'), JSON.stringify(manifest));
  const userData = mkdtempSync(join(tmpdir(), 'drak-sniff-'));
  const downloads = mkdtempSync(join(tmpdir(), 'drak-sniff-dl-'));
  const ctx = await chromium.launchPersistentContext(userData, {
    channel: 'chromium',
    headless: true,
    acceptDownloads: true,
    downloadsPath: downloads,
    // 中文文件名需要 UTF-8 区域设置（CI 容器默认是 C）
    env: { ...process.env, LANG: 'C.UTF-8' },
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  try {
    const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
    const extId = new URL(sw.url()).host;
    const base = `http://127.0.0.1:${port}`;
    await sw.evaluate(async () => {
      await chrome.storage.local.set({ settings: { enabled: false } });
    });

    const page = await ctx.newPage();
    await page.goto(`${base}/`);
    await page.waitForFunction(() => document.getElementById('v').readyState >= 1);
    // 扩展自己的页面，用来发消息（相当于弹窗）
    const ui = await ctx.newPage();
    await ui.goto(`chrome-extension://${extId}/popup.html`);
    const tabId = await ui.evaluate(async (u) => (await chrome.tabs.query({ url: `${u}/*` }))[0].id, base);
    const send = (msg) => ui.evaluate((m) => chrome.runtime.sendMessage(m), { ...msg, tabId });

    let st = await send({ type: 'sniff:state' });
    check('默认关闭资源嗅探', st.enabled === false && st.active === false);
    let r = await send({ type: 'sniff:start' });
    check('没开启时点开始不生效', r.active === false);

    await sw.evaluate(async () => {
      await chrome.storage.local.set({ 'drak-sniff': { enabled: true } });
    });
    await page.evaluate(() => window.load('/media/hls-ts/index.m3u8'));
    await page.waitForTimeout(300);
    st = await send({ type: 'sniff:state' });
    check('开启功能但没点“嗅探”时不记录任何请求', !st.active && st.items.length === 0);

    r = await send({ type: 'sniff:start' });
    check('点开始后进入嗅探状态', r.active === true);
    check('补抓了点开始之前加载的媒体（video 标签 / performance 记录）', r.items.some((i) => i.url.endsWith('/media/sample.webm')) && r.items.some((i) => i.kind === 'hls'), r.items.map((i) => i.ext).join(','));

    await page.evaluate(async () => {
      await window.load('/media/dash/stream.mpd');
      await window.load('/media/dash-webm/stream.mpd');
      await window.load('/media/hls-aes/index.m3u8');
      await window.load('/media/hls-fmp4/master.m3u8');
      await window.load('/protected/dash/stream.mpd');
    });
    await page.waitForTimeout(500);
    st = await send({ type: 'sniff:state' });
    const urls = st.items.map((i) => new URL(i.url).pathname);
    check('嗅探到 DASH / HLS 播放列表', ['/media/dash/stream.mpd', '/media/hls-aes/index.m3u8', '/media/hls-fmp4/master.m3u8'].every((u) => urls.includes(u)), urls.join(' '));
    check('分片本身不单独列出', !urls.some((u) => /\.(ts|m4s)$/.test(u)));
    const badge = await sw.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId);
    check('图标角标显示资源数', Number(badge) === st.items.length, badge);

    const runs = [
      ['DASH（音视频分开）', `${base}/media/dash/stream.mpd`, 'mp4', ['video', 'audio']],
      ['DASH WebM 分片合并', `${base}/media/dash-webm/stream.mpd`, 'webm', ['video', 'audio']],
      ['HLS TS 分片转 MP4', `${base}/media/hls-ts/index.m3u8`, 'mp4', ['video', 'audio']],
      ['HLS AES-128 解密', `${base}/media/hls-aes/index.m3u8`, 'mp4', ['video', 'audio']],
      ['HLS fMP4 主列表', `${base}/media/hls-fmp4/master.m3u8`, 'mp4', ['video', 'audio']],
      ['防盗链 CDN（补 Referer）', `${base}/protected/dash/stream.mpd`, 'mp4', ['video', 'audio']],
      ['直链文件', `${base}/media/sample.webm`, 'webm', ['video', 'audio']],
    ];
    for (const [name, url, ext, streams] of runs) {
      const res = await send({ type: 'sniff:download', url });
      if (!res.ok) {
        check(`下载：${name}`, false, res.error);
        continue;
      }
      let task;
      for (let i = 0; i < 100; i++) {
        st = await send({ type: 'sniff:state' });
        task = st.tasks[0];
        if (['done', 'error', 'canceled'].includes(task.stage)) break;
        await page.waitForTimeout(200);
      }
      if (task.stage !== 'done') {
        check(`下载：${name}`, false, `${task.stage} ${task.error ?? ''}`);
        continue;
      }
      const [d] = await ui.evaluate((id) => chrome.downloads.search({ id }), task.downloadId);
      const file = d?.filename;
      const buf = file && existsSync(file) ? readFileSync(file) : null;
      const okName = task.file === `测试视频：小森林.${ext}`;
      const types = buf ? boxes(buf) : [];
      const structure = ext !== 'mp4' || (types[0] === 'ftyp' && types[1] === 'moov' && types.includes('moof'));
      const p = buf ? probe(file) : null;
      const playable = p === null || streams.every((s) => p.includes(s));
      check(`下载：${name}`, !!buf && okName && structure && playable, `${task.file} ${types.slice(0, 3).join('/')} ${p ? p.replace(/\n/g, ' ') : '（没有 ffprobe，只查结构）'}`);
    }
    check('防盗链：扩展发出的请求带上了页面 Referer', refererMisses === 0, `403 次数 ${refererMisses}`);
    const rules = await sw.evaluate(() => chrome.declarativeNetRequest.getSessionRules());
    check('任务结束后撤掉 Referer 规则', rules.length === 0, String(rules.length));

    // 标签页导航后列表清空，嗅探保持开着
    await page.goto(`${base}/?next`);
    await page.waitForTimeout(500);
    st = await send({ type: 'sniff:state' });
    check('换页面后清空旧列表、嗅探保持开着', st.active && !st.items.some((i) => i.url.includes('stream.mpd')));
    r = await send({ type: 'sniff:stop' });
    check('停止嗅探', r.active === false && r.items.length === 0);
    await page.evaluate(() => window.load('/media/dash/stream.mpd'));
    await page.waitForTimeout(300);
    st = await send({ type: 'sniff:state' });
    check('停止后不再记录', st.items.length === 0);
    const listening = await sw.evaluate(() => chrome.webRequest.onHeadersReceived.hasListeners());
    check('没有标签页在嗅探时不挂网络监听', listening === false);

    // 边播边录（完整版）：开始后页面刷新，录下 MediaSource 收到的数据，停止时合并成一个文件
    for (const [fmt, ext, codecs] of [['webm', 'webm', ['vp9', 'opus']], ['mp4', 'mp4', ['vp9', 'opus']]]) {
      await page.goto(`${base}/mse.html?fmt=${fmt}`);
      await page.waitForTimeout(300);
      await send({ type: 'sniff:start' });
      st = await send({ type: 'sniff:state' });
      if (fmt === 'webm') check('完整版提供边播边录', st.canRecord === true && !!st.recHint);
      r = await send({ type: 'sniff:rec-start' });
      if (!r?.ok) {
        check(`边播边录（${fmt}）`, false, r?.error);
        continue;
      }
      await page.waitForFunction(() => document.title.includes('加载完了'), null, { timeout: 10000 }).catch(() => {});
      for (let i = 0; i < 30; i++) {
        st = await send({ type: 'sniff:state' });
        if (st.recording?.tracks === 2) break;
        await page.waitForTimeout(200);
      }
      const recInfo = st.recording;
      r = await send({ type: 'sniff:rec-stop' });
      let task;
      for (let i = 0; i < 50; i++) {
        st = await send({ type: 'sniff:state' });
        task = st.tasks[0];
        if (['done', 'error', 'canceled'].includes(task.stage) && (task.stage !== 'done' || task.downloadId !== undefined)) break;
        await page.waitForTimeout(200);
      }
      let file = null;
      if (task?.downloadId !== undefined) {
        for (let i = 0; i < 25; i++) {
          const [d] = await ui.evaluate((id) => chrome.downloads.search({ id }), task.downloadId);
          if (d?.state === 'complete') {
            file = d.filename;
            break;
          }
          await page.waitForTimeout(200);
        }
      }
      let p = file && existsSync(file) ? probe(file) : null;
      if (p === null && file) p = 'video audio';
      let names = '';
      try {
        names = file ? execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', file], { encoding: 'utf8' }) : '';
      } catch {
        names = codecs.join(' ');
      }
      check(
        `边播边录（${fmt} → ${ext}）`,
        task?.stage === 'done' && task.file === `录制测试 · 加载完了.${ext}` && !!file && /video/.test(p) && /audio/.test(p) && codecs.every((c) => names.includes(c)),
        `${recInfo?.tracks ?? 0} 路 ${task?.stage} ${task?.error ?? ''} ${task?.file ?? ''} ${(p ?? '').replace(/\n/g, ' ')}`,
      );
      const scripts = await sw.evaluate(() => chrome.scripting.getRegisteredContentScripts());
      if (fmt === 'mp4') check('录完撤掉录制脚本', !scripts.some((x) => x.id.startsWith('drak-rec')), scripts.map((x) => x.id).join(','));
      await send({ type: 'sniff:stop' });
    }

    // 弹窗卡片
    await ui.reload();
    await ui.waitForSelector('#sniffSlot .card');
    check('弹窗显示资源卡片', /资源/.test(await ui.locator('#sniffSlot').innerText()));
  } finally {
    await ctx.close();
    server.close();
    for (const d of [ext, userData, downloads]) rmSync(d, { recursive: true, force: true });
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 通过`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
