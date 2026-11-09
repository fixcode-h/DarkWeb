// 真实站点验收：加载 dist/ 扩展访问真实知乎 / B 站，截图并输出诊断。
// 需要能访问外网的环境；不进 CI（站点内容随时变化）。用法：npm run build && node test/live/run.mjs
import { chromium } from 'playwright';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILTIN_SELECTORS } from './selectors.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dist = join(root, 'dist');
const outDir = join(root, 'test-results', 'live');
mkdirSync(outDir, { recursive: true });
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;

const PAGES = (process.env.LIVE_PAGES ? JSON.parse(process.env.LIVE_PAGES) : null) || [
  ['zhihu-explore', 'https://www.zhihu.com/explore'],
  ['zhihu-signin', 'https://www.zhihu.com/signin'],
  ['zhuanlan-home', 'https://zhuanlan.zhihu.com/'],
  ['zhihu-question', 'https://www.zhihu.com/question/660077479'],
  ['bili-home', 'https://www.bilibili.com/'],
  ['bili-video', 'https://www.bilibili.com/video/BV1Xx411c7cH/'],
  ['bili-dynamic', 'https://t.bilibili.com/'],
  ['bili-space-dynamic', 'https://space.bilibili.com/2/dynamic'],
  ['bili-live', 'https://live.bilibili.com/1496449'],
];

// 页面内测量：可视区网格采样亮区占比 + 可见文字对比度
const MEASURE = () => {
  const parse = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lin = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const contrast = (a, b) => {
    const x = lum(a), y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const isMedia = (el) => /^(IMG|VIDEO|CANVAS|IFRAME|SVG|PICTURE)$/i.test(el.tagName);
  const bgOf = (el) => {
    let cur = el;
    while (cur) {
      const cs = getComputedStyle(cur);
      if (cs.backgroundImage !== 'none' && /url\(/.test(cs.backgroundImage)) return { media: true };
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0.5) return c;
      cur = cur.parentElement || (cur.getRootNode() instanceof ShadowRoot ? cur.getRootNode().host : null);
    }
    return parse(getComputedStyle(document.documentElement).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
  };
  const path = (el) => {
    const parts = [];
    for (let e = el; e && e !== document.body && parts.length < 4; e = e.parentElement) {
      const cls = typeof e.className === 'string' ? e.className.trim().split(/\s+/)[0] : '';
      parts.unshift(e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (cls ? '.' + cls : ''));
    }
    return parts.join('>');
  };
  // 亮区
  let bright = 0, total = 0;
  const brightAt = {};
  for (let y = 10; y < innerHeight; y += 30) {
    for (let x = 10; x < innerWidth; x += 30) {
      const el = document.elementFromPoint(x, y);
      if (!el || isMedia(el) || el.closest('video,canvas,iframe,img,svg,picture')) continue;
      const bg = bgOf(el);
      if (bg.media) continue;
      total++;
      if (lum(bg) > 0.4) {
        bright++;
        const k = path(el);
        brightAt[k] = (brightAt[k] || 0) + 1;
      }
    }
  }
  // 文字
  const low = {};
  let texts = 0, lowCount = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n && texts < 3000; n = walker.nextNode()) {
    if (!n.data.trim()) continue;
    const el = n.parentElement;
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > innerHeight) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || +cs.opacity === 0) continue;
    const fg = parse(cs.color);
    const bg = bgOf(el);
    if (!fg || bg.media || fg.a < 0.3) continue;
    texts++;
    const c = contrast(fg, bg);
    if (c < 3) {
      lowCount++;
      const k = `${path(el)} | ${cs.color} on rgb(${bg.r},${bg.g},${bg.b}) | ${c.toFixed(2)} | ${n.data.trim().slice(0, 16)}`;
      low[k] = (low[k] || 0) + 1;
    }
  }
  // 大面积背景图（含 ::before/::after），看是否被压暗
  const bgImages = [];
  for (const el of [document.documentElement, document.body, ...document.querySelectorAll('body *')]) {
    for (const ps of [null, '::before', '::after']) {
      const cs = getComputedStyle(el, ps);
      if (!/url\(/.test(cs.backgroundImage)) continue;
      const r = el.getBoundingClientRect();
      if (r.width * r.height < 300000) continue;
      bgImages.push(`${path(el)}${ps || ''} ${Math.round(r.width)}x${Math.round(r.height)} ${cs.backgroundImage.slice(0, 100)} inline=${!!el.style?.backgroundImage}`);
    }
  }
  const html = document.documentElement;
  return {
    bgImages: bgImages.slice(0, 6),
    url: location.href,
    title: document.title,
    theme: html.getAttribute('data-theme'),
    drakMode: html.getAttribute('data-drak-mode'),
    bodyBg: getComputedStyle(document.body).backgroundColor,
    brightRatio: total ? +(bright / total).toFixed(3) : null,
    brightTop: Object.entries(brightAt).sort((a, b) => b[1] - a[1]).slice(0, 6),
    texts,
    lowContrast: lowCount,
    lowTop: Object.entries(low).sort((a, b) => b[1] - a[1]).slice(0, 8),
    imgs: {
      invert: document.querySelectorAll('[data-drak-img=invert]').length,
      dim: document.querySelectorAll('[data-drak-img=dim]').length,
      keep: document.querySelectorAll('[data-drak-img=keep]').length,
    },
  };
};

