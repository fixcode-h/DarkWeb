// 阅读增强的端到端验收：划词翻译（本地假的 AI 大模型接口）、字体与排版、护眼滤镜、排除网站
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dist = join(root, 'dist');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`);
}

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Enhance</title>
<style>body{font:16px/1.2 Arial,sans-serif;max-width:720px;margin:40px auto}.icon-star{font-family:IconFont}</style></head><body>
<p id="p1">Reading at night is easier with a warm screen.</p>
<p id="p2">这一段是中文。</p>
<pre id="code">const keep = "monospace";</pre>
<i id="ico" class="icon-star"></i>
<textarea id="ta">Editable text in a textarea</textarea>
<input id="in" type="text"><input id="pw" type="password"><div id="ce" contenteditable="true"></div>
</body></html>`;

const para = (i) => `<p>Paragraph ${i}: long-form reading benefits from a calm layout, steady line length and a typeface that does not tire the eyes. ${'Readers scan less and absorb more when the clutter around the text is gone. '.repeat(3)}</p>`;
const ARTICLE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Calm reading</title></head><body>
<nav id="nav"><a href="/">Home</a> <a href="/a">About</a></nav>
<div class="ad-banner" id="ad">Buy now! Limited offer!</div>
<aside id="side"><p>Related links and sidebar widgets</p></aside>
<article><h1>Calm reading on the web</h1><p class="byline">By Jane Writer</p>
${Array.from({ length: 8 }, (_, i) => para(i + 1)).join('')}
<p>Inline <code>code sample</code> and an <a href="javascript:alert(1)" id="bad">evil link</a> plus <a href="/docs">docs</a>.</p>
<img src="/x.png" onerror="window.__pwned = 1" alt="pic">
</article><footer>Footer text</footer></body></html>`;

let lastTo = '';
function startServer() {
  return new Promise((done) => {
    const server = createServer((req, res) => {
      if (req.url === '/v1/chat/completions') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          const msgs = JSON.parse(body).messages;
          lastTo = /into (.+?)\./.exec(msgs[0].content)?.[1] ?? '';
          const items = JSON.parse(msgs[1].content);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(items.map((t) => `【译:${t}】`)) } }] }));
        });
        return;
      }
      if (req.url === '/favicon.ico') {
        res.writeHead(204);
        return res.end();
      }
      if (req.url === '/x.png') {
        res.writeHead(404);
        return res.end();
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(req.url === '/article' ? ARTICLE : PAGE);
    });
    server.listen(0, '127.0.0.1', () => done({ server, port: server.address().port }));
  });
}

/** 选中元素里的文字并模拟松开鼠标 */
async function selectText(page, id) {
  await page.evaluate((i) => {
    const el = document.getElementById(i);
    const r = document.createRange();
    r.selectNodeContents(el);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }, id);
  const box = await page.locator(`#${id}`).boundingBox();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
  await page.mouse.up();
  await page.waitForTimeout(80);
}
const shadow = (page, sel) =>
  page.evaluate((s) => {
    const host = document.querySelector('[data-drak-selection]');
    const el = host?.shadowRoot?.querySelector(s);
    return el ? { text: el.textContent, visible: el.getBoundingClientRect().width > 0 } : null;
  }, sel);

