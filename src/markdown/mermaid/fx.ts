import { lineSpans } from '../render'
import { enhanceSequence, SEQ_STYLES, type SeqStyle } from './seq'

// 移植自 fixcode-h/agent-panel 的 web/src/lib/mermaid-fx.ts（同一作者，Apache-2.0），去掉了设置页和多语言。
const t = (s: string, v: Record<string, string | number> = {}) => s.replace(/\{(\w+)\}/g, (_m, k: string) => String(v[k] ?? ''))
const copyText = (text: string, _o?: unknown) =>
  navigator.clipboard.writeText(text).then(
    () => true,
    () => false,
  )

/**
 * mermaid 图的外观和动效：主题变量、画好后的顶栏 / 画布 / 缩放按钮、出场动画、悬停高亮、拖动缩放、全屏。
 * 画图本身在 Markdown.tsx；这里只处理画出来的 SVG。动画、悬停、渐变底在设置 → Markdown 样式 → Mermaid 里可以关，
 * 开关落成 --md-mermaid-* 变量（'1' / '0'），画图时读一次。
 * 整体风格（--md-mermaid-look）落成 .md-mermaid 上的 data-look，配色全在 mermaid-looks.css：
 * 这里只给节点的形状标上种类（data-k：普通 / 判断 / 起止），不在 JS 里算颜色。
 */

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
/** 变量都定义在 .md-app 上（三套主题），不在根元素上 */
const css = () => getComputedStyle(document.querySelector('.md-app') ?? document.documentElement)
const on = (name: string) => css().getPropertyValue(`--md-mermaid-${name}`).trim() !== '0'

/**
 * mermaid 只认 hex / rgb 这类颜色，深色下的 --fg 是 color-mix（设置里的「深色文字亮度」往底色里混）：
 * 交给浏览器算出颜色，再画到 1px 画布上读回 rgb
 */
