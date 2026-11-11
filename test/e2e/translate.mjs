// 网页翻译的端到端验收：加载 dist/ 扩展，用本地假的“AI 大模型”接口当翻译引擎，检查渲染与还原
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

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Fixture</title>
<style>body{font:16px/1.6 sans-serif;max-width:720px;margin:20px auto}.nowrap{white-space:nowrap;overflow:hidden;width:200px}.far{margin-top:6000px}</style></head><body>
<h1 id="h">Adaptive dark mode for every website</h1>
<p id="p1">The extension recolors pages by <a id="lnk" href="/docs">color role</a> and keeps <strong>borders</strong> intact, see <code>npm run build</code> for details.</p>
<p id="zh">这一段已经是中文，不需要翻译。</p>
<p id="num">2024-01-01 12:30</p>
<pre id="pre">const untouched = "code block";</pre>
<div id="mixed">Leading text before a block<div id="inner">Nested block text goes here</div>trailing text after the block</div>
<p id="img">Photo of a cat <img id="cat" alt="" width="10" height="10" src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=="> sitting on a sofa</p>
<button id="btn"><i class="material-icons">menu</i> Open menu</button>
<div class="nowrap" id="nowrap">A fairly long single line title that is truncated</div>
<p id="br">First line of the address<br>Second line of the address</p>
<div id="host"></div>
<p id="far" class="far">This paragraph is far below the viewport</p>
<script>
  document.getElementById('host').attachShadow({ mode: 'open' }).innerHTML = '<p id="sp">Text inside a shadow root</p>';
  window.addLater = () => { const p = document.createElement('p'); p.id = 'later'; p.textContent = 'Content that was added later'; document.getElementById('far').before(p); };
  window.rewrite = () => { document.getElementById('h').textContent = 'A completely new heading'; };
