// 从 builtin-rules.ts 里抽出各站点用到的选择器，供真实站点验收统计命中数
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../src/shared/builtin-rules.ts'), 'utf8');
export const BUILTIN_SELECTORS = src
  .split(/\n  \{\n/)
  .slice(1)
  .map((block) => {
    const match = [...(/match:\s*\[([^\]]*)\]/.exec(block)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((x) => x[1]);
    const selectors = [];
    for (const key of ['invert', 'ignore', 'keepImage']) {
      const m = new RegExp(`${key}:\\s*\\[([\\s\\S]*?)\\]\\s*,\\s*\\n`).exec(block);
      if (m) selectors.push(...[...m[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((x) => x[1]));
    }
    return { match, selectors };
  });