function plainColor(value: string) {
  if (!/^(color-mix|color)\(/.test(value)) return value
  const probe = document.createElement('span')
  probe.style.color = value
  ;(document.querySelector('.md-app') ?? document.body).appendChild(probe)
  const computed = getComputedStyle(probe).color
  probe.remove()
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return computed
  ctx.fillStyle = computed
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
  return `rgb(${r}, ${g}, ${b})`
}

const CURVES = ['rounded', 'basis', 'linear'] as const
const LOOKS = ['soft', 'tint', 'card', 'classic'] as const

/** 画图前要交给 mermaid.initialize 的版式：连线走法、节点内边距（菱形大小主要看它） */
export function mermaidLayout() {
  const c = css()
  const curve = c.getPropertyValue('--md-mermaid-curve').trim() as (typeof CURVES)[number]
  const padding = parseInt(c.getPropertyValue('--md-mermaid-pad'), 10)
  return { curve: CURVES.includes(curve) ? curve : 'rounded', padding: padding > 0 ? padding : 8 }
}

/** mermaid 的主题变量：颜色都从 index.css 的 --md-* / --mmd-* 读，深浅色、配色跟着面板走 */
export function mermaidThemeVars(dark: boolean): Record<string, string | boolean> {
  const c = css()
  const v = (k: string) => c.getPropertyValue(k).trim()
  const bg = v('--code-bg')
  const fg = plainColor(v('--fg'))
  const line = v('--line')
  const hue = ['--md-blue', '--md-violet', '--md-teal', '--md-gold', '--md-coral', '--md-gray'].map(v)
  const tint = ['--mmd-node-b', '--mmd-pick-b', '--mmd-end-b', '--mmd-note', '--mmd-crit', '--mmd-node-b'].map(v)
  const out: Record<string, string | boolean> = {
    darkMode: dark,
    fontSize: '13px',
    background: bg,
    primaryColor: v('--mmd-node-b'),
    primaryBorderColor: v('--mmd-node-line'),
    primaryTextColor: fg,
    secondaryColor: v('--mmd-pick-b'),
    secondaryBorderColor: v('--mmd-pick-line'),
    secondaryTextColor: fg,
    tertiaryColor: v('--mmd-end-b'),
    tertiaryBorderColor: v('--mmd-end-line'),
    tertiaryTextColor: fg,
    mainBkg: v('--mmd-node-b'),
    nodeBorder: v('--mmd-node-line'),
    nodeTextColor: fg,
    lineColor: v('--mmd-edge'),
    textColor: fg,
    titleColor: v('--md-gold'),
    edgeLabelBackground: bg,
    clusterBkg: bg,
    clusterBorder: line,
    actorBkg: v('--mmd-node-b'),
    actorBorder: v('--mmd-node-line'),
    actorTextColor: fg,
    actorLineColor: line,
    signalColor: v('--muted'),
    signalTextColor: fg,
    labelBoxBkgColor: v('--mmd-pick-b'),
    labelBoxBorderColor: v('--mmd-pick-line'),
    labelTextColor: fg,
    loopTextColor: fg,
    noteBkgColor: v('--mmd-note'),
    noteBorderColor: v('--mmd-note-line'),
    noteTextColor: fg,
    activationBkgColor: v('--mmd-pick-b'),
    activationBorderColor: v('--mmd-pick-line'),
    sequenceNumberColor: bg,
    pieStrokeColor: bg,
    pieStrokeWidth: '2px',
    pieOuterStrokeColor: line,
    pieTitleTextColor: fg,
    pieSectionTextColor: bg,
    pieLegendTextColor: fg,
    pieOpacity: '0.92',
    sectionBkgColor: v('--panel'),
    altSectionBkgColor: bg,
    sectionBkgColor2: v('--panel'),
    taskBkgColor: v('--mmd-node-b'),
    taskBorderColor: hue[0],
    taskTextColor: fg,
    taskTextLightColor: fg,
    taskTextOutsideColor: fg,
    taskTextDarkColor: fg,
    activeTaskBkgColor: v('--mmd-note'),
    activeTaskBorderColor: hue[3],
    doneTaskBkgColor: v('--mmd-end-b'),
    doneTaskBorderColor: hue[2],
    critBkgColor: v('--mmd-crit'),
    critBorderColor: hue[4],
    gridColor: line,
    todayLineColor: hue[4],
    classText: fg,
    stateLabelColor: fg,
    stateBkg: v('--mmd-node-b'),
    altBackground: v('--mmd-pick-b'),
    compositeBackground: bg,
    transitionColor: v('--mmd-edge'),
    attributeBackgroundColorOdd: bg,
    attributeBackgroundColorEven: v('--panel'),
    commitLabelColor: fg,
    commitLabelBackground: bg,
    tagLabelColor: fg,
    tagLabelBackground: v('--mmd-pick-b'),
    tagLabelBorder: v('--mmd-pick-line'),
  }
  // 饼图、Git 分支、思维导图的分支各取一种色相
  hue.forEach((h, i) => {
    out[`pie${i + 1}`] = h
    out[`git${i}`] = h
    out[`gitBranchLabel${i}`] = bg
    out[`cScale${i}`] = tint[i]
    out[`cScaleLabel${i}`] = fg
  })
  out.git6 = hue[0]
  out.git7 = hue[1]
  return out
}

/** SVG 上 aria-roledescription 写的图类型 → 顶栏里显示的名字 */
const TYPE_NAMES: Record<string, () => string> = {
  flowchart: () => t('流程图'),
  sequence: () => t('时序图'),
  pie: () => t('饼图'),
  stateDiagram: () => t('状态图'),
  gantt: () => t('甘特图'),
  classDiagram: () => t('类图'),
  mindmap: () => t('思维导图'),
  gitGraph: () => t('Git 图'),
  er: () => t('ER 图'),
}

/** 画好后的整块：顶栏（类型、复制源码、复制 SVG、全屏）+ 可拖动缩放的画布 + 收起的源码 */
export function mermaidHtml(svg: string, src: string) {
  const role = /aria-roledescription="([^"]+)"/.exec(svg)?.[1] ?? ''
  const type = TYPE_NAMES[role.replace(/-v\d+$/, '')]?.() ?? role
  const lines = lineSpans(escape(src))
  const btn = (act: string, label: string) =>
    `<button type="button" class="md-copy" data-mmd="${act}">${escape(label)}</button>`
  return (
    `<div class="md-code-bar"><span class="md-code-lang">mermaid${type ? ` <small>· ${escape(type)}</small>` : ''}</span>` +
    `<span class="md-code-acts">${btn('src', t('复制源码'))}${btn('svg', t('复制 SVG'))}${btn('full', t('全屏'))}</span></div>` +
    `<div class="md-mmd-canvas"><div class="md-mermaid-svg">${svg}</div>` +
    `<div class="md-mmd-zoom">${btn('out', '−')}<span>100%</span>${btn('in', '+')}${btn('reset', '⟲')}</div></div>` +
    `<details><summary>${escape(t('源码 · {n} 行', { n: lines.count }))}</summary><pre><code>${lines.html}</code></pre></details>`
  )
}

