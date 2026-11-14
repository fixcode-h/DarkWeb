/**
 * 阅读增强：字体与排版、护眼滤镜（静态内容脚本，document_start，只在顶层页面运行）。
 * 两者都只往 <html> 下挂一个节点，不碰页面自己的内容树；设置一改立即生效，不用刷新。
 */
import { siteKeyOf } from '../shared/settings';
import { ENHANCE_KEY, enhanceActiveOn, filterStyle, fontCss, loadEnhance, normalizeEnhance, type EnhanceSettings } from './settings';

const STYLE_ID = 'drak-enhance-font';
const site = siteKeyOf(location.host);
let style: HTMLStyleElement | null = null;
let overlay: HTMLElement | null = null;

function apply(s: EnhanceSettings): void {
  const on = enhanceActiveOn(s, site);
  const css = on ? fontCss(s.font) : '';
  if (css) {
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
    }
    if (style.textContent !== css) style.textContent = css;
    // 放在最后，和页面里同为 !important 的规则比时靠后者胜
    if (style.parentNode !== document.documentElement || style.nextSibling) document.documentElement.appendChild(style);
  } else style?.remove();

  const fs = on ? filterStyle(s.filter) : '';
  if (fs) {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.setAttribute('aria-hidden', 'true');
      overlay.setAttribute('translate', 'no');
      overlay.dataset.drakFilter = '';
      // 打印时不带滤镜
      const printCss = document.createElement('style');
      printCss.textContent = '@media print { [data-drak-filter] { display: none !important; } }';
      document.documentElement.appendChild(printCss);
    }
    overlay.style.cssText = fs;
    if (!overlay.isConnected) document.documentElement.appendChild(overlay);
  } else overlay?.remove();
}

let current: EnhanceSettings | null = null;
void loadEnhance().then((s) => {
  current = s;
  apply(s);
  // 有的网站会整体替换 <body> 之后再 append 到 <html>，把我们的样式挤到前面；页面加载完再排一次
  document.addEventListener('DOMContentLoaded', () => current && apply(current), { once: true });
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[ENHANCE_KEY]) return;
  current = normalizeEnhance(changes[ENHANCE_KEY].newValue);
  apply(current);
});

