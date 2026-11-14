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
</body></html>`;

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
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(PAGE);
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
