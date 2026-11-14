# Drak 暗色模式隐私政策

最后更新：2026-11-11

Drak 暗色模式（下称“本扩展”）是一个把网页重新配色为暗色的浏览器扩展，也提供可选的网页翻译功能。

## 我们不收集任何数据

本扩展没有服务器，不收集、不出售你的个人信息、浏览记录或网页内容。本扩展不含统计、广告或跟踪代码，也不加载远程代码。唯一会把内容发出设备的是你主动使用的网页翻译，见下一节。

## 网页翻译

只有在你点击“翻译此页面”、按快捷键、使用右键菜单，或把某个网站加入“总是翻译”之后，本扩展才会翻译该页面。翻译时：

划词翻译只在你选中文字后点开“译”图标（或设置成松开鼠标即翻译、或用右键“翻译选中的文字”）时，把选中的这段文字发给同一个翻译服务。

- **发送什么**：当前页面上可见区域附近需要翻译的文字（含链接、加粗等格式标记），以及目标语言。不发送网址、Cookie、表单输入框和可编辑区域里的内容。
- **发给谁**：只发给你在设置里选择的翻译服务：Google 翻译（`translate.googleapis.com`，默认）、微软翻译（`edge.microsoft.com`、`api-edge.cognitive.microsofttranslator.com`）、DeepL（`api.deepl.com` / `api-free.deepl.com`），或你自己填写的 AI 大模型接口地址。默认引擎不可用时，可能自动改用 Google 或微软中的另一个（可在设置里关闭）。这些服务按各自的隐私政策处理收到的文字。
- **密钥**：你填写的 DeepL 或 AI 大模型 API 密钥只保存在本机的 `chrome.storage.local`，只在请求对应服务时发送给该服务。
- **缓存**：译文只在浏览器运行期间缓存在内存里，不写入磁盘。

不使用翻译功能时，本扩展不会向任何翻译服务发送任何内容。

## 本扩展在你的设备上处理什么

为了给网页重新配色，本扩展需要在你的浏览器里读取并改写页面的样式。所有处理都在本机完成：

- **网页样式和图片**：读取页面的 CSS 和图片的颜色信息来计算暗色配色。个别跨域的样式表或图片无法在页面内直接读取时，扩展会在浏览器内再向它原本的地址请求一次。这个请求只发给该资源原来的服务器，结果只在本机用于配色，不会发给其他任何地方。
- **设置**：全局开关、各网站的模式、亮度与对比度、你写的站点规则、翻译设置、阅读增强设置（字体、滤镜等，全部在本地处理），保存在浏览器本地存储（`chrome.storage.local`）。
- **样式缓存**：为了避免页面打开时闪白，扩展会把每个网站算好的暗色样式缓存在本地存储里，可以在设置页清除。
- **网站的主题 Cookie**：少数网站（例如知乎）用 Cookie 来决定是否显示自带的暗色主题。在这些网站上，扩展可能会写入该网站自己的主题 Cookie 来切换到它的原生暗色；关闭后会恢复为原来的值。扩展不会读取或传出其他 Cookie。

除翻译时发给所选翻译服务的文字外，以上数据都只留在你的设备上。卸载扩展时，浏览器会一并删除扩展的本地数据。

## 权限说明

- **读取和更改所有网站上的数据**：暗色模式需要在你访问的每个网页上运行，才能改写它的颜色。
- **存储（storage、unlimitedStorage）**：保存设置和样式缓存。
- **脚本（scripting）**：按你的设置把配色脚本注入网页，并在你关闭某个网站时不再注入。
- **定时器（alarms）**：在你设定的时间段自动开关暗色模式。
- **右键菜单（contextMenus）**：在页面右键菜单里加入“翻译此页面 / 显示原文”。

## 变更

如果以后的版本增加了其他会把数据发送到设备之外的功能，我们会先更新本政策和商店页面上的数据披露，再发布该版本。

## 联系方式

有问题请在 GitHub 提 issue：<https://github.com/fixcode-h/DarkWeb/issues>

---

# Privacy Policy for Drak Dark Mode

Last updated: 2026-11-11

Drak Dark Mode ("the extension") recolors web pages into a dark theme and offers optional page translation.

**The extension does not collect or sell any personal data, browsing history or page content.** It has no backend server, contains no analytics, advertising or tracking code, and loads no remote code. The only content that leaves your device is page text you explicitly ask to translate.

**Page translation** runs only when you click "Translate this page", use the shortcut or context menu, or add a site to "Always translate". The visible text near the viewport (with link and emphasis markup) and the target language are sent only to the translation service you select: Google Translate (`translate.googleapis.com`, default), Microsoft Translator (`edge.microsoft.com`, `api-edge.cognitive.microsofttranslator.com`), DeepL (`api.deepl.com` / `api-free.deepl.com`), or an AI model endpoint you configure. If the selected engine fails, the other of Google or Microsoft may be used as a fallback (can be turned off). URLs, cookies, form inputs and editable areas are not sent. API keys you enter are stored only in `chrome.storage.local` and sent only to the matching service. Translations are cached in memory only.

Everything is processed locally in your browser:

- **Page styles and images** are read to compute dark colors. When a cross-origin stylesheet or image cannot be read from the page, the extension requests it again from its original URL inside the browser. The request goes only to that resource's original server, and the result is used only on your device.
- **Settings** (global switch, per-site mode, brightness, contrast, your custom site rules, translation settings) are stored in `chrome.storage.local`.
- **A style cache** per site is stored locally to avoid a white flash on page load. You can clear it on the options page.
- **Site theme cookies**: on a few sites that select their built-in dark theme by cookie (for example zhihu.com), the extension may set that site's own theme cookie and restores the original value when turned off. It does not read or transmit any other cookie.

Permissions: access to all websites is needed so dark mode can run on every page you visit; `storage` and `unlimitedStorage` hold settings and the style cache; `scripting` injects the recoloring script according to your settings; `alarms` switches dark mode on and off on the schedule you set; `contextMenus` adds "Translate this page / Show original" to the page context menu.

If a future version adds another feature that sends data off your device, this policy and the store listing's data disclosure will be updated before that version is released.

Contact: <https://github.com/fixcode-h/DarkWeb/issues>
