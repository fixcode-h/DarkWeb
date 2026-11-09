# 真实站点验收

不进 CI（线上内容随时变化），在能访问知乎 / B 站的环境里手动跑：

```bash
npm run build
node test/live/run.mjs            # 截图和 report.json 在 test-results/live/
node test/live/native.mjs         # 不加载扩展，对比知乎原生夜间的几种开启方式
node test/live/inspect.mjs <url> '<js 表达式>' [截图名]   # 调试单个页面
```

`LIVE_PAGES='[["名字","url"],...]'` 可以换页面。

2026-11 核实结果：
- 知乎问题页、专栏文章对无头浏览器返回 403（反爬），只能验发现页、登录页、专栏首页。
- 知乎原生夜间由服务端按 cookie `themeApp=dark` 渲染；只设 `html[data-theme=dark]` 时顶栏和卡片仍是白的。
- B 站未登录访问 t.bilibili.com 偶尔被风控拦到“出错啦”页，先访问首页再访问即可。
