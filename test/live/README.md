# 真实站点验收

不进 CI（线上内容随时变化），在能访问知乎 / B 站的环境里手动跑：

```bash
npm run build
node test/live/run.mjs            # 截图和 report.json 在 test-results/live/
node test/live/native.mjs         # 不加载扩展，对比知乎原生夜间的几种开启方式
node test/live/inspect.mjs <url> '<js 表达式>' [截图名]   # 调试单个页面
node test/live/translate.mjs      # 用 Google 翻译真实页面，统计视口内漏翻的段落，截图在 test-results/live-tr/
```

`LIVE_PAGES='[["名字","url"],...]'` 可以换页面；翻译用 `TR_PAGES='[["名字","url","目标语言"],...]'`。

2026-11 核实结果：
- 知乎问题页、专栏文章对无头浏览器返回 403（反爬），只能验发现页、登录页、专栏首页。
- 知乎原生夜间由服务端按 cookie `themeApp=dark` 渲染；只设 `html[data-theme=dark]` 时顶栏和卡片仍是白的。
- B 站未登录访问 t.bilibili.com 偶尔被风控拦到“出错啦”页，先访问首页再访问即可。

2026-11-11 多网站实测（GitHub、YouTube、MDN、维基、HN、BBC、react.dev、Next.js、Vercel、shadcn、Tailwind、Python/Rust 文档、百度/百科、知乎、B 站、少数派、掘金、豆瓣、新浪、网易、腾讯新闻、微博、博客园等 50 个页面，加局域网 IP:端口页面）：
- react.dev（Tailwind v3 `rgb(… / var(--tw-bg-opacity))`）、Next.js / Vercel / shadcn（`hsl(var(--background))` 通道变量）、Tailwind v4（`oklch()`）曾大片发白或文字发黑，已修。
- 少数派的样式表 CDN 校验 Referer，后台直接拉取被 403，已改为失败时以页面身份重试。
- Stack Overflow、npm、Medium、CSDN 等对无头浏览器返回 403 / 人机验证页，验不了。
- 新浪、网易、百度、微博首页 DOMContentLoaded 本身要 5–10 秒（脚本多），首次上色晚是页面原因，期间有防闪白底色。
