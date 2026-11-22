// GitHub 加速下载的端到端验收：用仿 GitHub 结构的页面（拦截 github.com 请求）检查各处按钮、替换模式、关闭、私有仓库，
// 以及设置页卡片、弹窗的悬浮滚动条
import { chromium } from 'playwright';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dist = join(root, 'dist');
const NODE = 'https://v6.gh-proxy.org/';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`);
}

// 结构照 2026-11 的 github.com：Code 下拉是 React ActionList，Release 附件是 li.Box-row，单文件页 Raw 在 ButtonGroup 里
const page = (isPublic) => `<!doctype html><html><head><meta charset="utf-8">
<meta name="octolytics-dimension-repository_public" content="${isPublic}"><title>o/r</title></head><body>
<div id="menu"></div>
<ul id="assets">
  <li class="Box-row d-flex"><div><a id="asset" href="/o/r/releases/download/v1.0/app-win.zip" rel="nofollow">app-win.zip</a></div><div class="right"><span>sha256:abc</span></div></li>
  <li class="Box-row d-flex"><div><a id="src" href="/o/r/archive/refs/tags/v1.0.tar.gz" rel="nofollow">Source code (tar.gz)</a></div><div class="right"></div></li>
</ul>
<ul><li class="d-inline-block"><a id="tag" class="Link--muted" href="/o/r/archive/refs/tags/v1.0.zip">zip</a></li></ul>
<div class="prc-ButtonGroup-ButtonGroup-vFUrY"><div class="prc-ButtonGroup-Item-PqvDl"><a id="raw" data-testid="raw-button" href="https://github.com/o/r/raw/refs/heads/main/LICENSE">Raw</a></div></div>
<a id="plain" href="/o/r/issues">Issues</a>
<script>
  // 模拟点开 Code 下拉时才生成菜单
  setTimeout(() => {
    document.getElementById('menu').innerHTML = '<div class="d-flex mb-2"><input id="clone-with-https" readonly value="https://github.com/o/r.git"><button>copy</button></div>'
      + '<ul><li data-component="ActionList.Item" class="prc-ActionList-ActionListItem"><a id="zip" href="/o/r/archive/refs/heads/main.zip"><span><svg></svg></span><span><span data-component="ActionList.Item.Label">Download ZIP</span></span></a></li></ul>';
  }, 300);
