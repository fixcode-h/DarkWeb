# DarkWeb (Drak)

通用自适应暗色模式浏览器插件（Chrome / Edge，Manifest V3）。按颜色在页面中的角色（背景、文字、边框、阴影、强调色）在 OKLCH 色彩空间里重新配色，保留边框和层次，不做整页反色。

## 分支

- `dev`：日常开发，推送后跑 CI（类型检查、单元测试、端到端验收）
- `main`：发布分支，合并后 GitHub Actions 自动构建、验收并发布扩展包（Releases 里的 `drak-<版本>.zip`）

## 本地开发

```bash
npm install
npm run build        # 输出到 dist/，在 chrome://extensions 里“加载已解压的扩展程序”选 dist
npm test             # 颜色引擎单元测试
npm run test:e2e     # 构建后在本地仿真的知乎 / B 站页面上跑端到端验收
```

首次运行端到端测试前需要 `npx playwright install chromium`。

## 目录

| 路径 | 内容 |
| --- | --- |
| `src/content/engine/` | 颜色解析与 OKLCH 映射、CSS 值改写、样式表改写 |
| `src/content/` | 内容脚本：调度、Shadow DOM、内联样式、图片分析、自检与降级、防闪白基础层 |
| `src/content/probe.ts` | 页面世界探针：捕获 `attachShadow`、`insertRule`、`adoptedStyleSheets` |
| `src/background/sw.ts` | 动态注册内容脚本、跨域样式表与图片代理、快捷键 |
| `src/shared/` | 设置、站点规则（含知乎 / B 站内置规则）、图片分类 |
| `src/popup/`、`src/options/` | 弹窗与设置页 |
| `test/unit/`、`test/e2e/` | 单元测试；端到端验收（本地仿真页面） |

## 使用

- 弹窗：全局开关、本站模式（自动 / 动态 / 原生 / 滤镜 / 关闭）、亮度与对比度、白底图降亮度、跟随系统
- 快捷键 `Alt+Shift+D`：开关当前网站
- 设置页：按站点修正规则（JSON），用户规则优先于内置规则
