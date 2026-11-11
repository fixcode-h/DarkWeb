// 生成发布说明：列出这个包相对上一个发布包的调整（合并的 PR；没有 PR 时列提交）。
// 用法：node scripts/release-notes.mjs <版本号> [输出文件，默认 release/notes.md]
// 上一个包按 git 标签（v*）确定，所以需要完整的提交历史和标签（CI 里 checkout 要 fetch-depth: 0）。
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2];
if (!version) throw new Error('用法：node scripts/release-notes.mjs <版本号> [输出文件]');
const outFile = resolve(process.argv[3] || join(root, 'release/notes.md'));

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

// 上一个发布标签：已合入当前提交、且不指向当前提交的最新一个
const head = git('rev-parse', 'HEAD');
const prev = git('tag', '--merged', 'HEAD', '--sort=-creatordate', '--list', 'v*')
  .split('\n')
  .filter(Boolean)
  .find((t) => git('rev-list', '-n', '1', t) !== head);
const range = prev ? `${prev}..HEAD` : 'HEAD';

const log = git('log', range, '--format=%H%x00%P%x00%s%x00%b%x1e')
  .split('\x1e')
  .map((r) => r.trim())
  .filter(Boolean)
  .map((r) => {
    const [hash, parents, subject, body = ''] = r.split('\x00');
    return { hash, merge: parents.includes(' '), subject, body };
  });

const items = [];
for (const c of log) {
  const m = /^Merge pull request #(\d+) /.exec(c.subject);
  if (!m) continue;
  const title = c.body.split('\n').map((l) => l.trim()).find(Boolean) || c.subject;
  items.push(`- ${title}（#${m[1]}）`);
}
// 没有走 PR 的改动：列出普通提交
if (!items.length) {
  for (const c of log) if (!c.merge) items.push(`- ${c.subject}（${c.hash.slice(0, 7)}）`);
}

const lines = [
  `## Drak ${version}`,
  '',
  prev ? `相对上一个包（${prev}）的调整：` : '本次包含的调整：',
  '',
  ...(items.length ? items : ['- 没有代码调整（重新构建）']),
  '',
  '### 安装',
  '',
  '下载 zip 解压后，在 chrome://extensions 打开开发者模式，选择“加载已解压的扩展程序”。包里的 CHANGES.md 是同一份调整说明。',
  '',
];
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, lines.join('\n'));
console.log(lines.join('\n'));
