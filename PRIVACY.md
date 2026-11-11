# Drak 暗色模式隐私政策

最后更新：2026-11-11

Drak 暗色模式（下称“本扩展”）是一个把网页重新配色为暗色的浏览器扩展。

## 我们不收集任何数据

本扩展没有服务器，不收集、不上传、不出售、不与任何第三方共享你的个人信息、浏览记录或网页内容。本扩展不含统计、广告或跟踪代码，也不加载远程代码。

## 本扩展在你的设备上处理什么

为了给网页重新配色，本扩展需要在你的浏览器里读取并改写页面的样式。所有处理都在本机完成：

- **网页样式和图片**：读取页面的 CSS 和图片的颜色信息来计算暗色配色。个别跨域的样式表或图片无法在页面内直接读取时，扩展会在浏览器内再向它原本的地址请求一次。这个请求只发给该资源原来的服务器，结果只在本机用于配色，不会发给其他任何地方。
- **设置**：全局开关、各网站的模式、亮度与对比度、你写的站点规则，保存在浏览器本地存储（`chrome.storage.local`）。
- **样式缓存**：为了避免页面打开时闪白，扩展会把每个网站算好的暗色样式缓存在本地存储里，可以在设置页清除。
- **网站的主题 Cookie**：少数网站（例如知乎）用 Cookie 来决定是否显示自带的暗色主题。在这些网站上，扩展可能会写入该网站自己的主题 Cookie 来切换到它的原生暗色；关闭后会恢复为原来的值。扩展不会读取或传出其他 Cookie。

以上数据都只留在你的设备上。卸载扩展时，浏览器会一并删除扩展的本地数据。

## 权限说明

- **读取和更改所有网站上的数据**：暗色模式需要在你访问的每个网页上运行，才能改写它的颜色。
- **存储（storage、unlimitedStorage）**：保存设置和样式缓存。
- **脚本（scripting）**：按你的设置把配色脚本注入网页，并在你关闭某个网站时不再注入。

## 变更

如果以后的版本增加了会把数据发送到设备之外的功能，我们会先更新本政策和商店页面上的数据披露，再发布该版本。

## 联系方式

有问题请在 GitHub 提 issue：<https://github.com/fixcode-h/DarkWeb/issues>

---

# Privacy Policy for Drak Dark Mode

Last updated: 2026-11-11

Drak Dark Mode ("the extension") recolors web pages into a dark theme.

**The extension does not collect, transmit, sell or share any personal data, browsing history or page content.** It has no backend server, contains no analytics, advertising or tracking code, and loads no remote code.

Everything is processed locally in your browser:

- **Page styles and images** are read to compute dark colors. When a cross-origin stylesheet or image cannot be read from the page, the extension requests it again from its original URL inside the browser. The request goes only to that resource's original server, and the result is used only on your device.
- **Settings** (global switch, per-site mode, brightness, contrast, your custom site rules) are stored in `chrome.storage.local`.
- **A style cache** per site is stored locally to avoid a white flash on page load. You can clear it on the options page.
- **Site theme cookies**: on a few sites that select their built-in dark theme by cookie (for example zhihu.com), the extension may set that site's own theme cookie and restores the original value when turned off. It does not read or transmit any other cookie.

Permissions: access to all websites is needed so dark mode can run on every page you visit; `storage` and `unlimitedStorage` hold settings and the style cache; `scripting` injects the recoloring script according to your settings.

If a future version adds a feature that sends data off your device, this policy and the store listing's data disclosure will be updated before that version is released.

Contact: <https://github.com/fixcode-h/DarkWeb/issues>
