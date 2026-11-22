/**
 * Markdown 页面样式。配色、圆角、工具条照阅读模式（enhance/reader.ts）和弹窗（popup/ui.css），三个主题共用一套变量。
 */
export const MD_CSS = String.raw`
:root {
  --sans: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
  --mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, "DejaVu Sans Mono", monospace;
  --ease-snap: cubic-bezier(.32, .72, 0, 1);
}
.md-app {
  --bg: #171717; --pop: #262626; --field: #252525; --fg: #e6e6e6; --muted: #c6c6c6; --subtle: #9c9c9c;
  --edge: rgb(255 255 255 / .1); --hover: rgb(255 255 255 / .07); --active: rgb(255 255 255 / .11);
  --accent: #257de0; --link: #6aabf1; --code-bg: rgb(255 255 255 / .06); --pre-bg: #121212; --inline-code: #e9b77a;
  --primary: #efefef; --on-primary: #191919; --warn: #e49c06;
  --shadow-pop: 0 8px 24px rgb(0 0 0 / .32), 0 2px 6px rgb(0 0 0 / .2);
  --md-editor-bg: #141414; --md-gutter: #4d4d4d; --md-active-line: rgb(255 255 255 / .04); --md-selection: rgb(37 125 224 / .35); --md-match: rgb(37 125 224 / .18);
  --md-syn-heading: #6aabf1; --md-syn-em: #e9b77a; --md-syn-link: #6aabf1; --md-syn-code: #a5d6a7; --md-syn-quote: #a5d6a7; --md-syn-mark: #c792ea;
  --hl-keyword: #c792ea; --hl-string: #a5d6a7; --hl-title: #82aaff; --hl-number: #f78c6c; --hl-comment: #6b6b6b; --hl-attr: #ffcb6b; --hl-meta: #89ddff;
  --hl-add: rgb(83 197 86 / .14); --hl-del: rgb(241 119 120 / .14);
  color-scheme: dark;
}
.md-app.light {
  --bg: #fbfbfa; --pop: #fff; --field: #f2f2f2; --fg: #1f1f1f; --muted: #404040; --subtle: #6b6b6b;
  --edge: rgb(0 0 0 / .1); --hover: rgb(0 0 0 / .05); --active: rgb(0 0 0 / .09);
  --link: #1757ac; --code-bg: rgb(0 0 0 / .05); --pre-bg: #f5f5f4; --inline-code: #a3410c;
  --primary: #191919; --on-primary: #fff; --warn: #b26b00;
  --shadow-pop: 0 8px 24px rgb(0 0 0 / .12), 0 2px 6px rgb(0 0 0 / .08);
  --md-editor-bg: #fff; --md-gutter: #b5b5b5; --md-active-line: rgb(0 0 0 / .035); --md-selection: rgb(37 125 224 / .22); --md-match: rgb(37 125 224 / .12);
  --md-syn-heading: #1757ac; --md-syn-em: #a3410c; --md-syn-link: #1757ac; --md-syn-code: #2e7d32; --md-syn-quote: #2e7d32; --md-syn-mark: #8e44ad;
  --hl-keyword: #8e44ad; --hl-string: #2e7d32; --hl-title: #1f5fbf; --hl-number: #b4530f; --hl-comment: #8a8a8a; --hl-attr: #9a6700; --hl-meta: #0b7285;
  --hl-add: rgb(46 139 74 / .12); --hl-del: rgb(207 34 46 / .1);
  color-scheme: light;
}
.md-app.sepia {
  --bg: #f4ecd8; --pop: #fbf6ea; --field: #efe5cc; --fg: #3b2f22; --muted: #5b4a37; --subtle: #85725c;
  --edge: rgb(80 60 30 / .16); --hover: rgb(80 60 30 / .07); --active: rgb(80 60 30 / .12);
  --link: #8a4b14; --code-bg: rgb(80 60 30 / .08); --pre-bg: #efe6cf; --inline-code: #8a4b14;
  --primary: #3b2f22; --on-primary: #fbf6ea; --warn: #9a5b00;
  --shadow-pop: 0 8px 24px rgb(80 60 30 / .14), 0 2px 6px rgb(80 60 30 / .08);
  --md-editor-bg: #f8f1e1; --md-gutter: #b8a68a; --md-active-line: rgb(80 60 30 / .05); --md-selection: rgb(138 75 20 / .2); --md-match: rgb(138 75 20 / .12);
  --md-syn-heading: #8a4b14; --md-syn-em: #9a3412; --md-syn-link: #8a4b14; --md-syn-code: #4d6b1f; --md-syn-quote: #4d6b1f; --md-syn-mark: #7c3a8a;
  --hl-keyword: #7c3a8a; --hl-string: #4d6b1f; --hl-title: #1d5a8a; --hl-number: #9a3412; --hl-comment: #9a8a70; --hl-attr: #8a5a00; --hl-meta: #1d6a6a;
  --hl-add: rgb(77 107 31 / .12); --hl-del: rgb(160 40 30 / .1);
  color-scheme: light;
}
html, body { margin: 0; height: 100%; }
body { overflow: hidden; }
.md-app {
  position: fixed; inset: 0; display: flex; flex-direction: column;
  background: var(--bg); color: var(--fg); font: 14px/1.5 var(--sans);
  --md-editor-size: 14px;
}
.md-app * { box-sizing: border-box; }
.md-app [hidden] { display: none !important; }
.md-app button { font: inherit; color: inherit; }

/* 顶栏 */
.md-top { flex: none; height: 52px; display: flex; align-items: center; gap: 10px; padding: 0 14px; border-bottom: 1px solid var(--edge); }
.md-file { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 13px; color: var(--subtle); }
.md-file svg { width: 16px; height: 16px; flex: none; }
.md-file b { color: var(--fg); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 32vw; }
.md-file .meta { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.md-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--warn); flex: none; }
.md-spacer { flex: 1; }
.md-seg { display: flex; gap: 2px; padding: 3px; border-radius: 8px; background: var(--hover); }
.md-seg button { all: unset; cursor: pointer; height: 26px; padding: 0 12px; border-radius: 6px; font-size: 12.5px; color: var(--subtle); display: grid; place-items: center; transition: background 60ms, color 60ms; }
.md-seg button:hover { color: var(--fg); }
.md-seg button[aria-pressed="true"] { background: var(--active); color: var(--fg); }
.md-bar { display: flex; align-items: center; gap: 2px; padding: 3px; background: var(--pop); border: 1px solid var(--edge); border-radius: 10px; }
.md-bar button, .md-fmt button {
  all: unset; box-sizing: border-box; cursor: pointer; min-width: 28px; height: 28px; padding: 0 7px; border-radius: 7px;
  display: grid; place-items: center; color: var(--muted); font-size: 13px; white-space: nowrap; transition: background 60ms, color 60ms;
}
.md-bar button:hover, .md-bar button:focus-visible, .md-fmt button:hover, .md-fmt button:focus-visible { background: var(--hover); color: var(--fg); }
.md-bar button:active, .md-fmt button:active { background: var(--active); }
.md-bar button[aria-pressed="true"] { background: var(--active); color: var(--fg); }
.md-bar button:disabled { opacity: .35; cursor: default; background: none; }
.md-bar svg, .md-fmt svg { width: 15px; height: 15px; }
.md-sep { width: 1px; height: 18px; background: var(--edge); margin: 0 3px; flex: none; }
.md-btn {
  all: unset; box-sizing: border-box; cursor: pointer; height: 30px; padding: 0 12px; border-radius: 7px; display: flex; align-items: center; gap: 6px;
  font-size: 13px; white-space: nowrap; border: 1px solid var(--edge); color: var(--muted); transition: background 60ms, filter 60ms;
}
.md-btn:hover { background: var(--hover); color: var(--fg); }
.md-btn.primary { background: var(--primary); color: var(--on-primary); border-color: transparent; font-weight: 600; }
.md-btn.primary:hover { filter: brightness(.92); }
.md-btn svg { width: 14px; height: 14px; }
.md-btn kbd { font: 11.5px var(--sans); opacity: .55; font-weight: 400; }
.md-btn:focus-visible, .md-seg button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

/* 草稿恢复提示 */
.md-banner { flex: none; display: flex; align-items: center; gap: 12px; padding: 8px 16px; font-size: 13px; border-bottom: 1px solid var(--edge); background: color-mix(in srgb, var(--warn) 10%, var(--bg)); }
.md-banner span { flex: 1; color: var(--muted); }
.md-banner .md-btn { height: 26px; }

/* 格式工具条 */
.md-fmt { flex: none; height: 40px; display: flex; align-items: center; gap: 2px; padding: 0 10px; border-bottom: 1px solid var(--edge); overflow: hidden; }
.md-fmt .hint { margin-left: auto; padding-left: 12px; font-size: 12px; color: var(--subtle); white-space: nowrap; }

/* 主体 */
.md-main { flex: 1; min-height: 0; display: flex; }
.md-toc { width: 260px; flex: none; border-right: 1px solid var(--edge); padding: 18px 10px; overflow: auto; font-size: 13px; overscroll-behavior: contain; }
.md-toc h6 { margin: 0 8px 10px; font-size: 11px; letter-spacing: .06em; color: var(--subtle); font-weight: 600; }
.md-toc a { display: block; padding: 5px 10px; border-radius: 6px; color: var(--subtle); text-decoration: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: background 60ms, color 60ms; }
.md-toc a:hover { background: var(--hover); color: var(--fg); }
.md-toc a.l2 { padding-left: 24px; } .md-toc a.l3 { padding-left: 38px; font-size: 12.5px; }
.md-toc a.on { background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--link); }
.md-toc .stat { margin: 16px 10px 0; padding-top: 12px; border-top: 1px solid var(--edge); font-size: 12px; color: var(--subtle); line-height: 1.8; }
.md-editor { flex: 1; min-width: 0; border-right: 1px solid var(--edge); background: var(--md-editor-bg); }
.md-preview { flex: 1; min-width: 0; overflow: auto; overscroll-behavior: contain; scroll-behavior: auto; }
.md-page { margin: 0 auto; padding: 36px 32px 30vh; }
.md-app[data-view="split"] .md-page { padding: 26px 34px 30vh; max-width: none !important; }
.md-app[data-view="read"] .md-editor, .md-app[data-view="read"] .md-fmt, .md-app[data-view="read"] .md-status { display: none; }
.md-app[data-view="source"] .md-preview, .md-app:not([data-view="read"]) .md-toc { display: none; }
.md-app[data-view="source"] .md-editor { border-right: 0; }
.md-app[data-notoc] .md-toc { display: none; }
.md-app:not([data-view="read"]) [data-only="read"], .md-app[data-view="read"] [data-only="edit"] { display: none !important; }
.md-app:not([data-view="split"]) [data-only="split"] { display: none !important; }

/* 状态栏 */
.md-status { flex: none; height: 26px; display: flex; align-items: center; gap: 18px; padding: 0 14px; border-top: 1px solid var(--edge); font-size: 11.5px; color: var(--subtle); white-space: nowrap; overflow: hidden; }
.md-status .r { margin-left: auto; }

/* 弹层 */
.md-toast { position: absolute; right: 20px; bottom: 40px; width: 340px; max-width: calc(100vw - 32px); background: var(--pop); border: 1px solid var(--edge); border-radius: 10px; box-shadow: var(--shadow-pop); padding: 12px 14px; font-size: 13px; z-index: 10; animation: md-in 160ms var(--ease-snap); }
.md-toast b { display: block; margin-bottom: 4px; }
.md-toast p { margin: 0 0 10px; color: var(--subtle); font-size: 12.5px; line-height: 1.6; }
.md-toast .row { display: flex; gap: 8px; justify-content: flex-end; }
.md-toast.small { width: auto; padding: 8px 14px; }
.md-toast.small p { margin: 0; color: var(--muted); }
@keyframes md-in { from { opacity: 0; transform: translateY(6px); } }

/* 正文 */
.md-body { font-size: 16px; line-height: 1.8; color: var(--fg); word-wrap: break-word; }
.md-body > :first-child { margin-top: 0 !important; }
.md-body h1, .md-body h2, .md-body h3, .md-body h4, .md-body h5, .md-body h6 { line-height: 1.35; font-weight: 650; margin: 1.6em 0 .6em; scroll-margin-top: 16px; }
.md-body h1 { font-size: 1.9em; padding-bottom: .3em; border-bottom: 1px solid var(--edge); margin-top: .4em; }
.md-body h2 { font-size: 1.45em; padding-bottom: .25em; border-bottom: 1px solid var(--edge); }
.md-body h3 { font-size: 1.2em; } .md-body h4 { font-size: 1.05em; } .md-body h5, .md-body h6 { font-size: .95em; color: var(--muted); }
.md-body p, .md-body ul, .md-body ol, .md-body blockquote, .md-body table, .md-body pre, .md-body details, .md-body dl { margin: .8em 0; }
.md-body a { color: var(--link); text-decoration: underline; text-decoration-color: color-mix(in srgb, var(--link) 40%, transparent); text-underline-offset: 3px; }
.md-body a:hover { text-decoration-color: var(--link); }
.md-body strong { font-weight: 650; }
.md-body del { color: var(--subtle); }
.md-body img, .md-body video { max-width: 100%; height: auto; border-radius: 6px; }
.md-body code, .md-body kbd, .md-body samp { font-family: var(--mono); font-size: .86em; }
.md-body :not(pre) > code { background: var(--code-bg); color: var(--inline-code); padding: .12em .4em; border-radius: 4px; }
.md-body kbd { padding: 1px 6px; border: 1px solid var(--edge); border-bottom-width: 2px; border-radius: 4px; background: var(--code-bg); }
.md-body pre { position: relative; background: var(--pre-bg); border: 1px solid var(--edge); border-radius: 8px; padding: 12px 14px; overflow: auto; font-size: .88em; line-height: 1.65; }
.md-body pre code { font-size: inherit; background: none; padding: 0; color: var(--fg); }
.md-body pre[data-lang]::before { content: attr(data-lang); position: absolute; right: 10px; top: 6px; font: 11px var(--sans); color: var(--subtle); }
.md-body blockquote { padding: 4px 0 4px 16px; border-left: 3px solid var(--accent); color: var(--muted); background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 7%, transparent), transparent 70%); }
.md-body blockquote > :first-child { margin-top: 0; } .md-body blockquote > :last-child { margin-bottom: 0; }
.md-body ul, .md-body ol { padding-left: 1.6em; }
.md-body li { margin: .25em 0; }
.md-body li > p { margin: .3em 0; }
.md-body li.task-item { list-style: none; }
.md-body li.task-item > p:first-child, .md-body li.task-item:not(:has(> p)) { text-indent: 0; }
.md-body .task-box { display: inline-grid; place-items: center; vertical-align: -2px; width: 15px; height: 15px; margin: 0 8px 0 -1.4em; border-radius: 4px; border: 1.5px solid var(--subtle); cursor: pointer; transition: background 60ms, border-color 60ms; }
.md-body .task-box:hover { border-color: var(--link); }
.md-body .task-box.checked { background: var(--accent); border-color: var(--accent); }
.md-body .task-box.checked::after { content: ""; width: 7px; height: 4px; border: 2px solid #fff; border-top: 0; border-right: 0; transform: rotate(-45deg) translate(1px, -1px); }
.md-body table { border-collapse: collapse; display: block; width: max-content; max-width: 100%; overflow: auto; font-size: .92em; }
.md-body th, .md-body td { border: 1px solid var(--edge); padding: 6px 12px; text-align: left; }
.md-body th[style*="center"], .md-body td[style*="center"] { text-align: center; }
.md-body th { background: var(--code-bg); font-weight: 600; }
.md-body tr:nth-child(even) td { background: color-mix(in srgb, var(--code-bg) 40%, transparent); }
.md-body hr { border: 0; height: 1px; background: var(--edge); margin: 2em 0; }
.md-body details { padding: 6px 12px; border: 1px solid var(--edge); border-radius: 8px; }
.md-body summary { cursor: pointer; color: var(--muted); }
.md-body .footnotes { font-size: .88em; color: var(--muted); }
.md-body .footnote-ref a, .md-body .footnote-backref { text-decoration: none; }
.md-body [align="center"] { text-align: center; } .md-body [align="right"] { text-align: right; }
.md-body .md-empty { color: var(--subtle); text-align: center; padding: 80px 0; }

/* 代码高亮（highlight.js 的类名） */
.hljs-keyword, .hljs-selector-tag, .hljs-built_in, .hljs-type, .hljs-literal { color: var(--hl-keyword); }
.hljs-string, .hljs-regexp, .hljs-symbol, .hljs-template-variable, .hljs-addition { color: var(--hl-string); }
.hljs-title, .hljs-section, .hljs-function .hljs-title, .hljs-title.function_ { color: var(--hl-title); }
.hljs-number, .hljs-variable, .hljs-params, .hljs-link { color: var(--hl-number); }
.hljs-comment, .hljs-quote { color: var(--hl-comment); font-style: italic; }
.hljs-attr, .hljs-attribute, .hljs-name, .hljs-selector-class, .hljs-selector-id { color: var(--hl-attr); }
.hljs-meta, .hljs-tag, .hljs-subst, .hljs-operator { color: var(--hl-meta); }
.hljs-addition { background: var(--hl-add); display: inline-block; width: 100%; }
.hljs-deletion { color: inherit; background: var(--hl-del); display: inline-block; width: 100%; }
.hljs-emphasis { font-style: italic; } .hljs-strong { font-weight: 700; }

/* 窄屏：目录收起，分栏改成上下 */
@media (max-width: 900px) {
  .md-toc { display: none; }
  .md-app[data-view="split"] .md-main { flex-direction: column; }
  .md-app[data-view="split"] .md-editor { border-right: 0; border-bottom: 1px solid var(--edge); }
  .md-fmt .hint, .md-file .meta, .md-bar [data-act="width"] { display: none; }
}
@media (max-width: 640px) {
  .md-top { gap: 6px; padding: 0 8px; }
  .md-bar, .md-btn:not(.primary) { display: none; }
  .md-page { padding: 20px 16px 30vh; }
}

@media print {
  body { overflow: visible; }
  .md-app { position: static; display: block; background: #fff; color: #000; }
  .md-top, .md-fmt, .md-toc, .md-editor, .md-status, .md-banner, .md-toast { display: none !important; }
  .md-preview { overflow: visible; }
  .md-app[data-view] .md-preview { display: block !important; }
  .md-page { padding: 0; max-width: none !important; }
}
`;
