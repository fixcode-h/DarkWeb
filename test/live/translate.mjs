// 真实站点翻译验收：加载 dist/ 扩展，用默认引擎（Google）翻译真实页面，统计视口内漏翻的段落并截图。
// 需要能访问外网；不进 CI。用法：npm run build && node test/live/translate.mjs
// TR_PAGES='[["名字","url","目标语言"],...]' 可以换页面。
import { chromium } from 'playwright';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dist = join(root, 'dist');
const outDir = join(root, 'test-results', 'live-tr');
mkdirSync(outDir, { recursive: true });
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;

const PAGES = (process.env.TR_PAGES ? JSON.parse(process.env.TR_PAGES) : null) || [
  ['github', 'https://github.com/microsoft/vscode', 'zh-CN'],
  ['mdn', 'https://developer.mozilla.org/en-US/docs/Web/CSS/color', 'zh-CN'],
  ['wiki', 'https://en.wikipedia.org/wiki/Cat', 'zh-CN'],
  ['hn', 'https://news.ycombinator.com/', 'zh-CN'],
  ['bbc', 'https://www.bbc.com/news', 'zh-CN'],
  ['react', 'https://react.dev/learn', 'zh-CN'],
  ['pydocs', 'https://docs.python.org/3/library/os.html', 'zh-CN'],
  ['youtube', 'https://www.youtube.com/', 'zh-CN'],
  ['nextjs', 'https://nextjs.org/docs', 'zh-CN'],
  ['zhihu', 'https://www.zhihu.com/explore', 'en'],
  ['bili', 'https://www.bilibili.com/', 'en'],
];

// 视口内还没翻译的文字段落（粗略：含目标语言之外文字、不在译文里、可见）
const MISSES = (target) => {
  const zh = /[一-鿿]/;
  const latin = /[A-Za-z]{3,}/;
  const needs = (t) => (target.startsWith('zh') ? latin.test(t) && !zh.test(t) : zh.test(t));
  const out = [];
  let total = 0;
  const seen = new Set();
  const walk = (root) => {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const t = n.data.trim();
      if (t.length < 12 || !needs(t)) continue;
      const el = n.parentElement;
      if (!el || el.closest('font.drak-tr, script, style, noscript, code, pre, kbd, samp, textarea, [translate=no], .notranslate')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > innerHeight) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
      total++;
      // 同一块里已有译文就算翻过了
      let block = el;
      while (block && block !== document.body && getComputedStyle(block).display.startsWith('inline')) block = block.parentElement;
      if (block?.querySelector?.(':scope font.drak-tr') || el.closest('[data-drak-tr-src]')) continue;
      const k = el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0] + ' | ' + t.slice(0, 50);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(k);
      }
    }
    for (const e of root.querySelectorAll('*')) if (e.shadowRoot) walk(e.shadowRoot);
  };
  walk(document.body);
  return { total, missed: out.length, sample: out.slice(0, 12), translated: document.querySelectorAll('font.drak-tr').length };
};

async function main() {
  const userData = mkdtempSync(join(tmpdir(), 'drak-trlive-'));
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
    const setTr = (patch) =>
      sw.evaluate(async (p) => {
        const cur = (await chrome.storage.local.get('translate')).translate || {};
        await chrome.storage.local.set({ translate: { ...cur, ...p } });
      }, patch);
    const command = (type) =>
      sw.evaluate(async (t) => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['translate.js'] });
        return chrome.tabs.sendMessage(tab.id, { type: t }, { frameId: 0 });
      }, type);
    for (const [name, url, target] of PAGES) {
      await setTr({ target, mode: 'bilingual' });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
      let m = {};
      try {
        await page.goto(url, { timeout: 45000, waitUntil: 'domcontentloaded' });
        await page.bringToFront();
        await page.waitForTimeout(5000);
        await command('tr:start');
        await page.waitForTimeout(8000);
        m = await page.evaluate(MISSES, target);
        await page.screenshot({ path: join(outDir, `${name}.png`) });
        // 滚动后新内容
        await page.mouse.wheel(0, 1600);
        await page.waitForTimeout(5000);
        m.afterScroll = await page.evaluate(MISSES, target);
        await page.screenshot({ path: join(outDir, `${name}-scroll.png`) });
      } catch (e) {
        errors.push('run: ' + e.message.split('\n')[0]);
      }
      report.push({ name, url, ...m, errors });
      console.log(`\n== ${name} ${page.url()}`);
      console.log(JSON.stringify({ translated: m.translated, missed: `${m.missed}/${m.total}`, afterScroll: m.afterScroll && `${m.afterScroll.missed}/${m.afterScroll.total}`, sample: m.sample?.slice(0, 6), scrollSample: m.afterScroll?.sample?.slice(0, 4), errors: errors.slice(0, 2) }, null, 0));
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
