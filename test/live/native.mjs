// 不加载扩展，对比知乎原生夜间的几种开启方式：只设 html 属性 / 只设 cookie / URL 参数
import { chromium } from 'playwright';
const b = await chromium.launch({ proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined });
const out = process.argv[2] || 'test-results/live';
const sample = () => {
  const lum = (s) => { const p = (/rgba?\(([^)]+)\)/.exec(s) || [, '255,255,255'])[1].split(/[\s,]+/).map(Number); return p[3] === 0 ? null : +((p[0] + p[1] + p[2]) / 765).toFixed(2); };
  const q = (s) => { const e = document.querySelector(s); return e ? lum(getComputedStyle(e).backgroundColor) : 'none'; };
  let bright = 0, total = 0;
  for (let y = 80; y < innerHeight; y += 40) for (let x = 20; x < innerWidth; x += 40) {
    let el = document.elementFromPoint(x, y); if (!el) continue; total++;
    while (el && lum(getComputedStyle(el).backgroundColor) === null) el = el.parentElement;
    if (el && lum(getComputedStyle(el).backgroundColor) > 0.6) bright++;
  }
  return { theme: document.documentElement.getAttribute('data-theme'), body: q('body'), header: q('.AppHeader'), brightRatio: +(bright / total).toFixed(2) };
};
for (const [name, url, how] of [
  ['light', 'https://www.zhihu.com/explore', null],
  ['attr', 'https://www.zhihu.com/explore', 'attr'],
  ['cookie', 'https://www.zhihu.com/explore', 'cookie'],
  ['param', 'https://www.zhihu.com/explore?theme=dark', null],
]) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' });
  if (how === 'cookie') await ctx.addCookies([{ name: 'themeApp', value: 'dark', domain: '.zhihu.com', path: '/' }]);
  const p = await ctx.newPage();
  if (how === 'attr') await p.addInitScript(() => {
    new MutationObserver(() => { const h = document.documentElement; if (h && h.getAttribute('data-theme') !== 'dark') h.setAttribute('data-theme', 'dark'); }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-theme'], childList: true });
  });
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForTimeout(6000);
  const cookies = (await ctx.cookies()).filter((c) => c.name.startsWith('theme')).map((c) => `${c.name}=${c.value}@${c.domain}${c.httpOnly ? ' httpOnly' : ''}`);
  console.log(name, JSON.stringify(await p.evaluate(sample)), cookies.join(' '));
  await p.screenshot({ path: `${out}/native-${name}.png` });
  await ctx.close();
}
await b.close();
