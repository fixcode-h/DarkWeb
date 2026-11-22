/**
 * Markdown → HTML（GFM：表格、任务列表、删除线、脚注、自动链接、代码高亮）。
 * 这里只产出 HTML 字符串，不碰 DOM；放进页面前还要经过 sanitize.ts 清洗。
 * 块级元素都带 data-line（源码起始行，从 0 起），分栏时用来对齐滚动位置。
 */
import MarkdownIt, { type PluginSimple } from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import footnote from 'markdown-it-footnote';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import lua from 'highlight.js/lib/languages/lua';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import plaintext from 'highlight.js/lib/languages/plaintext';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scss from 'highlight.js/lib/languages/scss';
import shell from 'highlight.js/lib/languages/shell';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

const LANGS = { bash, c, cpp, csharp, css, diff, dockerfile, go, ini, java, javascript, json, kotlin, lua, markdown, php, plaintext, powershell, python, ruby, rust, scss, shell, sql, swift, typescript, xml, yaml };
for (const [name, lang] of Object.entries(LANGS)) hljs.registerLanguage(name, lang);
hljs.registerAliases(['sh', 'zsh', 'console'], { languageName: 'bash' });
hljs.registerAliases(['html', 'vue', 'svg'], { languageName: 'xml' });
hljs.registerAliases(['toml'], { languageName: 'ini' });
hljs.registerAliases(['text', 'txt'], { languageName: 'plaintext' });

export interface Heading {
  level: number;
  text: string;
  id: string;
  /** 源码行号，从 0 起 */
  line: number;
}

export interface Rendered {
  html: string;
  headings: Heading[];
  /** 正文字数：中日韩按字计、其他按词计 */
  words: number;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** 标题锚点，规则接近 GitHub：小写、去标点、空白换成连字符，中文原样保留 */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

export function countWords(text: string): number {
  const cjk = text.match(/[぀-ヿ㐀-鿿豈-﫿가-힯]/g)?.length ?? 0;
  const rest = text.replace(/[぀-ヿ㐀-鿿豈-﫿가-힯]/g, ' ').match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
  return cjk + rest;
}

const TASK_RE = /^\[([ xX])\]\s/;

function createMd(): MarkdownIt {
  const md = new MarkdownIt({ html: true, linkify: true, typographer: false });
  md.use(footnote as unknown as PluginSimple);
  md.enable(['strikethrough', 'table']);

  // 块级开标签带上源码行号
  md.core.ruler.push('drak_line', (state) => {
    for (const t of state.tokens) {
      if (t.map && t.nesting >= 0 && t.block && t.type !== 'inline') t.attrSet('data-line', String(t.map[0]));
    }
  });

  // 任务列表：- [ ] / - [x]
  md.core.ruler.after('inline', 'drak_tasks', (state) => {
    const toks = state.tokens;
    for (let i = 2; i < toks.length; i++) {
      const inline = toks[i];
      if (inline.type !== 'inline' || toks[i - 1].type !== 'paragraph_open' || toks[i - 2].type !== 'list_item_open') continue;
      const first = inline.children?.[0];
      const m = first?.type === 'text' ? TASK_RE.exec(first.content) : null;
      if (!m || !first) continue;
      const checked = m[1] !== ' ';
      first.content = first.content.slice(m[0].length);
      const box = new state.Token('html_inline', '', 0);
      const line = toks[i - 2].map?.[0] ?? 0;
      box.content = `<span class="task-box${checked ? ' checked' : ''}" data-task="${line}" role="checkbox" aria-checked="${checked}"></span>`;
      inline.children!.unshift(box);
      toks[i - 2].attrJoin('class', 'task-item');
    }
  });

  // 代码块：自己输出外壳，带语言标签和复制按钮的位置
  md.renderer.rules.fence = (tokens, idx) => {
    const t = tokens[idx];
    const lang = t.info.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    let body: string;
    try {
      body = lang && hljs.getLanguage(lang) ? hljs.highlight(t.content, { language: lang, ignoreIllegals: true }).value : escapeHtml(t.content);
    } catch {
      body = escapeHtml(t.content);
    }
    const line = t.map ? ` data-line="${t.map[0]}"` : '';
    const label = lang ? ` data-lang="${escapeHtml(lang)}"` : '';
    return `<pre class="code"${line}${label}><code class="hljs">${body}</code></pre>\n`;
  };
  return md;
}

let instance: MarkdownIt | null = null;

export function renderMarkdown(src: string): Rendered {
  const md = (instance ??= createMd());
  const env = {};
  const tokens = md.parse(src, env);
  const headings: Heading[] = [];
  const used = new Map<string, number>();
  let plain = '';
  for (let i = 0; i < tokens.length; i++) {
    const t: Token = tokens[i];
    if (t.type === 'inline') plain += t.children?.filter((c) => c.type === 'text' || c.type === 'code_inline').map((c) => c.content).join('') + '\n';
    if (t.type !== 'heading_open') continue;
    const inline = tokens[i + 1];
    const text = (inline?.children ?? [])
      .filter((c) => c.type === 'text' || c.type === 'code_inline')
      .map((c) => c.content)
      .join('')
      .trim();
    let id = slugify(text) || 'section';
    const n = used.get(id) ?? 0;
    used.set(id, n + 1);
    if (n) id = `${id}-${n}`;
    t.attrSet('id', id);
    headings.push({ level: Number(t.tag.slice(1)), text, id, line: t.map?.[0] ?? 0 });
  }
  return { html: md.renderer.render(tokens, md.options, env), headings, words: countWords(plain) };
}

/** 把第 line 行（从 0 起）的任务框勾上 / 取消，返回新源码；那一行不是任务项时原样返回 */
export function toggleTask(src: string, line: number): string {
  const lines = src.split('\n');
  const cur = lines[line];
  if (cur === undefined) return src;
  const next = cur.replace(/^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/, (_m, pre: string, mark: string) => `${pre}[${mark === ' ' ? 'x' : ' '}]`);
  if (next === cur) return src;
  lines[line] = next;
  return lines.join('\n');
}
