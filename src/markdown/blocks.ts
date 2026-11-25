/**
 * 正文里代码块和 Mermaid 图的交互部分（渲染出的 HTML 经过清洗，按钮只能在这里补）：
 * - 代码块顶栏：语言、行数、折行、复制；
 * - mermaid 代码块画成图：画图库约 5MB，文件里真有图时才请后台注入；画好的 SVG 按“主题 + 源码”缓存，
 *   分栏编辑时每次重新渲染不用重画，也不重放出场动画。
 * 外观、动效、缩放、全屏照搬 agent-panel（./mermaid/fx.ts）。
 */
import type { Mermaid } from 'mermaid';
import { enhanceMermaid, mermaidAction, mermaidErrorHtml, mermaidHtml, mermaidLayout, mermaidThemeVars } from './mermaid/fx';

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** 代码块顶栏：语言名 + 行数，右边折行和复制 */
function codeBar(name: string, count: number): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'md-code-bar';
  const n = count > 1 ? ` <small>· ${count} 行</small>` : '';
  bar.innerHTML =
    `<span class="md-code-lang">${escape(name)}${n}</span><span class="md-code-acts">` +
    '<button type="button" class="md-copy" data-wrap>折行</button>' +
    '<button type="button" class="md-copy" data-copy><span class="swap"><span>复制</span><span>已复制</span></span></button></span>';
  return bar;
}

let loading: Promise<Mermaid | null> | null = null;
let inited = '';
let seq = 0;

/** 请后台注入画图库，等它挂到全局上 */
function loadMermaid(): Promise<Mermaid | null> {
  const g = globalThis as { __drakMermaid?: Mermaid };
  if (g.__drakMermaid) return Promise.resolve(g.__drakMermaid);
  loading ??= chrome.runtime
    .sendMessage({ type: 'md:mermaid' })
    .then((r: { ok?: boolean } | undefined) => (r?.ok ? (g.__drakMermaid ?? null) : null))
    .catch(() => null)
    .then((m) => {
      if (!m) loading = null;
      return m;
    });
  return loading;
}

export class Blocks {
  /** 主题 + 源码 → 画好的 SVG；画不出来时存错误原因 */
  private cache = new Map<string, { svg?: string; why?: string }>();
  private gen = 0;

  constructor(
    private root: HTMLElement,
    private theme: () => string,
  ) {}

  /** 正文换过一遍内容后调用 */
  decorate(): void {
    for (const box of this.root.querySelectorAll<HTMLElement>('.md-code')) {
      box.prepend(codeBar(box.dataset.lang || 'text', Number(box.dataset.lines) || 1));
    }
    const boxes = [...this.root.querySelectorAll<HTMLElement>('.md-mermaid')];
    for (const box of boxes) {
      box.dataset.src = box.querySelector('code')?.textContent ?? '';
      box.insertAdjacentHTML('afterbegin', '<div class="md-code-bar"><span class="md-code-lang">mermaid <small>· 正在绘制</small></span></div>');
    }
    if (boxes.length) void this.drawAll(boxes);
  }

  /** 换主题后图的配色要重算：清掉缓存，重画还在页面上的图 */
  redraw(): void {
    this.cache.clear();
    const boxes = [...this.root.querySelectorAll<HTMLElement>('.md-mermaid[data-src]')];
    for (const box of boxes) {
      delete box.dataset.done;
      box.classList.remove('mx-in');
    }
    if (boxes.length) void this.drawAll(boxes);
  }