/** 画不出来：顶栏标红、写出原因，下面是带行号的源码，复制按钮照常可用 */
export function mermaidErrorHtml(src: string, why: string) {
  const lines = lineSpans(escape(src))
  return (
    `<div class="md-code-bar"><span class="md-code-lang">mermaid · ${escape(t('图的语法有误，显示源码'))}</span>` +
    `<span class="md-code-acts"><button type="button" class="md-copy" data-mmd="src">${t('复制')}</button></span></div>` +
    (why ? `<div class="md-mmd-why">${escape(why)}</div>` : '') +
    `<pre><code>${lines.html}</code></pre>`
  )
}

const SVG_NS = 'http://www.w3.org/2000/svg'

/** 节点形状按种类标上 data-k：普通蓝、判断、起止，颜色由 mermaid-looks.css 按当前风格给 */
const KINDS = [
  ['node', '.node rect.basic, rect.actor'],
  ['pick', '.node polygon'],
  ['end', '.node .outer-path > path:first-child, .node circle.basic'],
] as const

/** 用户在图里自己写了 style / classDef 颜色的节点不动：mermaid 把它写进形状的 style 属性 */
const userPainted = (el: Element) => /fill\s*:/.test(el.getAttribute('style') ?? '')

function tagKinds(svg: SVGSVGElement, type: string) {
  // 类图、ER 图的方框也画成 outer-path（和流程图的圆角起止节点一样），按普通节点上色
  const boxes = /classDiagram|^er/.test(type)
  for (const [k, sel] of KINDS)
    svg.querySelectorAll<SVGElement>(sel).forEach((el) => {
      if (userPainted(el)) return
      el.dataset.k = boxes && k === 'end' ? 'node' : k
      // 圆角起止节点是两条路径：前一条只填色，后一条只描边
      const outline = el.nextElementSibling as SVGElement | null
      if (outline?.getAttribute('fill') === 'none') outline.dataset.ks = el.dataset.k
    })
  // 箭头跟着线的粗细走：mermaid 固定 8px，细线配大三角头重脚轻
  const edge = parseFloat(css().getPropertyValue('--md-mermaid-edge')) || 1.5
  const size = String(Math.round(4 + edge * 2))
  svg.querySelectorAll('marker.flowchart-v2').forEach((m) => {
    m.setAttribute('markerWidth', size)
    m.setAttribute('markerHeight', size)
  })
}

/** 饼图扇区和图例色块按顺序标 data-c（0–5），颜色由当前风格的 --mx-c* 给，两者一一对上 */
function tagSeries(svg: SVGSVGElement) {
  svg.querySelectorAll('.pieCircle').forEach((p, i) => ((p as SVGElement).dataset.c = String(i % 6)))
  svg.querySelectorAll('g.legend rect').forEach((r, i) => ((r as SVGElement).dataset.c = String(i % 6)))
}

/** 节点换成上浅下深的渐变底（mermaid 只认纯色，渐变要自己加 defs）；两端颜色是当前风格的 --mx-<种类>-a / -b */
function gradients(svg: SVGSVGElement) {
  const defs = document.createElementNS(SVG_NS, 'defs')
  for (const [k] of KINDS) {
    const id = `${svg.id}-${k}`
    defs.insertAdjacentHTML(
      'beforeend',
      `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--mx-${k}-a)"/><stop offset="1" style="stop-color:var(--mx-${k}-b)"/></linearGradient>`,
    )
    svg.querySelectorAll<SVGElement>(`[data-k="${k}"]`).forEach((el) => {
      el.style.setProperty('--mx-g', `url(#${id})`)
      el.dataset.g = ''
    })
  }
  svg.prepend(defs)
}

const num = (el: Element, i: number) => (el as HTMLElement).style.setProperty('--i', String(i))

