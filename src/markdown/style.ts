import LOOKS_CSS from './mermaid/mermaid-looks.css';
import SEQ_CSS from './mermaid/mermaid-seq.css';
import MERMAID_CSS from './mermaid/mermaid.css';

/**
 * Markdown 页面样式。配色、圆角、工具条照阅读模式（enhance/reader.ts）和弹窗（popup/ui.css），三个主题共用一套变量。
 */
export const MD_CSS = String.raw`
:root {
  --sans: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
  --mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, "DejaVu Sans Mono", monospace;
  --ease-snap: cubic-bezier(.32, .72, 0, 1);
}
/*
 * 三套主题的配色。深色、浅色照 fixcode-h/agent-panel 的面板配色（index.css 的 :root / .dark），
 * 正文里的标题分级、列表符号、提示块、Mermaid 节点共用一组色相（--md-gold…），和 agent-panel 的 Markdown 样式一致。
 * 顶栏、目录、编辑器这些外壳沿用原来的变量名（--edge、--hover…），取值跟着换。
 */
.md-app {
  --bg: #262624; --panel: #232321; --card: #30302e; --pop: #30302e; --field: #2b2b29;
  --line: #3b3a37; --line-strong: #4a4945; --sel: #353532;
  --fg: #cccbc6; --fg-bright: #eeeeed; --muted: #c3c1b8; --subtle: #a09e95;
  --edge: var(--line); --hover: rgb(255 255 255 / .05); --active: var(--sel);
  --accent: #d97757; --link: var(--md-blue); --code-bg: #1f1f1d; --pre-bg: var(--code-bg); --code-chip-fg: #f0a08a; --inline-code: var(--code-chip-fg);
  --primary: #efefef; --on-primary: #191919; --warn: #e3a752;
  --shadow-pop: 0 12px 36px -8px rgb(0 0 0 / .55), 0 0 0 .5px rgb(255 255 255 / .06);
  --md-editor-bg: #222220; --md-gutter: #5a5955; --md-active-line: rgb(255 255 255 / .035); --md-selection: color-mix(in oklab, #d97757 40%, transparent); --md-match: rgb(217 119 87 / .2);
  --md-syn-heading: var(--md-blue); --md-syn-em: var(--md-sand); --md-syn-link: var(--md-blue); --md-syn-code: var(--code-chip-fg); --md-syn-quote: var(--md-teal); --md-syn-mark: var(--md-violet);
  --hl-comment: #7f7d75; --hl-keyword: #c792ea; --hl-string: #a5d28a; --hl-number: #f0a868; --hl-func: #82aaff; --hl-type: #e5c07b; --hl-attr: #f07f6c; --hl-tag: #f07f6c; --hl-del: #ec7a64;
  --md-gold: #f2c46d; --md-blue: #6aabf1; --md-violet: #b7a1ff; --md-teal: #6fd6bd; --md-coral: #f0937a; --md-gray: #8b8b8b; --md-bright: var(--fg-bright); --md-sand: #e9cf9f;
  --md-dot: rgb(255 255 255 / .05);
  --mmd-node-a: #24324a; --mmd-node-b: #1a2230; --mmd-node-line: #46699a; --mmd-pick-a: #2e2742; --mmd-pick-b: #211c30; --mmd-pick-line: #6b5aa0;
  --mmd-end-a: #1f3a33; --mmd-end-b: #17271f; --mmd-end-line: #3f8a75; --mmd-note: #2a2418; --mmd-note-line: #7a6232; --mmd-crit: #2e1f1b; --mmd-crit-line: #8a4a3a; --mmd-edge: #7a7a7a;
  --md-pre-bg: var(--code-bg); --app-sans: var(--sans);
  /* Mermaid：agent-panel 的默认外观（素净风格、圆角连线、步骤式时序图） */
  --md-mermaid-look: soft; --md-mermaid-curve: rounded; --md-mermaid-edge: 1.5px; --md-mermaid-radius: 8px; --md-mermaid-pad: 8px;
  --md-mermaid-motion: 1; --md-mermaid-hover: 1; --md-mermaid-gradient: 1; --md-mermaid-grid: radial-gradient(var(--md-dot) 1px, transparent 1px);
  --md-mermaid-seq: steps; --md-mermaid-seqColor: 1; --md-mermaid-seqText: 14px; --md-mermaid-seqNote: auto;
  color-scheme: dark;
}
.md-app.light, .md-app.sepia {
  --bg: #faf9f5; --panel: #f6f5f0; --card: #fff; --pop: #fff; --field: #fff;
  --line: #e7e4da; --line-strong: #d5d1c4; --sel: #ebe8df;
  --fg: #1f1e1c; --fg-bright: #0f0f12; --muted: #55534d; --subtle: #66645c;
  --hover: rgb(0 0 0 / .045);
  --accent: #c6613f; --code-bg: #f7f6f1; --code-chip-fg: #a83f22;
  --primary: #191919; --on-primary: #fff; --warn: #935b0c;
  --shadow-pop: 0 10px 30px -10px rgb(60 50 30 / .25), 0 0 0 .5px rgb(60 50 30 / .08);
  --md-editor-bg: #fff; --md-gutter: #b5b2a8; --md-active-line: rgb(0 0 0 / .03); --md-selection: rgb(198 97 63 / .18); --md-match: rgb(198 97 63 / .11);
  --hl-comment: #8a877d; --hl-keyword: #a626a4; --hl-string: #3f7f3a; --hl-number: #b4560f; --hl-func: #2f63c0; --hl-type: #a06a00; --hl-attr: #b0412f; --hl-tag: #c2412d; --hl-del: #b4372b;
  --md-gold: #a86b0c; --md-blue: #1f6fd1; --md-violet: #6a4fc4; --md-teal: #13866d; --md-coral: #c4532f; --md-gray: #6b6b6b; --md-bright: var(--fg-bright); --md-sand: #8a5a10;
  --md-dot: rgb(0 0 0 / .07);
  --mmd-node-a: #f2f7fe; --mmd-node-b: #e1ecfb; --mmd-node-line: #7fa6d9; --mmd-pick-a: #f5f1fe; --mmd-pick-b: #e9e2fa; --mmd-pick-line: #a593dc;
  --mmd-end-a: #eefaf6; --mmd-end-b: #dcf2ea; --mmd-end-line: #6fb9a6; --mmd-note: #fbf1de; --mmd-note-line: #d1a75a; --mmd-crit: #fbe9e3; --mmd-crit-line: #df9a83; --mmd-edge: #8a8a92;
  color-scheme: light;
}
/* 护眼：浅色那套换成米黄纸色，色相不变 */
.md-app.sepia {
  --bg: #f4ecd8; --panel: #efe5cc; --card: #fbf6ea; --pop: #fbf6ea; --field: #efe5cc;
  --line: #e0d3b4; --line-strong: #cdbd98; --sel: #e8dcc0;
  --fg: #3b2f22; --fg-bright: #24190e; --muted: #5b4a37; --subtle: #85725c;
  --code-bg: #efe6cf; --code-chip-fg: #8a4b14;
  --primary: #3b2f22; --on-primary: #fbf6ea;
  --md-editor-bg: #f8f1e1; --md-gutter: #b8a68a;
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
.md-page { position: relative; margin: 0 auto; padding: 40px 48px 30vh; }
/* 正文两侧的拖动条：平时只是透明的热区，悬停/拖动时显示一条细线 */
.md-grip { position: absolute; top: 0; bottom: 0; width: 14px; cursor: col-resize; z-index: 2; touch-action: none; }
.md-grip.l { left: 0; } .md-grip.r { right: 0; }
.md-grip::after { content: ""; position: absolute; top: 0; bottom: 0; width: 2px; border-radius: 1px; background: var(--accent); opacity: 0; transition: opacity 120ms; }
.md-grip.l::after { left: 0; } .md-grip.r::after { right: 0; }
.md-grip:hover::after, .md-resizing .md-grip::after { opacity: .55; }
.md-resizing, .md-resizing * { cursor: col-resize !important; user-select: none !important; }
.md-wtip { position: fixed; transform: translateX(-50%); padding: 4px 10px; border-radius: 6px; background: var(--pop); border: 1px solid var(--edge); box-shadow: var(--shadow-pop); font-size: 12px; color: var(--muted); z-index: 5; pointer-events: none; }
.md-bar .md-wbtn { display: inline-flex; gap: 4px; align-items: center; }
.md-wbtn span { font-size: 12px; font-variant-numeric: tabular-nums; }
.md-app[data-view="split"] .md-page { padding: 26px 34px 30vh; max-width: none !important; }
.md-app:not([data-view="read"]) .md-grip { display: none; }
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

/*
 * 正文：照搬 fixcode-h/agent-panel 的 Markdown 样式（index.css 里的 .chat-md，取它的默认值）。
 * 尺寸都按正文字号 --md-base 算（页面按「A− / A+」写在 .md-body 上）。
 */
.md-body {
  --md-base: 17px;
  font-size: var(--md-base); line-height: 1.7; color: var(--fg); overflow-wrap: break-word;
  text-autospace: normal; text-spacing-trim: normal;
}
.md-body > * { margin-block: calc(.72 * var(--md-base)); }
.md-body p { margin-block: calc(.75 * var(--md-base)); }
.md-body > :first-child, .md-body p:first-child { margin-top: 0; }
.md-body > :last-child, .md-body p:last-child { margin-bottom: 0; }
.md-body p, .md-body li, .md-body blockquote, .md-body td { text-wrap: pretty; }

/* 标题：每级一个色相 + 装饰（一级短标尺、二级竖条、三级菱形、四级短横） */
.md-body :is(h1, h2, h3, h4, h5, h6) { line-height: 1.375; scroll-margin-top: 16px; text-wrap: balance; font-weight: 600; }
.md-body :is(h1, h2, h3, h4, h5, h6)::before { content: ''; display: none; margin-right: .55em; vertical-align: middle; translate: 0 -.08em; background: currentColor; }
.md-body h1 {
  font-size: calc(1.5 * var(--md-base)); font-weight: 700; color: var(--md-gold);
  margin: calc(1.6 * var(--md-base)) 0 calc(.7 * var(--md-base)); padding-bottom: 10px;
  background:
    linear-gradient(currentColor, currentColor) left bottom / calc(3.2 * var(--md-base)) 3px no-repeat,
    linear-gradient(var(--line), var(--line)) left calc(100% - 1px) / 100% 1px no-repeat;
}
.md-body h2 { font-size: calc(1.28 * var(--md-base)); color: var(--md-blue); margin: calc(1.5 * var(--md-base)) 0 calc(.6 * var(--md-base)); }
.md-body h2::before { display: inline-block; width: 3px; height: .9em; border-radius: 3px; }
.md-body h3 { font-size: calc(1.12 * var(--md-base)); color: var(--md-violet); margin: calc(1.3 * var(--md-base)) 0 calc(.5 * var(--md-base)); }
.md-body h3::before { display: inline-block; width: .42em; height: .42em; rotate: 45deg; border-radius: 1px; }
.md-body h4 { font-size: var(--md-base); color: var(--md-teal); margin: calc(1.1 * var(--md-base)) 0 calc(.4 * var(--md-base)); }
.md-body h4::before { display: inline-block; width: .7em; height: 2px; border-radius: 2px; }
.md-body h5 { font-size: calc(.95 * var(--md-base)); color: var(--md-coral); margin: var(--md-base) 0 calc(.35 * var(--md-base)); }
.md-body h6 { font-size: calc(.82 * var(--md-base)); color: var(--md-gray); margin: var(--md-base) 0 calc(.3 * var(--md-base)); letter-spacing: .06em; }
.md-body > :is(h1, h2, h3, h4, h5, h6):first-child { margin-top: 0; }

.md-body :is(strong, b) { font-weight: 600; color: var(--md-bright); }
.md-body em { color: var(--md-sand); }
.md-body del { color: var(--subtle); }
.md-body a { color: var(--md-blue); text-decoration: underline; text-underline-offset: 2px; text-decoration-color: color-mix(in srgb, currentColor 40%, transparent); }
.md-body a:hover { text-decoration-color: currentColor; }

/* 列表：符号蓝、序号金色加粗 */
.md-body ul { list-style-type: disc; padding-left: calc(1.5 * var(--md-base)); }
.md-body ol { list-style-type: decimal; padding-left: calc(1.5 * var(--md-base)); }
.md-body :is(ul, ol) { margin-block: calc(.57 * var(--md-base)); }
.md-body li { padding-left: 2px; margin-block: calc(.28 * var(--md-base)); }
.md-body li > p { margin-block: calc(.28 * var(--md-base)); }
.md-body ul > li::marker { color: var(--md-blue); }
.md-body ol > li::marker { color: var(--md-gold); font-weight: 700; }
.md-body li > :is(ul, ol) { margin-block: calc(.28 * var(--md-base)); }
/* 任务列表：勾选框青色，勾掉的项变淡 */
.md-body li.task-item { list-style: none; }
.md-body li.task-item:has(.task-box.checked) { opacity: .55; }
.md-body .task-box { display: inline-grid; place-items: center; vertical-align: -2px; width: 15px; height: 15px; margin: 0 8px 0 -1.4em; border-radius: 4px; border: 1.5px solid var(--subtle); cursor: pointer; transition: background 60ms, border-color 60ms; }
.md-body .task-box:hover { border-color: var(--md-teal); }
.md-body .task-box.checked { background: var(--md-teal); border-color: var(--md-teal); }
.md-body .task-box.checked::after { content: ""; width: 7px; height: 4px; border: 2px solid var(--bg); border-top: 0; border-right: 0; transform: rotate(-45deg) translate(1px, -1px); }

/* 分隔线：两头渐隐 */
.md-body hr { border: 0; height: 1px; background: linear-gradient(90deg, transparent, var(--line-strong) 20%, var(--line-strong) 80%, transparent); margin-block: calc(1.6 * var(--md-base)); }

/* 引用：蓝色左线 + 淡蓝底；引用里再引用换紫色 */
.md-body blockquote { border-left: 3px solid var(--md-blue); color: var(--muted); background: color-mix(in srgb, var(--md-blue) 11%, transparent); border-radius: 0 8px 8px 0; padding: .55em 1em; margin-inline: 0; }
.md-body blockquote > :first-child { margin-top: 0; } .md-body blockquote > :last-child { margin-bottom: 0; }
.md-body blockquote blockquote { border-left-color: var(--md-violet); background: color-mix(in srgb, var(--md-violet) 6%, transparent); }
/* 提示块：> [!NOTE] / [!TIP] / [!IMPORTANT] / [!WARNING] / [!CAUTION] */
.md-body .md-alert { --alert: var(--md-blue); border: 1px solid color-mix(in srgb, var(--alert) 28%, transparent); border-left: 3px solid var(--alert); background: color-mix(in srgb, var(--alert) 7%, transparent); border-radius: 0 8px 8px 0; padding: .6em 1em; }
.md-body .md-alert[data-kind='tip'] { --alert: var(--md-teal); }
.md-body .md-alert[data-kind='important'] { --alert: var(--md-violet); }
.md-body .md-alert[data-kind='warning'] { --alert: var(--md-gold); }
.md-body .md-alert[data-kind='caution'] { --alert: var(--md-coral); }
.md-body .md-alert > .md-alert-title { display: flex; align-items: center; gap: 6px; margin: 0 0 2px; font-weight: 600; color: var(--alert); font-size: calc(.86 * var(--md-base)); letter-spacing: .04em; }
.md-body .md-alert > :last-child { margin-bottom: 0; }

/* 图片：单独一张带替代文字的图，文字放在下面当图注 */
.md-body img, .md-body video { max-width: 100%; height: auto; }
.md-body .md-fig { display: block; }
.md-body .md-fig img { border-radius: 8px; border: 1px solid var(--line); }
.md-body .md-cap { display: block; margin-top: 6px; text-align: center; font: 12.5px/1.5 var(--sans); color: var(--subtle); }

/* 行内代码：带细边框的小标签 */
.md-body code, .md-body kbd, .md-body samp { font-family: var(--mono); }
.md-body :not(pre) > code { font-size: calc(.86 * var(--md-base)); padding: 1px 5px; color: var(--code-chip-fg); background: color-mix(in srgb, var(--code-chip-fg) 9%, transparent); border: 1px solid color-mix(in srgb, var(--code-chip-fg) 18%, var(--line)); border-radius: 5px; word-spacing: normal; }
.md-body kbd { font-size: .86em; padding: 1px 6px; border: 1px solid var(--line-strong); border-bottom-width: 2px; border-radius: 5px; background: var(--sel); }

/* 代码块：一张卡片，顶栏是语言、行数、折行、复制，左边行号 */
.md-body .md-code, .md-body > pre, .md-body .md-mermaid { overflow: hidden; margin-block: calc(.86 * var(--md-base)); background: var(--code-bg); border: 1px solid var(--line); border-radius: 10px; }
.md-body .md-code-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; border-bottom: 1px solid var(--line); padding: 6px 8px 6px 14px; font: 12px/1.5 var(--sans); color: var(--subtle); background: color-mix(in srgb, var(--fg) 2%, transparent); }
.md-body .md-code-lang { display: flex; min-width: 0; align-items: center; gap: 6px; }
.md-body .md-code-lang::before { content: ''; width: 6px; height: 6px; flex: none; border-radius: 50%; background: var(--md-teal); }
.md-body .md-mermaid .md-code-lang::before { background: var(--md-violet); }
.md-body .md-code-lang small { font-size: 12px; opacity: .8; }
.md-body .md-code-acts { display: flex; flex: none; align-items: center; gap: 2px; }
.md-body .md-copy { all: unset; cursor: pointer; border-radius: 6px; padding: 2px 6px; font-size: 12px; color: var(--subtle); transition: background 120ms, color 120ms; }
.md-body .md-copy:hover { background: var(--sel); color: var(--fg); }
.md-body .md-copy[data-on] { color: var(--md-teal); }
.md-body .swap { display: inline-grid; place-items: center; }
.md-body .swap > * { grid-area: 1 / 1; transition: opacity 120ms var(--ease-snap), transform 300ms var(--ease-snap); }
.md-body .swap > :last-child, .md-body .swap[data-done] > :first-child { opacity: 0; transform: scale(.5); }
.md-body .swap[data-done] > :last-child { opacity: 1; transform: none; }
.md-body pre { --pre-pad: 14px; margin: 0; overflow-x: auto; padding: 12px var(--pre-pad); font-family: var(--mono); font-size: calc(.86 * var(--md-base)); line-height: 1.7; word-spacing: normal; }
.md-body pre code { white-space: pre; overflow-wrap: normal; counter-reset: md-ln; color: var(--fg); }
.md-body .md-code[data-wrap] pre code { white-space: pre-wrap; }
.md-body .md-ln { display: inline-block; min-width: 100%; --ln-tint: transparent; background: var(--ln-tint); }
.md-body .md-ln::before {
  counter-increment: md-ln; content: counter(md-ln); display: inline-block; position: sticky; z-index: 1; left: 0;
  text-align: right; user-select: none; width: calc(2.2em + 12px); padding-right: 24px; margin-right: 0;
  box-shadow: calc(-1 * var(--pre-pad)) 0 0 0 var(--code-bg);
  color: color-mix(in srgb, var(--subtle) 65%, transparent);
  --ln-line: color-mix(in srgb, var(--line) 70%, transparent);
  background: linear-gradient(var(--ln-line), var(--ln-line)) right 12px top 0 / 1px 100% no-repeat, linear-gradient(var(--ln-tint), var(--ln-tint)), var(--code-bg);
}
.md-body .md-code[data-lines='1'] .md-ln::before { display: none; }
.md-body .md-ln:hover { --ln-tint: color-mix(in srgb, var(--fg) 3%, transparent); }
.md-body .md-ln.md-add { --ln-tint: color-mix(in srgb, var(--md-teal) 11%, transparent); }
.md-body .md-ln.md-del { --ln-tint: color-mix(in srgb, var(--md-coral) 11%, transparent); }
.md-body .md-ln.md-add::before { color: var(--md-teal); }
.md-body .md-ln.md-del::before { color: var(--md-coral); }

/* 表格：圆角外框、表头浅底、细横线、隔行底色，太宽时横向滚动 */
.md-body .md-table { position: relative; width: fit-content; max-width: 100%; margin-block: calc(.86 * var(--md-base)); }
.md-body table { display: block; width: max-content; max-width: 100%; overflow: auto; border-collapse: separate; border-spacing: 0; margin: 0; font-size: calc(.93 * var(--md-base)); border: 1px solid var(--line); border-radius: 8px; }
.md-body :is(th, td) { padding: calc(.43 * var(--md-base)) calc(.86 * var(--md-base)); border: 0 solid var(--line); border-bottom-width: 1px; text-align: left; }
.md-body th { white-space: nowrap; color: var(--md-bright); font-weight: 600; background: color-mix(in srgb, var(--fg) 4%, var(--bg)); border-bottom-color: var(--line-strong); }
.md-body td { vertical-align: top; }
.md-body :is(th, td)[align="center"] { text-align: center; }
.md-body :is(th, td)[align="right"] { text-align: right; font-variant-numeric: tabular-nums; }
.md-body tr:last-child td { border-bottom-width: 0; }
.md-body tbody tr { transition: background 120ms; }
.md-body tbody tr:nth-child(even) { background: color-mix(in srgb, var(--fg) 2.5%, transparent); }
.md-body tbody tr:hover { background: color-mix(in srgb, var(--fg) 3%, transparent); }

.md-body details { padding: 6px 12px; border: 1px solid var(--line); border-radius: 8px; }
.md-body .md-mermaid details { padding: 0; border: 0; border-top: 1px solid var(--line); border-radius: 0; margin: 0; }
.md-body summary { cursor: pointer; color: var(--muted); }
.md-body .footnotes { font-size: .88em; color: var(--muted); }
.md-body .footnotes-sep { margin-top: calc(2 * var(--md-base)); }
.md-body .footnote-ref a, .md-body .footnote-backref { text-decoration: none; }
.md-body [align="center"] { text-align: center; } .md-body [align="right"] { text-align: right; }
.md-body .md-empty { color: var(--subtle); text-align: center; padding: 80px 0; }

/* 代码高亮（highlight.js 的类名），配色同 agent-panel */
.hljs-comment, .hljs-quote { color: var(--hl-comment); font-style: italic; }
.hljs-keyword, .hljs-selector-tag, .hljs-doctag, .hljs-meta .hljs-keyword { color: var(--hl-keyword); }
.hljs-string, .hljs-regexp, .hljs-addition, .hljs-meta .hljs-string { color: var(--hl-string); }
.hljs-number, .hljs-literal, .hljs-symbol, .hljs-bullet { color: var(--hl-number); }
.hljs-title, .hljs-title.function_, .hljs-section { color: var(--hl-func); }
.hljs-type, .hljs-title.class_, .hljs-built_in, .hljs-selector-class { color: var(--hl-type); }
.hljs-attr, .hljs-attribute, .hljs-variable, .hljs-template-variable, .hljs-property, .hljs-params { color: var(--hl-attr); }
.hljs-tag, .hljs-name, .hljs-selector-id, .hljs-meta { color: var(--hl-tag); }
.hljs-deletion { color: var(--hl-del); }
.hljs-emphasis { font-style: italic; } .hljs-strong { font-weight: 600; }

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
  .md-top, .md-fmt, .md-toc, .md-grip, .md-editor, .md-status, .md-banner, .md-toast { display: none !important; }
  .md-preview { overflow: visible; }
  .md-app[data-view] .md-preview { display: block !important; }
  .md-page { padding: 0; max-width: none !important; }
}
`
  + MERMAID_CSS + LOOKS_CSS + SEQ_CSS;