</script>
</body></html>`;

/** 假引擎：保留标签，把每段文字包成【译:…】，并把第一个标签挪到最前面，模拟语序变化 */
function fakeTranslate(html) {
  const m = /<a i="(\d+)">(.*?)<\/a>/.exec(html);
  if (m && !m[2].includes('<')) html = m[0] + html.replace(m[0], '');
  return html.replace(/(^|>)([^<]+)/g, (_, pre, text) => (/[a-z]/i.test(text) ? `${pre}【译:${text.trim()}】` : pre + text));
}

let llmCalls = 0;
function startServer() {
  return new Promise((done) => {
    const server = createServer((req, res) => {
      if (req.url === '/v1/chat/completions') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          llmCalls++;
          const items = JSON.parse(JSON.parse(body).messages[1].content);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ choices: [{ message: { content: '```json\n' + JSON.stringify(items.map(fakeTranslate)) + '\n```' } }] }));
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

async function main() {
  const { server, port } = await startServer();
  const userData = mkdtempSync(join(tmpdir(), 'drak-tr-'));
  const ctx = await chromium.launchPersistentContext(userData, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  try {
    const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
    const base = `http://127.0.0.1:${port}`;
    const setTr = (patch) =>
      sw.evaluate(async (p) => {
        const cur = (await chrome.storage.local.get('translate')).translate || {};
        await chrome.storage.local.set({ translate: { ...cur, ...p } });
      }, patch);
    // 与弹窗、快捷键走的是同一条路：注入 translate.js 再发命令
    const command = (type) =>
      sw.evaluate(async (t) => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['translate.js'] });
        return chrome.tabs.sendMessage(tab.id, { type: t }, { frameId: 0 });
      }, type);
    const tr = (page, id) =>
      page.evaluate((i) => {
        const el = document.getElementById(i);
        return Array.from(el.querySelectorAll(':scope > font.drak-tr')).map((f) => ({ text: f.textContent, html: f.innerHTML, block: f.hasAttribute('data-block') }));
      }, id);

    await setTr({ engine: 'llm', target: 'zh-CN', mode: 'bilingual', fallback: false, llm: { baseUrl: `${base}/v1`, apiKey: 'test', model: 'fake' } });
    const page = await ctx.newPage();
    await page.goto(`${base}/`);
    await page.bringToFront();
    const original = await page.evaluate(() => document.body.innerHTML);

    // ---- 双语对照 ----
    await command('tr:start');
    await page.waitForSelector('#p1 > font.drak-tr');
    await page.waitForTimeout(300);

    const h = await tr(page, 'h');
    check('双语：标题下方出现译文', h.length === 1 && h[0].text === '【译:Adaptive dark mode for every website】' && h[0].block, JSON.stringify(h));
    const p1 = (await tr(page, 'p1'))[0];
    check('双语：原文保留', (await page.evaluate(() => document.getElementById('p1').firstChild.nodeValue)).startsWith('The extension recolors'));
    check('双语：译文里的链接可点、语序可调整', /^<a href="\/docs">【译:color role】<\/a>/.test(p1?.html ?? ''), p1?.html);
    check('双语：加粗等行内格式保留', (p1?.html ?? '').includes('<strong>【译:borders】</strong>'));
    check('双语：行内代码原样保留', (p1?.html ?? '').includes('<code>npm run build</code>'));
    check('双语：译文里不重复元素 id', !(p1?.html ?? '').includes('id='));
    check('已是目标语言的段落不翻译', (await tr(page, 'zh')).length === 0);
    check('纯数字不翻译', (await tr(page, 'num')).length === 0);
    check('代码块不翻译', (await page.evaluate(() => document.getElementById('pre').innerHTML)) === 'const untouched = "code block";');
    const mixed = await tr(page, 'mixed');
    check('块内的散落文字各自成段', mixed.length === 2 && mixed[0].text.includes('Leading text') && mixed[1].text.includes('trailing text'), JSON.stringify(mixed));
    check('嵌套块单独翻译', (await tr(page, 'inner'))[0]?.text === '【译:Nested block text goes here】');
    const img = (await tr(page, 'img'))[0];
    check('双语：译文里不重复图片', !!img && !img.html.includes('<img') && img.text.includes('sitting on a sofa'), img?.html);
    const btn = await page.evaluate(() => ({ icon: document.querySelector('#btn i').textContent, tr: document.querySelector('#btn > font.drak-tr')?.textContent }));
    check('图标字体不翻译', btn.icon === 'menu' && btn.tr === '【译:Open menu】', JSON.stringify(btn));
    check('单行截断的容器里译文不另起一行', (await tr(page, 'nowrap'))[0]?.block === false);
    const br = await tr(page, 'br');
    check('换行分隔的每一行各自翻译', br.length === 2 && br[0].text.includes('First line') && br[1].text.includes('Second line'), JSON.stringify(br));
    check('Shadow DOM 内的文字也翻译', await page.evaluate(() => document.getElementById('host').shadowRoot.querySelector('font.drak-tr')?.textContent === '【译:Text inside a shadow root】'));
    check('视口之外的段落先不翻译', (await tr(page, 'far')).length === 0);

    await page.evaluate(() => window.addLater());
    await page.evaluate(() => document.getElementById('later').scrollIntoView());
    await page.waitForSelector('#later > font.drak-tr');
    check('后来新增的内容自动翻译', true);
    await page.evaluate(() => document.getElementById('far').scrollIntoView());
    await page.waitForSelector('#far > font.drak-tr');
    check('滚动到视口后再翻译', true);

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.evaluate(() => window.rewrite());
    await page.waitForFunction(() => document.querySelector('#h > font.drak-tr')?.textContent === '【译:A completely new heading】');
    check('页面改写文字后译文跟着更新', (await tr(page, 'h')).length === 1);

    const st = await command('tr:status');
    check('状态：进行中且有计数', st.active && st.done > 0 && st.done === st.total, JSON.stringify(st));

    // ---- 还原 ----
    await page.evaluate(() => {
      document.getElementById('later').remove();
      document.getElementById('h').textContent = 'Adaptive dark mode for every website';
    });
    await command('tr:stop');
    const restored = await page.evaluate(() => document.body.innerHTML);
    check('显示原文：页面完全还原', restored === original && (await page.evaluate(() => !document.querySelector('font.drak-tr, style[data-drak-tr]'))));

    // ---- 仅显示译文 ----
    await setTr({ mode: 'replace' });
    await command('tr:start');
    await page.waitForFunction(() => document.getElementById('h').textContent.startsWith('【译:'));
    await page.waitForTimeout(300);
    const rp = await page.evaluate(() => ({
      h: document.getElementById('h').textContent,
      p1: document.getElementById('p1').innerHTML,
      cat: !!document.querySelector('#img > #cat'),
      img: document.getElementById('img').textContent,
      lnk: document.querySelectorAll('#lnk').length,
    }));
    check('替换：原文被译文取代', rp.h === '【译:Adaptive dark mode for every website】', rp.h);
    check('替换：链接与格式保留', /^<a id="lnk" href="\/docs">【译:color role】<\/a>/.test(rp.p1) && rp.p1.includes('<strong>【译:borders】</strong>'), rp.p1);
    check('替换：图片仍在原处', rp.cat && rp.img.includes('【译:Photo of a cat】'));
    check('替换：不产生重复 id', rp.lnk === 1);
    await command('tr:toggle');
    check('替换：显示原文后完全还原', (await page.evaluate(() => document.body.innerHTML)) === original);

    // ---- 缓存 ----
    const before = llmCalls;
    await command('tr:start');
    await page.waitForFunction(() => document.getElementById('h').textContent.startsWith('【译:'));
    check('重复翻译走缓存，不再请求引擎', llmCalls === before, `${before} -> ${llmCalls}`);
    await command('tr:stop');

    // ---- 总是翻译此网站（按 域名/IP:端口 识别） ----
    await setTr({ mode: 'bilingual', autoSites: [`127.0.0.1:${port}`] });
    await page.goto(`${base}/some/other/path?x=1`);
    await page.waitForSelector('#p1 > font.drak-tr', { timeout: 5000 });
    check('自动翻译站点：同一 IP:端口 下的其他路径也自动翻译', true);

    // ---- 侧边翻译按钮 ----
    await setTr({ autoSites: [] });
    await page.goto(`${base}/`);
    await page.bringToFront();
    const fabHost = () => page.evaluate(() => !!document.querySelector('html > div[translate="no"][style*="2147483646"]'));
    await page.waitForFunction(() => !!document.querySelector('html > div[translate="no"][style*="2147483646"]'));
    check('侧边按钮：默认显示，挂在 <html> 下不改动 body', !(await page.evaluate(() => document.body.querySelector('div[translate="no"]'))));
    // 默认停在右侧、视口 62% 高度，半隐藏
    const fy = Math.round(900 * 0.62);
    await page.mouse.move(1272, fy);
    await page.waitForTimeout(300);
    await page.mouse.click(1255, fy);
    await page.waitForSelector('#p1 > font.drak-tr', { timeout: 8000 });
    check('侧边按钮：点一下翻译', true);
    await page.waitForTimeout(300);
    await page.mouse.click(1255, fy);
    await page.waitForFunction(() => !document.querySelector('font.drak-tr'));
    check('侧边按钮：再点一下显示原文', true);
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(root, 'test-results', 'fab.png') });

    await page.mouse.move(1255, fy);
    await page.mouse.down();
    await page.mouse.move(600, 400, { steps: 6 });
    await page.mouse.move(30, 300, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const fab1 = await sw.evaluate(async () => (await chrome.storage.local.get('translate')).translate.fab);
    check('侧边按钮：拖到左边，位置记住', fab1.side === 'left' && Math.abs(fab1.y - 300 / 900) < 0.02, JSON.stringify(fab1));
    check('侧边按钮：拖动不会触发翻译', await page.evaluate(() => !document.querySelector('font.drak-tr')));

    // 悬停后右侧出现菜单，第一项“本站隐藏”
    await page.mouse.move(26, 300);
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(root, 'test-results', 'fab-menu.png') });
    await page.mouse.click(80, 300 - 14);
    await page.waitForFunction(() => !document.querySelector('html > div[translate="no"][style*="2147483646"]'));
    const fab2 = await sw.evaluate(async () => (await chrome.storage.local.get('translate')).translate.fab);
    check("侧边按钮：本站隐藏", fab2.hiddenSites.length === 1 && fab2.hiddenSites[0] === `127.0.0.1:${port}`, JSON.stringify(fab2.hiddenSites));
    await page.reload();
    await page.waitForTimeout(800);
    check('侧边按钮：隐藏后刷新也不再出现', !(await fabHost()));
    await setTr({ fab: { ...fab2, hiddenSites: [] } });
    await page.waitForFunction(() => !!document.querySelector('html > div[translate="no"][style*="2147483646"]'));
    check('侧边按钮：设置里恢复后立即出现', true);
    await setTr({ fab: { ...fab2, hiddenSites: [], enabled: false } });
    await page.waitForFunction(() => !document.querySelector('html > div[translate="no"][style*="2147483646"]'));
    check('侧边按钮：全局关闭', true);
    await setTr({ fab: { ...fab2, hiddenSites: [], enabled: true, side: 'right', y: 0.62 } });

    // ---- 引擎不可用 ----
    // 换一个目标语言，避开前面已经缓存的译文
    await setTr({ autoSites: [], target: 'ja', llm: { baseUrl: `${base}/v1`, apiKey: '', model: 'fake' } });
    await page.goto(`${base}/`);
    await page.bringToFront();
    await command('tr:start');
    await page.waitForSelector('drak-translate-toast', { state: 'attached' });
    const err = await command('tr:status');
    check('引擎失败：给出原因且页面不被改动', /密钥/.test(err.error) && (await page.evaluate(() => !document.querySelector('font.drak-tr'))), err.error);
  } catch (e) {
    check('运行出错', false, String(e));
  } finally {
    await ctx.close();
    server.close();
    rmSync(userData, { recursive: true, force: true });
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n翻译验收：${results.length - failed.length} / ${results.length} 通过`);
  process.exit(failed.length ? 1 : 0);
}

main();
