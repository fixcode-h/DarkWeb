import { describe, expect, it } from 'vitest';
import { isMarkdownDocument, isMarkdownPath } from '../../src/markdown/match';
import { countWords, lineSpans, renderMarkdown, slugify, toggleTask } from '../../src/markdown/render';
import { DEFAULT_MARKDOWN, normalizeMarkdown, shouldRender, stepIn, MD_FONT_SIZES } from '../../src/markdown/settings';

describe('Markdown：识别', () => {
  it('按扩展名和内容类型判断', () => {
    expect(isMarkdownDocument('file:///D:/notes/README.md', 'text/plain')).toBe(true);
    expect(isMarkdownDocument('file:///home/a/%E7%AC%94%E8%AE%B0.markdown', 'text/markdown')).toBe(true);
    expect(isMarkdownDocument('https://raw.githubusercontent.com/a/b/main/README.md', 'text/plain')).toBe(true);
    expect(isMarkdownDocument('https://example.com/README.md?raw=1#top', 'text/plain')).toBe(true);
    expect(isMarkdownDocument('https://example.com/api/doc', 'text/markdown')).toBe(true);
  });
  it('网页、普通文本、非网页协议都不算', () => {
    expect(isMarkdownDocument('https://github.com/a/b/blob/main/README.md', 'text/html')).toBe(false);
    expect(isMarkdownDocument('https://example.com/notes.txt', 'text/plain')).toBe(false);
    expect(isMarkdownDocument('chrome-extension://x/README.md', 'text/plain')).toBe(false);
    expect(isMarkdownPath('https://example.com/?file=a.md')).toBe(false);
  });
});

describe('Markdown：设置', () => {
  it('空值和非法值回到默认', () => {
    expect(normalizeMarkdown(undefined)).toEqual(DEFAULT_MARKDOWN);
    const s = normalizeMarkdown({ view: 'x', fontSize: 99, theme: 'neon', enabled: 'yes' });
    expect(s.view).toBe('read');
    expect(s.fontSize).toBe(17);
    expect(s.theme).toBe('auto');
    expect(s.enabled).toBe(true);
  });
  it('栏宽默认 1520，可以是任意值但限制在范围内', () => {
    expect(DEFAULT_MARKDOWN.pageWidth).toBe(1520);
    expect(normalizeMarkdown({ pageWidth: 1333.4 }).pageWidth).toBe(1333);
    expect(normalizeMarkdown({ pageWidth: 100 }).pageWidth).toBe(560);
    expect(normalizeMarkdown({ pageWidth: 99999 }).pageWidth).toBe(3200);
    expect(normalizeMarkdown({ pageWidth: 'wide' }).pageWidth).toBe(1520);
  });
  it('旧设置升级：默认字号放大一档、旧栏宽不沿用，用户改过的字号保留', () => {
    const old = normalizeMarkdown({ fontSize: 16, width: 760 });
    expect(old.fontSize).toBe(17);
    expect(old.pageWidth).toBe(1520);
    expect(normalizeMarkdown({ fontSize: 20, width: 1040 }).fontSize).toBe(20);
    expect(normalizeMarkdown({ fontSize: 16, pageWidth: 1200 }).fontSize).toBe(16);
  });
  it('关闭网络文件后只渲染本地文件', () => {
    const s = normalizeMarkdown({ remote: false });
    expect(shouldRender(s, 'file:///a.md')).toBe(true);
    expect(shouldRender(s, 'https://x.com/a.md')).toBe(false);
    expect(shouldRender(normalizeMarkdown({ enabled: false }), 'file:///a.md')).toBe(false);
  });
  it('字号到头不再变', () => {
    expect(stepIn(MD_FONT_SIZES, 22, 1)).toBe(22);
    expect(stepIn(MD_FONT_SIZES, 16, 1)).toBe(17);
  });
});

describe('Markdown：渲染', () => {
  const src = '# 标题 One\n\n## 安装 & 使用\n\n## 安装 & 使用\n\n- [ ] 待办\n- [x] 完成\n\n```js\nconst a = 1;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n~~删~~ https://example.com\n';
  const r = renderMarkdown(src);
  it('标题带锚点，重名自动加序号', () => {
    expect(r.headings.map((h) => h.id)).toEqual(['标题-one', '安装--使用', '安装--使用-1']);
    expect(r.html).toContain('id="标题-one"');
  });
  it('块级元素带源码行号', () => {
    expect(r.html).toMatch(/<h2 data-line="2"/);
    expect(r.html).toMatch(/<div class="md-code" data-line="9" data-lang="js" data-lines="1">/);
  });
  it('代码块按行切开（行号用），跨行的高亮 span 在每行各自闭合', () => {
    const out = renderMarkdown('```js\n/* a\nb */\nx\n```').html;
    expect(out).toContain('data-lines="3"');
    expect(out).toContain('<span class="md-ln"><span class="hljs-comment">/* a</span></span>');
    expect(out).toContain('<span class="md-ln"><span class="hljs-comment">b */</span></span>');
    expect(lineSpans('+a\n-b\n c', true).html).toBe('<span class="md-ln md-add">+a</span>\n<span class="md-ln md-del">-b</span>\n<span class="md-ln"> c</span>');
  });
  it('mermaid 代码块留给页面画图', () => {
    const out = renderMarkdown('```mermaid\ngraph TD\nA-->B\n```').html;
    expect(out).toContain('<div class="md-mermaid" data-line="0">');
    expect(out).toContain('A--&gt;B');
  });
  it('提示块：> [!NOTE] 换成带标题的彩色块，普通引用不变', () => {
    const out = renderMarkdown('> [!WARNING]\n> 小心 **这里**\n\n> 普通引用').html;
    expect(out).toContain('<div class="md-alert" data-kind="warning"');
    expect(out).toContain('<p class="md-alert-title">注意</p>');
    expect(out).toContain('小心 <strong>这里</strong>');
    expect(out).not.toContain('[!WARNING]');
    expect(out).toMatch(/<blockquote data-line="3">/);
  });
  it('表格包一层；单独一张带说明的图加图注，一排徽章不加', () => {
    expect(r.html).toContain('<div class="md-table"><table');
    expect(renderMarkdown('| a | b |\n|:-:|--:|\n| 1 | 2 |').html).toContain('<td align="right">2</td>');
    expect(renderMarkdown('![架构图](a.png)').html).toContain('<span class="md-cap">架构图</span>');
    expect(renderMarkdown('![ci](a.svg) ![license](b.svg)').html).not.toContain('md-cap');
  });
  it('任务列表、表格、删除线、自动链接、代码高亮', () => {
    expect(r.html).toContain('class="task-box" data-task="6"');
    expect(r.html).toContain('class="task-box checked" data-task="7"');
    expect(r.html).toContain('<table');
    expect(r.html).toContain('<s>删</s>');
    expect(r.html).toContain('href="https://example.com"');
    expect(r.html).toContain('hljs-keyword');
  });
  it('勾选任务只改那一行', () => {
    const next = toggleTask(src, 6);
    expect(next.split('\n')[6]).toBe('- [x] 待办');
    expect(toggleTask(next, 7).split('\n')[7]).toBe('- [ ] 完成');
    expect(toggleTask(src, 0)).toBe(src);
  });
  it('字数：中文按字、英文按词', () => {
    expect(countWords('你好 world, hello')).toBe(4);
  });
  it('锚点规则接近 GitHub', () => {
    expect(slugify('Hello, World!')).toBe('hello-world');
    expect(slugify('中文 标题')).toBe('中文-标题');
  });
});
