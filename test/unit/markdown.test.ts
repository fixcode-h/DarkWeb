import { describe, expect, it } from 'vitest';
import { isMarkdownDocument, isMarkdownPath } from '../../src/markdown/match';
import { countWords, renderMarkdown, slugify, toggleTask } from '../../src/markdown/render';
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
    expect(s.fontSize).toBe(16);
    expect(s.theme).toBe('auto');
    expect(s.enabled).toBe(true);
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
    expect(r.html).toMatch(/<pre class="code" data-line="9" data-lang="js">/);
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
