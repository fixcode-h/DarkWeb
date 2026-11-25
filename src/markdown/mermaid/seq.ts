/**
 * 时序图的几种样式（设置 → Markdown 样式 → Mermaid 图 → 时序图样式：素净 / 泳道 / 步骤 / 卡片），
 * 落成 .md-mermaid 上的 data-seq，配色在 mermaid-seq.css。
 * mermaid 画出来的时序图只有一种样子，这里在画好的 SVG 上补结构：
 * - 每个参与者按从左到右的顺序编号（data-p），它的方框、生命线、它发出的消息都带同一个编号，CSS 按编号给色相；
 * - 箭头头是 <marker>，CSS 改不了单条线的箭头色，按色相各复制一份；
 * - 泳道样式在生命线后面垫一列列底色；步骤样式在每条消息起点画序号；
 * - 注释和消息文字改成靠左对齐（注释左边一道色条），线上文字可以垫一枚胶囊底。
 * 只加东西、改对齐，不动 mermaid 算好的位置，复制 SVG 拿到的还是一张完整的图。
 */

const SVG_NS = 'http://www.w3.org/2000/svg'
export const SEQ_STYLES = ['soft', 'lane', 'steps', 'pill'] as const
export type SeqStyle = (typeof SEQ_STYLES)[number]
const HUES = 6

const el = (tag: string, attrs: Record<string, string | number>) => {
  const n = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v))
  return n
}

/** 文字的宽高：图藏着（页签没切过来）时 getBBox 是 0，按字数估一个，不至于画出一枚扁胶囊 */
function textBox(t: SVGTextElement) {
  const b = t.getBBox()
  if (b.width > 0) return b
  const size = parseFloat(t.style.fontSize) || 16
  const len = [...(t.textContent ?? '')].reduce((n, c) => n + (c.charCodeAt(0) > 0x2e80 ? 1 : 0.6), 0)
  const x = parseFloat(t.getAttribute('x') ?? '0')
  const y = parseFloat(t.getAttribute('y') ?? '0')
  return { x: x - (len * size) / 2, y, width: len * size, height: size * 1.3 }
}

/** 消息线的起点、终点：直线读 x1/x2，自己调自己是一段曲线，读 path 的头一个点 */
function ends(line: SVGElement) {
  if (line.tagName === 'line')
    return {
      x1: +(line.getAttribute('x1') ?? 0),
      x2: +(line.getAttribute('x2') ?? 0),
      y: +(line.getAttribute('y1') ?? 0),
    }
  const m = /M\s*([-\d.]+)[ ,]+([-\d.]+)/.exec(line.getAttribute('d') ?? '')
  const x = m ? +m[1] : 0
  return { x1: x, x2: x, y: m ? +m[2] : 0 }
}

/** 参与者方框的中线 */
function centerX(g: Element) {
  const r = g.querySelector('rect')
  return r ? +(r.getAttribute('x') ?? 0) + +(r.getAttribute('width') ?? 0) / 2 : 0
}

