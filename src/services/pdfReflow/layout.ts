/**
 * PDF 重排的版面分析 (纯函数, 不依赖 MuPDF, 可在 node 里测试):
 *  1. 页眉页脚 / 页码: 页边带内跨页重复、或被页眉线隔开的行
 *  2. 图表区域: 位图与矢量聚簇; 框里多为正文字号的是文本框 (代码 / 提示), 其余整块裁成图
 *  3. 行分类: 标题 (字号 / 整行粗体) · 列表 (小圆点位图或符号) · 代码 (等宽) · 图注 · 目录引导线
 *  4. 段落还原: 行尾折行与真正的段落结束分开 (行是否到右边界、首行缩进、段间距), 跨页续段
 *
 * 微信读书把普通折行当成段落结束、在折行处多补空格 (docs/plans/pdf-reflow.md §1.1), 这里的规则就是为此写的.
 */
import type { Block, BookMetrics, RawPage, Rect, RLine, RSpan, RVector } from './types.ts'

// ---- 字符与文字 ----

const CJK_RE = /[⺀-⿿　-〿぀-ヿ㄀-ㇿ㐀-䶿一-鿿가-힯豈-﫿︰-﹏＀-￯]/
export const isCjk = (ch: string | undefined) => !!ch && CJK_RE.test(ch)

/** 句末标点 (行尾是它们时, 不满行的行才算段落结束; 满行时由版式风格决定) */
const TERMINAL_RE = /[。！？!?….．:：;；"”’）)」』】]$/

export function lineText(l: Pick<RLine, 'spans'>): string {
  return l.spans.map(s => s.text).join('')
}

const styleKey = (s: RSpan) => `${s.bold ? 1 : 0}${s.italic ? 1 : 0}${s.mono ? 1 : 0}`

/** 相邻同样式的 span 合并; 空 span 去掉 */
export function mergeSpans(spans: RSpan[]): RSpan[] {
  const out: RSpan[] = []
  for (const s of spans) {
    if (!s.text) continue
    const last = out[out.length - 1]
    if (last && styleKey(last) === styleKey(s)) last.text += s.text
    else out.push({ ...s })
  }
  return out
}

/**
 * 行内空白整理: 连续空白合一, 去掉行首尾空白; 等宽 (代码) 文字保持原样.
 * 中文之间的空格保留: MuPDF 只在字距确实拉开时补空格 (「第 2 章 上下文」、人名), 实测很少误补;
 * 微信读书「模 型」那样的多余空格出在折行处, 由 joinSpans 接行时不补空格解决.
 */
export function tidySpans(spans: RSpan[]): RSpan[] {
  const chars: Array<{ c: string; s: RSpan }> = []
  for (const s of spans) for (const c of s.text) chars.push({ c: c === ' ' || c === '\t' ? ' ' : c, s })
  const keep: Array<{ c: string; s: RSpan }> = []
  for (let i = 0; i < chars.length; i++) {
    const { c, s } = chars[i]
    if (c === ' ' && !s.mono) {
      const prev = keep[keep.length - 1]
      if (!prev || prev.c === ' ') continue
      let j = i + 1
      while (j < chars.length && chars[j].c === ' ') j++
      if (!chars[j]) continue
    }
    keep.push({ c, s })
  }
  while (keep.length && keep[keep.length - 1].c === ' ' && !keep[keep.length - 1].s.mono) keep.pop()
  const out: RSpan[] = []
  for (const { c, s } of keep) {
    const last = out[out.length - 1]
    if (last && styleKey(last) === styleKey(s)) last.text += c
    else out.push({ text: c, ...(s.bold ? { bold: true } : {}), ...(s.italic ? { italic: true } : {}), ...(s.mono ? { mono: true } : {}) })
  }
  return out
}

/**
 * 把两段文字接成一段: 西文行尾连字符断词还原, 中日韩之间不加空格, 其余补一个空格.
 */
export function joinSpans(a: RSpan[], b: RSpan[]): RSpan[] {
  if (!a.length) return b.map(s => ({ ...s }))
  if (!b.length) return a.map(s => ({ ...s }))
  const out = a.map(s => ({ ...s }))
  const last = out[out.length - 1]
  const first = b[0].text
  const prevText = last.text
  const lastCh = prevText[prevText.length - 1]
  const firstCh = first[0]
  if (lastCh === '-' && /[A-Za-z]/.test(prevText[prevText.length - 2] ?? '') && /[a-z]/.test(firstCh ?? '')) {
    last.text = prevText.slice(0, -1)
  } else if (!(isCjk(lastCh) || isCjk(firstCh) || lastCh === ' ' || firstCh === ' ' || lastCh === '/' || lastCh === '-')) {
    last.text += ' '
  }
  return mergeSpans([...out, ...b.map(s => ({ ...s }))])
}

// ---- 几何 ----

const area = (r: Rect) => Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0)
const union = (a: Rect, b: Rect): Rect => ({
  x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1),
})
const near = (a: Rect, b: Rect, gap: number) =>
  a.x0 - gap <= b.x1 && b.x0 - gap <= a.x1 && a.y0 - gap <= b.y1 && b.y0 - gap <= a.y1
/** 两矩形的最短距离 (相交为 0) */
const distance = (a: Rect, b: Rect) => {
  const dx = Math.max(0, a.x0 - b.x1, b.x0 - a.x1)
  const dy = Math.max(0, a.y0 - b.y1, b.y0 - a.y1)
  return Math.hypot(dx, dy)
}
const centerInside = (l: Rect, r: Rect, pad = 1) => {
  const cx = (l.x0 + l.x1) / 2
  const cy = (l.y0 + l.y1) / 2
  return cx >= r.x0 - pad && cx <= r.x1 + pad && cy >= r.y0 - pad && cy <= r.y1 + pad
}
const isThin = (r: Rect) => r.x1 - r.x0 <= 2.5 || r.y1 - r.y0 <= 2.5

