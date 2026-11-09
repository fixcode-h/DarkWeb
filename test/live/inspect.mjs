// 调试用：加载扩展打开一个页面，执行一段表达式并打印结果。用法：node test/live/inspect.mjs <url> '<js 表达式>' [截图名]
import { chromium } from 'playwright';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dist = join(root, 'dist');
const [url, expr, shot] = process.argv.slice(2);
const userData = mkdtempSync(join(tmpdir(), 'drak-inspect-'));
const ext = process.env.NO_EXT ? [] : [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`];
const ctx = await chromium.launchPersistentContext(userData, {
  channel: 'chromium', headless: true, locale: 'zh-CN', viewport: { width: 1280, height: 900 },
  proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined, args: ext,
});
const p = await ctx.newPage();
await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
await p.waitForTimeout(+(process.env.WAIT || 7000));
console.log(await p.evaluate(expr));
if (shot) await p.screenshot({ path: join(root, 'test-results/live', shot + '.png') });
await ctx.close();
rmSync(userData, { recursive: true, force: true });