/** 按样式给画好的时序图补结构；同一张图只做一次（全屏复制出来的那份已经做过） */
export function enhanceSequence(svg: SVGSVGElement, style: SeqStyle, color = true) {
  if (svg.dataset.seqDone) return
  svg.dataset.seqDone = style
  // 参与者从左到右编号
  const heads = [...svg.querySelectorAll<SVGGElement>('[data-et="participant"]')]
  heads.sort((a, b) => centerX(a) - centerX(b))
  // 关了「参与者着色」时都标 n（中性色），版式照旧
  const index = new Map(heads.map((g, i) => [g.dataset.id ?? '', color ? String(i % HUES) : 'n']))
  const tag = (n: Element, id: string | null | undefined) => {
    const i = index.get(id ?? '')
    if (i !== undefined) (n as SVGElement).dataset.p = i
  }
  heads.forEach((g) => tag(g, g.dataset.id))
  svg.querySelectorAll('line.actor-line').forEach((l) => tag(l, l.getAttribute('data-id')))

  // 每种色相一个箭头头
  const head = svg.querySelector<SVGMarkerElement>(`marker[id$="-arrowhead"]`)
  if (head)
    for (const i of new Set(index.values())) {
      const copy = head.cloneNode(true) as SVGMarkerElement
      copy.id = `${head.id}-p${i}`
      copy.dataset.p = i
      head.after(copy)
    }

  const messages = [...svg.querySelectorAll<SVGElement>('[data-et="message"]')]
  messages.forEach((line, n) => {
    tag(line, line.dataset.from)
    const text = line.previousElementSibling
    if (text?.classList.contains('messageText')) tag(text, line.dataset.from)
    if (head && line.dataset.p && line.getAttribute('marker-end'))
      line.setAttribute('marker-end', `url(#${head.id}-p${line.dataset.p})`)
    if (style === 'steps') stepBadge(line, text as SVGTextElement | null, n + 1)
    if (style === 'pill' && text instanceof SVGTextElement) pill(text, line.dataset.p)
  })

  // 注释：文字靠左，左边一道色条
  svg.querySelectorAll<SVGGElement>('[data-et="note"]').forEach((g) => {
    const rect = g.querySelector('rect')
    const text = g.querySelector<SVGTextElement>('text')
    if (!rect || !text) return
    const x = +(rect.getAttribute('x') ?? 0)
    const y = +(rect.getAttribute('y') ?? 0)
    const h = +(rect.getAttribute('height') ?? 0)
    rect.after(el('rect', { x, y, width: 3, height: h, class: 'sq-note-bar' }))
    text.setAttribute('text-anchor', 'start')
    text.style.textAnchor = 'start'
    const left = String(x + 14)
    text.setAttribute('x', left)
    text.querySelectorAll('tspan').forEach((s) => s.setAttribute('x', left))
    // mermaid 按它自己量的字宽定框，换了字体常常窄一截、字压到框外：按实际字宽把框补宽
    const need = textBox(text).width + 28
    if (need > +(rect.getAttribute('width') ?? 0)) rect.setAttribute('width', String(need))
  })

  if (style === 'lane') lanes(svg, heads)
}

/** 泳道：每个参与者一列底色，列宽到左右邻居的中线，从方框一直铺到图底 */
function lanes(svg: SVGSVGElement, heads: SVGGElement[]) {
  const vb = svg.viewBox.baseVal
  const mids = heads.map(centerX)
  // 生命线画到 y=2000（超出 viewBox、靠 overflow 显示），底色列跟它一样长，往下拖也不断
  const bottom = Math.max(
    vb.y + vb.height,
    ...[...svg.querySelectorAll('line.actor-line')].map((l) => +(l.getAttribute('y2') ?? 0)),
  )
  const g = el('g', { class: 'sq-lanes' })
  mids.forEach((x, i) => {
    const left = i === 0 ? vb.x : (mids[i - 1] + x) / 2
    const right = i === mids.length - 1 ? vb.x + vb.width : (mids[i + 1] + x) / 2
    const lane = el('rect', { x: left, y: 0, width: right - left, height: bottom, class: 'sq-lane' })
    ;(lane as SVGElement).dataset.p = heads[i].dataset.p ?? '0'
    g.append(lane)
  })
  svg.prepend(g)
}

/** 步骤：消息起点一枚带序号的圆，消息文字挪到序号右边靠左 */
function stepBadge(line: SVGElement, text: SVGTextElement | null, n: number) {
  const { x1, x2, y } = ends(line)
  const toLeft = x2 < x1
  const g = el('g', { class: 'sq-step' })
  ;(g as SVGElement).dataset.p = line.dataset.p ?? '0'
  g.append(el('circle', { cx: x1, cy: y, r: 10 }))
  const num = el('text', { x: x1, y: y + 0.5, 'text-anchor': 'middle', 'dominant-baseline': 'central' })
  num.textContent = String(n)
  g.append(num)
  line.after(g)
  if (!text || x1 === x2) return
  // 文字贴着起点写，往箭头方向延伸，读起来像「1 谁 → 做了什么」
  const x = toLeft ? x1 - 18 : x1 + 18
  text.setAttribute('x', String(x))
  text.setAttribute('text-anchor', toLeft ? 'end' : 'start')
  text.style.textAnchor = toLeft ? 'end' : 'start'
}

/** 卡片：消息文字垫一枚胶囊底，压在线的正上方 */
function pill(text: SVGTextElement, p: string | undefined) {
  const b = textBox(text)
  const r = el('rect', {
    x: b.x - 10,
    y: b.y - 3,
    width: b.width + 20,
    height: b.height + 6,
    rx: (b.height + 6) / 2,
    class: 'sq-pill',
  })
  if (p) (r as SVGElement).dataset.p = p
  text.before(r)
}
