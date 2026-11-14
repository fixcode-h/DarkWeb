/** 划词翻译里不依赖页面的纯函数，单独放出来便于单元测试 */
import { looksLikeTarget } from '../translate/lang';

/** 引擎吃的是 HTML 片段：选中的纯文字先转义 */
export function escapeHtml(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 选中的已经是目标语言时，反过来译成英文（目标是英文则译成中文） */
export function selectionTarget(text: string, target: string): string {
  if (!looksLikeTarget(text, target)) return target;
  return target.startsWith('en') ? 'zh-CN' : 'en';
}