/** 给出场动画编号：节点、线、线上的字、饼图扇区、甘特条、时序消息各有各的顺序 */
function stagger(svg: SVGSVGElement) {
  svg
    .querySelectorAll(
      '.nodes > .node, .node.mindmap-node, rect.actor.actor-top, text.actor-box, circle.commit, .branchLabel, .commit-label-bkg, text.commit-label, g.legend',
    )
    .forEach((n, i) => {
      n.classList.add('mx-node')
      num(n, i)
    })
  svg.querySelectorAll<SVGGeometryElement>('.edgePaths path, line.branch, path.arrow').forEach((p, i) => {
    p.classList.add('mx-edge')
    num(p, i)
    if (/dotted|dashed/.test(p.getAttribute('class') ?? '')) p.classList.add('dash')
    // 画线动画要知道线有多长
    try {
      p.style.setProperty('--len', String(Math.ceil(p.getTotalLength()) + 2))
    } catch {
      p.classList.add('dash')
    }
  })
  svg.querySelectorAll('.edgeLabels .edgeLabel').forEach((l, i) => {
    l.classList.add('mx-label')
    num(l, i)
  })
  svg.querySelectorAll('rect.task').forEach(num)
  // 饼图：每块以圆心缩放；悬停时沿自己的角度往外弹一点
  svg.querySelectorAll<SVGGraphicsElement>('.pieCircle').forEach((p, i) => {
    const m = /translate\(([-\d.]+)[ ,]+([-\d.]+)/.exec(p.parentElement?.getAttribute('transform') ?? '')
    const b = p.getBBox()
    const mx = b.x + b.width / 2
    const my = b.y + b.height / 2
    const len = Math.hypot(mx, my) || 1
    p.style.transformOrigin = `${m ? m[1] : 0}px ${m ? m[2] : 0}px`
    p.style.setProperty('--dx', `${((mx / len) * 7).toFixed(1)}px`)
    p.style.setProperty('--dy', `${((my / len) * 7).toFixed(1)}px`)
    num(p, i)
  })
  // 时序图：按从上到下的位置一条条出现，同一高度的（线、文字、序号）一起
  const seq = [
    ...svg.querySelectorAll<SVGGraphicsElement>(
      '.messageLine0, .messageLine1, .messageText, .sequenceNumber, rect.note, .noteText, rect[class^=activation], .sq-step, .sq-pill, .sq-note-bar',
    ),
  ]
  if (seq.length) {
    const rows = seq.map((e) => Math.round(e.getBBox().y / 34))
    const order = [...new Set(rows)].sort((a, b) => a - b)
    seq.forEach((e, i) => {
      e.classList.add('mx-seq')
      num(e, order.indexOf(rows[i]) + 3)
    })
    svg.querySelectorAll('line.actor-line').forEach((l) => {
      l.classList.add('mx-seq')
      num(l, 2)
    })
  }
}

/** 流程图、状态图、ER 图：悬停一个节点时它和相连的节点、线高亮，其余变淡 */
function hoverLinks(svg: SVGSVGElement) {
  const key = (n: Element) =>
    (/flowchart-(.+)-\d+$/.exec(n.id) ?? /state-(.+?)-\d+$/.exec(n.id) ?? /entity-(.+?)-/.exec(n.id))?.[1]
  const nodes = [...svg.querySelectorAll('.nodes > .node')]
  const edges = [...svg.querySelectorAll<SVGElement>('.edgePaths path')]
  const labels = [...svg.querySelectorAll('.edgeLabels .edgeLabel')]
  for (const n of nodes) {
    const k = key(n)
    if (!k) continue
    n.addEventListener('mouseenter', () => {
      svg.classList.add('mx-focus')
      n.classList.add('hot')
      edges.forEach((e, i) => {
        // 线的 id 是 L_<起点>_<终点>_<序号>
        const id = e.dataset.id ?? ''
        if (!id.startsWith(`L_${k}_`) && !id.endsWith(`_${k}_${id.split('_').pop()}`)) return
        e.classList.add('hot')
        labels[i]?.classList.add('hot')
        const other = id.replace(/^L_/, '').replace(/_\d+$/, '').split('_')
        nodes.forEach((o) => other.includes(key(o) ?? '\0') && o.classList.add('hot'))
      })
    })
    n.addEventListener('mouseleave', () => {
      svg.classList.remove('mx-focus')
      svg.querySelectorAll('.hot').forEach((x) => x.classList.remove('hot'))
    })
  }
}

type Zoom = { z: number; x: number; y: number }
const zooms = new WeakMap<HTMLElement, Zoom>()

function setZoom(box: HTMLElement, next: Zoom) {
  zooms.set(box, next)
  const view = box.querySelector<HTMLElement>('.md-mermaid-svg')
  view?.style.setProperty('--mz', String(next.z))
  view?.style.setProperty('--mx', `${next.x}px`)
  view?.style.setProperty('--my', `${next.y}px`)
  const label = box.querySelector('.md-mmd-zoom span')
  if (label) label.textContent = `${Math.round(next.z * 100)}%`
}
const zoomOf = (box: HTMLElement) => zooms.get(box) ?? { z: 1, x: 0, y: 0 }
const clampZ = (z: number) => Math.min(4, Math.max(0.4, z))

/** 画布：拖动平移，Ctrl / ⌘ + 滚轮缩放（全屏里直接滚轮），双击复位 */
function panZoom(box: HTMLElement, wheelAlways = false) {
  const canvas = box.querySelector<HTMLElement>('.md-mmd-canvas')
  if (!canvas) return
  canvas.addEventListener(
    'wheel',
    (e) => {
      if (!wheelAlways && !e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const cur = zoomOf(box)
      setZoom(box, { ...cur, z: clampZ(cur.z * (e.deltaY < 0 ? 1.1 : 1 / 1.1)) })
    },
    { passive: false },
  )
  canvas.addEventListener('dblclick', () => setZoom(box, { z: 1, x: 0, y: 0 }))
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || (e.target as Element).closest('.md-mmd-zoom')) return
    const start = zoomOf(box)
    const sx = e.clientX
    const sy = e.clientY
    let moved = false
    const move = (ev: PointerEvent) => {
      // 挪动超过几个像素才算拖动，单击节点、选文字不受影响
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return
      if (!moved) {
        moved = true
        canvas.dataset.drag = ''
        canvas.setPointerCapture(e.pointerId)
      }
      setZoom(box, { ...start, x: start.x + ev.clientX - sx, y: start.y + ev.clientY - sy })
    }
    const up = () => {
      delete canvas.dataset.drag
      canvas.removeEventListener('pointermove', move)
    }
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up, { once: true })
    canvas.addEventListener('pointercancel', up, { once: true })
  })
}

