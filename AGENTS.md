# AGENTS.md

给在这个仓库里干活的 AI 编程助手（以及人）看的约定。项目介绍、目录结构见 [README.md](README.md)。

## 分支和发布流程

所有开发都走这一条路，不要例外：

1. **从 `dev` 拉分支开发**。新功能、修 bug、改文档都一样，不要从 `main` 拉分支，也不要直接在 `main` 上改。
2. **合回 `dev`**。开 PR 到 `dev`，CI（类型检查、单元测试、端到端验收）通过后合并。
3. **`dev` 合到 `main` 出包**。开一个 `dev` → `main` 的 PR 并合并。`main` 每有新提交，`.github/workflows/release.yml` 会自动：
   - 再跑一遍类型检查、单元测试、端到端验收
   - 生成发布说明，构建并发布 GitHub Release，附两个包：
     - `drak-<版本>.zip`：manifest 带 `key`，本地“加载已解压的扩展程序”时 ID 固定
     - `drak-<版本>-store.zip`：不带 `key`，上传 Chrome 应用商店用（带 `key` 的包会被商店拒）
   - 配好 `CWS_*` Secrets 后，把商店版自动上传到 Chrome 应用商店并提交审核，见 [docs/store/README.md](docs/store/README.md)

不要往 `main` 直接 push，也不要从功能分支直接开 PR 到 `main`。

## 版本号

- 包的版本号是 `<package.json 的 version>.<发布工作流运行序号>`，每次出包自动递增，不用手动改。
- 要发 `0.3.0` 这样的正式版本时，在 `dev` 上改 `package.json` 的 `version`。

## 提交前自检

```bash
npm run typecheck
npm test
npm run test:e2e   # 首次需要 npx playwright install chromium
```

或者一次跑完：`npm run check`。

## 其他约定

- 文档、注释、提交信息、PR 描述都用中文。
- 密钥（商店凭据等）只放在 GitHub Secrets，不要写进代码、文档或提交记录。
- 新增扩展权限或改变功能范围前，先看 [docs/store/listing.md](docs/store/listing.md) 最后一节，和商店页面的声明对不上会被拒审。
