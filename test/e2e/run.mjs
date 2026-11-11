// 端到端验收：加载 dist/ 扩展，在本地仿真的知乎 / B 站页面上逐项检查（设计文档第 11 节）
import { chromium } from 'playwright';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dist = join(root, 'dist');
const outDir = join(root, 'test-results');
mkdirSync(outDir, { recursive: true });

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`);
}

// 页面内工具：解析颜色、算对比度、找有效背景（跨 Shadow 边界）
const HELPERS = () => {
  const parse = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lin = (v) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const contrast = (a, b) => {
    const x = lum(a), y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const bgOf = (el) => {
    let cur = el;
    while (cur) {
      const c = parse(getComputedStyle(cur).backgroundColor);
      if (c && c.a > 0.5) return c;
      if (cur.parentElement) cur = cur.parentElement;
      else {
        const r = cur.getRootNode();
        cur = r instanceof ShadowRoot ? r.host : null;
      }
    }
    return parse(getComputedStyle(document.documentElement).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
  };
  window.__t = {
    parse, lum, contrast, bgOf,
    info(el) {
      const cs = getComputedStyle(el);
      const fg = parse(cs.color);
      const bg = bgOf(el);
      return { fg, bg, bgLum: lum(bg), fgLum: lum(fg), contrast: contrast(fg, bg), filter: cs.filter, raw: cs.backgroundColor };
    },
    borderContrast(el, side = 'bottom') {
      const cs = getComputedStyle(el);
      const c = parse(cs[`border${side[0].toUpperCase()}${side.slice(1)}Color`]);
      const bg = bgOf(el.parentElement || el);
      // 半透明边框按背景合成
      const mix = { r: c.r * c.a + bg.r * (1 - c.a), g: c.g * c.a + bg.g * (1 - c.a), b: c.b * c.a + bg.b * (1 - c.a), a: 1 };
      return contrast(mix, bg);
    },
  };
};

async function main() {
  const { server, port } = await startServer();
  const userData = mkdtempSync(join(tmpdir(), 'drak-e2e-'));
  const ctx = await chromium.launchPersistentContext(userData, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 900 },
    args: [
      `--disable-extensions-except=${dist}`,
      `--load-extension=${dist}`,
      '--host-resolver-rules=MAP *.zhihu.com 127.0.0.1, MAP *.zhimg.com 127.0.0.1, MAP *.bilibili.com 127.0.0.1, MAP *.hdslb.com 127.0.0.1',
    ],
  });
  try {
    await ctx.addInitScript(HELPERS);
    let sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
    for (let i = 0; i < 50; i++) {
      const n = await sw.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).length);
      if (n === 2) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const setSettings = (patch) =>
      sw.evaluate(async (p) => {
        const cur = (await chrome.storage.local.get('settings')).settings || {};
        await chrome.storage.local.set({ settings: { ...cur, ...p } });
      }, patch);
    const diag = (page) =>
      sw.evaluate(async (url) => {
        const tabs = await chrome.tabs.query({});
        const t = tabs.find((x) => x.url === url);
        return chrome.tabs.sendMessage(t.id, { type: 'diag' }, { frameId: 0 });
      }, page.url());

    const consoleErrors = [];
    const open = async (url, wait = 1500) => {
      const page = await ctx.newPage();
      page.on('pageerror', (e) => consoleErrors.push(`${url}: ${e.message}`));
      page.on('console', (m) => {
        if (m.type() === 'error') consoleErrors.push(`${url}: ${m.text()}`);
      });
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForTimeout(wait);
      return page;
    };
    const Z = `http://www.zhihu.com:${port}/`;
    const B = `http://www.bilibili.com:${port}/`;

    // ---------- 知乎（原生暗色不可用 -> 自动退回动态模式） ----------
    {
      const page = await open(Z, 2000);
      await page.screenshot({ path: join(outDir, 'zhihu.png'), fullPage: true });
      const d = await diag(page);
      writeFileSync(join(outDir, 'zhihu-diag.json'), JSON.stringify(d, null, 2));
      check('知乎：首次访问写入原生暗色 cookie，本次先用动态模式', d.mode === 'dynamic' && d.reason === 'native-pending', `${d.mode}/${d.reason}`);
      const cookie = await page.evaluate(() => document.cookie);
      check('知乎：已写入 themeApp=dark', /(^|; )themeApp=dark/.test(cookie), cookie);
      {
        // 第二次访问：cookie 已在，走原生；仿真页没有暗色主题 -> 自动退回动态模式
        const p2 = await open(Z + '?visit=native', 2000);
        const d2 = await diag(p2);
        const lum2 = await p2.evaluate(() => window.__t.info(document.body).bgLum);
        check('知乎：原生暗色不可用时自动退回动态模式', d2.mode === 'dynamic' && d2.reason === 'native-failed' && lum2 < 0.03, `${d2.mode}/${d2.reason}/${lum2.toFixed(4)}`);
        await p2.close();
      }
      const r = await page.evaluate(() => {
        const t = window.__t;
        const q = (s) => document.querySelector(s);
        const card = t.info(q('#card1'));
        const body = t.info(document.body);
        return {
          body: body.bgLum,
          cardBg: card.bg,
          pageBg: body.bg,
          title: t.info(q('#title1')).contrast,
          meta: t.info(q('#meta1')).contrast,
          link: t.info(q('#link1')).contrast,
          para: t.info(q('#para1')).contrast,
          quote: t.info(q('#quote')).contrast,
          code: t.info(q('#code')).contrast,
          header: t.info(q('.AppHeader')).bgLum,
          headerBorder: t.borderContrast(q('.AppHeader')),
          quoteBorder: t.borderContrast(q('#quote'), 'left'),
          tableBorder: t.borderContrast(q('#table td')),
          codeBorder: t.borderContrast(q('#code')),
          formula: getComputedStyle(q('#formula')).filter,
          glyph: q('#glyph').getAttribute('data-drak-img'),
          photo: q('#photo').getAttribute('data-drak-img'),
          shot: q('#shot').getAttribute('data-drak-img'),
          inline: t.info(q('#card2')),
          sc: t.info(q('#sc')),
          dyn: Array.from(document.querySelectorAll('.dyn')).map((e) => t.info(e).bgLum),
          video: getComputedStyle(q('#videoText')).backgroundColor,
          videoColor: getComputedStyle(q('#videoText')).color,
          backdrop: t.lum(t.parse(getComputedStyle(q('#backdrop')).backgroundColor)),
          btn: t.parse(getComputedStyle(q('#ask')).backgroundColor),
          btnText: t.info(q('#ask')).contrast,
        };
      });
      check('知乎：页面背景为深色', r.body < 0.03, r.body.toFixed(4));
      check('知乎：卡片与页面底色仍可区分', Math.abs(r.cardBg.r - r.pageBg.r) >= 4, `card ${r.cardBg.r} / page ${r.pageBg.r}`);
      for (const k of ['title', 'meta', 'link', 'para', 'quote', 'code']) check(`知乎：文字对比度 ${k} ≥ 4.5`, r[k] >= 4.5, r[k].toFixed(2));
      check('知乎：跨域样式表（顶栏）已转换', r.header < 0.03, r.header.toFixed(4));
      for (const k of ['headerBorder', 'quoteBorder', 'tableBorder', 'codeBorder']) check(`知乎：边框可见 ${k} ≥ 1.5`, r[k] >= 1.5, r[k].toFixed(2));
      check('知乎：公式图被反转（站点规则）', /invert/.test(r.formula), r.formula);
      check('知乎：透明底深色图标自动反转', r.glyph === 'invert', String(r.glyph));
      check('知乎：照片不动', r.photo === null, String(r.photo));
      check('知乎：白底截图降亮度', r.shot === 'dim', String(r.shot));
      check('知乎：内联样式卡片已转换', r.inline.bgLum < 0.03 && r.inline.contrast >= 4.5, `${r.inline.raw} / ${r.inline.contrast.toFixed(2)}`);
      check('知乎：CSS-in-JS insertRule 规则已转换', r.sc.bgLum < 0.03 && r.sc.contrast >= 4.5, r.sc.raw);
      check('知乎：动态加载的卡片已转换', r.dyn.length >= 5 && r.dyn.every((l) => l < 0.03), r.dyn.map((l) => l.toFixed(3)).join(','));
      check('知乎：ignore 区域（视频播放器）保持原样', r.video === 'rgb(255, 255, 255)' && r.videoColor === 'rgb(0, 0, 0)', `${r.video} / ${r.videoColor}`);
      check('知乎：半透明遮罩仍为深色', r.backdrop < 0.05, r.backdrop.toFixed(4));
      check('知乎：品牌蓝按钮保留色相、白字可读', r.btn.b > r.btn.r + 60 && r.btnText >= 3, `rgb(${r.btn.r},${r.btn.g},${r.btn.b}) / ${r.btnText.toFixed(2)}`);
      check('知乎：插件无内部异常', d.errors === 0, String(d.errors));
      check('知乎：首次应用主线程耗时 ≤ 80ms', d.timings.startupMainThread <= 80, `${d.timings.startupMainThread}ms`);
      check('知乎：自检亮区占比 ≤ 3%', d.brightRatio !== null && d.brightRatio <= 0.03, String(d.brightRatio));

      // 关闭本站 -> 完全还原
      await setSettings({ siteModes: { [`zhihu.com:${port}`]: 'off' } });
      await page.waitForTimeout(400);
      const off = await page.evaluate(() => {
        const c = document.querySelector('#card2');
        return {
          attr: document.documentElement.hasAttribute('data-drak-off'),
          body: getComputedStyle(document.body).backgroundColor,
          card: [c.style.backgroundColor, c.style.color, c.style.borderColor],
          adopted: document.adoptedStyleSheets.length,
          img: document.querySelectorAll('[data-drak-img]').length,
        };
      });
      check('知乎：关闭后页面还原（背景、注入样式表、图片标记）', off.attr && off.body === 'rgb(246, 246, 246)' && off.adopted === 0 && off.img === 0, JSON.stringify(off));
      check('知乎：关闭后内联样式还原为原值', off.card.join('|') === 'rgb(255, 255, 255)|rgb(51, 51, 51)|rgb(235, 235, 235)', off.card.join('|'));
      await setSettings({ siteModes: {} });
      await page.waitForTimeout(600);
      const on = await page.evaluate(() => window.__t.info(document.body).bgLum);
      check('知乎：重新开启后恢复暗色（无需刷新）', on < 0.03, on.toFixed(4));

      // 亮度调节即时生效
      await setSettings({ brightness: 90 });
      await page.waitForTimeout(600);
      const bright = await page.evaluate(() => window.__t.info(document.querySelector('#card1')).bg.r);
      await setSettings({ brightness: 50 });
      check('知乎：亮度滑杆即时生效', bright > r.cardBg.r, `${r.cardBg.r} -> ${bright}`);
      await page.waitForTimeout(500);

      // 配色主题
      const bgOfCard = () => page.evaluate(() => window.__t.info(document.querySelector('#card1')));
      await setSettings({ theme: 'warm' });
      await page.waitForTimeout(600);
      const warm = await bgOfCard();
      check('主题：暖色主题底色偏暖、文字仍可读', warm.bg.r > warm.bg.b + 4 && warm.contrast >= 4.5, `rgb(${warm.bg.r},${warm.bg.g},${warm.bg.b}) / ${warm.contrast.toFixed(2)}`);
      await setSettings({ theme: 'black' });
      await page.waitForTimeout(600);
      const black = await page.evaluate(() => ({ card: window.__t.info(document.querySelector('#card1')), border: window.__t.borderContrast(document.querySelector('.AppHeader')) }));
      check('主题：纯黑主题卡片为纯黑、分割线仍可见', black.card.bg.r <= 1 && black.card.contrast >= 4.5 && black.border >= 1.5, `rgb(${black.card.bg.r},${black.card.bg.g},${black.card.bg.b}) / 边框 ${black.border.toFixed(2)}`);
      await setSettings({ theme: 'default', saturation: 0 });
      await page.waitForTimeout(600);
      const grayBtn = await page.evaluate(() => window.__t.parse(getComputedStyle(document.querySelector('#ask')).backgroundColor));
      check('饱和度：调到 0 后品牌色变灰', Math.max(grayBtn.r, grayBtn.g, grayBtn.b) - Math.min(grayBtn.r, grayBtn.g, grayBtn.b) <= 3, `rgb(${grayBtn.r},${grayBtn.g},${grayBtn.b})`);
      await setSettings({ saturation: 50, imageBrightness: 60 });
      await page.waitForTimeout(600);
      const imgs = await page.evaluate(() => ({ photo: getComputedStyle(document.querySelector('#photo')).filter, shot: getComputedStyle(document.querySelector('#shot')).filter }));
      check('图片亮度：照片整体压暗，白底图叠加压暗', imgs.photo === 'brightness(0.6)' && /brightness\(0\.48\)/.test(imgs.shot), `${imgs.photo} / ${imgs.shot}`);
      await setSettings({ imageBrightness: 100 });
      await page.waitForTimeout(600);

      // 和本站无关的设置变化不应触发整页重算
      const mark = () => page.evaluate(() => (window.__sheet = document.adoptedStyleSheets.at(-1), document.adoptedStyleSheets.length));
      const n1 = await mark();
      await setSettings({ siteModes: { 'example.org': 'off' }, userRules: '[{"match":["example.org"],"mode":"filter"}]' });
      await page.waitForTimeout(500);
      const same = await page.evaluate(() => window.__sheet === document.adoptedStyleSheets.at(-1));
      check('性能：其他网站的设置变化不重算本页', n1 > 0 && same, `sheets ${n1}`);
      await setSettings({ siteModes: {}, userRules: '[]' });

      // 定时启用：时段外自动关闭，回到时段内恢复
      const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      const now = Date.now();
      await setSettings({ scheduleEnabled: true, scheduleStart: hhmm(new Date(now + 2 * 3600e3)), scheduleEnd: hhmm(new Date(now + 4 * 3600e3)) });
      await page.waitForTimeout(600);
      const dOff = await diag(page);
      const offBody = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      const regOff = await sw.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).length);
      check('定时：时段外页面还原且不再注册内容脚本', dOff.mode === 'off' && dOff.reason === 'scheduled-off' && offBody === 'rgb(246, 246, 246)' && regOff === 0, `${dOff.mode}/${dOff.reason}/${offBody}/注册 ${regOff}`);
      await setSettings({ scheduleStart: hhmm(new Date(now - 2 * 3600e3)), scheduleEnd: hhmm(new Date(now + 2 * 3600e3)) });
      await page.waitForTimeout(600);
      const dOn = await diag(page);
      const regOn = await sw.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).length);
      check('定时：时段内恢复暗色并重新注册', dOn.mode === 'dynamic' && regOn === 2, `${dOn.mode}/注册 ${regOn}`);
      await setSettings({ scheduleEnabled: false });
      await page.waitForTimeout(400);
      await page.close();
    }

    // ---------- 知乎（原生暗色可用） ----------
    {
      // 换一个路径：原生暗色的确认结果按路径第一段记录，不影响上面 / 的测试
      const page = await open(Z + 'explore?native=1', 1000);
      const d = await diag(page);
      const r = await page.evaluate(() => ({ theme: document.documentElement.getAttribute('data-theme'), body: window.__t.info(document.body).bgLum }));
      check('知乎：原生暗色可用时使用原生主题', d.mode === 'native' && r.theme === 'dark' && r.body < 0.03, `${d.mode} / ${r.theme} / ${r.body.toFixed(4)}`);
      await page.close();
      // 再次访问：已确认可用，不再并行跑动态模式
      const again = await open(Z + 'explore?native=1&visit=2', 1000);
      const d2 = await diag(again);
      const body2 = await again.evaluate(() => window.__t.info(document.body).bgLum);
      check('知乎：确认过原生暗色后直接走原生，不跑动态模式', d2.mode === 'native' && d2.sheets === 0 && d2.timings.startupMainThread <= 5 && body2 < 0.03, `${d2.mode} / sheets ${d2.sheets} / ${d2.timings.startupMainThread}ms / ${body2.toFixed(4)}`);
      await again.close();
    }

    // ---------- 知乎：页面按暗色 cookie 渲染后关闭本站 -> 还原 cookie 并自动刷新成浅色 ----------
    {
      const page = await open(Z + 'explore?native=1&visit=off', 1000);
      const before = await page.evaluate(() => document.cookie);
      await page.evaluate(() => (window.__beforeReload = 1));
      await setSettings({ siteModes: { [`zhihu.com:${port}`]: 'off' } });
      await page.waitForTimeout(1500);
      const after = await page.evaluate(() => ({ marker: window.__beforeReload ?? null, cookie: document.cookie, theme: document.documentElement.getAttribute('data-theme') }));
      check(
        '知乎：按暗色 cookie 渲染的页面关闭本站后还原 cookie 并刷新',
        /(^|; )themeApp=dark/.test(before) && after.marker === null && !/(^|; )themeApp=dark/.test(after.cookie) && after.theme !== 'dark',
        `${before} -> ${JSON.stringify(after)}`,
      );
      const lum = await page.evaluate(() => window.__t.info(document.body).bgLum);
      check('知乎：关闭本站并刷新后页面是浅色', lum > 0.8, lum.toFixed(4));
      await setSettings({ siteModes: {} });
      await page.waitForTimeout(400);
      await page.close();
    }

    // ---------- 滤镜模式跟随滑块 ----------
    {
      await setSettings({ siteModes: { [`zhihu.com:${port}`]: 'filter' } });
      const page = await open(Z + 'explore?visit=filter', 800);
      const f1 = await page.evaluate(() => getComputedStyle(document.documentElement).filter);
      await setSettings({ brightness: 90, contrast: 80 });
      await page.waitForTimeout(500);
      const f2 = await page.evaluate(() => getComputedStyle(document.documentElement).filter);
      check('滤镜模式：亮度、对比度滑杆生效', /invert\(1\)/.test(f1) && /invert\(0\.88\)/.test(f2) && /contrast\(1\.18\)/.test(f2), `${f1} -> ${f2}`);
      await setSettings({ siteModes: {}, brightness: 50, contrast: 50 });
      await page.waitForTimeout(400);
      await page.close();
    }

    // ---------- 哔哩哔哩 ----------
    {
      const page = await open(B, 1500);
      await page.screenshot({ path: join(outDir, 'bilibili.png'), fullPage: true });
      const d = await diag(page);
      writeFileSync(join(outDir, 'bilibili-diag.json'), JSON.stringify(d, null, 2));
      const r = await page.evaluate(() => {
        const t = window.__t;
        const q = (s) => document.querySelector(s);
        const open = q('#comments').shadowRoot;
        const closed = window.__closedRoot;
        const lazy = q('#lazy').shadowRoot;
        return {
          body: t.info(document.body).bgLum,
          header: t.info(q('#header')).bgLum,
          headerBorder: t.borderContrast(q('#header')),
          title: t.info(q('#vtitle')).contrast,
          owner: t.info(q('#owner')).contrast,
          upload: t.parse(getComputedStyle(q('#upload')).backgroundColor),
          uploadText: t.info(q('#upload')).contrast,
          logo: t.parse(getComputedStyle(q('#logo')).color),
          sending: t.info(q('#sending')).bgLum,
          dm: getComputedStyle(q('#dm')).color,
          cover: [q('#cover1').getAttribute('data-drak-img'), getComputedStyle(q('#cover1')).filter],
          qr: q('#qr').getAttribute('data-drak-img'),
          host: t.info(q('#comments')).bgLum,
          ctitle: t.info(open.getElementById('ctitle')),
          reply: t.info(closed.getElementById('reply')),
          replyBorder: t.borderContrast(closed.getElementById('reply')),
          name: t.parse(getComputedStyle(closed.getElementById('name')).color),
          lazy: lazy ? t.info(lazy.getElementById('lazyInner')) : null,
        };
      });
      check('B站：动态模式', d.mode === 'dynamic', d.mode);
      check('B站：页面与顶栏为深色', r.body < 0.03 && r.header < 0.03, `${r.body.toFixed(4)} / ${r.header.toFixed(4)}`);
      check('B站：顶栏分割线可见', r.headerBorder >= 1.5, r.headerBorder.toFixed(2));
      check('B站：标题与次要文字对比度 ≥ 4.5', r.title >= 4.5 && r.owner >= 4.5, `${r.title.toFixed(2)} / ${r.owner.toFixed(2)}`);
      check('B站：粉色投稿按钮保留色相、白字可读', r.upload.r > r.upload.g + 60 && r.upload.r > r.upload.b && r.uploadText >= 3, `rgb(${r.upload.r},${r.upload.g},${r.upload.b}) / ${r.uploadText.toFixed(2)}`);
      check('B站：品牌蓝 logo 保留色相', r.logo.b > r.logo.r + 60, `rgb(${r.logo.r},${r.logo.g},${r.logo.b})`);
      check('B站：播放器画面区弹幕保持原样，发送栏跟随暗色', r.sending < 0.03 && r.dm === 'rgb(255, 255, 255)', `${r.sending.toFixed(4)} / ${r.dm}`);
      check('B站：视频封面不动', r.cover[0] === null && r.cover[1] === 'none', r.cover.join(' '));
      check('B站：登录二维码不动', r.qr === null, String(r.qr));
      check('B站：评论区（open Shadow DOM）已转换', r.host < 0.03 && r.ctitle.contrast >= 4.5, `${r.host.toFixed(4)} / ${r.ctitle.contrast.toFixed(2)}`);
      check('B站：嵌套 closed Shadow DOM 已转换', r.reply.bgLum < 0.03 && r.reply.contrast >= 4.5, `${r.reply.raw} / ${r.reply.contrast.toFixed(2)}`);
      check('B站：closed Shadow DOM 里的边框可见', r.replyBorder >= 1.5, r.replyBorder.toFixed(2));
      check('B站：评论用户名保留粉色', r.name.r > r.name.g + 40, `rgb(${r.name.r},${r.name.g},${r.name.b})`);
      check('B站：延迟升级的自定义组件已转换', r.lazy && r.lazy.bgLum < 0.03 && r.lazy.contrast >= 4.5, r.lazy ? `${r.lazy.raw} / ${r.lazy.contrast.toFixed(2)}` : 'no root');
      check('B站：插件无内部异常', d.errors === 0, String(d.errors));
      check('B站：首次应用主线程耗时 ≤ 80ms', d.timings.startupMainThread <= 80, `${d.timings.startupMainThread}ms`);
      await page.close();
    }

    // ---------- 通用页面 ----------
    {
      const page = await open(`http://127.0.0.1:${port}/plain`, 800);
      const r = await page.evaluate(() => ({ body: window.__t.info(document.body).bgLum, border: window.__t.borderContrast(document.querySelector('#p')) }));
      check('通用页面：深色且分割线可见', r.body < 0.03 && r.border >= 1.5, `${r.body.toFixed(4)} / ${r.border.toFixed(2)}`);
      await page.close();
      const modern = await open(`http://127.0.0.1:${port}/modern`, 1500);
      for (const [id, name] of [['tw', 'Tailwind v3 透明度变量'], ['ok', 'oklch()'], ['sh', 'shadcn 通道变量'], ['sha', 'shadcn 通道变量 + 透明度'], ['ge', 'Geist 通道变量'], ['twc', 'Tailwind 通道变量'], ['gd', '防盗链 CDN 的样式表']]) {
        const m = await modern.evaluate((i) => window.__t.info(document.getElementById(i)), id);
        check(`新式写法：${name}已转换`, m.bgLum < 0.03 && m.contrast >= 4.5, `${m.raw} / ${m.contrast.toFixed(2)}`);
      }
      await modern.close();
      const dark = await open(`http://127.0.0.1:${port}/darksite`, 800);
      const d = await diag(dark);
      check('本来就是深色的网站自动跳过', d.mode === 'off' && d.reason === 'page-already-dark', `${d.mode}/${d.reason}`);
      await dark.close();
    }

    // ---------- 网站自带暗色：不叠加 ----------
    {
      const state = async (page) => {
        const d = await diag(page);
        return `${d.mode}/${d.reason}`;
      };
      for (const [path, name] of [['darkwrap', 'body 透明、包裹层深色'], ['darkscheme', '只声明 color-scheme: dark'], ['darkgray', '深灰主题']]) {
        const page = await open(`http://127.0.0.1:${port}/${path}`, 800);
        const st = await state(page);
        const r = await page.evaluate(() => ({ adopted: document.adoptedStyleSheets.length, scheme: getComputedStyle(document.documentElement).colorScheme, bg: getComputedStyle(document.querySelector('#app') || document.body).backgroundColor }));
        check(`自带暗色（${name}）：自动跳过，不叠加`, st === 'off/page-already-dark' && r.adopted === 0, `${st} / ${JSON.stringify(r)}`);
        await page.close();
      }
      {
        const page = await open(`http://127.0.0.1:${port}/hero`, 1800);
        const st = await state(page);
        const below = await page.evaluate(() => window.__t.info(document.querySelector('#content')).bgLum);
        check('浅色网站的深色头图：仍按浅色网站处理', st.startsWith('dynamic/') && below < 0.03, `${st} / ${below.toFixed(4)}`);
        await page.close();
      }
      {
        // 加载后 200ms 网站自己切到暗色
        const page = await open(`http://127.0.0.1:${port}/darklate`, 2500);
        const st = await state(page);
        const r = await page.evaluate(() => ({ adopted: document.adoptedStyleSheets.length, card: getComputedStyle(document.querySelector('#card')).backgroundColor, body: getComputedStyle(document.body).backgroundColor }));
        check('自带暗色（加载后才由脚本开启）：识别后让位，颜色是网站自己的', st === 'off/page-already-dark' && r.adopted === 0 && r.card === 'rgb(30, 30, 30)' && r.body === 'rgb(18, 18, 18)', `${st} / ${JSON.stringify(r)}`);
        // 用户在网站里切回浅色 -> 插件重新接管
        await page.evaluate(() => window.toggleTheme());
        await page.waitForTimeout(2500);
        const st2 = await state(page);
        const lum2 = await page.evaluate(() => window.__t.info(document.querySelector('#card')).bgLum);
        check('网站切回浅色后插件重新接管', st2.startsWith('dynamic/') && lum2 < 0.03, `${st2} / ${lum2.toFixed(4)}`);
        // 再切到暗色 -> 再次让位
        await page.evaluate(() => window.toggleTheme());
        await page.waitForTimeout(2500);
        const st3 = await state(page);
        const card3 = await page.evaluate(() => getComputedStyle(document.querySelector('#card')).backgroundColor);
        check('网站再次切到暗色后插件再次让位', st3 === 'off/page-already-dark' && card3 === 'rgb(30, 30, 30)', `${st3} / ${card3}`);
        await page.close();
      }
    }

    // ---------- 按 IP:端口 关闭站点 ----------
    {
      const other = await startServer();
      try {
        await setSettings({ siteModes: { [`127.0.0.1:${port}`]: 'off' } });
        await new Promise((r) => setTimeout(r, 500)); // 等内容脚本重新注册
        const lumOf = async (url) => {
          const page = await open(url, 600);
          const r = await page.evaluate(() => ({ lum: window.__t.info(document.body).bgLum, scheme: getComputedStyle(document.documentElement).colorScheme, off: document.documentElement.hasAttribute('data-drak-off') }));
          await page.close();
          return r;
        };
        const a = await lumOf(`http://127.0.0.1:${port}/plain`);
        const a2 = await lumOf(`http://127.0.0.1:${port}/plain?other=page#x`);
        const b = await lumOf(`http://127.0.0.1:${other.port}/plain`);
        check('关闭 IP:端口：该站点所有页面都不处理（脚本不注入）', a.lum > 0.9 && a2.lum > 0.9 && a.scheme === 'normal' && !a.off, JSON.stringify([a, a2]));
        check('关闭 IP:端口：同一 IP 的其他端口不受影响', b.lum < 0.03, JSON.stringify(b));
        // 旧数据：整条网址 / 带 www. 的键，读取时归一成站点键
        await setSettings({ siteModes: { [`http://127.0.0.1:${other.port}/some/page?x=1`]: 'off' } });
        await new Promise((r) => setTimeout(r, 500));
        const c = await lumOf(`http://127.0.0.1:${other.port}/plain`);
        const d = await lumOf(`http://127.0.0.1:${port}/plain`);
        check('旧的整条网址记录按站点生效', c.lum > 0.9 && d.lum < 0.03, JSON.stringify([c, d]));
        await setSettings({ siteModes: {} });
        await new Promise((r) => setTimeout(r, 500));
      } finally {
        other.server.close();
      }
    }

    // ---------- 防闪白：慢样式表 + 首次/重复访问，逐帧检查 ----------
    {
      const page = await ctx.newPage();
      await page.goto(`http://127.0.0.1:${port}/plain`);
      await page.waitForTimeout(300);
      const analyze = await ctx.newPage();
      const measure = async (url, wait = 800) => {
        const cdp = await ctx.newCDPSession(page);
        const frames = [];
        cdp.on('Page.screencastFrame', async (f) => {
          frames.push(f.data);
          await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
        });
        await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 60, everyNthFrame: 1 });
        await page.goto(url, { waitUntil: 'load' });
        await page.waitForTimeout(wait);
        await cdp.send('Page.stopScreencast');
        await cdp.detach();
        if (process.env.DRAK_DEBUG) frames.forEach((f, i) => writeFileSync(join(outDir, `frame-${url.slice(-1)}-${i}.jpg`), Buffer.from(f, 'base64')));
        return analyze.evaluate(async (list) => {
          const out = [];
          for (const b64 of list) {
            const img = new Image();
            img.src = 'data:image/jpeg;base64,' + b64;
            await img.decode();
            const c = document.createElement('canvas');
            c.width = 64;
            c.height = 40;
            const g = c.getContext('2d');
            g.drawImage(img, 0, 0, 64, 40);
            const d = g.getImageData(0, 0, 64, 40).data;
            let s = 0;
            for (let i = 0; i < d.length; i += 4) s += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
            out.push(s / (d.length / 4));
          }
          return out;
        }, frames);
      };
      const first = await measure(`${Z}?cssdelay=700&visit=1`);
      check('防闪白：首次访问（样式表延迟 700ms）无整屏亮帧', first.length > 0 && first.every((v) => v < 0.5), first.map((v) => v.toFixed(2)).join(','));
      await page.waitForTimeout(2500); // 等缓存写入
      const again = await measure(`${Z}?cssdelay=700&visit=2`);
      check('防闪白：重复访问无整屏亮帧', again.length > 0 && again.every((v) => v < 0.5), `${again.length} 帧，最亮 ${Math.max(...again).toFixed(3)}`);
      // 加载完成后会撤掉样式复查“网站是否自带暗色”，带过渡动画的页面不能因此闪一下
      const tr = await measure(`http://127.0.0.1:${port}/transition`, 5000);
      check('防闪白：复查网站自带暗色时无亮帧（页面带过渡动画）', tr.length > 0 && tr.every((v) => v < 0.5), `${tr.length} 帧，最亮 ${Math.max(...tr).toFixed(3)}`);
      await page.close();
      await analyze.close();
    }

    check('全部页面控制台无报错', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | '));
  } finally {
    await ctx.close();
    server.close();
    rmSync(userData, { recursive: true, force: true });
  }
  const failed = results.filter((r) => !r.ok);
  writeFileSync(join(outDir, 'e2e-results.json'), JSON.stringify(results, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