/** 取众数 (按 step 量化); 平票取较小值 */
function mode(xs: number[], step = 1): number {
  const counts = new Map<number, number>()
  for (const x of xs) {
    const k = Math.round(x / step) * step
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  let best = 0
  let bestN = -1
  for (const [k, n] of counts) if (n > bestN || (n === bestN && k < best)) { best = k; bestN = n }
  return best
}

const visibleChars = (l: Pick<RLine, 'spans'>) => lineText(l).replace(/\s/g, '').length

// ---- 页眉页脚 ----

const PAGE_NUMBER_RE = /^[\s\-–—·•|]*(?:第\s*)?(?:\d{1,4}|[ivxlcdm]{1,7})(?:\s*页)?(?:\s*[/／]\s*\d{1,4})?[\s\-–—·•|]*$/i

/** 页眉 / 页脚线: 页边附近的细横线, 宽度过半页 */
function edgeRules(p: RawPage): { top?: number; bottom?: number } {
  let top: number | undefined
  let bottom: number | undefined
  for (const v of p.vectors) {
    if (v.y1 - v.y0 > 2.5 || v.x1 - v.x0 < p.w * 0.5) continue
    if (v.y1 <= p.h * 0.13) top = Math.max(top ?? -Infinity, v.y1)
    else if (v.y0 >= p.h * 0.87) bottom = Math.min(bottom ?? Infinity, v.y0)
  }
  return { top, bottom }
}

const headKey = (l: RLine) => lineText(l).replace(/\s+/g, '').replace(/\d+/g, '#')

/**
 * 找出页眉、页脚、页码行. 返回要去掉的行.
 * - 页眉线以上 / 页脚线以下的行
 * - 页边带 (顶 8% / 底 8%) 内, 同一文字 (数字归一) 在 ≥3 页出现, 或本身就是页码
 */
export function findRunningHeads(pages: RawPage[]): Set<RLine> {
  const removed = new Set<RLine>()
  const counts = new Map<string, number>()
  const bands: Array<{ line: RLine; key: string }> = []
  for (const p of pages) {
    const rules = edgeRules(p)
    const seen = new Set<string>()
    for (const l of p.lines) {
      const inTop = l.y1 <= p.h * 0.08 || (rules.top !== undefined && l.y1 <= rules.top + 1)
      const inBottom = l.y0 >= p.h * 0.92 || (rules.bottom !== undefined && l.y0 >= rules.bottom - 1)
      if (!inTop && !inBottom) continue
      if ((rules.top !== undefined && inTop && l.y1 <= rules.top + 1) || (rules.bottom !== undefined && inBottom && l.y0 >= rules.bottom - 1)) {
        removed.add(l)
        continue
      }
      const text = lineText(l).trim()
      if (PAGE_NUMBER_RE.test(text)) {
        removed.add(l)
        continue
      }
      const key = `${inTop ? 't' : 'b'}:${headKey(l)}`
      bands.push({ line: l, key })
      if (!seen.has(key)) {
        seen.add(key)
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    }
  }
  for (const { line, key } of bands) if ((counts.get(key) ?? 0) >= 3) removed.add(line)
  return removed
}

// ---- 整书统计 ----

/** 书的版式统计: 正文字号、行距、首行缩进风格、标题字号级别 */
export function bookMetrics(pages: RawPage[], removed: Set<RLine>): BookMetrics {
  const sizeChars = new Map<number, number>()
  for (const p of pages) for (const l of p.lines) {
    if (removed.has(l) || l.vertical) continue
    const k = Math.round(l.size * 2) / 2
    sizeChars.set(k, (sizeChars.get(k) ?? 0) + visibleChars(l))
  }
  let bodySize = 10
  let best = -1
  for (const [k, n] of sizeChars) if (n > best) { best = n; bodySize = k }

  const isBody = (l: RLine) => !removed.has(l) && !l.mono && Math.abs(l.size - bodySize) <= bodySize * 0.1
  const pitches: number[] = []
  let indented = 0
  let bodyLines = 0
  for (const p of pages) {
    const body = p.lines.filter(isBody).sort((a, b) => a.y0 - b.y0)
    if (body.length < 3) continue
    const left = pageLeft(body)
    for (let i = 0; i < body.length; i++) {
      const l = body[i]
      bodyLines++
      const off = l.x0 - left
      if (off >= l.size * 0.8 && off <= l.size * 4.5) indented++
      const prev = body[i - 1]
      if (prev && Math.abs(prev.x0 - l.x0) < l.size * 5) {
        const dy = l.y0 - prev.y0
        if (dy > l.size * 0.9 && dy < l.size * 3) pitches.push(dy)
      }
    }
  }
  const pitch = pitches.length ? mode(pitches, 0.25) : bodySize * 1.45
  // 只出现一次的大字号 (封面书名、扉页) 不占标题级别
  const sizeLines = new Map<number, number>()
  for (const p of pages) for (const l of p.lines) {
    if (removed.has(l) || l.vertical) continue
    const k = Math.round(l.size * 2) / 2
    sizeLines.set(k, (sizeLines.get(k) ?? 0) + 1)
  }
  const headingSizes = [...sizeChars.keys()]
    .filter(s => s >= bodySize * 1.18 && (sizeLines.get(s) ?? 0) >= 2)
    .sort((a, b) => b - a)
  return {
    bodySize,
    pitch: pitch > bodySize * 0.9 ? pitch : bodySize * 1.45,
    indentStyle: bodyLines > 0 && indented / bodyLines >= 0.05,
    headingSizes,
  }
}

/** 正文左边界: 至少四分之一正文行共享的最小 x0 */
function pageLeft(body: RLine[]): number {
  const counts = new Map<number, number>()
  for (const l of body) {
    const k = Math.round(l.x0)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const need = Math.max(2, body.length * 0.25)
  const frequent = [...counts].filter(([, n]) => n >= need).map(([k]) => k)
  return frequent.length ? Math.min(...frequent) : Math.min(...body.map(l => l.x0))
}

/** 正文右边界: 正文行 x1 的众数 (中文标点悬挂会略超出, 「满行」判断留了余量) */
function pageRight(body: RLine[]): number {
  const long = body.filter(l => l.x1 - l.x0 > (l.size * 8))
  const xs = (long.length ? long : body).map(l => l.x1)
  const m = mode(xs, 1)
  // 众数可能落在短行上 (比如全是代码): 取 90 分位与众数中较大者
  const s = [...xs].sort((a, b) => a - b)
  return Math.max(m, s[Math.floor(s.length * 0.9)] ?? m)
}

// ---- 图表区域 ----

interface Figure extends Rect {
  raster: boolean
}

interface PageAnalysis {
  figures: Figure[]
  /** 被图吃掉的行 (标签文字) */
  consumed: Set<RLine>
  /** 文本框里的行 (非等宽的标为引用框) */
  boxed: Set<RLine>
  /** 代码框里的行 (整行按代码排, 即使夹着中文) */
  code: Set<RLine>
  bullets: Set<RLine>
  quoted: Set<RLine>
}

const CAPTION_RE = /^\s*(?:图|表|圖|插图|Figure|Fig\.?|Table|Chart|Exhibit)\s*[\dA-Za-z一二三四五六七八九十]+(?:\s*[-–.．:：]\s*\d+)?/i

function clusterRects<T extends Rect>(rects: T[], gap: number): T[][] {
  const n = rects.length
  const parent = rects.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const order = rects.map((_, i) => i).sort((a, b) => rects[a].x0 - rects[b].x0)
  for (let a = 0; a < n; a++) {
    const ra = rects[order[a]]
    for (let b = a + 1; b < n; b++) {
      const rb = rects[order[b]]
      if (rb.x0 - gap > ra.x1) break
      if (near(ra, rb, gap)) parent[find(order[a])] = find(order[b])
    }
  }
  const groups = new Map<number, T[]>()
  for (let i = 0; i < n; i++) {
    const r = find(i)
    const g = groups.get(r)
    if (g) g.push(rects[i])
    else groups.set(r, [rects[i]])
  }
  return [...groups.values()]
}

/** 一页里的图表区域、文本框、列表圆点与引用竖线 */
export function analyzePage(p: RawPage, lines: RLine[], m: BookMetrics): PageAnalysis {
  const body = m.bodySize
  const pageArea = p.w * p.h
  const out: PageAnalysis = { figures: [], consumed: new Set(), boxed: new Set(), code: new Set(), bullets: new Set(), quoted: new Set() }
  const inBand = (r: Rect) => r.y1 <= p.h * 0.08 || r.y0 >= p.h * 0.92

  // 小圆点: 很小的位图 / 矢量 (列表符号)
  const dots: Rect[] = []
  const shapes: Array<Rect & { raster: boolean; thin: boolean }> = []
  for (const im of p.images) {
    const w = im.x1 - im.x0
    const h = im.y1 - im.y0
    if (Math.max(w, h) <= Math.max(8, body * 0.9)) dots.push(im)
    else if (w >= 12 && h >= 12) shapes.push({ ...im, raster: true, thin: false })
  }
  const bars: RVector[] = []
  for (const v of p.vectors) {
    if (inBand(v)) continue
    const w = v.x1 - v.x0
    const h = v.y1 - v.y0
    if (area(v) >= pageArea * 0.8) continue
    if (!isThin(v) && Math.max(w, h) <= Math.max(6, body * 0.7)) { dots.push(v); continue }
    shapes.push({ ...v, raster: false, thin: isThin(v) })
    if (w <= 3 && h >= body * 1.5) bars.push(v)
  }

  for (const l of lines) {
    const cy = (l.y0 + l.y1) / 2
    if (dots.some(d => d.x1 <= l.x0 + 1 && d.x1 >= l.x0 - l.size * 2.5 && (d.y0 + d.y1) / 2 >= l.y0 - 1 && (d.y0 + d.y1) / 2 <= l.y1 + 1)) out.bullets.add(l)
    if (bars.some(b => l.x0 - b.x1 >= -1 && l.x0 - b.x1 <= l.size * 3 && cy >= b.y0 && cy <= b.y1)) out.quoted.add(l)
  }

  if (shapes.length > 4000) {
    // 图形极多 (曲线图 / 地图): 整页图形合成一块
    const all = shapes.filter(s => !s.thin).reduce<Rect | null>((u, s) => (u ? union(u, s) : s), null)
    if (all) shapes.splice(0, shapes.length, { ...all, raster: shapes.some(s => s.raster), thin: false })
  }

  const textLen = (ls: RLine[]) => ls.reduce((n, l) => n + visibleChars(l), 0)
  const textLeft = Math.min(...lines.map(l => l.x0), p.w)
  const textRight = Math.max(...lines.map(l => l.x1), 0)
  const textWidth = Math.max(1, textRight - textLeft)
  for (const group of clusterRects(shapes, 4)) {
    const raster = group.some(g => g.raster)
    let box = group.reduce<Rect>((u, g) => union(u, g), group[0])
    const w = box.x1 - box.x0
    const h = box.y1 - box.y0
    const thin = group.filter(g => g.thin)
    if (!raster) {
      if (thin.length === group.length && group.length <= 2) continue // 分隔线 / 下划线 / 引用竖线
      if (h < body * 1.8 || w < body * 1.8 || area(box) < 900) continue // 行内底色 / 小图标
    }
    const inside = lines.filter(l => centerInside(l, box))
    const chars = textLen(inside)
    const texty = textLen(inside.filter(l => l.mono || l.size >= body * 0.88))
    const horizontalRules = thin.filter(g => g.y1 - g.y0 <= 2.5 && g.x1 - g.x0 >= w * 0.6).length
    const tableLike = horizontalRules >= 3 && inside.length >= 3
    if (raster) {
      if (texty > 200) continue // 衬在正文下面的底图
    } else if (!inside.length) {
      if (area(box) < 2500) continue
    } else if (!tableLike) {
      // 文本框: 代码块 / 提示框, 文字照常重排
      const kind = boxKind(inside, group, box, texty / Math.max(1, chars), textWidth)
      if (kind) {
        for (const l of inside) (kind === 'code' ? out.code : out.boxed).add(l)
        continue
      }
    }
    out.figures.push({ ...box, raster })
  }

  // 独立公式: 连续几行居中、数学字体占比高 (分式、求和会被拆成好几行碎片), 整块成图
  for (const r of findDisplayMath(lines.filter(l => !l.mono && !out.boxed.has(l) && !out.code.has(l) && !out.figures.some(f => centerInside(l, f))), m, textWidth)) {
    out.figures.push({ ...r, raster: false })
  }

  // 表格: 多行多栏对齐的短文字 (三线表的横线彼此隔得远, 聚不成一簇, 靠文字排布识别)
  for (const t of findTables(lines.filter(l => !l.mono && !out.boxed.has(l) && !out.code.has(l) && !out.figures.some(f => centerInside(l, f))), m)) {
    let box = t
    for (const v of p.vectors) {
      if (v.y1 - v.y0 > 2.5 || v.x1 - v.x0 < (t.x1 - t.x0) * 0.5) continue
      if (v.x1 < t.x0 || v.x0 > t.x1) continue
      if (v.y0 >= t.y0 - body * 2.2 && v.y1 <= t.y1 + body * 2.2) box = union(box, v)
    }
    out.figures.push({ ...box, raster: false })
  }

  // 图表: 把贴着的标签 (坐标轴、图例、刻度) 与紧贴边框的短标题并进来
  const lone = (l: RLine) => isLoneShortLine(l, lines, textWidth, m)
  out.figures = out.figures.map(f => {
    let box: Rect = f
    for (let pass = 0; pass < 3; pass++) {
      for (const l of lines) {
        if (l.mono || CAPTION_RE.test(lineText(l)) || centerInside(l, box)) continue
        const d = distance(l, box)
        const small = l.size < body * 0.88 && d <= body * 1.2
        const hugging = l.x0 >= box.x0 - 2 && l.x1 <= box.x1 + 2 && l.x1 - l.x0 <= (box.x1 - box.x0) * 0.7
          && (Math.abs(l.y1 - box.y0) <= body * 0.6 || Math.abs(l.y0 - box.y1) <= body * 0.6)
        // 顶着正文左边界的短行是小标题 / 段首, 不是图的标签
        const atMargin = Math.abs(l.x0 - textLeft) <= 2
        if (small || hugging || (d <= body * 2 && !atMargin && lone(l))) box = union(box, l)
      }
    }
    // 图与下方图注之间的说明文字 (公式、图例说明) 属于图
    const caption = lines
      .filter(l => CAPTION_RE.test(lineText(l)) && l.y0 >= box.y1 - 1 && l.y0 - box.y1 <= body * 6
        && (l.x0 + l.x1) / 2 >= box.x0 && (l.x0 + l.x1) / 2 <= box.x1)
      .sort((a, b) => a.y0 - b.y0)[0]
    if (caption) {
      for (const l of lines) {
        if (l === caption || l.y0 < box.y1 - 1 || l.y1 > caption.y0 + 1) continue
        if (l.x1 - l.x0 <= textWidth * 0.8 && l.x0 >= box.x0 - body * 2 && l.x1 <= box.x1 + body * 2) box = union(box, l)
      }
    }
    return { ...box, raster: f.raster }
  })

  // 重叠或挨着的图合并 (左右并排的对比图、上下相接的分图)
  const adjacent = (a: Rect, b: Rect) => {
    if (near(a, b, 2)) return true
    const vOverlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
    const hOverlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)
    const hGap = Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1)
    const vGap = Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1)
    return (vOverlap >= Math.min(a.y1 - a.y0, b.y1 - b.y0) * 0.5 && hGap <= body * 3)
      || (hOverlap >= Math.min(a.x1 - a.x0, b.x1 - b.x0) * 0.5 && vGap <= body * 1.2)
  }
  let merged = true
  while (merged) {
    merged = false
    for (let i = 0; i < out.figures.length && !merged; i++) {
      for (let j = i + 1; j < out.figures.length; j++) {
        if (adjacent(out.figures[i], out.figures[j])) {
          out.figures[i] = { ...union(out.figures[i], out.figures[j]), raster: out.figures[i].raster || out.figures[j].raster }
          out.figures.splice(j, 1)
          merged = true
          break
        }
      }
    }
  }
  for (const f of out.figures) for (const l of lines) {
    if (centerInside(l, f) && !CAPTION_RE.test(lineText(l))) {
      out.consumed.add(l)
      out.boxed.delete(l)
      out.code.delete(l)
    }
  }
  return out
}