/** 画好的图加上渐变、动画编号、悬停高亮和拖动缩放；最后加 mx-in 开始出场动画 */
export function enhanceMermaid(box: HTMLElement, opts: { replay?: boolean; still?: boolean } = {}) {
  const svg = box.querySelector<SVGSVGElement>('.md-mermaid-svg svg')
  if (!svg) return
  const type = svg.getAttribute('aria-roledescription') ?? ''
  const look = css().getPropertyValue('--md-mermaid-look').trim() as (typeof LOOKS)[number]
  box.dataset.look = LOOKS.includes(look) ? look : 'soft'
  if (!opts.replay) tagSeries(svg)
  if (/^sequence/.test(type)) {
    const seq = css().getPropertyValue('--md-mermaid-seq').trim() as SeqStyle
    box.dataset.seq = SEQ_STYLES.includes(seq) ? seq : 'steps'
    const note = css().getPropertyValue('--md-mermaid-seqNote').trim()
    if (['stripe', 'block', 'aside'].includes(note)) box.dataset.seqNote = note
    else delete box.dataset.seqNote
    enhanceSequence(svg, box.dataset.seq as SeqStyle, on('seqColor'))
  }
  if (!/mindmap|pie|gantt|gitGraph/.test(type) && !opts.replay) {
    tagKinds(svg, type)
    if (on('gradient')) gradients(svg)
  }
  // still：编辑时重新渲染、图没变（从缓存取的），不再放一遍出场动画
  if (on('motion') && !opts.still) {
    stagger(svg)
    requestAnimationFrame(() => box.classList.add('mx-in'))
  }
  if (on('hover')) hoverLinks(svg)
  panZoom(box)
}

/**
 * 全屏看图：铺满整个窗口（不再是遮罩里的弹窗），顶栏中间「图形 / 源码」切换，Esc 或「关闭」退出。
 * 把这张图复制一份放进去，源码页用收起的那份带行号的源码
 */
