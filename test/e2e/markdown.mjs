// Markdown 文件渲染 / 编辑的端到端验收：本地服务器返回纯文本 .md，检查渲染、目录、编辑、任务框、下载、草稿、设置
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dist = join(root, 'dist');
const shots = process.env.MD_SHOTS || '';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`);
}

export const README = `# Drak 暗色模式

自适应暗色模式浏览器插件：按**颜色角色**重新配色，保留边框与层次，*不做简单反色*。详见 [安装](#安装)。

> 提示：打开本地 \`.md\` 文件前，需要在扩展详情页打开「允许访问文件网址」。

## 功能特性

| 功能 | 说明 | 版本 |
|------|------|------|
| 自适应暗色 | 按背景、文字、边框分别计算配色 | 0.1 |
| 网页翻译 | 整页 / 划词 / 输入框三种方式 | 0.3 |
| Markdown 渲染 | 自动渲染 .md 文件，可直接编辑保存 | 0.7 |

### 按颜色角色重新配色

背景、文字、边框分开处理。

## 安装

\`\`\`bash
# 安装依赖并构建
npm install
npm run build -- --zip
\`\`\`

\`\`\`js
const answer = 42; // 注释
\`\`\`

## 开发计划

- [x] 暗色引擎
- [x] 网页翻译与阅读模式
- [ ] Markdown 渲染与编辑

## 许可证

MIT[^1]

[^1]: 见 LICENSE 文件。

\`\`\`mermaid
flowchart LR
  A[打开] --> B{有图?}
\`\`\`

> [!TIP]
> 拖动两侧边缘调宽度

<img src="x" onerror="window.__pwned = 1"><script>window.__pwned = 2</script>
<a href="javascript:window.__pwned=3" id="evil">evil</a>
`;

function startServer() {
  return new Promise((done) => {
    const server = createServer((req, res) => {
      const send = (type, body) => {
        res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
        res.end(body);
      };
      if (req.url.split('?')[0] === '/README.md') return send('text/plain; charset=utf-8', README);
      if (req.url === '/doc') return send('text/markdown; charset=utf-8', '# 服务器说是 Markdown\n\n正文');
      if (req.url === '/page.md') return send('text/html; charset=utf-8', '<!doctype html><title>x</title><h1 id="real">真网页</h1>');
      if (req.url === '/notes.txt') return send('text/plain; charset=utf-8', '# 不是 md');
      res.writeHead(404);
      res.end();
    });
    server.listen(0, '127.0.0.1', () => done({ server, port: server.address().port }));
  });
}

const editorText = (page) => page.evaluate(() => [...document.querySelectorAll('.cm-line')].map((l) => l.textContent).join('\n'));

async function main() {
  const { server, port } = await startServer();
  const userData = mkdtempSync(join(tmpdir(), 'drak-md-'));
  const ctx = await chromium.launchPersistentContext(userData, {
    channel: 'chromium',
    headless: true,
    acceptDownloads: true,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: shots ? 2 : 1,
    colorScheme: 'dark',
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  try {
    const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
    const base = `http://127.0.0.1:${port}`;
    // 等暗色引擎的内容脚本注册好，才能验证它在 .md 页面上让位
    await sw.evaluate(async () => {
      for (let i = 0; i < 50 && !(await chrome.scripting.getRegisteredContentScripts()).length; i++) await new Promise((r) => setTimeout(r, 100));
    });
    const setMd = (patch) =>
      sw.evaluate(async (p) => {
        const cur = (await chrome.storage.local.get('markdown')).markdown || {};
        await chrome.storage.local.set({ markdown: { ...cur, ...p } });
      }, patch);

    // ---- 阅读模式 ----
    const page = await ctx.newPage();
    page.on('dialog', (d) => d.accept());
    await page.goto(`${base}/README.md`);
    await page.waitForSelector('html[data-drak-md="render"] .md-body h1', { timeout: 8000 });
    check('识别纯文本 .md 并渲染', (await page.textContent('.md-body h1')) === 'Drak 暗色模式');
    check('暗色引擎让位', await page.evaluate(() => document.documentElement.hasAttribute('data-drak-off') && !document.documentElement.hasAttribute('data-drak-mode')));
    check('默认深色主题', await page.evaluate(() => getComputedStyle(document.querySelector('.md-app')).backgroundColor) === 'rgb(38, 38, 36)');
    check('标签页标题是文件名', (await page.title()) === 'README.md');
    const toc = await page.$$eval('.md-toc a[data-id]', (as) => as.map((a) => a.textContent));
    check('目录列出标题', toc.join('|') === 'Drak 暗色模式|功能特性|按颜色角色重新配色|安装|开发计划|许可证', toc.join('|'));
    check('表格', (await page.$$('.md-body table td')).length === 9);
    check('代码高亮', (await page.$$('.md-body .md-code[data-lang="js"] .hljs-keyword')).length > 0);
    check('代码块顶栏和行号', (await page.textContent('.md-code[data-lang="bash"] .md-code-lang')) === 'bash · 3 行' && (await page.$$('.md-code[data-lang="bash"] .md-ln')).length === 3);
    check('提示块', (await page.textContent('.md-alert[data-kind="tip"] .md-alert-title')) === '提示');
    await page.waitForSelector('.md-mermaid[data-done]', { timeout: 15000 }).catch(() => {});
    check('Mermaid 画成图', (await page.getAttribute('.md-mermaid', 'data-done')) === '1' && !!(await page.$('.md-mermaid .md-mermaid-svg svg .node')), await page.getAttribute('.md-mermaid', 'data-done'));
    check('任务列表', (await page.$$('.md-body .task-box')).length === 3 && (await page.$$('.md-body .task-box.checked')).length === 2);
    check('脚注', (await page.$$('.md-body .footnotes li')).length === 1);
    await page.waitForTimeout(200);
    check('HTML 里的脚本和事件属性不执行', (await page.evaluate(() => window.__pwned)) === undefined && !(await page.$('.md-body script')) && !(await page.$('.md-body img[onerror]')));
    check('javascript: 链接被去掉', (await page.getAttribute('#evil', 'href')) === null);
    if (shots) await page.screenshot({ path: join(shots, 'md-read.png') });

    await page.click('.md-toc a[data-id="安装"]');
    await page.waitForTimeout(600);
    check('点目录跳到对应标题', await page.evaluate(() => Math.abs(document.querySelector('#安装').getBoundingClientRect().top - document.querySelector('.md-preview').getBoundingClientRect().top) < 40));
    check('目录高亮当前章节', (await page.textContent('.md-toc a.on')) === '安装');

    await page.click('[data-act="bigger"]');
    check('A+ 增大字号并记住', (await page.evaluate(() => getComputedStyle(document.querySelector('.md-body')).fontSize)) === '18px' && (await sw.evaluate(async () => (await chrome.storage.local.get('markdown')).markdown.fontSize)) === 18);
    await page.click('[data-act="smaller"]');

    // 栏宽：拖右侧边缘调节并记住，双击恢复默认
    const pageW = () => page.evaluate(() => Math.round(document.querySelector('.md-page').getBoundingClientRect().width));
    const grip = await page.locator('.md-grip.r').boundingBox();
    const mid = await page.evaluate(() => { const r = document.querySelector('.md-preview').getBoundingClientRect(); return r.left + r.width / 2; });
    await page.mouse.move(grip.x + grip.width / 2, 300);
    await page.mouse.down();
    await page.mouse.move(mid + 450, 320, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    const stored = await sw.evaluate(async () => (await chrome.storage.local.get('markdown')).markdown.pageWidth);
    check('拖动边缘调栏宽并记住', stored === 900 && Math.abs((await pageW()) - 900) <= 1 && (await page.textContent('[data-act="width"] span')) === '900');
    await page.click('[data-act="width"]');
    check('栏宽按钮跳到下一档', (await sw.evaluate(async () => (await chrome.storage.local.get('markdown')).markdown.pageWidth)) === 960);
    await page.dblclick('.md-grip.r', { position: { x: 7, y: 300 } });
    check('双击边缘恢复默认栏宽', (await sw.evaluate(async () => (await chrome.storage.local.get('markdown')).markdown.pageWidth)) === 1520);

    // 预览里勾任务框
    await page.click('.md-body .task-box:not(.checked)');
    check('阅读模式勾任务框后标记为已修改', (await page.title()).startsWith('● ') && (await page.isVisible('[data-act="save-read"]')));

    // ---- 编辑 ----
    await page.click('[data-act="edit"]');
    await page.waitForSelector('.cm-editor');
    check('切到分栏：编辑器和预览都在', (await page.isVisible('.cm-editor')) && (await page.isVisible('.md-preview')));
    await page.waitForFunction(() => [...document.querySelectorAll('.cm-line')].some((l) => l.textContent === '- [x] Markdown 渲染与编辑'), null, { timeout: 3000 }).catch(() => {});
    check('勾选结果写回源码', (await editorText(page)).includes('- [x] Markdown 渲染与编辑'));
    await page.click('.cm-content');
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n## 新章节\n\n刚写的内容');
    await page.waitForFunction(() => [...document.querySelectorAll('.md-body h2')].some((h) => h.textContent === '新章节'));
    check('编辑后预览实时更新', true);
    await page.keyboard.down('Shift');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
    await page.keyboard.up('Shift');
    await page.click('[data-fmt="bold"]');
    const afterBold = await editorText(page);
    check('格式按钮：加粗选中的文字', afterBold.includes('刚写**的内容**'), afterBold.split('\n').slice(-2).join(' / '));
    await page.waitForFunction(() => document.querySelector('.md-body strong:last-of-type')?.textContent === '的内容' || [...document.querySelectorAll('.md-body strong')].some((s) => s.textContent === '的内容'));
    check('状态栏显示光标位置', /第 \d+ 行/.test(await page.textContent('[data-s="pos"]')));

    // 同步滚动
    await page.hover('.md-editor');
    await page.evaluate(() => (document.querySelector('.cm-scroller').scrollTop = 300));
    await page.waitForTimeout(200);
    const pTop = await page.evaluate(() => document.querySelector('.md-preview').scrollTop);
    check('分栏同步滚动', pTop > 50, `preview scrollTop=${pTop}`);
    await page.evaluate(() => (document.querySelector('.cm-scroller').scrollTop = 0));
    if (shots) {
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(shots, 'md-edit.png') });
    }

    // 下载
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="download"]')]);
    const body = readFileSync(await dl.path(), 'utf8');
    check('下载的是修改后的内容', dl.suggestedFilename() === 'README.md' && body.includes('## 新章节') && body.includes('- [x] Markdown 渲染与编辑'));

    // 草稿：等暂存后刷新
    await page.waitForTimeout(1200);
    await page.reload();
    await page.waitForSelector('.md-banner', { timeout: 5000 });
    check('刷新后提示恢复草稿', /未保存的修改/.test(await page.textContent('.md-banner')));
    await page.click('.md-banner .md-btn.primary');
    await page.waitForSelector('.cm-editor');
    check('恢复草稿', (await editorText(page)).includes('## 新章节') && (await page.title()).startsWith('● '));

    // 源码视图、Ctrl+E 回阅读
    await page.click('[data-view="source"]');
    check('源码视图只显示编辑器', (await page.isVisible('.cm-editor')) && !(await page.isVisible('.md-preview')));
    await page.keyboard.press('Control+e');
    check('Ctrl+E 回到阅读', (await page.getAttribute('.md-app', 'data-view')) === 'read');

    // 主题切换
    await page.click('[data-act="theme"]');
    check('切换主题：自动（深色）的下一个是浅色', await page.evaluate(() => document.querySelector('.md-app').classList.contains('light')));
    await setMd({ theme: 'auto' });

    // ---- 其他类型 ----
    const p2 = await ctx.newPage();
    await p2.goto(`${base}/doc`);
    await p2.waitForSelector('.md-body h1', { timeout: 8000 });
    check('服务器返回 text/markdown 时也渲染', (await p2.textContent('.md-body h1')) === '服务器说是 Markdown');
    await p2.goto(`${base}/page.md`);
    await p2.waitForTimeout(800);
    check('.md 结尾但其实是网页：不接管', !(await p2.$('.md-app')) && (await p2.textContent('#real')) === '真网页');
    await p2.goto(`${base}/notes.txt`);
    await p2.waitForTimeout(800);
    check('普通 .txt 不接管', !(await p2.$('.md-app')));

    // ---- 设置：关闭网络文件 ----
    await setMd({ remote: false });
    await p2.goto(`${base}/README.md?off`);
    await p2.waitForFunction(() => document.documentElement.getAttribute('data-drak-md') === 'off' && document.documentElement.hasAttribute('data-drak-mode'), null, { timeout: 5000 }).catch(() => undefined);
    check('关闭“渲染网络上的 .md”后不接管', !(await p2.$('.md-app')) && (await p2.getAttribute('html', 'data-drak-md')) === 'off');
    const attrs = await p2.evaluate(() => [...document.documentElement.attributes].map((a) => `${a.name}=${a.value}`).join(' '));
    // 测试浏览器是深色偏好，纯文本页本身就显示成深色，引擎可能以“页面已是深色”让位；只要不是因为 Markdown 让位就行
    const diag = await sw.evaluate(async (u) => {
      const [tab] = await chrome.tabs.query({ url: u });
      return chrome.tabs.sendMessage(tab.id, { type: 'diag' }, { frameId: 0 });
    }, `${base}/README.md?off`);
    check('不接管时暗色引擎照常处理', diag?.reason !== 'markdown' && (/data-drak-mode/.test(attrs) || diag?.reason === 'page-already-dark'), `${attrs}；reason=${diag?.reason}`);
    await setMd({ remote: true, view: 'split' });
    await p2.goto(`${base}/README.md`);
    await p2.waitForSelector('.cm-editor', { timeout: 8000 });
    check('默认打开方式：分栏', (await p2.getAttribute('.md-app', 'data-view')) === 'split');
    await setMd({ view: 'read' });
    await p2.close();

    // ---- 本地文件（测试浏览器默认允许扩展访问文件网址时才测得到） ----
    if (await sw.evaluate(() => new Promise((r) => chrome.extension.isAllowedFileSchemeAccess(r)))) {
      const dir = mkdtempSync(join(tmpdir(), 'drak-md-file-'));
      writeFileSync(join(dir, '笔记.md'), '# 本地笔记\n\n![图](pic.png)\n\n[下一篇](next.md)\n');
      const fp = await ctx.newPage();
      await fp.goto(pathToFileURL(join(dir, '笔记.md')).href);
      await fp.waitForSelector('.md-body h1', { timeout: 8000 });
      check('本地 file:// 文件渲染', (await fp.textContent('.md-body h1')) === '本地笔记' && (await fp.title()) === '笔记.md');
      check('本地文件里的相对图片和链接指向同目录', (await fp.getAttribute('.md-body img', 'src')).startsWith('file://') && (await fp.getAttribute('.md-body a', 'href')).endsWith('/next.md'));
      check('本地文件显示“本地文件”', (await fp.textContent('.md-file .meta')).includes('本地文件'));
      await fp.close();
      rmSync(dir, { recursive: true, force: true });
    } else console.log('- 测试浏览器没有文件网址权限，跳过 file:// 用例');

    // ---- 设置页 ----
    const opt = await ctx.newPage();
    const extId = new URL(sw.url()).host;
    await opt.goto(`chrome-extension://${extId}/enhance.html#markdown`);
    await opt.waitForSelector('#mdEnabled');
    const fileAccess = await sw.evaluate(() => new Promise((r) => chrome.extension.isAllowedFileSchemeAccess(r)));
    check('设置页：文件网址权限提示和实际权限一致', (await opt.isVisible('#mdFileWarn')) === !fileAccess, `允许访问文件网址=${fileAccess}`);
    await opt.click('label:has(#mdDrafts) .switch');
    await opt.waitForTimeout(200);
    check('设置页：修改后自动保存', (await sw.evaluate(async () => (await chrome.storage.local.get('markdown')).markdown.drafts)) === false);
    if (shots) {
      await opt.evaluate(() => document.getElementById('markdown').scrollIntoView());
      await opt.screenshot({ path: join(shots, 'md-options.png') });
    }
    await opt.close();
    await page.close();
  } catch (e) {
    check('运行出错', false, String(e));
  } finally {
    await ctx.close();
    server.close();
    rmSync(userData, { recursive: true, force: true });
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\nMarkdown 验收：${results.length - failed.length} / ${results.length} 通过`);
  process.exit(failed.length ? 1 : 0);
}

main();