async function main() {
  const { server, port } = await startServer();
  const userData = mkdtempSync(join(tmpdir(), 'drak-enh-'));
  const ctx = await chromium.launchPersistentContext(userData, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  try {
    const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
    const base = `http://127.0.0.1:${port}`;
    const set = (key, patch) =>
      sw.evaluate(
        async ([k, p]) => {
          const cur = (await chrome.storage.local.get(k))[k] || {};
          await chrome.storage.local.set({ [k]: { ...cur, ...p } });
        },
        [key, patch],
      );
    await set('translate', { engine: 'llm', target: 'zh-CN', fallback: false, fab: { enabled: false, side: 'right', y: 0.6, hiddenSites: [] }, llm: { baseUrl: `${base}/v1`, apiKey: 'test', model: 'fake' } });
    // 暗色模式关掉，只看阅读增强
    await sw.evaluate(async () => {
      const cur = (await chrome.storage.local.get('settings')).settings || {};
      await chrome.storage.local.set({ settings: { ...cur, enabled: false } });
    });

    const page = await ctx.newPage();
    await page.goto(`${base}/`);
    await page.bringToFront();

    // ---- 划词翻译 ----
    await selectText(page, 'p1');
    check('划词：选中后出现“译”图标', (await shadow(page, '.icon'))?.text === '译');
    await page.evaluate(() => document.querySelector('[data-drak-selection]').shadowRoot.querySelector('.icon').click());
    await page.waitForFunction(() => /【译/.test(document.querySelector('[data-drak-selection]')?.shadowRoot?.querySelector('.out')?.textContent ?? ''));
    const out = await shadow(page, '.out');
    check('划词：卡片显示译文', out?.text === '【译:Reading at night is easier with a warm screen.】', out?.text);
    check('划词：译成目标语言', /Chinese|简体中文|zh/i.test(lastTo), lastTo);
    check('划词：页面选区保留', await page.evaluate(() => getSelection().toString().includes('Reading at night')));
    await page.keyboard.press('Escape');
    check('划词：Esc 关闭卡片', !(await shadow(page, '.card')));

    await set('enhance', { selection: { enabled: true, trigger: 'auto' } });
    await page.waitForTimeout(100);
    await selectText(page, 'p2');
    await page.waitForFunction(() => /【译/.test(document.querySelector('[data-drak-selection]')?.shadowRoot?.querySelector('.out')?.textContent ?? ''));
    check('划词：立即翻译模式松开鼠标就出卡片', !(await shadow(page, '.icon')) && !!(await shadow(page, '.card')));
    check('划词：选中的已是中文时译成英文', /English|^en$/.test(lastTo), lastTo);
    await page.mouse.click(5, 5);
    check('划词：点页面别处关闭卡片', !(await shadow(page, '.card')));

    await selectText(page, 'ta');
    await page.evaluate(() => {
      const ta = document.getElementById('ta');
      ta.focus();
      ta.select();
    });
    const tb = await page.locator('#ta').boundingBox();
    await page.mouse.move(tb.x + 10, tb.y + 10);
    await page.mouse.up();
    await page.waitForTimeout(80);
    check('划词：输入框里选字不打扰', !(await shadow(page, '.card')) && !(await shadow(page, '.icon')));

    await set('enhance', { selection: { enabled: false, trigger: 'icon' } });
    await page.waitForTimeout(100);
    await selectText(page, 'p1');
    check('划词：关闭后不再出现', !(await shadow(page, '.icon')) && !(await shadow(page, '.card')));

    // ---- 输入框翻译 ----
    const typeAndTriple = async (sel, text) => {
      await page.click(sel);
      await page.keyboard.type(text);
      await page.keyboard.press('Space');
      await page.keyboard.press('Space');
      await page.keyboard.press('Space');
    };
    await typeAndTriple('#in', '你好世界');
    await page.waitForFunction(() => document.getElementById('in').value.startsWith('【译'));
    check('输入框：连按三次空格替换成译文', (await page.inputValue('#in')) === '【译:你好世界】', await page.inputValue('#in'));
    check('输入框：译成设置里的语言（默认英文）', /English|^en$/.test(lastTo), lastTo);
    await page.keyboard.press('Control+z');
    const undone = await page.inputValue('#in');
    check('输入框：Ctrl+Z 撤销回原文', undone.startsWith('你好世界'), undone);
    await typeAndTriple('#ce', '早上好');
    await page.waitForFunction(() => document.getElementById('ce').innerText.startsWith('【译'));
    check('输入框：可编辑区域也能翻译', (await page.evaluate(() => document.getElementById('ce').innerText.trim())) === '【译:早上好】');
    await typeAndTriple('#pw', 'secret');
    await page.waitForTimeout(400);
    check('输入框：密码框不处理', (await page.inputValue('#pw')).startsWith('secret'));
    await page.fill('#in', '');
    await page.click('#in');
    await page.keyboard.type('a b c');
    await page.waitForTimeout(400);
    check('输入框：正常打字的空格不触发', (await page.inputValue('#in')) === 'a b c');

    // ---- 字体与排版 ----
    const fontOf = (id) => page.evaluate((i) => getComputedStyle(document.getElementById(i)).fontFamily, id);
    await set('enhance', { font: { family: 'custom', custom: 'Courier New', lineHeight: 2, bolder: false } });
    await page.waitForFunction(() => /Courier New/.test(getComputedStyle(document.getElementById('p1')).fontFamily));
    check('字体：正文换成所选字体', /Courier New/.test(await fontOf('p1')));
    check('字体：代码块不改', !/Courier New/.test(await fontOf('code')), await fontOf('code'));
    check('字体：图标元素不改', !/Courier New/.test(await fontOf('ico')));
    const lh = await page.evaluate(() => getComputedStyle(document.getElementById('p1')).lineHeight);
    check('排版：段落行高生效', lh === '32px', lh);

    // ---- 护眼滤镜 ----
    await set('enhance', { filter: { mode: 'warm', strength: 40 } });
    await page.waitForSelector('html > [data-drak-filter]', { state: 'attached' });
    const ov = await page.evaluate(() => {
      const el = document.querySelector('html > [data-drak-filter]');
      const cs = getComputedStyle(el);
      return { pe: cs.pointerEvents, pos: cs.position, blend: cs.mixBlendMode };
    });
    check('滤镜：暖色覆盖层铺满且不挡点击', ov.pe === 'none' && ov.pos === 'fixed' && ov.blend === 'multiply', JSON.stringify(ov));
    const hit = await page.evaluate(() => {
      const r = document.getElementById('p1').getBoundingClientRect();
      return document.elementFromPoint(r.left + 5, r.top + 5)?.id;
    });
    check('滤镜：页面元素仍可点击', hit === 'p1', hit);
    await set('enhance', { filter: { mode: 'off', strength: 40 } });
    await page.waitForSelector('html > [data-drak-filter]', { state: 'detached' });
    check('滤镜：关闭后移除', true);

    // ---- 排除网站 ----
    await set('enhance', { filter: { mode: 'dim', strength: 30 }, disabledSites: ['127.0.0.1:' + port] });
    await page.reload();
    await page.waitForTimeout(300);
    const excluded = await page.evaluate(() => ({ ov: !!document.querySelector('[data-drak-filter]'), font: getComputedStyle(document.getElementById('p1')).fontFamily }));
    check('排除网站：滤镜和字体都不生效', !excluded.ov && !/Courier New/.test(excluded.font), JSON.stringify(excluded));

    // ---- 阅读模式 ----
    await set('enhance', { disabledSites: [], filter: { mode: 'off', strength: 30 }, font: { family: '', custom: '', lineHeight: 0, bolder: false } });
    const art = await ctx.newPage();
    await art.goto(`${base}/article`);
    await art.bringToFront();
    const tool = (name) =>
      sw.evaluate(async (n) => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [n] });
      }, name);
    // 原页面自己的图片加载失败会触发一次 onerror，先清零
    await art.waitForTimeout(200);
    await art.evaluate(() => (window.__pwned = 0));
    await tool('enhance-reader.js');
    await art.waitForSelector('[data-drak-reader]', { state: 'attached' });
    await art.waitForTimeout(300);
    const rd = await art.evaluate(() => {
      const r = document.querySelector('[data-drak-reader]').shadowRoot;
      const c = r.querySelector('.content');
      return {
        title: r.querySelector('h1.title').textContent,
        hasPara: c.textContent.includes('Paragraph 8'),
        dupTitle: c.textContent.includes('Calm reading on the web'),
        hasAd: c.textContent.includes('Buy now'),
        hasNav: c.textContent.includes('About'),
        badHref: c.querySelector('a[href^="javascript"]') !== null,
        onerror: !!c.querySelector('[onerror]'),
        docs: c.querySelector('a[href$="/docs"]')?.getAttribute('href'),
        overflow: document.documentElement.style.overflow,
      };
    });
    check('阅读模式：抽出标题和正文', rd.title === 'Calm reading on the web' && rd.hasPara, JSON.stringify(rd));
    check('阅读模式：去掉广告和导航', !rd.hasAd && !rd.hasNav);
    check('阅读模式：正文里不重复标题', !rd.dupTitle);
    check('阅读模式：去掉 javascript: 链接和事件属性', !rd.badHref && !rd.onerror && !(await art.evaluate(() => window.__pwned)));
    check('阅读模式：相对链接补成完整地址', rd.docs === `${base}/docs`, rd.docs);
    check('阅读模式：背后页面不滚动', rd.overflow === 'hidden');
    await art.evaluate(() => document.querySelector('[data-drak-reader]').shadowRoot.querySelector('[data-act="bigger"]').click());
    await art.waitForTimeout(200);
    const fs = await sw.evaluate(async () => (await chrome.storage.local.get('enhance')).enhance.reader.fontSize);
    check('阅读模式：调字号并记住', fs === 20, String(fs));
    await art.keyboard.press('Escape');
    check('阅读模式：Esc 退出并恢复滚动', await art.evaluate(() => !document.querySelector('[data-drak-reader]') && document.documentElement.style.overflow === ''));
    await tool('enhance-reader.js');
    await art.waitForSelector('[data-drak-reader]', { state: 'attached' });
    await tool('enhance-reader.js');
    check('阅读模式：再触发一次关闭', await art.evaluate(() => !document.querySelector('[data-drak-reader]')));

    // ---- 屏蔽页面元素 ----
    await tool('enhance-picker.js');
    await art.waitForSelector('[data-drak-picker]', { state: 'attached' });
    const adBox = await art.locator('#ad').boundingBox();
    await art.mouse.move(adBox.x + 5, adBox.y + 5);
    await art.mouse.click(adBox.x + 5, adBox.y + 5);
    check('屏蔽：点选时不触发页面点击', art.url().endsWith('/article'));
    await art.keyboard.press('Enter');
    await art.waitForFunction(() => getComputedStyle(document.getElementById('ad')).display === 'none');
    const rules = await sw.evaluate(async () => (await chrome.storage.local.get('enhance')).enhance.hideRules);
    const key = `127.0.0.1:${port}`;
    check('屏蔽：元素立即隐藏并按站点保存', Array.isArray(rules[key]) && rules[key].length === 1, JSON.stringify(rules));
    check('屏蔽：只隐藏选中的元素', await art.evaluate(() => getComputedStyle(document.getElementById('side')).display !== 'none'));
    await art.keyboard.press('Escape');
    check('屏蔽：Esc 退出点选', await art.evaluate(() => !document.querySelector('[data-drak-picker]')));
    await art.reload();
    await art.waitForTimeout(300);
    check('屏蔽：刷新后仍然隐藏', await art.evaluate(() => getComputedStyle(document.getElementById('ad')).display === 'none'));
    await set('enhance', { siteCss: { [key]: '#side { display: none !important; }' }, hideRules: { [key]: ['body { } * { display:none }', ...rules[key]] } });
    await art.waitForFunction(() => getComputedStyle(document.getElementById('side')).display === 'none');
    check('自定义 CSS：按站点生效', true);
    check('屏蔽：坏选择器被丢弃，不会跳出规则', await art.evaluate(() => getComputedStyle(document.querySelector('article')).display !== 'none'));
    await art.close();

    // ---- YouTube 双语字幕（本地仿真播放器 DOM）----
    const YT = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div id="movie_player" style="position:relative;width:800px;height:450px;background:#000">
