// 本地仿真服务器：按 Host 头区分“知乎/B 站”的主站、静态资源、图片域名
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function crc32(buf) {
  let crc = 0xffffffff;
  for (const b of buf) {
    crc ^= b;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, c]);
}
/** pixel(x, y) -> [r, g, b, a] */
function png(w, h, pixel) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (w * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const IMAGES = {
  // 照片：彩色噪声 + 渐变
  'photo.png': png(300, 200, (x, y) => [Math.round(80 + 120 * (x / 300) + 50 * rand()), Math.round(60 + 150 * (y / 200) * rand()), Math.round(200 * rand()), 255]),
  'cover1.png': png(240, 135, (x, y) => [Math.round(255 * rand()), Math.round(120 + 100 * Math.sin(x / 20)), Math.round(255 * (y / 135)), 255]),
  'cover2.png': png(240, 135, (x, y) => [Math.round(40 + 200 * (y / 135)), Math.round(200 * rand()), Math.round(100 + 80 * Math.cos(x / 15)), 255]),
  // 白底截图：白色为主，几条灰线
  'screenshot.png': png(480, 320, (x, y) => (y % 40 < 2 || (x > 40 && x < 300 && y % 40 > 10 && y % 40 < 16) ? [200, 200, 200, 255] : [255, 255, 255, 255])),
  // 透明底黑色图标
  'glyph.png': png(32, 32, (x, y) => ((x - 16) ** 2 + (y - 16) ** 2 < 100 ? [20, 20, 20, 255] : [0, 0, 0, 0])),
  // 二维码：黑白方块
  'qr.png': png(120, 120, (x, y) => (((Math.floor(x / 10) * 7 + Math.floor(y / 10) * 13) % 3 === 0) ? [0, 0, 0, 255] : [255, 255, 255, 255])),
};

const EQUATION_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="24" viewBox="0 0 80 24"><path d="M2 4h20v3H2zM2 11h16v3H2zM2 18h20v3H2zM30 4l10 16M40 4L30 20" stroke-width="2" stroke="currentColor"/><path d="M50 10h12v3H50zM50 16h12v3H50z"/></svg>';

export function startServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const host = url.hostname;
      const port = url.port;
      const send = (type, body, delay = 0) =>
        setTimeout(() => {
          res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
          res.end(body);
        }, delay);
      const page = (file) => {
        let html = readFileSync(join(dir, file), 'utf8').replaceAll('__PORT__', port).replaceAll('__CSSDELAY__', url.searchParams.get('cssdelay') || '0');
        if (url.searchParams.get('native') === '1') html = html.replace('<html lang="zh-CN">', '<html lang="zh-CN" data-native-supported>');
        send('text/html; charset=utf-8', html);
      };
      if (url.pathname === '/favicon.ico') {
        res.writeHead(204);
        return res.end();
      }
      if (url.pathname.startsWith('/img/')) {
        const img = IMAGES[url.pathname.slice(5)];
        if (img) return send('image/png', img);
      }
      if (url.pathname === '/equation') return send('image/svg+xml', EQUATION_SVG);
      if (host === 'static.zhimg.com' && url.pathname === '/zhihu.css') {
        return send('text/css', readFileSync(join(dir, 'zhihu.css')), Number(url.searchParams.get('delay') || 0));
      }
      if (host === 's1.hdslb.com' && url.pathname === '/bili.css') return send('text/css', readFileSync(join(dir, 'bili.css')));
      if (host.endsWith('zhihu.com') && (url.pathname === '/' || url.pathname.startsWith('/explore'))) return page('zhihu.html');
      if (host.endsWith('bilibili.com') && url.pathname === '/') return page('bilibili.html');
      // 有防盗链的 CDN：不带页面 Referer（扩展后台直接拉取）时返回 403
      if (host === 's2.hdslb.com' && url.pathname === '/guard.css') {
        if (!(req.headers.referer || '').startsWith('http://127.0.0.1:')) {
          res.writeHead(403, { 'content-type': 'text/html' });
          return res.end('<h1>403 Forbidden</h1>');
        }
        return send('text/css', '.gd{background:#f7f7f9;color:#000;padding:8px}');
      }
      // 新式写法：Tailwind v3 透明度变量、oklch()、shadcn/ui 与 Vercel Geist 的通道变量
      if (url.pathname === '/modern') {
        const css = [
          ':root{--background:0 0% 100%;--foreground:222.2 84% 4.9%;--v:0, 0%, 98%;--fv:0, 0%, 9%;--bg2:hsla(var(--v), 1);--fg2:hsla(var(--fv), 1);--c:255 255 255}',
          'body{margin:0;background:#fff;color:#222}div{padding:8px}',
          '.tw{--tw-bg-opacity:1;background-color:rgb(255 255 255/var(--tw-bg-opacity));--tw-text-opacity:1;color:rgb(35 39 47/var(--tw-text-opacity))}',
          '.ok{background:oklch(0.985 0.002 247.839);color:oklch(0.21 0.034 264.665)}',
          '.sh{background:hsl(var(--background));color:hsl(var(--foreground))}',
          '.sha{background:hsl(var(--background) / 0.95);color:hsl(var(--foreground))}',
          '.ge{background:var(--bg2);color:var(--fg2)}',
          '.twc{--tw-bg-opacity:1;background:rgb(var(--c) / var(--tw-bg-opacity));color:#111}',
        ].join('');
        return send(
          'text/html; charset=utf-8',
          `<!doctype html><html><head><style>${css}</style><link rel="stylesheet" href="http://s2.hdslb.com:${port}/guard.css"></head><body>` +
            '<div class="tw" id="tw">Tailwind v3</div><div class="ok" id="ok">oklch</div><div class="sh" id="sh">shadcn</div><div class="sha" id="sha">shadcn 半透明</div>' +
            '<div class="ge" id="ge">Geist</div><div class="twc" id="twc">Tailwind 通道变量</div><div class="gd" id="gd">防盗链 CDN 样式表</div></body></html>',
        );
      }
      if (url.pathname === '/plain') {
        return send('text/html; charset=utf-8', '<!doctype html><html><head><style>body{background:#fff;color:#222}p{border-bottom:1px solid #eee}</style></head><body><p id="p">普通网站</p></body></html>');
      }
      if (url.pathname === '/darksite') {
        return send('text/html; charset=utf-8', '<!doctype html><html><head><style>body{background:#111;color:#eee}</style></head><body><p>本来就是深色的网站</p></body></html>');
      }
      const doc = (head, body) => send('text/html; charset=utf-8', `<!doctype html><html><head>${head}</head><body>${body}</body></html>`);
      const filler = '<p>正文</p>'.repeat(80);
      // body 透明，深色画在包裹层上（单页应用常见写法）
      if (url.pathname === '/darkwrap') {
        return doc('<style>body{margin:0}#app{background:#1e1f22;color:#dcddde;min-height:100vh}</style>', `<div id="app"><h1>包裹层深色</h1>${filler}</div>`);
      }
      // 只声明 color-scheme，不写任何颜色
      if (url.pathname === '/darkscheme') return doc('<meta name="color-scheme" content="dark">', `<h1>只声明 color-scheme</h1>${filler}`);
      // 深灰主题
      if (url.pathname === '/darkgray') return doc('<style>body{background:#36393f;color:#dcddde}</style>', `<h1>深灰主题</h1>${filler}`);
      // body 深色但文字色没设（继承默认黑），真正的文字各自写成白色（Discord 官网一类）+ 一个白色的 Cookie 浮层
      if (url.pathname === '/darkinherit') {
        return doc(
          '<style>body{margin:0;background:#1a2081}h1,p{color:#fff}.wrap{padding:24px}#cookie{position:fixed;right:16px;bottom:16px;width:320px;padding:16px;background:#fff;color:#222}</style>',
          `<div class="wrap"><div><h1>深色底、文字各自设白色</h1>${filler}</div></div><div id="cookie">本站使用 Cookie</div>`,
        );
      }
      // html/body 都透明、每个分区各自画深色背景的长页面（官网、落地页）
      if (url.pathname === '/darksections') {
        const sec = (bg) => `<section style="background:${bg};min-height:700px"><h2>分区</h2><p>说明文字</p></section>`;
        return doc('<style>body{margin:0;color:#e8e8e8}section{padding:40px}</style>', [sec('#000'), sec('#0b0d12'), sec('#111'), sec('#000'), sec('#15171c')].join(''));
      }
      // 加载完成后才由脚本套上暗色主题，带过渡动画；window.toggleTheme() 模拟用户在网站里切换
      if (url.pathname === '/darklate') {
        return doc(
          '<style>body{background:#fff;color:#222;transition:background-color .3s,color .3s}.card{background:#f6f6f6;padding:20px;transition:background-color .3s}html.dark body{background:#121212;color:#eee}html.dark .card{background:#1e1e1e}</style>',
          `<div class="card" id="card">卡片</div>${filler}<script>window.toggleTheme=()=>document.documentElement.classList.toggle('dark');addEventListener('load',()=>setTimeout(window.toggleTheme,200));</script>`,
        );
      }
      // 浅色网站，所有元素都带颜色过渡：复查网站是否自带暗色时不能闪白
      if (url.pathname === '/transition') {
        return doc('<style>*{transition:background-color .4s,color .4s}body{background:#fff;color:#222}.card{background:#f3f3f3;padding:40px}</style>', `<div class="card">卡片</div>${filler}`);
      }
      // 浅色网站 + 占满首屏的深色头图：不能当成暗色网站
      if (url.pathname === '/hero') {
        return doc('<style>body{margin:0;background:#fff;color:#222}#hero{height:100vh;background:#0b0b0f;color:#fff}</style>', `<div id="hero"><h1>深色头图</h1></div><div id="content">${filler}</div>`);
      }
      res.writeHead(404);
      res.end('not found');
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}