/**
 * 独立公式区域: 不满行的行里数学字体字符占比 ≥ 30% 的「公式行」, 连同上下贴着的碎片
 * (分子分母、上下标、求和号、右侧公式编号) 聚成一块.
 */
export function findDisplayMath(lines: RLine[], m: BookMetrics, textWidth: number): Rect[] {
  const textLeft = Math.min(...lines.map(l => l.x0))
  // 不满行的公式行; 窄版面上公式会接近满行, 只要不顶着左边界 (正文行顶着) 且数学字符更多也算
  const isMathLine = (l: RLine) => ((l.math ?? 0) >= 0.3 && l.x1 - l.x0 < textWidth * 0.85)
    || ((l.math ?? 0) >= 0.4 && l.x0 > textLeft + 2)
  const near = (l: RLine, r: Rect) => l.y0 <= r.y1 + m.pitch * 0.9 && l.y1 >= r.y0 - m.pitch * 0.9
  const out: Rect[] = []
  const used = new Set<RLine>()
  const sorted = [...lines].sort((a, b) => a.y0 - b.y0)
  for (const seed of sorted) {
    if (used.has(seed) || !isMathLine(seed)) continue
    let box: Rect = seed
    used.add(seed)
    let grew = true
    while (grew) {
      grew = false
      for (const l of sorted) {
        if (used.has(l) || !near(l, box)) continue
        // 碎片: 本身是公式行, 或很短 (下标、编号、单个符号)
        if (!isMathLine(l) && (visibleChars(l) > 12 || Math.abs(l.x0 - textLeft) <= 2) && !/^\(?[\d.]+\)?$/.test(lineText(l).trim())) continue
        box = union(box, l)
        used.add(l)
        grew = true
      }
    }
    out.push(box)
  }
  return out
}

