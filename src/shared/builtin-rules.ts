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
    native: { attr: ['data-theme', 'dark'] },
    invert: ['.ztext-math img', 'img[src*="/equation?tex="]', 'img[data-formula]'],
    ignore: ['.ZVideo-player', '.VideoAnswerPlayer', '.ZVideoItem-video', '[class*="VideoPlayer"]'],
    keepImage: ['.Avatar', 'img[src*="qrcode"]', '.signQr-container img'],
  },
  {
    match: ['*.bilibili.com'],
    mode: 'dynamic',
    ignore: [
      '.bpx-player-container',
      '#bilibili-player',
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
];