function fullscreen(box: HTMLElement) {
  const wrap = document.createElement('div')
  wrap.className = 'md-mmd-full'
  wrap.dataset.view = 'graph'
  const panel = document.createElement('div')
  panel.className = 'md-body'
  // 正文字号（--md-base）写在正文元素上，全屏层里照搬一份
  panel.style.cssText = box.closest<HTMLElement>('.md-body')?.style.cssText ?? ''
  const copy = box.cloneNode(true) as HTMLElement
  copy.classList.remove('mx-in')
  // 收起的源码挪成源码页：整页滚动、带行号，可以选中复制
  const code = copy.querySelector('details pre')
  copy.querySelector('details')?.remove()
  const src = document.createElement('div')
  src.className = 'md-mmd-src'
  if (code) src.append(code)
  copy.append(src)
  const close = copy.querySelector<HTMLElement>('[data-mmd="full"]')
  if (close) {
    close.textContent = t('关闭')
    close.title = 'Esc'
  }
  const seg = (view: string, label: string) =>
    `<button type="button" role="radio" data-mmd-view="${view}" aria-checked="${view === 'graph'}">${escape(label)}</button>`
  copy
    .querySelector('.md-code-lang')
    ?.insertAdjacentHTML(
      'afterend',
      `<span class="md-mmd-views" role="radiogroup" aria-label="${escape(t('看图形还是源码'))}">${seg('graph', t('图形'))}${seg('src', t('源码'))}</span>`,
    )
  panel.append(copy)
  wrap.append(panel)
  ;(box.closest('.md-app') ?? document.body).append(wrap)
  // 复制出来的 SVG 和原图同 id：不改，mermaid 自带的样式表按 #id 选中，改了就丢样式
  copy.querySelector('svg')?.classList.remove('mx-focus')
  copy.querySelectorAll('.hot').forEach((x) => x.classList.remove('hot'))
  enhanceMermaid(copy, { replay: true })
  panZoom(copy, true)
  const show = (view: string) => {
    wrap.dataset.view = view
    wrap.querySelectorAll<HTMLElement>('[data-mmd-view]').forEach((b) => {
      b.setAttribute('aria-checked', String(b.dataset.mmdView === view))
    })
  }
  const done = () => {
    wrap.remove()
    removeEventListener('keydown', onKey, true)
  }
  // 图在弹窗（诊断报告、Radix Dialog）里时，弹窗在 document 捕获阶段收 Esc、把 body 设成不可点、
  // 把焦点和「点到外面」都拦回去：全屏挂在 body 上就点不动也退不出。这里在 window 捕获阶段先收 Esc，
  // 并把按下、焦点事件留在全屏层里，不让弹窗以为点到了外面而关掉
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    e.stopImmediatePropagation()
    e.preventDefault()
    done()
  }
  addEventListener('keydown', onKey, true)
  for (const type of ['pointerdown', 'focusin', 'focusout']) wrap.addEventListener(type, (e) => e.stopPropagation())
  wrap.addEventListener('click', (e) => {
    const target = e.target as Element
    const view = target.closest<HTMLElement>('[data-mmd-view]')?.dataset.mmdView
    if (view) return show(view)
    const act = target.closest<HTMLElement>('[data-mmd]')
    if (act?.dataset.mmd === 'full') return done()
    if (act) mermaidAction(act)
  })
}

/** 顶栏、缩放按钮的点击（Markdown.tsx 用事件委托转过来） */
export function mermaidAction(btn: HTMLElement) {
  const box = btn.closest<HTMLElement>('.md-mermaid')
  if (!box) return
  const act = btn.dataset.mmd
  const cur = zoomOf(box)
  if (act === 'in') return setZoom(box, { ...cur, z: clampZ(cur.z * 1.25) })
  if (act === 'out') return setZoom(box, { ...cur, z: clampZ(cur.z / 1.25) })
  if (act === 'reset') return setZoom(box, { z: 1, x: 0, y: 0 })
  if (act === 'full') return fullscreen(box)
  const text =
    act === 'svg'
      ? (box.querySelector('.md-mermaid-svg svg')?.outerHTML ?? '')
      : (box.dataset.src ?? box.querySelector('code')?.textContent ?? '')
  const label = btn.textContent
  void copyText(text, { fail: false }).then((ok) => {
    if (!ok) return
    btn.textContent = t('已复制')
    btn.dataset.on = ''
    setTimeout(() => {
      btn.textContent = label
      delete btn.dataset.on
    }, 1500)
  })
}
