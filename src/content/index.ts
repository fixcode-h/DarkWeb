/**
 * 内容脚本入口（隔离世界，document_start）。
 * 负责模式选择、动态模式下各模块的调度、设置变化时的热切换、诊断信息。
 */
import { BUILTIN_RULES } from '../shared/builtin-rules';
import type { Diagnostics, FetchCssResponse } from '../shared/messages';
import { parseUserRules, resolveRule, type EffectiveRule } from '../shared/rules';
import {
  CACHE_PREFIX,
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  normalizeSettings,
  siteModeFor,
  type Settings,
} from '../shared/settings';
import { shadowVarName } from './engine/css-value';
import { SheetRewriter } from './engine/rewriter';
import { ColorTransformer, buildTheme, type Role } from './engine/transform';
import { isIgnored, type Ctx } from './context';
import { Guard, sampleBrightness } from './guard';
import { pageLooksDark as looksDark, themeAttrChanged } from './native-dark';
import { InlineStyler } from './inline';
import { MediaAnalyzer, mediaCss } from './media';
import { ensureNativeCookie, restoreNativeCookie } from './native-cookie';
import { RootSheets, wrapScreen } from './sheets';

type Mode = 'off' | 'dynamic' | 'native' | 'filter';
type Root = Document | ShadowRoot;

const html = document.documentElement;
const host = location.hostname;
/** 带端口的主机，用来查“本站模式”（按域名 / IP:端口区分） */
const site = location.host;
const isTop = window === window.top;
const ATTR_FILTER = ['style', 'fill', 'stroke', 'stop-color', 'bgcolor', 'color', 'src', 'srcset', 'media', 'disabled', 'rel'];
const CACHE_LIMIT = 1_500_000;

function openOrClosedShadowRoot(el: Element): ShadowRoot | null {
  const dom = (chrome as unknown as { dom?: { openOrClosedShadowRoot?: (e: Element) => ShadowRoot | null } }).dom;
  try {
    return dom?.openOrClosedShadowRoot ? dom.openOrClosedShadowRoot(el) : el.shadowRoot;
  } catch {
    return el.shadowRoot;
  }
}

/**
 * 记住“本站这一类页面的原生暗色已确认可用”，按路径第一段区分（知乎 /explore、/question 有暗色主题，/signin 没有）。
 * 要在 document_start 同步读到，所以放站点自己的 localStorage（扩展存储是异步的）。
 * 只有确认过的页面类型才跳过并行的动态模式，没确认过的照常试探，不会闪白。
 */