/** 孤零零的短行 (图示标签、刻度): 不长, 上下也没有贴着的长行 (那样就是段落的末行) */
function isLoneShortLine(l: RLine, lines: RLine[], textWidth: number, m: BookMetrics): boolean {
  if (l.x1 - l.x0 > textWidth * 0.4) return false
  return !lines.some(o => o !== l
    && o.x1 - o.x0 >= textWidth * 0.6
    && Math.abs(o.y0 - l.y0) <= m.pitch * 1.15
    && Math.abs(o.x0 - l.x0) <= Math.max(o.size, l.size) * 3)
}

/**
 * 框里的是成段文字 (代码块、提示框), 还是图示 (流程图、示意图) 的标签:
 * 代码 (等宽为主) 一律是文本框; 否则要求形状少 (底色 / 边框), 行长接近框宽, 且多为正文字号.
 */
function boxKind(inside: RLine[], shapes: Array<Rect & { thin: boolean }>, box: Rect, textyRatio: number, textWidth: number): 'code' | 'text' | null {
  const chars = inside.reduce((n, l) => n + visibleChars(l), 0)
  const mono = inside.filter(l => l.mono).reduce((n, l) => n + visibleChars(l), 0)
  // 代码框: 多数行以等宽字体开头 (注释、字符串里的中文用的是别的字体)
  if (mono >= chars * 0.6 || inside.filter(startsMono).length >= inside.length * 0.6) return 'code'
  return isTextBox(inside, shapes, box, textyRatio, textWidth, chars) ? 'text' : null
}

