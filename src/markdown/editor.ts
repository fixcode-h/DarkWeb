/**
 * 源码编辑器：CodeMirror 6 + Markdown 语法高亮。
 * 配色全部取页面上的 CSS 变量，跟着阅读主题（深色 / 浅色 / 米黄）一起变。
 */
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { Language, LanguageSupport, HighlightStyle, defineLanguageFacet, syntaxHighlighting } from '@codemirror/language';
import { parser as mdParser, GFM } from '@lezer/markdown';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorSelection, EditorState, type ChangeSpec } from '@codemirror/state';
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, placeholder } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

export type FormatCmd = 'heading' | 'bold' | 'italic' | 'strike' | 'link' | 'code' | 'quote' | 'ul' | 'ol' | 'task' | 'table' | 'image' | 'codeblock' | 'hr';

export interface EditorOptions {
  doc: string;
  fontSize: number;
  onChange: (text: string) => void;
  onCursor: (info: { line: number; col: number; selected: number }) => void;
  onScroll: () => void;
}

const style = HighlightStyle.define([
  { tag: t.heading, color: 'var(--md-syn-heading)', fontWeight: '700' },
  { tag: [t.strong], color: 'var(--md-syn-em)', fontWeight: '700' },
  { tag: [t.emphasis], color: 'var(--md-syn-em)', fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.link, t.url], color: 'var(--md-syn-link)' },
  { tag: [t.monospace], color: 'var(--md-syn-code)' },
  { tag: [t.quote], color: 'var(--md-syn-quote)' },
  { tag: [t.processingInstruction, t.contentSeparator, t.meta, t.labelName], color: 'var(--md-syn-mark)' },
  { tag: [t.list], color: 'var(--md-syn-mark)' },
  { tag: [t.comment], color: 'var(--subtle)', fontStyle: 'italic' },
  { tag: [t.angleBracket, t.tagName, t.attributeName], color: 'var(--md-syn-mark)' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', color: 'var(--fg)', backgroundColor: 'var(--md-editor-bg)', fontSize: 'var(--md-editor-size)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.75', overscrollBehavior: 'contain' },
  '.cm-content': { padding: '14px 0 40vh', caretColor: 'var(--link)' },
  '.cm-line': { padding: '0 18px 0 10px' },
  '.cm-gutters': { backgroundColor: 'var(--md-editor-bg)', color: 'var(--md-gutter)', border: 'none', paddingLeft: '8px' },
  '.cm-lineNumbers .cm-gutterElement': { minWidth: '32px', paddingRight: '6px' },
  '.cm-activeLine': { backgroundColor: 'var(--md-active-line)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--muted)' },
  '.cm-cursor': { borderLeftColor: 'var(--link)', borderLeftWidth: '2px' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--md-selection) !important' },
  '.cm-selectionMatch': { backgroundColor: 'var(--md-match)' },
  '.cm-searchMatch': { backgroundColor: 'var(--md-match)', outline: '1px solid var(--edge)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--md-selection)' },
  '.cm-panels': { backgroundColor: 'var(--pop)', color: 'var(--fg)', borderColor: 'var(--edge)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--edge)' },
  '.cm-panel.cm-search': { padding: '6px 10px', fontFamily: 'var(--sans)', fontSize: '12.5px' },
  '.cm-panel.cm-search input, .cm-panel.cm-search button': { font: 'inherit', color: 'var(--fg)' },
  '.cm-textfield': { background: 'var(--field)', border: '1px solid var(--edge)', borderRadius: '6px', padding: '3px 8px' },
  '.cm-button': { backgroundImage: 'none', background: 'var(--field)', border: '1px solid var(--edge)', borderRadius: '6px', padding: '3px 10px' },
  '.cm-panel.cm-search [name=close]': { color: 'var(--subtle)' },
  '.cm-placeholder': { color: 'var(--subtle)' },
});

/**
 * 直接用 @lezer/markdown 的解析器，不经过 @codemirror/lang-markdown：后者会顺带打包 HTML / CSS / JS 语言支持（多出 150KB），
 * 而这里只需要 Markdown 本身的高亮。
 */