const countSelectors = (sels) => Object.fromEntries(sels.map((s) => [s, document.querySelectorAll(s).length]));

async function main() {
  const userData = mkdtempSync(join(tmpdir(), 'drak-live-'));
  const ctx = await chromium.launchPersistentContext(userData, {
    channel: 'chromium',
    headless: true,
    locale: 'zh-CN',
    viewport: { width: 1280, height: 900 },
    proxy,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  const report = [];
  try {
    const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
    for (let i = 0; i < 50; i++) {
      const n = await sw.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).length);
      if (n === 2) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const diag = (page) =>
      sw.evaluate(async (url) => {
        const tabs = await chrome.tabs.query({});
        const t = tabs.find((x) => x.url === url);
        if (!t) return { error: 'tab not found' };
        return chrome.tabs.sendMessage(t.id, { type: 'diag' }, { frameId: 0 }).catch((e) => ({ error: String(e) }));
      }, page.url());

    for (const [name, url] of PAGES) {
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
      let status = null;
      try {
        const r = await page.goto(url, { timeout: 45000, waitUntil: 'domcontentloaded' });
        status = r?.status() ?? null;
        await page.waitForTimeout(6000);
        // 往下滚一段触发懒加载（评论区等）
        for (let i = 0; i < 3; i++) {
          await page.mouse.wheel(0, 800);
          await page.waitForTimeout(1200);
        }
        await page.evaluate(() => scrollTo(0, 0));
        await page.waitForTimeout(800);
      } catch (e) {
        errors.push('goto: ' + e.message.split('\n')[0]);
      }
      const shot = join(outDir, `${name}.png`);
      await page.screenshot({ path: shot }).catch(() => {});
      const m = await page.evaluate(MEASURE).catch((e) => ({ error: e.message }));
      const host = new URL(page.url()).hostname;
      const sels = BUILTIN_SELECTORS.filter((r) => r.match.some((p) => host === p.replace('*.', '') || host.endsWith(p.replace('*', ''))))
        .flatMap((r) => r.selectors);
      const selectorHits = await page.evaluate(countSelectors, sels).catch(() => ({}));
      // 视频页：评论区截图
      if (name === 'bili-video') {
        await page.evaluate(() => {
          const c = document.querySelector('bili-comments, #commentapp, .comment-container');
          c?.scrollIntoView();
        });
        await page.waitForTimeout(3000);
        await page.screenshot({ path: join(outDir, `${name}-comments.png`) }).catch(() => {});
        m.comments = await page.evaluate(MEASURE).catch((e) => ({ error: e.message }));
      }
      const d = await diag(page);
      const entry = { name, url, status, ...m, diag: d, selectorHits, pageErrors: errors.slice(0, 5) };
      report.push(entry);
      console.log(`\n== ${name} ${status} ${m.url}`);
      console.log(JSON.stringify({ mode: d?.mode, reason: d?.reason, errors: d?.errors, brightRatio: m.brightRatio, ownBright: d?.brightRatio, lowContrast: `${m.lowContrast}/${m.texts}`, imgs: m.imgs, startup: d?.timings?.startupMainThread, firstApply: d?.timings?.firstApply }));
      await page.close();
    }
  } finally {
    writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
    await ctx.close();
    rmSync(userData, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
