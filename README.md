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
| `src/translate/` | 网页翻译：引擎（Google / 微软 / DeepL / AI 大模型）、后台调度、页面渲染、弹窗一栏与翻译设置页 |
| `src/popup/`、`src/options/`、`src/ui/` | 弹窗、设置页、两者共用的外观控件 |
| `test/unit/`、`test/e2e/` | 单元测试；端到端验收（本地仿真页面；`translate.mjs` 用本地假引擎验收翻译） |

## 使用

- 弹窗：全局开关、本站模式（自动 / 动态 / 原生 / 滤镜 / 关闭）、配色主题、亮度 / 对比度 / 饱和度 / 图片亮度、白底图降亮度、跟随系统、定时启用
- 配色主题：默认、纯黑（OLED）、柔和、暖色护眼、午夜蓝；只给中性色染色，品牌色和强调色保持原样
- 定时启用：设置起止时间（可跨午夜），时段外不注入任何脚本
- 快捷键 `Alt+Shift+D`：开关当前网站；`Alt+Shift+A`：全局开关
- 设置页：外观与启用条件、按站点的模式、站点修正规则（JSON，用户规则优先于内置规则）、设置导入导出、缓存管理

## 网页翻译

- 弹窗里点“翻译此页面”，或按 `Alt+Shift+T`，或右键“翻译此页面 / 显示原文”；再点一次还原
- 引擎：Google 翻译（默认）、微软翻译，两者免密钥、互为备用；DeepL 和 AI 大模型（OpenAI 兼容接口）需要在“翻译设置”里填自己的密钥
- 显示方式：双语对照（原文下方显示译文，默认）或仅显示译文；链接、加粗等行内格式保留，代码不翻译
- 只翻译视口附近的内容，滚动和页面新增内容自动跟进；已是目标语言的段落跳过
- “总是翻译此网站”按域名或 IP:端口识别，对该站点所有页面生效
