/**
 * Mermaid 画图库的单独入口（dist/markdown-mermaid.js）。markdown.js 发现文件里有 mermaid 代码块时请后台注入，
 * 两者在同一个内容脚本环境里，通过全局变量交接。
 */
import mermaid from 'mermaid';

(globalThis as { __drakMermaid?: typeof mermaid }).__drakMermaid = mermaid;