const mdLang = new LanguageSupport(new Language(defineLanguageFacet({ commentTokens: { block: { open: '<!--', close: '-->' } } }), mdParser.configure(GFM), [], 'markdown'));

export class MdEditor {
  readonly view: EditorView;
  private size = new Compartment();
  private silent = false;

  constructor(parent: HTMLElement, private opts: EditorOptions) {
    this.view = new EditorView({
      parent,
      state: EditorState.create({
        doc: opts.doc,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          history(),
          drawSelection(),
          EditorView.lineWrapping,
          mdLang,
          syntaxHighlighting(style),
          search({ top: true }),
          highlightSelectionMatches(),
          placeholder('开始写点什么…'),
          theme,
          this.size.of(this.sizeTheme(opts.fontSize)),
          keymap.of([
            { key: 'Mod-b', run: () => this.format('bold') },
            { key: 'Mod-i', run: () => this.format('italic') },
            { key: 'Mod-k', run: () => this.format('link') },
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
          ]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !this.silent) opts.onChange(u.state.doc.toString());
            if (u.docChanged || u.selectionSet) {
              const sel = u.state.selection.main;
              const line = u.state.doc.lineAt(sel.head);
              const selected = u.state.selection.ranges.reduce((n, r) => n + u.state.sliceDoc(r.from, r.to).replace(/\s/g, '').length, 0);
              opts.onCursor({ line: line.number, col: sel.head - line.from + 1, selected });
            }
          }),
          EditorView.domEventHandlers({ scroll: () => opts.onScroll() }),
        ],
      }),
    });
  }

  private sizeTheme(px: number) {
    return EditorView.theme({ '&': { fontSize: `${px}px` } });
  }

  setFontSize(px: number): void {
    this.view.dispatch({ effects: this.size.reconfigure(this.sizeTheme(px)) });
  }

  get text(): string {
    return this.view.state.doc.toString();
  }

  /** 外部改了源码（比如在预览里勾任务框）：整体替换，保留撤销记录 */
  setText(text: string, notify = false): void {
    const cur = this.text;
    if (cur === text) return;
    // 只替换不同的那一段，光标和滚动位置不乱跳
    let a = 0;
    while (a < cur.length && a < text.length && cur[a] === text[a]) a++;
    let b = 0;
    while (b < cur.length - a && b < text.length - a && cur[cur.length - 1 - b] === text[text.length - 1 - b]) b++;
    this.silent = !notify;
    try {
      this.view.dispatch({ changes: { from: a, to: cur.length - b, insert: text.slice(a, text.length - b) } });
    } finally {
      this.silent = false;
    }
  }

  focus(): void {
    this.view.focus();
  }

  /** 滚动容器顶部在文档坐标里的高度 */
  private viewTop(): number {
    return this.view.scrollDOM.getBoundingClientRect().top - this.view.documentTop;
  }

  /** 视口顶部对应的源码行（从 0 起，带小数，用于同步滚动） */
  topLine(): number {
    const v = this.view;
    const h = this.viewTop();
    const block = v.lineBlockAtHeight(h);
    const line = v.state.doc.lineAt(block.from).number - 1;
    const frac = block.height ? Math.min(1, Math.max(0, (h - block.top) / block.height)) : 0;
    return line + frac;
  }

  /** 把第 line 行（从 0 起，可带小数）滚到顶部 */
  scrollToLine(line: number): void {
    const v = this.view;
    const n = Math.min(v.state.doc.lines, Math.max(1, Math.floor(line) + 1));
    const block = v.lineBlockAt(v.state.doc.line(n).from);
    const target = block.top + (line % 1) * block.height;
    v.scrollDOM.scrollTop += target - this.viewTop();
  }

  format(cmd: FormatCmd): boolean {
    const v = this.view;
    const st = v.state;
    const wrap = (mark: string, empty: string) =>
      st.changeByRange((r) => {
        const sel = st.sliceDoc(r.from, r.to);
        // 已经包着同样的标记：去掉
        if (sel.startsWith(mark) && sel.endsWith(mark) && sel.length >= mark.length * 2) {
          const inner = sel.slice(mark.length, sel.length - mark.length);
          return { changes: { from: r.from, to: r.to, insert: inner }, range: EditorSelection.range(r.from, r.from + inner.length) };
        }
        const text = sel || empty;
        return {
          changes: { from: r.from, to: r.to, insert: mark + text + mark },
          range: EditorSelection.range(r.from + mark.length, r.from + mark.length + text.length),
        };
      });
    const prefix = (make: (i: number, line: string) => string, strip: RegExp) => {
      const changes: ChangeSpec[] = [];
      const seen = new Set<number>();
      for (const r of st.selection.ranges) {
        const first = st.doc.lineAt(r.from).number;
        const last = st.doc.lineAt(r.to).number;
        // 所有行都已有这个前缀：去掉；否则统一加上
        const lines = [];
        for (let n = first; n <= last; n++) if (!seen.has(n)) lines.push(st.doc.line(n));
        lines.forEach((l) => seen.add(l.number));
        const all = lines.every((l) => strip.test(l.text));
        lines.forEach((l, i) => {
          const m = strip.exec(l.text);
          if (all && m) changes.push({ from: l.from, to: l.from + m[0].length, insert: '' });
          else if (!all) {
            const old = m ? m[0].length : 0;
            changes.push({ from: l.from, to: l.from + old, insert: make(i, l.text) });
          }
        });
      }
      return { changes };
    };
    const insertBlock = (block: string, cursorOffset: number) => {
      const r = st.selection.main;
      const line = st.doc.lineAt(r.from);
      const before = line.text.trim() ? '\n\n' : '';
      const at = line.text.trim() ? line.to : line.from;
      return { changes: { from: at, insert: before + block }, selection: { anchor: at + before.length + cursorOffset } };
    };
    let spec;
    switch (cmd) {
      case 'bold':
        spec = wrap('**', '粗体');
        break;
      case 'italic':
        spec = wrap('*', '斜体');
        break;
      case 'strike':
        spec = wrap('~~', '删除线');
        break;
      case 'code':
        spec = wrap('`', 'code');
        break;
      case 'link':
        spec = st.changeByRange((r) => {
          const text = st.sliceDoc(r.from, r.to) || '链接文字';
          const insert = `[${text}](https://)`;
          const urlAt = r.from + text.length + 3;
          return { changes: { from: r.from, to: r.to, insert }, range: EditorSelection.range(urlAt, urlAt + 8) };
        });
        break;
      case 'image':
        spec = st.changeByRange((r) => {
          const alt = st.sliceDoc(r.from, r.to) || '图片说明';
          const insert = `![${alt}](./image.png)`;
          const at = r.from + alt.length + 4;
          return { changes: { from: r.from, to: r.to, insert }, range: EditorSelection.range(at, at + 11) };
        });
        break;
      case 'heading': {
        // 循环：无 → ## → ### → 无
        const l = st.doc.lineAt(st.selection.main.from);
        const m = /^(#{1,6})\s+/.exec(l.text);
        const lvl = m ? m[1].length : 0;
        const next = lvl === 0 ? '## ' : lvl === 2 ? '### ' : lvl >= 3 ? '' : '## ';
        spec = { changes: { from: l.from, to: l.from + (m ? m[0].length : 0), insert: next } };
        break;
      }
      case 'quote':
        spec = prefix(() => '> ', /^>\s?/);
        break;
      case 'ul':
        spec = prefix(() => '- ', /^\s*[-*+]\s+(?!\[[ xX]\])/);
        break;
      case 'ol':
        spec = prefix((i) => `${i + 1}. `, /^\s*\d+[.)]\s+/);
        break;
      case 'task':
        spec = prefix(() => '- [ ] ', /^\s*[-*+]\s+\[[ xX]\]\s+/);
        break;
      case 'table':
        spec = insertBlock('| 列 1 | 列 2 | 列 3 |\n| --- | --- | --- |\n|  |  |  |\n', 2);
        break;
      case 'codeblock':
        spec = insertBlock('```\n\n```\n', 4);
        break;
      case 'hr':
        spec = insertBlock('---\n', 4);
        break;
    }
    if (!spec) return false;
    v.dispatch(st.update({ ...spec, scrollIntoView: true, userEvent: 'input.format' }));
    v.focus();
    return true;
  }
}
