# 发布到 Chrome 应用商店

分两部分：第一次上架要在网页上手动完成；之后每次 `main` 出新包，GitHub Actions 会自动上传并提交审核。

## 一、第一次上架（手动，一次性）

1. **注册开发者账号**。用 Google 账号打开[开发者后台](https://chrome.google.com/webstore/devconsole)，同意协议，支付一次性的 5 美元注册费。这个 Google 账号必须开启两步验证，否则不能发布。
2. **完善账号信息**。在 Account 页填写发布者名称、验证联系邮箱，并按要求声明是否为“交易者”（个人免费扩展一般选非交易者）。
3. **准备扩展包**。从 GitHub Releases 下载最新的 `drak-<版本>.zip`，或者本地运行 `BUILD_NUMBER=1 npm run build:release`，包在 `release/` 下。
4. **新建项目**。后台点 “New item”，上传 zip。
5. **填写页面**。按 [listing.md](listing.md) 填 Store listing、Privacy、Distribution 三个页面，素材在 [assets/](assets/)。
6. **提交审核**。点 “Submit for review”。本扩展申请了所有网站的访问权限，会进入更严格的人工审核，通常比普通扩展慢，可能需要几天到几周。审核结果会发到账号邮箱。
7. 审核通过后记下两个值，自动同步要用：
   - **扩展 ID**：商店链接或后台地址栏里那串 32 位小写字母
   - **Publisher ID**：后台 Account 页里

## 二、出新包自动同步

`.github/workflows/release.yml` 在 `main` 有新提交时会构建、验收、发 GitHub Release，最后运行 `scripts/cws-publish.mjs` 把同一个 zip 上传到商店并提交审核。审核通过后自动上架，用户的浏览器会自动更新。

没有配置下面的密钥时，这一步会直接跳过，不影响出包。

### 需要配置的密钥

在 GitHub 仓库的 Settings → Secrets and variables → Actions 里添加：

| Secret | 内容 |
| --- | --- |
| `CWS_PUBLISHER_ID` | 上面记下的 Publisher ID |
| `CWS_EXTENSION_ID` | 上面记下的扩展 ID |
| `CWS_SERVICE_ACCOUNT_KEY` | 服务账号 JSON 密钥文件的完整内容 |

**获取服务账号密钥（推荐，不会过期）**

1. 打开 [Google Cloud Console](https://console.cloud.google.com/)，新建一个项目（或选已有的）。
2. 搜索 “Chrome Web Store API”，点启用。
3. 进入 IAM 与管理 → 服务账号，创建一个服务账号，不用授予任何角色。
4. 打开这个服务账号 → 密钥 → 添加密钥 → 创建新密钥 → JSON，下载得到一个 `.json` 文件。
5. 回到 Chrome 开发者后台的 Account 页，把服务账号的邮箱（形如 `xxx@项目名.iam.gserviceaccount.com`）添加进去。每个发布者只能添加一个服务账号。
6. 把 `.json` 文件的全部内容粘贴成 `CWS_SERVICE_ACCOUNT_KEY`，然后删掉本地的文件。

**备选：OAuth refresh token**

如果 Cloud 项目不允许创建服务账号密钥，可以改用 OAuth，配置 `CWS_CLIENT_ID`、`CWS_CLIENT_SECRET`、`CWS_REFRESH_TOKEN` 三个 Secret 来代替 `CWS_SERVICE_ACCOUNT_KEY`。做法见[官方文档](https://developer.chrome.com/docs/webstore/using-api)。注意 OAuth 同意屏幕要发布为“正式版”，停留在“测试”状态时 refresh token 7 天就会失效。

### 版本号

商店要求每次上传的版本号都比上一次大。发布工作流会把 manifest 的版本号写成 `<package.json 的 version>.<工作流运行序号>`，例如 `0.1.0.42`，所以不用每次手动改版本号。要发 `0.2.0` 这样的正式版本时改 `package.json` 的 `version` 即可。

### 只上传不提交

想先在后台看一眼再手动提交审核，可以在仓库的 Actions Variables 里加 `CWS_PUBLISH=false`，这样每次只上传成草稿。

### 已知限制

- API 只能更新已有的项目，不能新建，也不能改商店页面的文字、截图和隐私声明。这些有变化时要到后台手动改。
- 上一个版本还在审核时又出了新包，脚本会撤回旧的提交，用新包重新提交，审核重新排队。`main` 合并得很频繁时，审核可能一直排不完，这时建议攒几个改动再合并，或者用 `CWS_PUBLISH=false` 改为手动提交。
- 新版本如果新增了权限，或者功能和商店页面的声明对不上，会被拒。加功能前先看 [listing.md](listing.md) 最后一节。

### 手动同步

```bash
BUILD_NUMBER=<比上次大的数字> npm run build:release
CWS_PUBLISHER_ID=... CWS_EXTENSION_ID=... CWS_SERVICE_ACCOUNT_KEY="$(cat key.json)" npm run store:publish
```