<div class="ytp-caption-window-container"><div class="caption-window" style="position:absolute;bottom:20px;left:0;right:0;text-align:center">
<span class="captions-text"><span class="caption-visual-line"><span class="ytp-caption-segment" style="font-size:24px;color:#fff;background:rgba(8,8,8,.75)">Hello there</span></span></span></div></div>
<div class="ytp-chrome-bottom"><div class="ytp-right-controls"><button class="ytp-subtitles-button ytp-button" aria-pressed="false" onclick="this.setAttribute('aria-pressed','true')">CC</button></div></div>
</div></body></html>`;
    await ctx.route('https://www.youtube.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: YT }));
    const yt = await ctx.newPage();
    await yt.goto('https://www.youtube.com/watch?v=test');
    await yt.bringToFront();
    await yt.waitForSelector('#movie_player .drak-sub-btn');
    check('字幕：播放器里出现“译”按钮，默认关闭', (await yt.getAttribute('.drak-sub-btn', 'aria-pressed')) === 'false');
    await yt.waitForTimeout(400);
    check('字幕：关闭时不显示译文', !(await yt.$('.drak-sub')));
    await yt.click('.drak-sub-btn');
    await yt.waitForSelector('.captions-text > .drak-sub');
    check('字幕：打开后原字幕下方出现译文', (await yt.textContent('.drak-sub')) === '【译:Hello there】', await yt.textContent('.drak-sub'));
    check('字幕：顺手打开播放器字幕', (await yt.getAttribute('.ytp-subtitles-button', 'aria-pressed')) === 'true');
    check('字幕：开关记在设置里', await sw.evaluate(async () => (await chrome.storage.local.get('enhance')).enhance.subtitles.enabled === true));
    await yt.evaluate(() => (document.querySelector('.ytp-caption-segment').textContent = 'Next line of speech'));
    await yt.waitForFunction(() => document.querySelector('.drak-sub')?.textContent === '【译:Next line of speech】');
    check('字幕：字幕变化后译文跟着更新', true);
    await yt.click('.drak-sub-btn');
    await yt.waitForSelector('.drak-sub', { state: 'detached' });
    check('字幕：再点一次关闭', true);
    await yt.close();

    // ---- 设置页 ----
    const opt = await ctx.newPage();
    const extId = new URL(sw.url()).host;
    await opt.goto(`chrome-extension://${extId}/enhance.html`);
    await opt.selectOption('#filterMode', 'gray');
    await opt.waitForTimeout(200);
    const saved = await sw.evaluate(async () => (await chrome.storage.local.get('enhance')).enhance.filter.mode);
    check('设置页：修改后自动保存', saved === 'gray', saved);
    await opt.close();
  } catch (e) {
    check('运行出错', false, String(e));
  } finally {
    await ctx.close();
    server.close();
    rmSync(userData, { recursive: true, force: true });
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n阅读增强验收：${results.length - failed.length} / ${results.length} 通过`);
  process.exit(failed.length ? 1 : 0);
}

main();