  private async drawAll(boxes: HTMLElement[]): Promise<void> {
    const gen = ++this.gen;
    const theme = this.theme();
    // 先把缓存里有的直接换上，不等画图库
    const todo = boxes.filter((box) => !this.fromCache(box, theme));
    if (!todo.length) return;
    const mermaid = await loadMermaid();
    if (gen !== this.gen) return;
    if (!mermaid) {
      for (const box of todo) this.show(box, { why: '画图组件加载失败' }, false);
      return;
    }
    this.init(mermaid, theme);
    for (const box of todo) {
      if (gen !== this.gen || !box.isConnected) return;
      const src = box.dataset.src ?? '';
      const key = `${theme}\n${src}`;
      const id = `drak-mmd-${++seq}`;
      let res: { svg?: string; why?: string };
      try {
        res = { svg: (await mermaid.render(id, src)).svg };
      } catch (e) {
        res = { why: String((e as Error)?.message ?? '').split('\n')[0] };
      } finally {
        // 出错时 mermaid 会把临时节点留在 body 末尾
        for (const tmp of [`d${id}`, `i${id}`, id]) {
          const n = document.getElementById(tmp);
          if (n && !this.root.contains(n)) n.remove();
        }
      }
      this.cache.set(key, res);
      if (box.isConnected) this.show(box, res, false);
    }
  }

  private fromCache(box: HTMLElement, theme: string): boolean {
    const hit = this.cache.get(`${theme}\n${box.dataset.src ?? ''}`);
    if (hit) this.show(box, hit, true);
    return !!hit;
  }

  private show(box: HTMLElement, res: { svg?: string; why?: string }, still: boolean): void {
    const src = box.dataset.src ?? '';
    if (res.svg) {
      box.dataset.done = '1';
      box.innerHTML = mermaidHtml(res.svg, src);
      enhanceMermaid(box, { still });
    } else {
      // 语法不对的图按普通代码块显示源码，标出画不出来的原因
      box.dataset.done = 'error';
      box.innerHTML = mermaidErrorHtml(src, res.why ?? '');
    }
  }

  private init(mermaid: Mermaid, theme: string): void {
    const layout = mermaidLayout();
    const key = `${theme}|${layout.curve}|${layout.padding}`;
    if (key === inited) return;
    // 配置照 agent-panel 的 Markdown.tsx：面板自己的配色、经典外观、时序图和甘特图按自然宽度画
    mermaid.initialize({
      startOnLoad: false,
      suppressErrorRendering: true,
      securityLevel: 'strict',
      theme: 'base',
      look: 'classic',
      fontFamily: getComputedStyle(this.root).fontFamily,
      themeVariables: mermaidThemeVars(theme === 'dark'),
      flowchart: { curve: layout.curve, padding: layout.padding, nodeSpacing: 40, rankSpacing: 48 },
      sequence: { mirrorActors: false, useMaxWidth: false, messageFontSize: 13, actorFontSize: 13, noteFontSize: 13, height: 40, boxMargin: 8, actorMargin: 56 },
      gantt: { fontSize: 12, sectionFontSize: 12, barHeight: 22, barGap: 6, leftPadding: 56, useWidth: 760 },
    });
    inited = key;
  }

  /** 正文里的点击：顶栏按钮、图的缩放和全屏。处理了返回 true */
  onClick(e: MouseEvent): boolean {
    const t = e.target as Element;
    const mmd = t.closest<HTMLElement>('[data-mmd]');
    if (mmd) {
      mermaidAction(mmd);
      return true;
    }
    const wrap = t.closest<HTMLElement>('.md-code [data-wrap]');
    if (wrap) {
      const box = wrap.closest<HTMLElement>('.md-code')!;
      if (box.toggleAttribute('data-wrap')) wrap.dataset.on = '';
      else delete wrap.dataset.on;
      return true;
    }
    const btn = t.closest<HTMLElement>('.md-code [data-copy]');
    if (btn) {
      const code = btn.closest('.md-code')?.querySelector('code')?.textContent ?? '';
      void navigator.clipboard.writeText(code).then(() => {
        const swap = btn.querySelector<HTMLElement>('.swap');
        swap?.setAttribute('data-done', '');
        setTimeout(() => swap?.removeAttribute('data-done'), 1500);
      });
      return true;
    }
    return false;
  }
}
