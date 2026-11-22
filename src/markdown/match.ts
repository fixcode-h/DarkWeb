/**
 * 判断一个页面是不是“浏览器直接显示的 Markdown 源文件”。
 * 暗色引擎（content/index.ts）和 Markdown 检测脚本都用它，所以只放纯函数、不引别的模块，保持体积很小。
 */

const MD_EXT = /\.(md|markdown|mdown|mkd|mkdn)$/i;
const MD_TYPES = new Set(['text/markdown', 'text/x-markdown']);
/** 地址是 .md 结尾时，服务器常见的这几种类型浏览器都会按纯文本显示 */
const TEXT_TYPES = new Set(['text/plain', 'application/octet-stream', ...MD_TYPES]);

/** 地址的路径部分是否以 Markdown 扩展名结尾（查询串和锚点不算） */
export function isMarkdownPath(url: string): boolean {
  try {
    const u = new URL(url);
    return MD_EXT.test(decodeURIComponent(u.pathname));
  } catch {
    return false;
  }
}

/**
 * 页面是不是 Markdown 源文件：
 * - 服务器明确返回 text/markdown，或
 * - 地址以 .md 等结尾，并且浏览器把它当纯文本显示（file:// 下也是这样）
 */
export function isMarkdownDocument(url: string, contentType: string): boolean {
  if (!/^(https?|file):/i.test(url)) return false;
  const type = (contentType || '').toLowerCase();
  if (MD_TYPES.has(type)) return true;
  return TEXT_TYPES.has(type) && isMarkdownPath(url);
}

/** 根元素上的标记：pending 正在接管，render 已渲染，off 不接管（暗色引擎照常处理纯文本页） */
export const MD_ATTR = 'data-drak-md';
