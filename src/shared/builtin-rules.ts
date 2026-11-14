import type { SiteRule } from './rules';

/**
 * 内置站点规则。选择器来自对线上页面结构的已知信息，站点改版后可由用户规则覆盖。
 * 知乎原生夜间模式的开关方式（html[data-theme=dark]）未在线上验证；
 * 若开启后页面仍是浅色，内容脚本会自动退回 dynamic 模式。
 */
export const BUILTIN_RULES: SiteRule[] = [
  {
    match: ['*.zhihu.com'],
    mode: 'native',
    // 知乎夜间主题由服务端按 cookie themeApp=dark 渲染；只设 data-theme 时顶栏和卡片仍是白的（2026-11 线上核实）
    native: { attr: ['data-theme', 'dark'], cookie: ['themeApp', 'dark'] },
    invert: ['.ztext-math img', 'img[src*="/equation?tex="]', 'img[data-formula]'],
    ignore: ['.ZVideo-player', '.VideoAnswerPlayer', '.ZVideoItem-video', '[class*="VideoPlayer"]'],
    keepImage: ['.Avatar', 'img[src*="qrcode"]', '.signQr-container img'],
  },
  {
    match: ['*.bilibili.com'],
    mode: 'dynamic',
    ignore: [
      // 只排除画面和浮层；整个 .bpx-player-container 排除会让下方弹幕发送栏保持白色（2026-11 线上核实）
      '.bpx-player-video-area',
      '.bpx-player-dialog-area',
      '.bpx-player-tooltip-area',
      '.bpx-player-context-area',
      '.bilibili-player',
      '#live-player',
      '.live-player-mounter',
      '.bili-header__banner',
    ],
    keepImage: [
      '.bili-video-card__cover img',
      '.bili-video-card__image img',
      '.v-img img',
      '.bili-avatar img',
      'img[src*="qrcode"]',
      '.login-scan-box img',
    ],
  },
  {
    match: ['*.baidu.com'],
    mode: 'dynamic',
    // 首页“百度热搜”标题是透明底深灰字 + 红色“搜”的 PNG，彩色部分让自动分类判成保留，深底上看不清（2026-11 线上核实）
    invert: ['.hot-title-icon'],
  },
];
