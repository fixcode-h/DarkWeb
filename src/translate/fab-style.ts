/**
 * 侧边悬浮按钮的样式和图标。
 * 配色、圆角、动效照 AgentPanel 的默认配色（Claude Code）：中性灰面板、蓝色强调、10px 浮层圆角、7px 菜单项、120ms snap 进场。
 */
export const SIZE = 36;
/** 平时露出的宽度：贴在右边缘的半个标签，鼠标移上去整个滑出 */
export const PEEK = 22;

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

/** 图标取自 Lucide（与 AgentPanel 相同的图标集） */
export const ICONS = {
  translate: svg('<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>'),
  reader: svg(
    '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  ),
  picker: svg(
    '<path d="M12.03 12.68a.5.5 0 0 1 .65-.65l9 3.5a.5.5 0 0 1-.03.94l-3.45 1.07a1 1 0 0 0-.66.66l-1.07 3.44a.5.5 0 0 1-.94.03z"/><path d="M5 3a2 2 0 0 0-2 2"/><path d="M19 3a2 2 0 0 1 2 2"/><path d="M5 21a2 2 0 0 1-2-2"/><path d="M9 3h1"/><path d="M9 21h2"/><path d="M14 3h1"/><path d="M3 9v1"/><path d="M21 9v2"/><path d="M3 14v1"/>',
  ),
  moon: svg('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>'),
};

export const CSS = `
:host { all: initial; }
.wrap {
  --card: #1f1f1f; --pop: #303030; --fg: #ececec; --muted: #c6c6c6; --subtle: #9c9c9c;
  --edge: rgb(255 255 255 / .1); --line: rgb(255 255 255 / .08); --line-strong: #4a4a4a;
  --hover: rgb(255 255 255 / .07); --active: rgb(255 255 255 / .11); --kbd: rgb(255 255 255 / .06);
  --accent: #257de0; --accent-text: #6aabf1; --on-accent: #fff;
  --shadow-pop: 0 8px 24px rgb(0 0 0 / .32), 0 2px 6px rgb(0 0 0 / .2);
  --ease-snap: cubic-bezier(.32, .72, 0, 1); --ease-spring: cubic-bezier(.34, 1.3, .64, 1);
  position: fixed; z-index: 2147483646; top: 0; right: 0; display: flex; flex-direction: row-reverse; align-items: center; gap: 8px;
  transform: translateY(-50%); font: 13px/1.4 system-ui, -apple-system, "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif;
  -webkit-user-select: none; user-select: none; color-scheme: dark;
}
@media (prefers-color-scheme: light) {
  .wrap {
    --card: #fff; --pop: #fff; --fg: #191919; --muted: #404040; --subtle: #6b6b6b;
    --edge: rgb(0 0 0 / .1); --line: rgb(0 0 0 / .08); --line-strong: #d4d4d4;
    --hover: rgb(0 0 0 / .05); --active: rgb(0 0 0 / .09); --kbd: rgb(0 0 0 / .05); --accent-text: #1757ac;
    --shadow-pop: 0 8px 24px rgb(0 0 0 / .12), 0 2px 6px rgb(0 0 0 / .08);
    color-scheme: light;
  }
}

/* ---- 贴边按钮 ---- */
.btn {
  position: relative; box-sizing: border-box; width: ${SIZE + 6}px; height: ${SIZE}px; border-radius: ${SIZE / 2}px 0 0 ${SIZE / 2}px; padding: 0 6px 0 0;
  border: 1px solid var(--edge); border-right: 0; background: var(--card); color: var(--muted);
  box-shadow: var(--shadow-pop); cursor: pointer;
  display: grid; place-items: center; font-weight: 600; font-size: 14px; touch-action: none;
  transform: translateX(${SIZE + 6 - PEEK}px); opacity: .6;
  transition: transform 200ms var(--ease-snap), opacity 120ms, background 60ms, color 60ms;
}
.btn::before { content: ""; position: absolute; inset: 0; border-radius: inherit; background: transparent; transition: background 60ms; }
.label { position: relative; transition: transform 200ms var(--ease-spring); }
.open .btn, .on .btn, .dragging .btn { transform: none; opacity: 1; }
.btn:hover { color: var(--fg); }
.btn:hover::before { background: var(--hover); }
.btn:active::before { background: var(--active); }
.btn:active .label { transform: scale(.9); transition-duration: 60ms; }
.dragging .btn { cursor: grabbing; }
.on .btn { background: var(--accent); border-color: transparent; color: var(--on-accent); }
.on .btn:hover::before { background: rgb(255 255 255 / .1); }
.btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.ring {
  position: absolute; inset: 5px 11px 5px 5px; border-radius: 50%; border: 2px solid transparent; border-top-color: var(--accent);
  opacity: 0; transition: opacity 120ms; animation: spin .8s linear infinite;
}
.on .ring { border-top-color: var(--on-accent); }
.busy .ring { opacity: 1; }
@keyframes spin { to { transform: rotate(360deg); } }

/* ---- 悬停菜单 ---- */
.menu {
  box-sizing: border-box; width: 236px; display: flex; flex-direction: column; padding: 4px; border-radius: 10px;
  background: var(--pop); border: 1px solid var(--edge); box-shadow: var(--shadow-pop); color: var(--fg);
  opacity: 0; visibility: hidden; pointer-events: none; transform: translateY(var(--dy, 0px)) scale(.96); transform-origin: right center;
  transition: opacity 60ms, transform 60ms, visibility 0s 60ms;
}
.open:not(.dragging) .menu {
  opacity: 1; visibility: visible; pointer-events: auto; transform: translateY(var(--dy, 0px));
  transition: opacity 120ms var(--ease-snap), transform 120ms var(--ease-snap), visibility 0s;
}
.item {
  all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; gap: 10px; min-height: 32px;
  padding: 6px 10px; border-radius: 7px; white-space: nowrap; color: var(--fg); transition: background 60ms;
}
.item svg { width: 15px; height: 15px; flex: none; color: var(--subtle); transition: color 60ms; }
.item:hover, .item:focus-visible { background: var(--hover); }
.item:hover svg { color: var(--muted); }
.item:active { background: var(--active); }
.item[aria-disabled="true"] { cursor: default; }
.item[aria-disabled="true"]:hover { background: transparent; }
.text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.hint { font-size: 11.5px; color: var(--subtle); }
.hint:empty { display: none; }
.on-tr [data-act="translate"] svg { color: var(--accent-text); }
kbd {
  margin-left: auto; padding: 1px 5px; border-radius: 4px; background: var(--kbd); color: var(--subtle);
  font: 11px/16px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.sep { height: 1px; margin: 4px 6px; background: var(--line); }

/* 开关：照 AgentPanel 的 Switch，34x18，滑块用弹簧曲线 */
.switch { position: relative; flex: none; width: 30px; height: 18px; border-radius: 9px; background: var(--line-strong); transition: background 120ms var(--ease-snap); }
.switch::after {
  content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff;
  box-shadow: 0 1px 2px rgb(0 0 0 / .2); transition: transform 200ms var(--ease-spring);
}
.dark-on .switch { background: var(--accent); }
.dark-on .switch::after { transform: translateX(12px); }
[aria-disabled="true"] .switch { opacity: .5; }

/* 底部：隐藏悬浮按钮 */
.foot { display: flex; align-items: center; gap: 2px; padding: 4px 4px 2px 10px; color: var(--subtle); font-size: 12px; }
.foot span { flex: 1; }
.chip {
  all: unset; box-sizing: border-box; cursor: pointer; padding: 3px 8px; border-radius: 6px; color: var(--muted); font-size: 12px;
  transition: background 60ms, color 60ms;
}
.chip:hover, .chip:focus-visible { background: var(--hover); color: var(--fg); }
.chip:active { background: var(--active); }

@media (prefers-reduced-motion: reduce) { .btn, .menu, .label, .switch, .switch::after, .open:not(.dragging) .menu { transition: none; } }
@media print { .wrap { display: none; } }
`;

export const MENU_HTML = `
<div class="menu" role="menu">
  <button class="item" type="button" role="menuitem" data-act="translate">${ICONS.translate}<span class="text"><span class="tr-label">翻译此页面</span></span><kbd>Alt+Shift+T</kbd></button>
  <button class="item" type="button" role="menuitem" data-act="reader">${ICONS.reader}<span class="text">阅读模式</span></button>
  <button class="item" type="button" role="menuitem" data-act="picker">${ICONS.picker}<span class="text">屏蔽页面元素</span></button>
  <div class="sep"></div>
  <button class="item" type="button" role="menuitemcheckbox" data-act="dark">${ICONS.moon}<span class="text">本站暗色<span class="hint"></span></span><span class="switch"></span></button>
  <div class="sep"></div>
  <div class="foot"><span>隐藏悬浮按钮</span><button class="chip" type="button" data-act="site">本站</button><button class="chip" type="button" data-act="all">全部</button></div>
</div>`;