</script></body></html>`;

async function main() {
  const userData = mkdtempSync(join(tmpdir(), 'drak-gha-'));
  const ctx = await chromium.launchPersistentContext(userData, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1100, height: 900 },
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  let isPublic = true;
  const downloads = [];
  await ctx.route('https://github.com/**', (route) => {
    const url = route.request().url();
    if (/\/(releases\/download|archive)\//.test(url)) {
      downloads.push(url);
      return route.fulfill({ status: 200, headers: { 'content-disposition': 'attachment; filename=x.zip' }, contentType: 'application/zip', body: 'PK' });
    }
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: page(isPublic) });
  });
  try {
    const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
    const id = new URL(sw.url()).host;
    const setAccel = (v) => sw.evaluate((val) => chrome.storage.local.set({ ghaccel: val }), v);

    const p = await ctx.newPage();
    await p.goto('https://github.com/o/r');
    await p.waitForSelector('li.drak-gha-item a', { timeout: 5000 }).catch(() => {});
    await p.waitForTimeout(400);
    const add = await p.evaluate(() => {
      const href = (sel) => document.querySelector(sel)?.getAttribute('href') ?? null;
      return {
        zipItem: href('li.drak-gha-item a'),
        zipLabel: document.querySelector('li.drak-gha-item')?.textContent ?? '',
        zipOrig: href('#zip'),
        asset: href('#asset ~ * a.drak-gha-btn') ?? document.querySelector('#asset')?.closest('li')?.querySelector('a.drak-gha-btn')?.getAttribute('href'),
        src: document.querySelector('#src')?.closest('li')?.querySelector('a.drak-gha-btn')?.getAttribute('href'),
        tag: document.querySelector('#tag')?.nextElementSibling?.getAttribute('href'),
        raw: document.querySelector('.prc-ButtonGroup-ButtonGroup-vFUrY')?.nextElementSibling?.getAttribute('href'),
        clone: !!document.querySelector('.drak-gha-clone a.drak-gha-btn'),
        plainBtn: document.querySelector('#plain')?.nextElementSibling?.classList.contains('drak-gha-btn') ?? false,
        total: document.querySelectorAll('[data-drak-gha]').length,
      };
    });
    check('Code 下拉：Download ZIP 下面多一行加速下载', add.zipItem === `${NODE}https://github.com/o/r/archive/refs/heads/main.zip` && add.zipLabel.includes('加速下载 ZIP') && add.zipLabel.includes('v6.gh-proxy.org'), JSON.stringify(add.zipItem));
    check('Code 下拉：原 Download ZIP 不变', add.zipOrig === '/o/r/archive/refs/heads/main.zip');
    check('Release 附件加“加速”', add.asset === `${NODE}https://github.com/o/r/releases/download/v1.0/app-win.zip`, String(add.asset));
    check('Release 源码包加“加速”', add.src === `${NODE}https://github.com/o/r/archive/refs/tags/v1.0.tar.gz`, String(add.src));
    check('Tags 页源码包加“加速”', add.tag === `${NODE}https://github.com/o/r/archive/refs/tags/v1.0.zip`, String(add.tag));
    check('单文件 Raw 加“加速”', add.raw === `${NODE}https://github.com/o/r/raw/refs/heads/main/LICENSE`, String(add.raw));
    check('clone 地址下面有“复制加速 clone 地址”', add.clone);
    check('普通链接不加按钮', !add.plainBtn);

    // 换节点：按钮跟着变
    await setAccel({ node: 'https://cdn.gh-proxy.org/' });
    await p.waitForTimeout(300);
    const switched = await p.evaluate(() => document.querySelector('li.drak-gha-item a')?.getAttribute('href'));
    check('换节点后按钮地址跟着变', switched === 'https://cdn.gh-proxy.org/https://github.com/o/r/archive/refs/heads/main.zip', String(switched));

    // 替换模式：不加按钮，原链接直接改走加速
    await setAccel({ mode: 'replace' });
    await p.waitForTimeout(300);
    const rep = await p.evaluate(() => ({
      zip: document.querySelector('#zip').href,
      asset: document.querySelector('#asset').href,
      raw: document.querySelector('#raw').href,
      btns: document.querySelectorAll('a.drak-gha-btn:not([data-drak-gha="copy"])').length,
      items: document.querySelectorAll('li.drak-gha-item').length,
    }));
    check('替换模式：原链接改走加速、不加按钮', rep.zip === `${NODE}https://github.com/o/r/archive/refs/heads/main.zip` && rep.asset.startsWith(NODE) && rep.raw.startsWith(NODE) && rep.btns === 0 && rep.items === 0, JSON.stringify(rep));

    // 关闭：恢复原样
    await setAccel({ enabled: false });
    await p.waitForTimeout(300);
    const off = await p.evaluate(() => ({ marks: document.querySelectorAll('[data-drak-gha]').length, zip: document.querySelector('#zip').getAttribute('href'), asset: document.querySelector('#asset').getAttribute('href') }));
    check('关闭后页面恢复原样', off.marks === 0 && off.zip === '/o/r/archive/refs/heads/main.zip' && off.asset === '/o/r/releases/download/v1.0/app-win.zip', JSON.stringify(off));

    // 私有仓库：不加
    await setAccel({});
    isPublic = false;
    await p.goto('https://github.com/o/private');
    await p.waitForTimeout(900);
    const priv = await p.evaluate(() => document.querySelectorAll('[data-drak-gha]').length);
    check('私有仓库不加按钮', priv === 0, `marks=${priv}`);
    isPublic = true;

    // 回退：节点连不上时提示并改用原链接（后台探测走 fetch，这里让后台直接返回失败）
    await sw.evaluate(() => {
      self.__origFetch = self.fetch;
      self.fetch = (url, init) => (String(url).includes('gh-proxy.org') ? Promise.reject(new TypeError('blocked')) : self.__origFetch(url, init));
    });
    await p.goto('https://github.com/o/r');
    await p.waitForSelector('#asset ~ *, li.Box-row a.drak-gha-btn', { timeout: 5000 }).catch(() => {});
    downloads.length = 0;
    await p.locator('li.Box-row a.drak-gha-btn').first().click();
    await p.waitForTimeout(800);
    const toast = await p.evaluate(() => document.querySelector('.drak-gha-toast')?.textContent ?? '');
    check('节点连不上：提示并改用原链接', toast.includes('已改用 GitHub 原链接') && downloads.includes('https://github.com/o/r/releases/download/v1.0/app-win.zip'), `${toast} | ${downloads.join(',')}`);
    await p.close();

    // 设置页卡片
    const op = await ctx.newPage();
    await op.goto(`chrome-extension://${id}/options.html`);
    await op.waitForSelector('#ghaccel .gha-node', { timeout: 5000 }).catch(() => {});
    const card = await op.evaluate(() => ({ nodes: document.querySelectorAll('#ghaccel .gha-node').length, warn: !!document.querySelector('#ghaccel .gha-warn') }));
    check('设置页：节点列表（4 个内置 + 自定义）和第三方提示', card.nodes === 5 && card.warn, JSON.stringify(card));
    await op.fill('#ghaccel .gha-custom input', 'my.proxy.dev');
    await op.press('#ghaccel .gha-custom input', 'Enter');
    await op.waitForTimeout(200);
    const saved = await sw.evaluate(async () => (await chrome.storage.local.get('ghaccel')).ghaccel);
    check('设置页：自定义节点规范成 https 并选中', saved?.custom === 'https://my.proxy.dev/' && saved?.node === 'custom', JSON.stringify(saved));
    await op.close();

    // 弹窗：系统滚动条隐藏，悬浮细条可用
    const pp = await ctx.newPage();
    await pp.setViewportSize({ width: 340, height: 600 });
    await pp.goto(`chrome-extension://${id}/popup.html`);
    await pp.waitForTimeout(500);
    const sb = await pp.evaluate(async () => {
      const html = document.documentElement;
      const track = document.querySelector('.ov-track');
      const thumb = document.querySelector('.ov-thumb');
      const before = thumb.getBoundingClientRect().top;
      html.scrollTo({ top: 200 });
      await new Promise((r) => setTimeout(r, 100));
      return {
        hidden: getComputedStyle(html).scrollbarWidth,
        overflow: html.scrollHeight > html.clientHeight,
        fullWidth: document.body.getBoundingClientRect().width,
        track: !!track && !track.hidden,
        show: track.classList.contains('show'),
        moved: thumb.getBoundingClientRect().top > before,
        sticky: getComputedStyle(document.querySelector('body.popup > header')).position,
        scrolled: document.querySelector('body.popup > header').classList.contains('scrolled'),
      };
    });
    check('弹窗：系统滚动条隐藏，内容占满宽度', sb.hidden === 'none' && sb.fullWidth === 340, JSON.stringify(sb));
    check('弹窗：悬浮滚动条随滚动出现并移动', sb.overflow && sb.track && sb.show && sb.moved, JSON.stringify(sb));
    check('弹窗：顶栏固定，滚动后出现分隔线', sb.sticky === 'sticky' && sb.scrolled);
    await pp.close();
  } catch (e) {
    check('运行出错', false, String(e?.stack ?? e));
  } finally {
    await ctx.close();
    rmSync(userData, { recursive: true, force: true });
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\nGitHub 加速验收：${results.length - failed.length} / ${results.length} 通过`);
  process.exit(failed.length ? 1 : 0);
}

main();