const startsMono = (l: RLine) => !!l.spans.find(s => s.text.trim())?.mono

function isTextBox(inside: RLine[], shapes: Array<Rect & { thin: boolean }>, box: Rect, textyRatio: number, textWidth: number, chars: number): boolean {
  const solid = shapes.filter(s => !s.thin).length
  const avgWidth = inside.reduce((n, l) => n + (l.x1 - l.x0), 0) / Math.max(1, inside.length)
  // 成段文字左对齐; 居中排的几行字是图示里的说明
  const left = Math.min(...inside.map(l => l.x0))
  const leftAligned = inside.length <= 1 || inside.filter(l => l.x0 - left <= Math.max(3, l.size * 4)).length >= inside.length * 0.6
  // 提示框 / 引用框占大半栏宽; 图示里的小方框只装一两个词
  if (textyRatio < 0.6 || !leftAligned || box.x1 - box.x0 < textWidth * 0.5) return false
  // 框里有成段的长行 (练习题、长提示): 不论框画得多花哨都是文字
  const longLines = inside.filter(l => l.x1 - l.x0 >= (box.x1 - box.x0) * 0.6).length
  if (chars >= 300 || longLines >= 6) return true
  return solid <= 4 && avgWidth >= (box.x1 - box.x0) * 0.45
}

/**
 * 文字排出来的表格: 连续多行, 每行有 ≥2 个隔开的单元格, 单元格起点在各行对齐.
 * 双栏正文 (每行两段长文字) 不算.
 */
export function findTables(lines: RLine[], m: BookMetrics): Rect[] {
  const sorted = [...lines].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
  const rows: RLine[][] = []
  for (const l of sorted) {
    const row = rows[rows.length - 1]
    if (row) {
      const top = Math.min(...row.map(r => r.y0))
      const bottom = Math.max(...row.map(r => r.y1))
      const overlap = Math.min(bottom, l.y1) - Math.max(top, l.y0)
      if (overlap >= Math.min(bottom - top, l.y1 - l.y0) * 0.5) {
        row.push(l)
        continue
      }
    }
    rows.push([l])
  }
  for (const row of rows) row.sort((a, b) => a.x0 - b.x0)
  const textW = Math.max(1, Math.max(...lines.map(l => l.x1), 0) - Math.min(...lines.map(l => l.x0), Infinity))
  const isMulti = (row: RLine[]) => row.length >= 2 && row.every((c, i) => i === 0 || c.x0 - row[i - 1].x1 >= Math.min(c.size, row[i - 1].size) * 0.8)
  const out: Rect[] = []
  let i = 0
  while (i < rows.length) {
    if (!isMulti(rows[i])) { i++; continue }
    // 向下延伸: 多栏行, 或与上面某栏对齐的单格行 (单元格内折行)
    const run: RLine[][] = [rows[i]]
    const starts = new Set(rows[i].map(c => Math.round(c.x0)))
    let j = i + 1
    while (j < rows.length) {
      const row = rows[j]
      const prev = run[run.length - 1]
      const gap = Math.min(...row.map(c => c.y0)) - Math.max(...prev.map(c => c.y1))
      if (gap > m.pitch * 1.6) break
      // 各格都对齐已知栏起点: 多格行 (格间距再小也算), 或缩在第一栏右边的单格行 (单元格内折行)
      const aligned = row.every(c => [...starts].some(x => Math.abs(x - c.x0) <= 3))
      if (!isMulti(row) && !(aligned && (row.length >= 2 || row[0].x0 > Math.min(...run[0].map(c => c.x0)) + 3))) break
      if (isMulti(row)) for (const c of row) starts.add(Math.round(c.x0))
      run.push(row)
      j++
    }
    const multi = run.filter(isMulti)
    const wide = multi.every(r => r.length === 2 && r.every(c => c.x1 - c.x0 > textW * 0.35))
    // 栏起点在多数多栏行里重复出现
    const counts = new Map<number, number>()
    for (const r of multi) for (const c of r) {
      const k = [...counts.keys()].find(x => Math.abs(x - c.x0) <= 3) ?? Math.round(c.x0)
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    const columns = [...counts.values()].filter(n => n >= multi.length * 0.6).length
    const enough = multi.length >= 3 || (multi.length >= 2 && multi.every(r => r.length >= 3))
    if (enough && !wide && columns >= 2) {
      out.push(run.flat().reduce<Rect>((u, l) => union(u, l), run[0][0]))
      i = j
    } else {
      i++
    }
  }
  return out
}

// ---- 行分类与阅读顺序 ----

type LineKind = 'h' | 'bh' | 'p' | 'li' | 'pre' | 'caption' | 'leader'

const LEADER_RE = /(?:[.·．…⋯]\s*){5,}\s*[\divxlcdm]*\s*$/i
const LEADER_START_RE = /^\s*(?:[.·．…⋯]\s*){3,}/
/** 目录行: 有引导线, 或以页码结尾的短行 */
const TOC_LINE_RE = /(?:[.·．…⋯]\s*){4,}|^\s*[\divxlcdm]{1,4}\s*$/i
const BULLET_RE = /^\s*(?:[•●○◦▪▫■□◆◇►▶➢✓✔‣⁃]|[-–—·*](?=\s))\s*/
const NUMBERED_RE = /^\s*(?:\d{1,2}[.)、．](?![\d.])|[（(]\d{1,2}[)）]|[①-⑳]|[a-z][.)](?=\s))\s*\S/

