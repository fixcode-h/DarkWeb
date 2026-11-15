/**
 * 侧边快捷按钮的样式和图标。
 * 配色、圆角、动效照 AgentPanel 的默认配色（Claude Code）：中性灰面板、蓝色强调、120ms snap 进场、弹簧曲线。
 */
export const SIZE = 36;
/** 平时露出的宽度：贴在右边缘的半个标签，鼠标移上去整个滑出 */
export const PEEK = 22;
/** 小按钮（阅读模式、屏蔽、暗色）的高度 */
const TOOL = 32;

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

/** 图标取自 Lucide（与 AgentPanel 相同的图标集） */
export const ICONS = {
  reader: svg(
    '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  ),
  picker: svg(
    '<path d="M12.03 12.68a.5.5 0 0 1 .65-.65l9 3.5a.5.5 0 0 1-.03.94l-3.45 1.07a1 1 0 0 0-.66.66l-1.07 3.44a.5.5 0 0 1-.94.03z"/><path d="M5 3a2 2 0 0 0-2 2"/><path d="M19 3a2 2 0 0 1 2 2"/><path d="M5 21a2 2 0 0 1-2-2"/><path d="M9 3h1"/><path d="M9 21h2"/><path d="M14 3h1"/><path d="M3 9v1"/><path d="M21 9v2"/><path d="M3 14v1"/>',
  ),
  moon: svg('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>'),
  sun: svg(
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  ),
  close: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
};

export const CSS = `
:host { all: initial; }
.wrap {
  --card: #1f1f1f; --pop: #303030; --fg: #ececec; --muted: #c6c6c6; --subtle: #9c9c9c;
  --edge: rgb(255 255 255 / .1); --hover: rgb(255 255 255 / .07); --active: rgb(255 255 255 / .11);
  --accent: #257de0; --accent-text: #6aabf1; --on-accent: #fff;
  --shadow-pop: 0 8px 24px rgb(0 0 0 / .32), 0 2px 6px rgb(0 0 0 / .2);
  --shadow-tab: 0 2px 8px rgb(0 0 0 / .28);
  --ease-snap: cubic-bezier(.32, .72, 0, 1); --ease-spring: cubic-bezier(.34, 1.3, .64, 1);
  position: fixed; z-index: 2147483646; top: 0; right: 0; display: flex; flex-direction: column; align-items: flex-end; gap: 6px;
  transform: translateY(-${SIZE / 2}px); font: 12px/1.4 system-ui, -apple-system, "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif;
  -webkit-user-select: none; user-select: none; color-scheme: dark;
}
/* 按钮在屏幕下半部分时，小按钮排到“译”的上面，不出屏 */
.wrap.up { flex-direction: column-reverse; transform: translateY(calc(-100% + ${SIZE / 2}px)); }
@media (prefers-color-scheme: light) {
  .wrap {
    --card: #fff; --pop: #fff; --fg: #191919; --muted: #404040; --subtle: #6b6b6b;
    --edge: rgb(0 0 0 / .1); --hover: rgb(0 0 0 / .05); --active: rgb(0 0 0 / .09); --accent-text: #1757ac;
    --shadow-pop: 0 8px 24px rgb(0 0 0 / .12), 0 2px 6px rgb(0 0 0 / .08);
    --shadow-tab: 0 2px 8px rgb(0 0 0 / .1);
    color-scheme: light;
  }
}

/* ---- 贴边标签：“译”和下面的小按钮共用 ---- */
.tab {
  all: unset; position: relative; box-sizing: border-box; flex: none; cursor: pointer; display: grid; place-items: center;
  border: 1px solid var(--edge); border-right: 0; background: var(--card); color: var(--muted);
  transition: transform 200ms var(--ease-snap), opacity 120ms, background 60ms, color 60ms;
}
.tab::before { content: ""; position: absolute; inset: 0; border-radius: inherit; background: transparent; transition: background 60ms; }
.tab:hover { color: var(--fg); }
.tab:hover::before { background: var(--hover); }
.tab:active::before { background: var(--active); }
.tab:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.tab > * { position: relative; }

/* 提示文字：鼠标停在哪个按钮上，左边就显示它是做什么的 */
.tab[data-tip]::after {
  content: attr(data-tip); position: absolute; right: calc(100% + 8px); top: 50%; padding: 4px 8px; border-radius: 6px;
  background: var(--pop); color: var(--fg); border: 1px solid var(--edge); box-shadow: var(--shadow-pop); white-space: pre; font-weight: 400;
  opacity: 0; transform: translate(4px, -50%); pointer-events: none; transition: opacity 60ms, transform 60ms;
}
.tab[data-tip]:hover::after, .tab[data-tip]:focus-visible::after {
  opacity: 1; transform: translate(0, -50%); transition: opacity 120ms var(--ease-snap) 300ms, transform 120ms var(--ease-snap) 300ms;
}
.dragging .tab::after { display: none; }

/* “译”：主按钮，平时露出一半 */
.btn {
  width: ${SIZE + 6}px; height: ${SIZE}px; border-radius: ${SIZE / 2}px 0 0 ${SIZE / 2}px; padding-right: 6px;
  box-shadow: var(--shadow-pop); font-weight: 600; font-size: 14px; touch-action: none;
  transform: translateX(${SIZE + 6 - PEEK}px); opacity: .6;
}
.label { transition: transform 200ms var(--ease-spring); }
.open .btn, .on .btn, .dragging .btn { transform: none; opacity: 1; }
.btn:active .label { transform: scale(.9); transition-duration: 60ms; }
.dragging .btn { cursor: grabbing; }
.on .btn { background: var(--accent); border-color: transparent; color: var(--on-accent); }
.on .btn:hover::before { background: rgb(255 255 255 / .1); }
.ring {
  position: absolute; inset: 5px 11px 5px 5px; border-radius: 50%; border: 2px solid transparent; border-top-color: var(--accent);
  opacity: 0; transition: opacity 120ms; animation: spin .8s linear infinite;
}
.on .ring { border-top-color: var(--on-accent); }
.busy .ring { opacity: 1; }
@keyframes spin { to { transform: rotate(360deg); } }

/* 小按钮：平时露出一条边，鼠标移到这一列上依次滑出，点了直接生效 */
.tool {
  width: ${TOOL + 4}px; height: ${TOOL}px; border-radius: ${TOOL / 2}px 0 0 ${TOOL / 2}px; padding-right: 4px; box-shadow: var(--shadow-tab);
  transform: translateX(${TOOL + 4 - 27}px); opacity: .6;
  transition-delay: calc(var(--i, 0) * 25ms);
}
.tool svg { width: 15px; height: 15px; }
.open .tool { transform: none; opacity: 1; }
.dragging .tool { opacity: 0; transform: translateX(100%); }
.tool.dark-on { color: var(--accent-text); }
.tool[aria-disabled="true"] { cursor: default; }
.tool[aria-disabled="true"] svg { opacity: .45; }
/* 隐藏按钮：平时不露出，展开时才出现，比别的小一号 */
.hide {
  width: 26px; height: 22px; border-radius: 11px 0 0 11px; padding-right: 2px; color: var(--subtle); box-shadow: var(--shadow-tab);
  transform: translateX(100%); opacity: 0; pointer-events: none; transition-delay: calc(var(--i, 0) * 25ms);
}
.hide svg { width: 12px; height: 12px; }
.open .hide { transform: none; opacity: 1; }
.open:not(.dragging) .hide { pointer-events: auto; }

@media (prefers-reduced-motion: reduce) { .tab, .label, .tab::after { transition: none !important; } }
@media print { .wrap { display: none; } }
`;

export const TOOLS_HTML = `
<button class="tab tool" type="button" data-act="reader" style="--i:1" data-tip="阅读模式" aria-label="阅读模式">${ICONS.reader}</button>
<button class="tab tool" type="button" data-act="picker" style="--i:2" data-tip="屏蔽页面元素" aria-label="屏蔽页面元素">${ICONS.picker}</button>
<button class="tab tool" type="button" data-act="dark" style="--i:3" role="switch"></button>
<button class="tab hide" type="button" data-act="site" style="--i:4" data-tip="本站隐藏这列按钮\n可在弹窗里恢复" aria-label="本站隐藏">${ICONS.close}</button>`;