const NATIVE_OK_KEY = '__drak_native_ok';
const pathKind = () => '/' + (location.pathname.split('/')[1] || '');
function readVerified(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(NATIVE_OK_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function nativeVerified(): boolean {
  return readVerified().includes(pathKind());
}
function setNativeVerified(ok: boolean): void {
  try {
    const kind = pathKind();
    const list = readVerified().filter((k) => k !== kind);
    if (ok) list.push(kind);
    if (list.length) localStorage.setItem(NATIVE_OK_KEY, JSON.stringify(list.slice(-30)));
    else localStorage.removeItem(NATIVE_OK_KEY);
  } catch {
    /* 存储不可用时每次都试探 */
  }
}

/** 页面当前（不含我们的样式）是否已是深色。调用前要先撤掉我们的样式 */
function pageLooksDark(ignoreSelector: string): boolean {
  return looksDark((el) => isIgnored(el, ignoreSelector));
}

/** 站点规则生成的样式：vars 直接写进影子变量，css 原样追加 */
function siteCss(rule: EffectiveRule): string {
  let css = '';
  const vars = Object.entries(rule.vars);
  if (vars.length) {
    const roles: Role[] = ['bg', 'fg', 'border', 'shadow'];
    let decls = '';
    for (const [name, value] of vars) {
      for (const r of roles) decls += `${shadowVarName(r, name)}:${value} !important;`;
    }
    css += `:root{${decls}}\n`;
  }
  if (rule.css.trim()) css += rule.css + '\n';
  return css;
}

/** 一次动态模式会话；重启时整个丢弃重建 */
class DynamicSession {
  ctx: Ctx;
  roots = new Map<Root, RootSheets>();
  inline: InlineStyler;
  media: MediaAnalyzer;
  private abort = new AbortController();
  private observers: MutationObserver[] = [];
  private styleObserver: MutationObserver;
  private dirtyRoots = new Set<Root>();
  private sheetsQueued = false;
  private work: Element[] = [];
  private workIndex = 0;
  private flushQueued = false;
  private siteSheet: CSSStyleSheet;
  private mediaSheet: CSSStyleSheet;
  private lastHref = location.href;
  private timers: number[] = [];
  brightRatio: number | null = null;
  readyAt = 0;
  stopped = false;

  constructor(
    private app: Drak,
    settings: Settings,
    rule: EffectiveRule,
    guard: Guard,
    private cacheText: string | null,
  ) {
    const tx = new ColorTransformer(buildTheme(settings));
    const own = new WeakSet<CSSStyleSheet>();
    this.ctx = {
      settings,
      rule,
      tx,
      rewriter: new SheetRewriter(tx),
      guard,
      ignoreSelector: rule.ignore.join(','),
      keepSelector: rule.keepImage.join(','),
      own,
      fetchCss: (url) => this.app.fetchCss(url),
      peekCss: (url) => this.app.peekCss(url),
      onBgImage: (hit, root) => this.media.onBgImage(hit, root),
    };
    this.inline = new InlineStyler(this.ctx);
    this.inline.onBgUrl = (el, url) =>
      this.media.onInlineBg(el, url, (image) => this.inline.force(el, 'background-image', image));
    this.media = new MediaAnalyzer(this.ctx, (r) => this.roots.get(r));
    this.siteSheet = this.newSheet(wrapScreen(siteCss(rule)));
    this.mediaSheet = this.newSheet(wrapScreen(mediaCss(rule.invert)));
    this.styleObserver = new MutationObserver((recs) =>
      guard.run('style-text', () => {
        for (const r of recs) this.markDirty(r.target.getRootNode() as Root);
      }),
    );
  }

  private newSheet(text: string): CSSStyleSheet {
    const s = new CSSStyleSheet();
    this.ctx.own.add(s);
    try {
      s.replaceSync(text);
    } catch (e) {
      this.ctx.guard.error(e, 'site-sheet');
    }
    return s;
  }

  start(): void {
    const g = this.ctx.guard;
    html.setAttribute('data-drak-applying', '');
    const doc = new RootSheets(document, this.ctx, [this.siteSheet, this.mediaSheet]);
    if (this.cacheText) doc.cache = this.newSheet(this.cacheText);
    this.roots.set(document, doc);
    g.run('sheets', () => doc.sync());
    this.observeRoot(document);
    const opts = { capture: true, signal: this.abort.signal };
    document.addEventListener('drak-sheets', () => this.markAllDirty(), opts);
    document.addEventListener('drak-shadow', (e) => g.run('shadow', () => this.discover(e.target as Element)), opts);
    // 已经存在的 <style>/<link>
    for (const el of Array.from(document.querySelectorAll('style, link'))) this.watchStyleNode(el, document);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.onReady(), { once: true, signal: this.abort.signal });
    } else {
      this.onReady();
    }
    if (document.readyState === 'complete') this.onLoad();
    else window.addEventListener('load', () => this.onLoad(), { once: true, signal: this.abort.signal });
  }

  private onReady(): void {
    if (this.stopped) return;
    const g = this.ctx.guard;
    g.run('sheets', () => this.syncAll());
    if (this.pageAlreadyDark()) {
      // 原生暗色试探中：页面已变暗说明原生主题生效，交给 app 决定
      this.app.onPageAlreadyDark();
      return;
    }
    this.app.onDynamicReady();
    this.enqueue(html);
    // 首屏部分同步处理（最多 30ms），保证第一次绘制前已经是暗色
    this.processWork(30);
    html.setAttribute('data-drak-ready', '');
    this.readyAt = performance.now();
    requestAnimationFrame(() => requestAnimationFrame(() => html.removeAttribute('data-drak-applying')));
    this.scheduleFlush();
  }

  private onLoad(): void {
    if (this.stopped) return;
    this.ctx.guard.run('sheets', () => this.syncAll());
    this.timers.push(
      window.setTimeout(() => {
        this.ctx.guard.endStartup();
        this.selfCheck();
        this.finishCache(0);
      }, 1000),
    );
    // 单页应用路由变化后再自检一次
    this.timers.push(
      window.setInterval(() => {
        if (location.href !== this.lastHref) {
          this.lastHref = location.href;
          this.markAllDirty();
          this.timers.push(window.setTimeout(() => this.selfCheck(), 800));
        }
      }, 1500),
    );
  }

  /** 缓存：等跨域样式表都拉完，移除旧缓存并写入新的 */
  private finishCache(tries: number): void {
    if (this.stopped) return;
    const doc = this.roots.get(document);
    if (!doc) return;
    if (doc.pending > 0 && tries < 10) {
      this.timers.push(window.setTimeout(() => this.finishCache(tries + 1), 500));
      return;
    }
    if (doc.cache) {
      doc.cache = null;
      doc.sync();
    }
    if (!isTop) return;
    const text = doc.allText();
    if (text.length > 0 && text.length < CACHE_LIMIT) {
      chrome.storage.local.set({ [CACHE_PREFIX + host]: text }).catch(() => undefined);
    }
  }

  /**
   * 页面本身已是深色：暂时撤掉我们的样式量一下原始颜色。
   * 已经处理过的内联样式不还原，所以页面加载完之后再量只是初筛，结果为真时由 app 停掉会话再确认一次。
   */
  pageAlreadyDark(): boolean {
    if (!document.body) return false;
    const doc = this.roots.get(document);
    // 必须拷贝：adoptedStyleSheets 是同一个可观察数组，detach() 赋值后原引用的内容也跟着变
    const saved = [...document.adoptedStyleSheets];
    // 恢复样式时不要触发页面自己的过渡动画（否则会从浅色渐变回深色，看起来闪一下）
    const hold = !html.hasAttribute('data-drak-applying');
    if (hold) html.setAttribute('data-drak-applying', '');
    html.setAttribute('data-drak-off', '');
    doc?.detach();
    let dark = false;
    try {
      dark = pageLooksDark(this.ctx.ignoreSelector);
    } finally {
      html.removeAttribute('data-drak-off');
      document.adoptedStyleSheets = saved;
      if (hold) requestAnimationFrame(() => requestAnimationFrame(() => html.removeAttribute('data-drak-applying')));
    }
    return dark;
  }

  // ---- 观察 ----

  private observeRoot(root: Root): void {
    const mo = new MutationObserver((recs) => this.ctx.guard.run('mutations', () => this.onMutations(root, recs)));
    mo.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ATTR_FILTER });
    this.observers.push(mo);
  }

  private watchStyleNode(el: Element, root: Root): void {
    if (el.localName === 'style') {
      this.styleObserver.observe(el, { childList: true, characterData: true, subtree: true });
    } else if (el.localName === 'link' && /stylesheet/i.test(el.getAttribute('rel') || '')) {
      // 跨域样式表：和浏览器加载并行预取，样式表加载完成时通常已经能同步改写
      const href = (el as HTMLLinkElement).href;
      if (href && /^https?:/i.test(href) && new URL(href).origin !== location.origin) this.app.fetchCss(href);
      const handler = () => this.markDirty(root);
      el.addEventListener('load', handler, { signal: this.abort.signal });
      el.addEventListener('error', handler, { signal: this.abort.signal });
    }
  }

  private onMutations(root: Root, recs: MutationRecord[]): void {
    let dirty = false;
    for (const r of recs) {
      if (r.type === 'childList') {
        if ((r.target as Element).localName === 'style') dirty = true;
        r.addedNodes.forEach((n) => {
          if (n.nodeType !== 1) return;
          const el = n as Element;
          if (el.localName === 'style' || el.localName === 'link') {
            if (!el.hasAttribute('data-drak')) {
              this.watchStyleNode(el, root);
              dirty = true;
            }
          }
          this.enqueue(el);
        });
        r.removedNodes.forEach((n) => {
          const name = (n as Element).localName;
          if (name === 'style' || name === 'link') dirty = true;
        });
      } else if (r.type === 'attributes') {
        const el = r.target as Element;
        const name = r.attributeName || '';
        if ((el.localName === 'style' || el.localName === 'link') && (name === 'media' || name === 'disabled' || name === 'rel')) {
          dirty = true;
        } else if ((name === 'src' || name === 'srcset') && el.localName === 'img') {
          el.removeAttribute('data-drak-img');
          this.media.observe(el as HTMLImageElement);
        } else {
          this.inline.process(el);
        }
      }
    }
    // 样式表变化同步处理（仍在绘制之前），防止新内容闪白
    if (dirty) {
      this.markDirty(root);
      this.flushSheets();
    }
    this.scheduleFlush();
  }

  markDirty(root: Root): void {
    this.dirtyRoots.add(root);
    if (this.sheetsQueued) return;
    this.sheetsQueued = true;
    queueMicrotask(() => this.flushSheets());
  }

  markAllDirty(): void {
    for (const r of this.roots.keys()) this.markDirty(r);
  }

  private flushSheets(): void {
    this.sheetsQueued = false;
    if (this.stopped) return;
    const roots = Array.from(this.dirtyRoots);
    this.dirtyRoots.clear();
    for (const r of roots) {
      const rs = this.roots.get(r);
      if (rs) this.ctx.guard.run('sheets', () => rs.sync());
    }
  }

  syncAll(force = false): void {
    for (const rs of this.roots.values()) rs.sync(force);
  }

  // ---- 元素处理队列 ----

  private enqueue(el: Element): void {
    this.work.push(el);
    const all = el.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) this.work.push(all[i]);
  }

  private scheduleFlush(): void {
    if (this.flushQueued || this.workIndex >= this.work.length) return;
    this.flushQueued = true;
    requestAnimationFrame(() => {
      this.flushQueued = false;
      this.ctx.guard.run('elements', () => this.processWork(this.readyAt ? 4 : 8));
      this.scheduleFlush();
    });
  }

  private processWork(budgetMs: number): void {
    const t0 = performance.now();
    while (this.workIndex < this.work.length) {
      const el = this.work[this.workIndex++];
      try {
        this.processElement(el);
      } catch (e) {
        this.ctx.guard.error(e, 'element');
      }
      if ((this.workIndex & 31) === 0 && performance.now() - t0 > budgetMs) break;
    }
    if (this.workIndex >= this.work.length) {
      this.work = [];
      this.workIndex = 0;
    }
  }

  private processElement(el: Element): void {
    if (!el.isConnected) return;
    this.inline.process(el);
    const name = el.localName;
    if (name === 'img') this.media.observe(el as HTMLImageElement);
    if (name.includes('-') || el.hasAttribute('data-drak-sr')) {
      const sr = openOrClosedShadowRoot(el);
      if (sr) this.setupShadow(sr);
    }
  }

  /** 'drak-shadow' 事件或子树扫描发现的宿主：递归找出所有 Shadow Root */
  private discover(el: Element | null): void {
    if (!el || el.nodeType !== 1) return;
    const sr = openOrClosedShadowRoot(el);
    if (sr) this.setupShadow(sr);
    else this.enqueue(el);
    this.scheduleFlush();
  }

  private setupShadow(sr: ShadowRoot): void {
    if (this.roots.has(sr)) return;
    if (isIgnored(sr.host, this.ctx.ignoreSelector)) return;
    const rs = new RootSheets(sr, this.ctx, [this.mediaSheet]);
    this.roots.set(sr, rs);
    this.observeRoot(sr);
    for (const el of Array.from(sr.querySelectorAll('style, link'))) this.watchStyleNode(el, sr);
    rs.sync();
    for (const child of Array.from(sr.children)) this.enqueue(child);
    this.scheduleFlush();
  }

  // ---- 自检 ----

  selfCheck(): void {
    if (this.stopped || window.innerWidth < 200 || window.innerHeight < 150) return;
    this.ctx.guard.run('self-check', () => {
      const ignore = (el: Element) => isIgnored(el, this.ctx.ignoreSelector);
      let s = sampleBrightness(ignore);
      if (s.ratio > 0.25) {
        for (const el of s.elements) {
          if (el === html || el === document.body) continue;
          const bg = getComputedStyle(el).backgroundColor;
          const t = this.ctx.tx.transform(bg, 'bg');
          if (t) this.inline.force(el, 'background-color', t);
        }
        s = sampleBrightness(ignore);
      }
      this.brightRatio = s.ratio;
    });
  }

  stop(): void {
    this.stopped = true;
    this.abort.abort();
    for (const mo of this.observers) mo.disconnect();
    this.styleObserver.disconnect();
    for (const t of this.timers) {
      clearTimeout(t);
      clearInterval(t);
    }
    for (const rs of this.roots.values()) rs.detach();
    this.roots.clear();
    this.inline.restore();
    this.media.stop();
    html.removeAttribute('data-drak-applying');
  }

  stats() {
    let rules = 0;
    for (const rs of this.roots.values()) rules += rs.size;
    return {
      sheets: rules,
      rules: this.ctx.rewriter.stats.rules,
      shadowRoots: this.roots.size - 1,
      images: { ...this.media.counts },
    };
  }
}