interface Item {
  line?: RLine
  kind?: LineKind
  figure?: Figure
  page: number
  /** 所在栏 (双栏页) */
  col: number
}

/** 一页的阅读顺序: 单栏按 y; 双栏为跨栏块 (上) → 左栏 → 右栏 → 跨栏块 (下) */
function readingOrder(p: RawPage, lines: RLine[], figures: Figure[], m: BookMetrics): Item[] {
  const items: Item[] = [
    ...lines.map(line => ({ line, page: p.index, col: 0 })),
    ...figures.map(figure => ({ figure, page: p.index, col: 0 })),
  ]
  const rectOf = (it: Item): Rect => (it.line ?? it.figure)!
  const body = lines.filter(l => !l.mono && Math.abs(l.size - m.bodySize) <= m.bodySize * 0.1 && visibleChars(l) >= 6)
  const mid = p.w / 2
  const left = body.filter(l => l.x1 < p.w * 0.56 && l.x0 < p.w * 0.45)
  const right = body.filter(l => l.x0 > p.w * 0.44)
  const twoCol = body.length >= 8 && left.length >= body.length * 0.25 && right.length >= body.length * 0.25
  if (twoCol) {
    const top = Math.max(Math.min(...left.map(l => l.y0)), Math.min(...right.map(l => l.y0)))
    const bottom = Math.min(Math.max(...left.map(l => l.y1)), Math.max(...right.map(l => l.y1)))
    for (const it of items) {
      const r = rectOf(it)
      const spanning = r.x0 < mid - 4 && r.x1 > mid + 4
      if (spanning) it.col = r.y0 < top ? -1 : r.y0 > bottom ? 3 : (r.y0 < (top + bottom) / 2 ? -1 : 3)
      else it.col = (r.x0 + r.x1) / 2 < mid ? 1 : 2
    }
  }
  return items.sort((a, b) => {
    if (a.col !== b.col) return a.col - b.col
    const ra = rectOf(a)
    const rb = rectOf(b)
    const sameRow = Math.abs(ra.y0 - rb.y0) < Math.min(ra.y1 - ra.y0, rb.y1 - rb.y0) * 0.5
    return sameRow ? ra.x0 - rb.x0 : ra.y0 - rb.y0
  })
}

/** 把 b 接到同一视觉行的 a 后面 (原地改 a) */
function appendFragment(a: RLine, b: RLine) {
  const gap = b.x0 - a.x1
  const sep: RSpan[] = gap > Math.min(a.size, b.size) * 0.2 ? [{ text: ' ' }] : []
  const charsA = visibleChars(a)
  const charsB = visibleChars(b)
  a.spans = mergeSpans([...a.spans, ...sep, ...b.spans])
  // 主字号取字多的一侧
  if (charsB > charsA) a.size = b.size
  a.x1 = Math.max(a.x1, b.x1)
  a.y0 = Math.min(a.y0, b.y0)
  a.y1 = Math.max(a.y1, b.y1)
  a.bold = a.bold && b.bold
  const mono = a.spans.filter(s => s.mono).reduce((n, s) => n + s.text.replace(/\s/g, '').length, 0)
  a.mono = mono >= (charsA + charsB) * 0.6
  const math = (a.math ?? 0) * charsA + (b.math ?? 0) * charsB
  if (math) a.math = Math.round((math / Math.max(1, charsA + charsB)) * 100) / 100
}

const sameRow = (a: Rect, b: Rect) => Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) >= Math.min(a.y1 - a.y0, b.y1 - b.y0) * 0.6

/** 同一视觉行里被拆开的碎片 (行内公式、字距大的词) 接回一行 */
export function mergeRowFragments(lines: RLine[]): RLine[] {
  const sorted = [...lines].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
  const out: RLine[] = []
  for (const l of sorted) {
    const prev = out.find(o => {
      const overlap = Math.min(o.y1, l.y1) - Math.max(o.y0, l.y0)
      const gap = l.x0 - o.x1
      // 目录引导线 (……… 12) 常与标题分成两段, 隔得再远也是同一行
      const leader = LEADER_START_RE.test(lineText(l))
      return !o.vertical && !l.vertical
        && overlap >= Math.min(o.y1 - o.y0, l.y1 - l.y0) * 0.6
        && gap >= -1 && gap <= Math.max(o.size, l.size) * (leader ? 8 : 0.8)
        && Math.abs(o.size - l.size) <= Math.max(o.size, l.size) * 0.35
        && o.mono === l.mono
    })
    if (!prev) {
      out.push({ ...l, spans: l.spans.map(s => ({ ...s })) })
      continue
    }
    appendFragment(prev, l)
  }
  return out
}

