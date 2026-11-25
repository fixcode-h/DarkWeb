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

/**
 * 高亮后的 HTML 按行切开，每行包一个 .md-ln（行号是它的 ::before，复制时不带）。高亮的 span 可能跨行，
 * 切开时在行尾把开着的 span 关掉、下一行开头再原样打开。照搬 agent-panel 的 workflow-doc.ts。
 */
export function lineSpans(html: string, diff = false): { html: string; count: number } {
  const lines: string[] = [];
  const open: string[] = [];
  let cur = '';
  for (const [s] of html.matchAll(/<span[^>]*>|<\/span>|\n|[^<\n]+|</g)) {
    if (s === '\n') {
      lines.push(cur + '</span>'.repeat(open.length));
      cur = open.join('');
      continue;
    }
    if (s === '</span>') open.pop();
    else if (s.startsWith('<span')) open.push(s);
    cur += s;
  }
  lines.push(cur);
  if (lines.length > 1 && !lines[lines.length - 1].replace(/<[^>]*>/g, '')) lines.pop();
  const out = lines.map((l) => {
    let cls = 'md-ln';
    if (diff) {
      const text = l.replace(/<[^>]*>/g, '');
      if (/^\+(?!\+\+ )/.test(text)) cls += ' md-add';
      else if (/^-(?!-- )/.test(text)) cls += ' md-del';
    }
    return `<span class="${cls}">${l}</span>`;
  });
  return { html: out.join('\n'), count: out.length };
}

/** > [!NOTE] 这类提示块（GitHub 写法）的标题 */
export const ALERTS: Record<string, string> = { note: '说明', tip: '提示', important: '重要', warning: '注意', caution: '警告' };
const ALERT_RE = /^\[!(note|tip|important|warning|caution)\]\s*/i;

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

  // 提示块：> [!NOTE] 开头的引用换成带标题的彩色块
  md.core.ruler.after('inline', 'drak_alerts', (state) => {
    const toks = state.tokens;
    for (let i = 0; i < toks.length; i++) {
      if (toks[i].type !== 'blockquote_open' || toks[i + 1]?.type !== 'paragraph_open') continue;
      const inline = toks[i + 2];
      const first = inline?.children?.[0];
      const m = first?.type === 'text' ? ALERT_RE.exec(first.content) : null;
      if (!m || !first || !inline.children) continue;
      const kind = m[1].toLowerCase();
      first.content = first.content.slice(m[0].length);
      // [!NOTE] 单独占一行时，后面紧跟的换行也去掉
      if (!first.content && inline.children[1]?.type === 'softbreak') inline.children.splice(0, 2);
      else if (!first.content) inline.children.shift();
      const open = toks[i];
      open.tag = 'div';
      open.attrJoin('class', 'md-alert');
      open.attrSet('data-kind', kind);
      let depth = 0;
      for (let j = i; j < toks.length; j++) {
        if (toks[j].type === 'blockquote_open') depth++;
        else if (toks[j].type === 'blockquote_close' && --depth === 0) {
          toks[j].tag = 'div';
          break;
        }
      }
      const title = new state.Token('html_block', '', 0);
      title.content = `<p class="md-alert-title">${ALERTS[kind]}</p>\n`;
      toks.splice(i + 1, 0, title);
    }
  });

  // 表格列对齐：markdown-it 写成 style，清洗时 style 会被去掉，改写成 align
  md.core.ruler.push('drak_align', (state) => {
    for (const t of state.tokens) {
      const m = /text-align:(left|center|right)/.exec(t.attrGet('style') ?? '');
      if (!m || (t.type !== 'th_open' && t.type !== 'td_open')) continue;
      t.attrs = (t.attrs ?? []).filter(([k]) => k !== 'style');
      t.attrSet('align', m[1]);
    }
  });

  // 表格外面包一层：圆角外框、太宽时横向滚动
  md.renderer.rules.table_open = (tokens, idx, opts, _env, self) => `<div class="md-table">${self.renderToken(tokens, idx, opts)}`;
  md.renderer.rules.table_close = (tokens, idx, opts, _env, self) => `${self.renderToken(tokens, idx, opts)}</div>\n`;

  // 段落里只有一张带替代文字的图：文字放到图下面当图注（README 里一排徽章不加）
  const image = md.renderer.rules.image!;
  md.renderer.rules.image = (tokens, idx, opts, env, self) => {
    const html = image(tokens, idx, opts, env, self);
    const alt = tokens[idx].content.trim();
    const alone = tokens.length === 1 || tokens.every((t, i) => i === idx || (t.type === 'text' && !t.content.trim()) || t.type === 'softbreak');
    return alt && alone ? `<span class="md-fig">${html}<span class="md-cap">${escapeHtml(alt)}</span></span>` : html;
  };

  // 代码块：一张卡片，按行切开带行号；顶栏（语言、行数、折行、复制）由页面补上。mermaid 先放源码，页面再画成图
  md.renderer.rules.fence = (tokens, idx) => {
    const t = tokens[idx];
    const lang = t.info.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    const line = t.map ? ` data-line="${t.map[0]}"` : '';
    if (lang === 'mermaid') {
      const src = lineSpans(escapeHtml(t.content));
      return `<div class="md-mermaid"${line}><pre><code>${src.html}</code></pre></div>\n`;
    }
    let body: string;
    try {
      body = lang && hljs.getLanguage(lang) ? hljs.highlight(t.content, { language: lang, ignoreIllegals: true }).value : escapeHtml(t.content);
    } catch {
      body = escapeHtml(t.content);
    }
    const lines = lineSpans(body, lang === 'diff' || lang === 'patch');
    const label = lang ? ` data-lang="${escapeHtml(lang)}"` : '';
    return `<div class="md-code"${line}${label} data-lines="${lines.count}"><pre><code class="hljs">${lines.html}</code></pre></div>\n`;
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