class Drak {
  settings: Settings = DEFAULT_SETTINGS;
  mode: Mode = 'off';
  reason = 'starting';
  guard!: Guard;
  session: DynamicSession | null = null;
  private cssCache = new Map<string, Promise<string | null>>();
  private nativeApplied: { attr?: [string, string | null]; className?: string } | null = null;
  private nativeObserver: MutationObserver | null = null;
  private nativeProbing = false;
  private probeFresh = false;
  private cacheText: string | null = null;
  private t0 = performance.now();
  firstApplyMs = 0;
  private mql = window.matchMedia('(prefers-color-scheme: dark)');
  private recheckTimer = 0;
  private lastRecheck = 0;
  private rechecks = 0;
  private recheckMisses = 0;

  init(): void {
    // 先按默认设置立即开始（不等异步存储），读到真实设置后若有差异再重启
    this.apply();
    chrome.storage.local
      .get([SETTINGS_KEY, CACHE_PREFIX + host])
      .then((data) => {
        const s = normalizeSettings(data[SETTINGS_KEY]);
        const cache = isTop && typeof data[CACHE_PREFIX + host] === 'string' ? (data[CACHE_PREFIX + host] as string) : null;
        const changed = JSON.stringify(s) !== JSON.stringify(this.settings);
        this.settings = s;
        if (cache && this.session && !this.session.readyAt && !changed) {
          // 还没到 DOMContentLoaded：补上缓存层
          const doc = this.session.roots.get(document);
          if (doc && !doc.cache) {
            const sheet = new CSSStyleSheet();
            this.session.ctx.own.add(sheet);
            try {
              sheet.replaceSync(cache);
              doc.cache = sheet;
              doc.sync();
            } catch {
              /* ignore */
            }
          }
        }
        this.cacheText = cache;
        if (changed) this.restart();
      })
      .catch(() => undefined);
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[SETTINGS_KEY]) return;
      const s = normalizeSettings(changes[SETTINGS_KEY].newValue);
      if (JSON.stringify(s) === JSON.stringify(this.settings)) return;
      this.settings = s;
      this.restart();
    });
    this.mql.addEventListener('change', () => {
      if (this.settings.followSystem) this.restart();
      // 跟随系统的网站此时也切了主题
      else this.scheduleRecheck();
    });
    this.watchPageTheme();
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type === 'diag') {
        sendResponse(this.diagnostics());
        return false;
      }
      if (msg?.type === 'reapply') {
        this.restart();
        sendResponse({ ok: true });
        return false;
      }
      return false;
    });
  }

  private cssDone = new Map<string, string | null>();

  fetchCss(url: string): Promise<string | null> {
    let p = this.cssCache.get(url);
    if (!p) {
      p = chrome.runtime
        .sendMessage({ type: 'fetch-css', url })
        .then((r: FetchCssResponse) => (r?.ok && typeof r.text === 'string' ? r.text : null))
        .catch(() => null)
        .then((t) => {
          this.cssDone.set(url, t);
          // 预取完成时如果样式表已加载，立即改写
          if (t !== null) this.session?.markAllDirty();
          return t;
        });
      this.cssCache.set(url, p);
    }
    return p;
  }

  peekCss(url: string): string | null | undefined {
    return this.cssDone.get(url);
  }

  // ---- 网站自带暗色的持续识别 ----
  // DOMContentLoaded 时量一次不够：很多网站的暗色主题由脚本在加载后才套上（读 localStorage、框架挂载），
  // 用户也可能中途在网站里切换主题。这里在几个时机重新量：页面加载完成后、<html>/<body> 上出现像主题切换的属性变化、系统配色变化。

  private watchPageTheme(): void {
    const mo = new MutationObserver((recs) => {
      for (const r of recs) {
        const name = r.attributeName || '';
        // 我们自己改写内联样式引起的变化不算
        if (name === 'style' && this.session?.inline.wroteLast(r.target as Element)) continue;
        if (themeAttrChanged(name, r.oldValue, (r.target as Element).getAttribute(name))) return this.scheduleRecheck();
      }
    });
    const opts = { attributes: true, attributeOldValue: true };
    mo.observe(html, opts);
    const onReady = () => {
      if (document.body) mo.observe(document.body, opts);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady, { once: true });
    else onReady();
    // 只在顶层页面做定时复查，子框架（广告等）数量多，不值得
    if (!isTop) return;
    const onLoad = () => {
      window.setTimeout(() => this.recheckPageDark(), 1200);
      // 慢一些的单页应用：第二次复查
      window.setTimeout(() => this.recheckPageDark(), 4000);
    };
    if (document.readyState === 'complete') onLoad();
    else window.addEventListener('load', onLoad, { once: true });
  }

  private scheduleRecheck(): void {
    clearTimeout(this.recheckTimer);
    // 等网站把主题切完（样式生效、过渡结束）再量；同时限制频率
    const wait = Math.max(350, this.lastRecheck + 1500 - performance.now());
    this.recheckTimer = window.setTimeout(() => this.recheckPageDark(), wait);
  }

  /** 重新判断页面自己是不是深色，并在“动态配色”与“自动跳过”之间切换 */
  private recheckPageDark(): void {
    if (!document.body || this.rechecks >= 30) return;
    if (this.mode === 'off' && this.reason === 'page-already-dark') {
      // 之前因为页面是深色而跳过：网站切回浅色了就重新接管
      this.rechecks++;
      this.lastRecheck = performance.now();
      if (!pageLooksDark(this.rule().ignore.join(','))) this.restart();
      return;
    }
    const session = this.session;
    if (this.mode !== 'dynamic' || !session || !session.readyAt || this.nativeProbing) return;
    if (this.guard.tripped || this.recheckMisses >= 2) return;
    const rule = session.ctx.rule;
    // 走站点规则原生暗色流程的网站（知乎等）由那套流程自己判断
    if (rule.native) return;
    this.rechecks++;
    this.lastRecheck = performance.now();
    if (!this.guard.run('recheck', () => session.pageAlreadyDark())) return;
    // 初筛认为页面已是深色：彻底撤掉（包括内联样式）再确认一次，仍是深色才真的让位
    this.turnOff('page-already-dark');
    if (!pageLooksDark(rule.ignore.join(','))) {
      // 初筛误报（深色其实是我们改出来的）：恢复动态配色，并且不再反复折腾这个页面
      this.recheckMisses++;
      this.restart();
    }
  }

  private rule(): EffectiveRule {
    const user = parseUserRules(this.settings.userRules).rules;
    return resolveRule(host, BUILTIN_RULES, user);
  }

  apply(): void {
    this.guard = new Guard((reason) => this.onTrip(reason));
    const s = this.settings;
    if (!s.enabled) return this.turnOff('disabled');
    const siteMode = siteModeFor(s, site);
    if (siteMode === 'off') return this.turnOff('site-disabled');
    if (s.followSystem && !this.mql.matches) return this.turnOff('system-light');
    const rule = this.rule();
    const mode: Mode = siteMode !== 'auto' ? siteMode : rule.mode || 'dynamic';
    if (mode === 'off') return this.turnOff('rule-off');
    html.removeAttribute('data-drak-off');
    this.reason = siteMode !== 'auto' ? 'user-choice' : rule.mode ? 'site-rule' : 'default';
    const cookie = rule.native?.cookie;
    if (cookie && mode !== 'native') restoreNativeCookie(...cookie);
    if (mode === 'filter') {
      this.mode = 'filter';
      html.setAttribute('data-drak-mode', 'filter');
      html.setAttribute('data-drak-ready', '');
      return;
    }
    html.removeAttribute('data-drak-mode');
    if (mode === 'native' && rule.native) {
      this.startNative(rule);
      return;
    }
    this.startDynamic(rule);
  }

  private startDynamic(rule: EffectiveRule): void {
    this.mode = 'dynamic';
    html.setAttribute('data-drak-mode', 'dynamic');
    this.session = new DynamicSession(this, this.settings, rule, this.guard, this.cacheText);
    this.guard.run('start', () => this.session!.start());
  }

  private startNative(rule: EffectiveRule): void {
    this.mode = 'native';
    html.setAttribute('data-drak-mode', 'native');
    const n = rule.native!;
    if (n.cookie && !ensureNativeCookie(...n.cookie)) {
      // 服务端按 cookie 渲染主题：本次加载仍是浅色，先用动态配色，下次加载起走原生暗色
      this.startDynamic(rule);
      this.reason = 'native-pending';
      return;
    }
    const assert = () => {
      if (n.attr && html.getAttribute(n.attr[0]) !== n.attr[1]) html.setAttribute(n.attr[0], n.attr[1]);
      if (n.className && !html.classList.contains(n.className)) html.classList.add(n.className);
    };
    this.nativeApplied = {
      attr: n.attr ? [n.attr[0], html.getAttribute(n.attr[0])] : undefined,
      className: n.className && !html.classList.contains(n.className) ? n.className : undefined,
    };
    assert();
    // 站点脚本可能在初始化时改回去，持续守住
    this.nativeObserver = new MutationObserver(() => assert());
    this.nativeObserver.observe(html, { attributes: true, attributeFilter: n.attr ? [n.attr[0], 'class'] : ['class'] });
    if (n.cookie && nativeVerified()) {
      // cookie 已在且之前确认过原生暗色可用：服务端已按暗色渲染，不必并行跑动态模式（知乎上能省下约 300ms 主线程）。
      // DOMContentLoaded 时再确认一次，万一没变暗再退回动态模式。
      const check = () => {
        if (this.mode !== 'native' || this.session) return;
        // 撤掉基础层量页面自己的颜色（基础层给 html 上了深色底，会造成误判）
        html.setAttribute('data-drak-off', '');
        const dark = pageLooksDark(rule.ignore.join(','));
        html.removeAttribute('data-drak-off');
        if (dark) {
          html.setAttribute('data-drak-ready', '');
          this.firstApplyMs = performance.now() - this.t0;
          return;
        }
        setNativeVerified(false);
        this.stopNative();
        this.startDynamic(rule);
        this.reason = 'native-failed';
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', check, { once: true });
      else check();
      return;
    }
    // 原生主题能否生效要等页面样式加载完才知道；期间并行跑动态模式，避免试探失败时闪白。
    // DOMContentLoaded 时动态会话会撤掉自己的样式量一次页面原始颜色：已是深色说明原生主题生效。
    this.nativeProbing = true;
    this.probeFresh = document.readyState === 'loading';
    this.mode = 'dynamic';
    this.session = new DynamicSession(this, this.settings, rule, this.guard, this.cacheText);
    this.guard.run('start', () => this.session!.start());
    if (this.nativeProbing) this.mode = 'native';
  }

  /** 动态会话发现页面本身已是深色 */
  onPageAlreadyDark(): void {
    if (this.nativeProbing) {
      this.nativeProbing = false;
      // 只认页面刚加载时的试探结果；已加载页面上重启时量到的颜色可能还带着上一轮的改动
      if (this.probeFresh && this.rule().native?.cookie) setNativeVerified(true);
      this.session?.stop();
      this.session = null;
      this.mode = 'native';
      html.setAttribute('data-drak-mode', 'native');
      html.setAttribute('data-drak-ready', '');
      this.firstApplyMs = performance.now() - this.t0;
      return;
    }
    this.turnOff('page-already-dark');
  }

  /** 动态会话完成首屏应用 */
  onDynamicReady(): void {
    this.firstApplyMs = performance.now() - this.t0;
    if (this.nativeProbing) {
      this.nativeProbing = false;
      this.stopNative();
      this.mode = 'dynamic';
      // cookie 不在这里还原：同站有的页面（如登录页）没有暗色主题，还原会让其他页面下次又要先走一遍动态配色
      this.reason = 'native-failed';
      html.setAttribute('data-drak-mode', 'dynamic');
    }
  }

  private stopNative(): void {
    this.nativeObserver?.disconnect();
    this.nativeObserver = null;
    const a = this.nativeApplied;
    if (a?.attr) {
      if (a.attr[1] === null) html.removeAttribute(a.attr[0]);
      else html.setAttribute(a.attr[0], a.attr[1]);
    }
    if (a?.className) html.classList.remove(a.className);
    this.nativeApplied = null;
  }

  turnOff(reason: string): void {
    this.reason = reason;
    const cookie = this.rule().native?.cookie;
    if (cookie) restoreNativeCookie(...cookie);
    this.teardown();
    this.mode = 'off';
    html.setAttribute('data-drak-off', '');
  }

  private teardown(): void {
    this.nativeProbing = false;
    this.session?.stop();
    this.session = null;
    this.stopNative();
    html.removeAttribute('data-drak-mode');
    html.removeAttribute('data-drak-ready');
  }

  restart(): void {
    this.teardown();
    this.apply();
    if (this.session && document.readyState !== 'loading') {
      // 已加载的页面直接全部就绪
      html.setAttribute('data-drak-ready', '');
    }
  }

  private onTrip(reason: 'errors' | 'slow'): void {
    if (reason === 'errors') {
      this.teardown();
      this.mode = 'filter';
      this.reason = 'too-many-errors';
      html.removeAttribute('data-drak-off');
      html.setAttribute('data-drak-mode', 'filter');
      html.setAttribute('data-drak-ready', '');
    } else {
      // 超慢页面：停掉图片分析等增量工作，保留已生效的样式
      this.reason = 'slow-page';
      this.session?.media.stop();
    }
  }

  diagnostics(): Diagnostics {
    const st = this.session?.stats();
    return {
      host,
      mode: this.mode,
      reason: this.reason,
      sheets: st?.sheets ?? 0,
      rules: st?.rules ?? 0,
      shadowRoots: st?.shadowRoots ?? 0,
      images: st?.images ?? { keep: 0, invert: 0, dim: 0 },
      errors: this.guard?.errorCount ?? 0,
      timings: {
        firstApply: Math.round(this.firstApplyMs),
        startupMainThread: Math.round(this.guard?.startupMs ?? 0),
        ...Object.fromEntries(Object.entries(this.guard?.timings ?? {}).map(([k, v]) => [k, Math.round(v * 10) / 10])),
      },
      brightRatio: this.session?.brightRatio ?? null,
      frame: isTop ? 'top' : 'sub',
    };
  }
}

(() => {
  const w = window as unknown as { __drakContent?: Drak };
  if (w.__drakContent) return;
  // 扩展更新后旧脚本上下文失效：不重复注入
  if (!chrome.runtime?.id) return;
  const app = new Drak();
  w.__drakContent = app;
  try {
    app.init();
  } catch {
    html.setAttribute('data-drak-off', '');
  }
})();
