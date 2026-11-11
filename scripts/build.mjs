// 构建扩展到 dist/；--zip 时再打包到 release/drak-<version>.zip
// 设置 BUILD_NUMBER 时，manifest 版本号写成 <version>.<BUILD_NUMBER>：Chrome 应用商店要求每次上传的版本号都更大
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const zip = process.argv.includes('--zip');

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'icons'), { recursive: true });

const common = {
  bundle: true,
  target: 'chrome120',
  legalComments: 'none',
  minify: zip,
  sourcemap: zip ? false : 'inline',
  logLevel: 'warning',
};

await Promise.all([
  build({ ...common, entryPoints: [join(root, 'src/background/sw.ts')], outfile: join(dist, 'sw.js'), format: 'esm' }),
  build({ ...common, entryPoints: [join(root, 'src/content/index.ts')], outfile: join(dist, 'content.js'), format: 'iife' }),
  build({ ...common, entryPoints: [join(root, 'src/content/probe.ts')], outfile: join(dist, 'probe.js'), format: 'iife', sourcemap: false }),
  build({ ...common, entryPoints: [join(root, 'src/popup/popup.ts')], outfile: join(dist, 'popup.js'), format: 'iife' }),
  build({ ...common, entryPoints: [join(root, 'src/options/options.ts')], outfile: join(dist, 'options.js'), format: 'iife' }),
]);

// 静态文件
for (const f of ['popup/popup.html', 'popup/ui.css', 'options/options.html']) {
  copyFileSync(join(root, 'src', f), join(dist, f.split('/').pop()));
}
const base = readFileSync(join(root, 'src/content/base.css'), 'utf8');
writeFileSync(join(dist, 'base.css'), base);
writeFileSync(join(dist, 'base-system.css'), base.replace('@media screen {', '@media screen and (prefers-color-scheme: dark) {'));

const manifest = JSON.parse(readFileSync(join(root, 'src/manifest.json'), 'utf8'));
manifest.version = pkg.version;
const buildNumber = process.env.BUILD_NUMBER;
if (buildNumber) {
  if (!/^\d+$/.test(buildNumber) || Number(buildNumber) > 65535) throw new Error(`BUILD_NUMBER 必须是 0-65535 的整数：${buildNumber}`);
  if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error(`package.json 的 version 必须是 x.y.z：${pkg.version}`);
  manifest.version = `${pkg.version}.${Number(buildNumber)}`;
  manifest.version_name = `${pkg.version} (build ${Number(buildNumber)})`;
}
writeFileSync(join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2));

// ---- 图标：月牙，纯代码生成 PNG ----
function crc32(buf) {
  let c;
  const table = crc32.t || (crc32.t = Array.from({ length: 256 }, (_, n) => {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  }));
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function icon(size) {
  const ss = 4; // 超采样抗锯齿
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const r = size * 0.46;
  const c = size / 2;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let bgCov = 0;
      let moonCov = 0;
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) {
          const px = x + (sx + 0.5) / ss;
          const py = y + (sy + 0.5) / ss;
          const inBg = (px - c) ** 2 + (py - c) ** 2 <= r * r;
          if (!inBg) continue;
          bgCov++;
          const inMoon = (px - c) ** 2 + (py - c) ** 2 <= (r * 0.62) ** 2;
          const inBite = (px - (c + r * 0.32)) ** 2 + (py - (c - r * 0.28)) ** 2 <= (r * 0.52) ** 2;
          if (inMoon && !inBite) moonCov++;
        }
      const a = bgCov / (ss * ss);
      const m = bgCov ? moonCov / bgCov : 0;
      const o = y * (size * 4 + 1) + 1 + x * 4;
      // 背景 #1d2330，月牙 #f2c94c
      raw[o] = Math.round(0x1d + (0xf2 - 0x1d) * m);
      raw[o + 1] = Math.round(0x23 + (0xc9 - 0x23) * m);
      raw[o + 2] = Math.round(0x30 + (0x4c - 0x30) * m);
      raw[o + 3] = Math.round(a * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
for (const s of [16, 32, 48, 128]) writeFileSync(join(dist, 'icons', `icon-${s}.png`), icon(s));

if (zip) {
  const out = join(root, 'release');
  mkdirSync(out, { recursive: true });
  const file = join(out, `drak-${pkg.version}.zip`);
  rmSync(file, { force: true });
  execFileSync('zip', ['-qr', file, '.'], { cwd: dist });
  console.log(`packed ${file}`);
} else {
  console.log(`built ${dist}`);
}