/**
 * 阅读顺序里同栏同一行的碎片接成一行 (两端对齐的中西文混排行字距很大、行内代码是另一种字体,
 * MuPDF 会拆成几段). 表格与图已先认出并拿走, 这里不会把表格的单元格连起来.
 * 会改写各行的第一段.
 */
function joinRowItems(items: Item[]): Item[] {
  const out: Item[] = []
  for (const it of items) {
    const prev = out[out.length - 1]
    if (it.line && prev?.line && prev.col === it.col && sameRow(prev.line, it.line) && it.line.x0 >= prev.line.x1 - 1
      && Math.abs(prev.line.size - it.line.size) <= Math.max(prev.line.size, it.line.size) * 0.35) {
      appendFragment(prev.line, it.line)
      continue
    }
    // 原地合并: 行对象是 layoutBook 自己的副本, 列表圆点 / 引用框等集合仍按它查
    out.push(it)
  }
  return out
}

function classify(l: RLine, m: BookMetrics, a: PageAnalysis, figures: Figure[]): LineKind {
  const text = lineText(l).trim()
  if (LEADER_RE.test(text)) return 'leader'
  if (l.mono || a.code.has(l)) return 'pre'
  // 图注 / 表注: 不论旁边认没认出图, 都不当标题
  if (CAPTION_RE.test(text) && text.length <= 120 && (l.bold || l.size < m.bodySize * 0.95 || figures.some(f => distance(f, l) <= m.bodySize * 3))) return 'caption'
  if (a.bullets.has(l) || BULLET_RE.test(text)) return 'li'
  if (l.size >= m.bodySize * 1.18 && text.length <= 80) return 'h'
  if (NUMBERED_RE.test(text)) return 'li'
  // 整行粗体的短行可能是小标题; 以冒号 / 句读结尾的是段首引导语
  if (l.bold && l.size >= m.bodySize * 0.95 && text.length <= 40 && !/[。，、；,;：:]$/.test(text)) return 'bh'
  return 'p'
}

function headingLevel(size: number, m: BookMetrics): number {
  const k = Math.round(size * 2) / 2
  const i = m.headingSizes.findIndex(s => s <= k + 0.01)
  return Math.min(3, (i < 0 ? m.headingSizes.length : i) + 1)
}

// ---- 段落还原 ----

interface Open {
  kind: Exclude<LineKind, 'leader' | 'bh'>
  level?: number
  lines: RLine[]
  spans: RSpan[]
  page: number
  pageH: number
  small: boolean
  quote: boolean
  /** 列表项正文的起点 (悬挂缩进时续行与它对齐) */
  textX0: number
}

interface PageCtx {
  left: number
  right: number
}

export interface LayoutOptions {
  /** 跳过的页 (封面页等, 0 起) */
  skipPages?: Set<number>
}

/**
 * 整书版面分析 → 阅读顺序的块序列.
 */
export function layoutBook(pages: RawPage[], opts: LayoutOptions = {}): { blocks: Block[]; metrics: BookMetrics } {
  const prepared = pages.map(p => ({ ...p, lines: mergeRowFragments(p.lines.filter(l => !l.vertical && lineText(l).trim())) }))
  const removed = findRunningHeads(prepared)
  const m = bookMetrics(prepared, removed)
  const blocks: Block[] = []
  let open: Open | null = null
  let pendingFigures: Block[] = []

  const flush = () => {
    if (open) {
      const spans = open.kind === 'pre' ? codeSpans(open.lines, m) : open.spans
      if (spans.some(s => s.text.trim())) {
        blocks.push({
          kind: open.kind,
          ...(open.kind === 'h' ? { level: open.level ?? 1, size: open.lines[0].size } : {}),
          spans,
          page: open.page,
          y: open.lines[0].y0 / open.pageH,
          ...(open.small ? { small: true } : {}),
          ...(open.quote ? { quote: true } : {}),
        })
      }
    }
    open = null
    if (pendingFigures.length) {
      blocks.push(...pendingFigures)
      pendingFigures = []
    }
  }

  let prevPageCtx: PageCtx | null = null
  for (const p of prepared) {
    if (opts.skipPages?.has(p.index)) continue
    const lines = p.lines.filter(l => !removed.has(l))
    // 目录页: 一大半是带引导线的行, 电子书有自己的目录, 整页略过 (先于图表识别: 目录的「标题 … 页码」会像表格)
    const tocLines = lines.filter(l => TOC_LINE_RE.test(lineText(l).trim())).length
    if (tocLines >= 5 && tocLines >= lines.length * 0.4) continue
    const a = analyzePage(p, lines, m)
    const flow = lines.filter(l => !a.consumed.has(l))

    const body = flow.filter(l => !l.mono && Math.abs(l.size - m.bodySize) <= m.bodySize * 0.1 && visibleChars(l) >= 4)
    const ctx: PageCtx = body.length >= 3
      ? { left: pageLeft(body), right: pageRight(body) }
      : prevPageCtx ?? { left: Math.min(...flow.map(l => l.x0), p.w * 0.1), right: Math.max(...flow.map(l => l.x1), p.w * 0.9) }
    const items = joinRowItems(readingOrder(p, flow, a.figures, m))
    let firstText = true
    let prevLine: RLine | null = open ? (open as Open).lines[(open as Open).lines.length - 1] : null
    let prevCol = 0

    for (const it of items) {
      if (it.figure) {
        const fig: Block = { kind: 'figure', spans: [], page: p.index, y: it.figure.y0 / p.h, rect: { x0: it.figure.x0, y0: it.figure.y0, x1: it.figure.x1, y1: it.figure.y1 }, ...(it.figure.raster ? { raster: true } : {}) }
        // 页首的浮动图: 上一页的段落可能还没完, 图放到段落后面
        if (firstText && open && (open.kind === 'p' || open.kind === 'li')) pendingFigures.push(fig)
        else {
          flush()
          blocks.push(fig)
        }
        continue
      }
      const l = it.line!
      let kind: LineKind = classify(l, m, a, a.figures)
      if (kind === 'leader') continue
      const quote = a.quoted.has(l) || (a.boxed.has(l) && !l.mono)
      const small = l.size < m.bodySize * 0.85 && kind !== 'h' && kind !== 'caption'
      const cur: Open | null = open
      const newPage = firstText
      const colChange = it.col !== prevCol && !newPage
      firstText = false
      prevCol = it.col

      if (kind === 'bh') {
        // 整行粗体的短行: 独立成行才是标题 (文本框里的不算)
        const standalone: boolean = !a.boxed.has(l) && (!cur || !prevLine || newPage || colChange
          || l.y0 - prevLine.y0 > m.pitch * 1.3 || isShort(prevLine, ctx))
        kind = standalone ? 'h' : 'p'
      }

      if (cur && prevLine && continues(cur, prevLine, l, kind, ctx, m, newPage || colChange, quote, small)) {
        cur.lines.push(l)
        if (kind !== 'pre') cur.spans = joinSpans(cur.spans, tidySpans(stripMarker(l, kind, a, true)))
        prevLine = l
        continue
      }
      flush()
      const spans: RSpan[] = kind === 'pre' ? [] : tidySpans(stripMarker(l, kind, a, false))
      open = {
        kind: kind as Open['kind'],
        ...(kind === 'h' ? { level: headingLevel(l.size, m) } : {}),
        lines: [l],
        spans,
        page: p.index,
        pageH: p.h,
        small,
        quote,
        textX0: l.x0,
      }
      prevLine = l
    }
    prevPageCtx = ctx
  }
  flush()
  return { blocks, metrics: m }
}

