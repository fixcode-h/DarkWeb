// 检查更新的端到端验收：假的 GitHub Releases 接口 → 设置页列出改动和下载按钮、弹窗提示、出错时给出原因
import { chromium } from 'playwright';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dist = join(root, 'dist');
const shots = process.env.UPDATE_SHOTS;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`);
}

const NOTES = (v, prev) => `## Drak ${v}\n\n相对上一个包（v${prev}）的调整：\n\n- 插件内置检查更新（#31）\n  - 设置页加“版本与更新”\n  - 弹窗底部加“检查更新”\n- 修复百度首页暗色（#28）\n\n### 安装\n\n下载 zip 解压后加载。\n`;
const release = (v, prev) => ({
  tag_name: `v${v}`,
  body: NOTES(v, prev),
  html_url: `https://github.com/fixcode-h/DarkWeb/releases/tag/v${v}`,
  published_at: '2026-11-14T00:00:00Z',
  assets: [
    { name: `drak-${v}-store.zip`, browser_download_url: `https://example.invalid/drak-${v}-store.zip` },
    { name: `drak-${v}.zip`, browser_download_url: `https://example.invalid/drak-${v}.zip` },
  ],
});

async function main() {
  const userData = mkdtempSync(join(tmpdir(), 'drak-upd-'));
  const ctx = await chromium.launchPersistentContext(userData, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 980, height: 1400 },
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  let api = { status: 200, body: [] };
  await ctx.route('https://api.github.com/**', (route) =>
    route.fulfill({ status: api.status, contentType: 'application/json', body: JSON.stringify(api.body) }),
  );
  try {
    const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
    const id = new URL(sw.url()).host;
    const version = await sw.evaluate(() => chrome.runtime.getManifest().version);
    const [a, b, c] = version.split('.').map(Number);
    const v1 = `${a}.${b}.${c}.900`;
    const v2 = `${a}.${b}.${c}.901`;
    const alarm = await sw.evaluate(async () => {
      for (let i = 0; i < 20; i++) {
        const x = await chrome.alarms.get('drak-update-check');
        if (x) return x;
        await new Promise((r) => setTimeout(r, 100));
      }
      return null;
    });
    check('后台每天自动检查一次', alarm && alarm.periodInMinutes === 1440);

    // ---- 已是最新 ----
    api = { status: 200, body: [{ ...release(version, version), tag_name: `v${version}` }] };
    const page = await ctx.newPage();
    await page.goto(`chrome-extension://${id}/options.html#update`);
    await page.click('#update button:has-text("检查更新")');
    await page.waitForSelector('#update :text("已是最新版本")');
    check('已是最新：提示已是最新版本', true);

    // ---- 有两个新版本 ----
    api = { status: 200, body: [release(v2, v1), release(v1, version), release(version, version)] };
    await page.click('#update button:has-text("检查更新")');
    await page.waitForSelector('#update .upd-changes');
    const info = await page.evaluate(() => ({
      status: document.querySelector('#update .upd-status')?.textContent,
      tags: [...document.querySelectorAll('#update .upd-tag')].map((e) => e.textContent),
      items: [...document.querySelectorAll('#update .upd-release:first-child > ul > li')].length,
      subs: [...document.querySelectorAll('#update .upd-release:first-child ul ul li')].map((e) => e.textContent),
      install: !!document.querySelector('#update .upd-release')?.textContent.includes('解压后加载'),
      download: [...document.querySelectorAll('#update button')].map((e) => e.textContent).find((t) => t.startsWith('下载')),
      reload: [...document.querySelectorAll('#update button')].some((e) => e.textContent.includes('重新加载')),
    }));
    check('有新版：标出最新版本和落后几个版本', info.status?.includes(v2) && info.status.includes('2 个版本'), info.status);
    check('有新版：每个版本列出改动，新的在前', info.tags.join() === `${v2},${v1}` && info.items === 2 && info.subs.length === 2 && !info.install, JSON.stringify(info));
    check('有新版：下载带 key 的包', info.download === `下载 drak-${v2}.zip`, info.download);
    check('解压安装：提供覆盖后重新加载', info.reload);
    const badge = await sw.evaluate(() => chrome.action.getBadgeText({}));
    check('有新版：图标角标显示“新”', badge === '新', badge);
    if (shots) await page.locator('#update').screenshot({ path: join(shots, 'options-update.png') });

    // ---- 弹窗 ----
    const popup = await ctx.newPage();
    await popup.setViewportSize({ width: 340, height: 700 });
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.waitForSelector('#updateSlot:not([hidden]) .upd-note');
    const note = await popup.textContent('#updateSlot');
    check('弹窗：顶部提示有新版本', note.includes(v2) && note.includes('查看改动并更新'), note);
    if (shots) await popup.screenshot({ path: join(shots, 'popup-update.png') });

    // ---- 出错 ----
    api = { status: 500, body: {} };
    await popup.click('#checkUpdate');
    await popup.waitForSelector('#updateSlot :text("检查失败")');
    check('出错：弹窗显示原因', (await popup.textContent('#updateSlot')).includes('500'));
    await page.reload();
    await page.waitForSelector('#update .errors');
    const keep = await page.$('#update .upd-changes');
    check('出错：设置页显示原因并保留上次的结果', !!keep);
  } catch (e) {
    check('运行出错', false, String(e));
  } finally {
    await ctx.close();
    rmSync(userData, { recursive: true, force: true });
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n检查更新验收：${results.length - failed.length} / ${results.length} 通过`);
  process.exit(failed.length ? 1 : 0);
}

main();
