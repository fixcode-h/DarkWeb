// 生成 Chrome 应用商店的上架素材到 docs/store/assets/：
//   screenshot-1.png / screenshot-2.png  1280x800 截图（中性演示页，前后对比 + 全暗色）
//   promo-small.png                      440x280 小宣传图
//   icon-128.png                         128x128 商店图标（复制构建出的 dist/icons/icon-128.png）
// 用法：npm run store:assets（会先构建 dist/）
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const out = join(root, 'docs/store/assets');
mkdirSync(out, { recursive: true });
copyFileSync(join(root, 'dist/icons/icon-128.png'), join(out, 'icon-128.png'));
console.log('wrote docs/store/assets/icon-128.png');

const DEMO = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>演示页</title><style>
*{box-sizing:border-box}body{margin:0;font:15px/1.7 -apple-system,"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif;background:#f4f5f7;color:#1f2329}
header{height:56px;background:#fff;border-bottom:1px solid #e3e5e8;display:flex;align-items:center;padding:0 32px;gap:28px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.logo{font-weight:700;font-size:19px;color:#2563eb}nav{display:flex;align-items:center;gap:22px;color:#59636e}nav b{color:#1f2329;border-bottom:2px solid #2563eb;padding:16px 0}
.search{margin-left:auto;width:260px;height:34px;border:1px solid #d5d9de;border-radius:17px;background:#f4f5f7;padding:0 14px;line-height:32px;color:#8b949e}
.btn{background:#2563eb;color:#fff;border-radius:6px;padding:6px 16px}
main{display:grid;grid-template-columns:1fr 300px;gap:16px;max-width:1120px;margin:20px auto;padding:0 16px}
.card{background:#fff;border:1px solid #e3e5e8;border-radius:8px;padding:20px 24px;margin-bottom:14px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
h2{margin:0 0 6px;font-size:18px}.meta{color:#8b949e;font-size:13px;margin-bottom:8px}p{margin:0 0 10px;color:#3b4350}
.tags span{display:inline-block;background:#eaf1ff;color:#2563eb;border-radius:4px;padding:1px 9px;font-size:12px;margin-right:6px}
.tags .g{background:#e7f6ec;color:#16803c}.tags .o{background:#fff3e0;color:#b45309}
.acts{display:flex;gap:18px;color:#59636e;font-size:13px;border-top:1px solid #eef0f2;padding-top:10px;margin-top:12px}
.vote{background:#eaf1ff;color:#2563eb;border-radius:4px;padding:2px 12px}
pre{background:#f6f8fa;border:1px solid #e3e5e8;border-radius:6px;padding:12px 14px;font:13px/1.6 ui-monospace,Menlo,Consolas,monospace;color:#24292f;margin:0 0 10px}
pre i{color:#cf222e;font-style:normal}pre u{color:#0a3069;text-decoration:none}
aside h3{margin:0 0 10px;font-size:15px}aside li{margin:6px 0;color:#3b4350}aside ol{margin:0;padding-left:20px}
.bar{height:8px;border-radius:4px;background:#eef0f2;margin:8px 0 14px;overflow:hidden}.bar i{display:block;height:100%;background:#2563eb}
.note{background:#fffbe6;border:1px solid #f5e1a4;color:#7a5b00;border-radius:6px;padding:10px 14px}
</style></head><body>
<header><span class="logo">示例社区</span><nav><b>首页</b><span>发现</span><span>专栏</span><span>问答</span></nav><span class="search">搜索你感兴趣的内容</span><span class="btn">提问</span></header>
<main><div>
<div class="card"><h2>为什么简单反色的暗色模式看起来很别扭？</h2><div class="meta">设计与体验 · 1,204 人赞同 · 3 小时前</div>
<p>整页反色会把边框、阴影和层次一起抹平，品牌色也会偏掉。更好的做法是先判断每个颜色在页面里的角色（背景、文字、边框、强调色），再分别映射到暗色调色板。</p>
<div class="tags"><span>暗色模式</span><span class="g">可读性</span><span class="o">配色</span></div>
<div class="acts"><span class="vote">▲ 赞同 1204</span><span>评论 86</span><span>收藏</span><span>分享</span></div></div>
<div class="card"><h2>OKLCH 色彩空间里怎么保持对比度</h2><div class="meta">前端 · 532 人赞同 · 昨天</div>
<p>在感知均匀的色彩空间里调整亮度，色相和饱和度不会跑偏：</p>
<pre><i>const</i> dark = <u>remap</u>(color, { role: <u>'background'</u>, lightness: 0.22 });
<i>const</i> text = <u>remap</u>(color, { role: <u>'text'</u>, minContrast: 4.5 });</pre>
<div class="note">提示：链接色和按钮色会保留色相，只调亮度，品牌色依然认得出来。</div>
<div class="acts"><span class="vote">▲ 赞同 532</span><span>评论 41</span><span>收藏</span><span>分享</span></div></div>
<div class="card"><h2>夜间阅读两小时，眼睛还舒服吗？</h2><div class="meta">生活 · 318 人赞同 · 2 天前</div>
<p>背景不要纯黑，文字不要纯白。稍微抬高背景亮度、压低文字亮度，长时间阅读会轻松很多。</p></div>
</div><aside>
<div class="card"><h3>本周热门</h3><ol><li>暗色模式的十个误区</li><li>边框和阴影为什么重要</li><li>图片要不要降亮度</li><li>跟随系统还是手动切换</li></ol></div>
<div class="card"><h3>阅读进度</h3><span class="meta">本月已读 18 / 30 篇</span><div class="bar"><i style="width:60%"></i></div><span class="meta">连续打卡 12 天</span><div class="bar"><i style="width:40%;background:#16a34a"></i></div></div>
</aside></main></body></html>`;

const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(DEMO);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;
const userData = mkdtempSync(join(tmpdir(), 'drak-assets-'));
const ctx = await chromium.launchPersistentContext(userData, {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});
try {
  const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
  const setEnabled = async (enabled) => {
    await sw.evaluate(async (v) => {
      const cur = (await chrome.storage.local.get('settings')).settings || {};
      await chrome.storage.local.set({ settings: { ...cur, enabled: v } });
    }, enabled);
    for (let i = 0; i < 50; i++) {
      const n = await sw.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).length);
      if (n === (enabled ? 2 : 0)) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('内容脚本注册状态没有按预期变化');
  };
  const shot = async () => {
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    const buf = await page.screenshot();
    await page.close();
    return `data:image/png;base64,${buf.toString('base64')}`;
  };

  await setEnabled(false);
  const light = await shot();
  await setEnabled(true);
  const dark = await shot();

  const icon = `data:image/png;base64,${readFileSync(join(dist, 'icons/icon-128.png')).toString('base64')}`;
  const font = `font-family:-apple-system,'PingFang SC','Microsoft YaHei','Noto Sans CJK SC',sans-serif`;
  const label = `position:absolute;bottom:24px;padding:6px 16px;border-radius:16px;font-size:15px;${font}`;
  const render = async (html, w, h, file) => {
    const page = await ctx.newPage();
    await page.setViewportSize({ width: w, height: h });
    // 合成页用 about:blank，扩展不会注入
    await page.setContent(`<body style="margin:0;width:${w}px;height:${h}px;overflow:hidden;position:relative">${html}</body>`);
    await page.screenshot({ path: join(out, file) });
    await page.close();
    console.log(`wrote docs/store/assets/${file}`);
  };

  await render(
    `<img src="${light}" style="position:absolute;inset:0"><div style="position:absolute;inset:0 0 0 50%;overflow:hidden"><img src="${dark}" style="position:absolute;top:0;right:0"></div>
     <div style="position:absolute;top:0;bottom:0;left:50%;width:2px;margin-left:-1px;background:#f2c94c"></div>
     <span style="${label};left:24px;background:#1d2330;color:#fff">原网页</span>
     <span style="${label};right:24px;background:#f2c94c;color:#1d2330">开启 Drak 后</span>`,
    1280, 800, 'screenshot-1.png');
  await render(`<img src="${dark}">`, 1280, 800, 'screenshot-2.png');
  await render(
    `<div style="position:absolute;inset:0;background:#1d2330;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;${font}">
       <img src="${icon}" width="96" height="96">
       <div style="color:#fff;font-size:34px;font-weight:700">Drak 暗色模式</div>
       <div style="color:#aeb6c4;font-size:17px">按颜色角色重新配色，不做简单反色</div>
     </div>`,
    440, 280, 'promo-small.png');
} finally {
  await ctx.close();
  server.close();
  rmSync(userData, { recursive: true, force: true });
}