/** 行没到右边界 (段落最后一行) */
function isShort(l: RLine, ctx: PageCtx): boolean {
  return l.x1 < ctx.right - Math.max(l.size * 1.5, (ctx.right - ctx.left) * 0.05)
}

/** l 是否接着 open 这一块 (行尾折行) */
function continues(cur: Open, prev: RLine, l: RLine, kind: LineKind, ctx: PageCtx, m: BookMetrics, jump: boolean, quote: boolean, small: boolean): boolean {
  if (cur.quote !== quote) return false
  if (kind === 'h') {
    // 两行的标题 (编号一行, 标题一行)
    return cur.kind === 'h' && !jump && Math.abs(prev.size - l.size) <= l.size * 0.1 && l.y0 - prev.y1 <= l.size * 1.2
  }
  if (cur.kind === 'pre') {
    if (kind !== 'pre') return false
    if (jump) return true
    return l.y0 - prev.y0 <= m.pitch * 3.2
  }
  if (kind === 'pre') return false
  if (cur.kind === 'caption') {
    // 多行图注: 字号相同、紧挨着, 上一行写满或没写完一句
    return (kind === 'p' || kind === 'caption') && !jump && Math.abs(prev.size - l.size) <= l.size * 0.1
      && l.y0 - prev.y0 <= Math.max(prev.y1 - prev.y0, l.size) * 1.6
      && (!isShort(prev, ctx) || !TERMINAL_RE.test(lineText(prev).trim()))
  }
  if (kind === 'caption') return false
  if (kind === 'li') return false // 新的列表项
  if (cur.kind === 'h') return false
  if (cur.small !== small) return false
  if (Math.abs(prev.size - l.size) > Math.max(prev.size, l.size) * 0.12) return false
  // 上一行没写满: 段落已结束
  if (isShort(prev, ctx)) return false
  const indent = l.x0 - ctx.left
  if (jump) {
    // 跨页 / 跨栏: 上一行满行, 下一行不缩进才是续段; 不缩进排版的书再看句末标点
    if (indent >= l.size * 0.8 && cur.kind !== 'li') return false
    if (!m.indentStyle && TERMINAL_RE.test(lineText(prev).trim())) return false
    return true
  }
  const dy = l.y0 - prev.y0
  if (dy <= 0 || dy > m.pitch * 1.55 + 0.5) return false
  if (cur.kind === 'li') {
    // 列表项续行: 与项目正文对齐 (悬挂缩进, 让出「1. 」「• 」的宽度) 或回到左边界
    return l.x0 >= Math.min(cur.textX0, ctx.left) - l.size * 0.5 && l.x0 <= cur.textX0 + l.size * 3
  }
  // 比上一行缩进: 新段落 (首行缩进)
  if (l.x0 - prev.x0 >= l.size * 0.8) return false
  // 比上一行凸出且上一行不是首行: 新段落 (悬挂式)
  if (prev.x0 - l.x0 >= l.size * 0.8 && cur.lines.length > 1) return false
  return true
}

/** 列表项: 圆点位图换成「• 」; 文字符号原样保留 */
function stripMarker(l: RLine, kind: LineKind, a: PageAnalysis, continuation: boolean): RSpan[] {
  if (kind === 'li' && !continuation && a.bullets.has(l) && !BULLET_RE.test(lineText(l))) {
    return [{ text: '• ' }, ...l.spans]
  }
  return l.spans
}

/** 代码块: 按行首缩进还原空格, 行距大的地方补空行 */
function codeSpans(lines: RLine[], m: BookMetrics): RSpan[] {
  const left = Math.min(...lines.map(l => l.x0))
  const out: string[] = []
  let prev: RLine | null = null
  for (const l of lines) {
    const text = lineText(l).replace(/\s+$/, '')
    const charW = Math.max(1, l.size * 0.6)
    if (prev && l.y0 > prev.y0) {
      const codePitch = Math.max(l.size * 1.2, Math.min(m.pitch, l.size * 2))
      const blanks = Math.min(3, Math.round((l.y0 - prev.y0) / codePitch) - 1)
      for (let i = 0; i < blanks; i++) out.push('')
    }
    out.push(' '.repeat(Math.max(0, Math.round((l.x0 - left) / charW))) + text)
    prev = l
  }
  return [{ text: out.join('\n'), mono: true }]
}
