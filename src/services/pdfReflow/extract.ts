/**
 * MuPDF → 原始几何 (RawPage): 逐字符取字体样式, 按行聚合成带样式的 span;
 * 同时收集矢量与位图的外框 (图表区域、列表圆点、引用竖线).
 * 只依赖传入的 mupdf 模块对象, 主线程与 Worker 通用.
 */
import type { OutlineNode, PdfSampleStats, RawPage, Rect, RLine, RSpan, RVector } from './types.ts'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Mupdf = any
type MDocument = any
type MPage = any

interface Style {
  bold: boolean
  italic: boolean
  mono: boolean
  math?: boolean
}

interface Ch {
  c: string
  x0: number
  y0: number
  x1: number
  y1: number
  size: number
  st: Style
}

const rectOf = (b: number[]): Rect => ({ x0: b[0], y0: b[1], x1: b[2], y1: b[3] })

const BOLD_NAME_RE = /bold|black|heavy|demi|-w[6-9]\b/i
const ITALIC_NAME_RE = /italic|oblique/i
/** 字体名里的等宽线索 (字体自身的等宽标记优先); 注意 ArialUnicodeMS 里的 code 不算 */
const MONO_NAME_RE = /mono|courier|consol|menlo|(?:^|[^a-z])code|sourcecode|firacode|typewriter|cmtt|lmtt|inconsolata|fixedsys/i
/** 公式用的字体 (TeX 的 CM / LM 数学字体、OpenType Math、Symbol); CMR 也排正文, 不算 */
const MATH_NAME_RE = /^(?:cmmi|cmsy|cmex|cmbsy|cmmib|msam|msbm|eufm|eusm|rsfs|wasy|stmary|mtmi|mtsy|mtex|txmi|txsy|txex|pxmi|pxsy|newtxmi|zxmi|lmmi|lmsy|lmex)\d*|math|^symbol/i

function styleOf(font: any, cache: Map<unknown, Style>): Style {
  const key = font?.pointer ?? font
  let st = cache.get(key)
  if (!st) {
    let name = ''
    try { name = String(font.getName() ?? '').replace(/^[A-Z]{6}\+/, '') } catch { /* 忽略 */ }
    const flag = (fn: string) => { try { return !!font[fn]() } catch { return false } }
    st = {
      bold: flag('isBold') || BOLD_NAME_RE.test(name),
      italic: flag('isItalic') || ITALIC_NAME_RE.test(name),
      mono: flag('isMono') || MONO_NAME_RE.test(name),
      ...(MATH_NAME_RE.test(name) ? { math: true } : {}),
    }
    cache.set(key, st)
  }
  return st
}

/** U+FFFD、私用区、控制字符: 文本层编码坏掉的信号 */
export const isBadChar = (c: string) => {
  const code = c.codePointAt(0) ?? 0
  return code === 0xfffd || (code >= 0xe000 && code <= 0xf8ff) || (code < 0x20 && code !== 9 && code !== 10 && code !== 13)
}

function buildLine(chars: Ch[], vertical: boolean): RLine | null {
  const visible = chars.filter(ch => ch.c.trim())
  if (!visible.length) return null
  const sizes = new Map<number, number>()
  for (const ch of visible) {
    const k = Math.round(ch.size * 2) / 2
    sizes.set(k, (sizes.get(k) ?? 0) + 1)
  }
  let size = visible[0].size
  let best = -1
  for (const [k, n] of sizes) if (n > best) { best = n; size = k }
  const spans: RSpan[] = []
  for (const ch of chars) {
    const last = spans[spans.length - 1]
    // 空格不改变样式, 归入前一段
    if (last && (ch.c === ' ' || (!!last.bold === ch.st.bold && !!last.italic === ch.st.italic && !!last.mono === ch.st.mono))) {
      last.text += ch.c
      continue
    }
    spans.push({ text: ch.c, ...(ch.st.bold ? { bold: true } : {}), ...(ch.st.italic ? { italic: true } : {}), ...(ch.st.mono ? { mono: true } : {}) })
  }
  const monoCount = visible.filter(ch => ch.st.mono).length
  const mathCount = visible.filter(ch => ch.st.math || isBadChar(ch.c)).length
  return {
    x0: Math.min(...visible.map(ch => ch.x0)),
    y0: Math.min(...visible.map(ch => ch.y0)),
    x1: Math.max(...visible.map(ch => ch.x1)),
    y1: Math.max(...visible.map(ch => ch.y1)),
    size,
    spans,
    mono: monoCount >= visible.length * 0.6,
    bold: visible.every(ch => ch.st.bold),
    ...(vertical ? { vertical: true } : {}),
    ...(mathCount ? { math: Math.round((mathCount / visible.length) * 100) / 100 } : {}),
  }
}

const isWhite = (color: unknown) => Array.isArray(color) && color.length > 0 && color.every(v => typeof v === 'number' && v >= 0.97)

/** 一页的原始几何 */
export function extractPage(mupdf: Mupdf, doc: MDocument, index: number): RawPage {
  const page: MPage = doc.loadPage(index)
  try {
    return extractLoadedPage(mupdf, page, index)
  } finally {
    page.destroy?.()
  }
}

/** 描边字形的原点 (伪粗体: 中文常用「填充 + 描边」加粗, 字体本身不是粗体) */
const glyphKey = (x: number, y: number) => `${Math.round(x * 2)},${Math.round(y * 2)}`

function strokedGlyphs(mupdf: Mupdf, dl: any): Set<string> {
  const out = new Set<string>()
  const dev = new mupdf.Device({
    strokeText(text: any, _stroke: unknown, ctm: number[]) {
      text.walk({
        showGlyph(_font: unknown, trm: number[]) {
          out.add(glyphKey(trm[4] * ctm[0] + trm[5] * ctm[2] + ctm[4], trm[4] * ctm[1] + trm[5] * ctm[3] + ctm[5]))
        },
      })
    },
  })
  try {
    dl.run(dev, mupdf.Matrix.identity)
    dev.close()
  } finally {
    dev.destroy?.()
  }
  return out
}

export function extractLoadedPage(mupdf: Mupdf, page: MPage, index: number): RawPage {
  const [bx0, by0, bx1, by1] = page.getBounds()
  // 显示列表只解释一次页面, 结构化文本与伪粗体检测共用
  const dl = page.toDisplayList(false)
  let stroked: Set<string>
  let st: any
  try {
    stroked = strokedGlyphs(mupdf, dl)
    st = dl.toStructuredText('preserve-images,vectors')
  } finally {
    dl.destroy?.()
  }
  const fakeBold: Style = { bold: true, italic: false, mono: false }
  const boldVariants = new Map<Style, Style>()
  const lines: RLine[] = []
  const vectors: RVector[] = []
  const images: Rect[] = []
  const fonts = new Map<unknown, Style>()
  let chars: Ch[] | null = null
  let vertical = false
  try {
    st.walk({
      onImageBlock(bbox: number[]) { images.push(rectOf(bbox)) },
      onVector(bbox: number[], flags: any, color: unknown) {
        const isStroked = !!flags?.isStroked
        if (!isStroked && isWhite(color)) return
        vectors.push({ ...rectOf(bbox), stroked: isStroked })
      },
      beginLine(_bbox: number[], wmode: number) {
        chars = []
        vertical = wmode === 1
      },
      onChar(c: string, origin: number[], font: any, size: number, quad: number[]) {
        if (!chars) return
        let style = styleOf(font, fonts)
        if (!style.bold && stroked.size && stroked.has(glyphKey(origin[0], origin[1]))) {
          let v = boldVariants.get(style)
          if (!v) {
            v = style.mono || style.italic || style.math ? { ...style, bold: true } : fakeBold
            boldVariants.set(style, v)
          }
          style = v
        }
        chars.push({
          c,
          x0: Math.min(quad[0], quad[4]),
          y0: Math.min(quad[1], quad[3]),
          x1: Math.max(quad[2], quad[6]),
          y1: Math.max(quad[5], quad[7]),
          size,
          st: style,
        })
      },
      endLine() {
        if (chars) {
          const line = buildLine(chars, vertical)
          if (line) lines.push(line)
        }
        chars = null
      },
    })
  } finally {
    st.destroy?.()
  }
  return { index, w: bx1 - bx0, h: by1 - by0, lines, vectors, images }
}

/** PDF 书签 → 目录树 (标题去空白; 没有页码的外链条目只保留其子项) */
export function extractOutline(doc: MDocument): OutlineNode[] {
  let items: any[] | null = null
  try { items = doc.loadOutline() } catch { items = null }
  const walk = (list: any[] | undefined, depth: number): OutlineNode[] => {
    if (!list || depth > 6) return []
    const out: OutlineNode[] = []
    for (const it of list) {
      const title = String(it?.title ?? '').replace(/\s+/g, ' ').trim()
      const children = walk(it?.down, depth + 1)
      const page = typeof it?.page === 'number' && it.page >= 0 ? it.page : undefined
      if (!title && !children.length) continue
      out.push({ title, ...(page !== undefined ? { page } : {}), children })
    }
    return out
  }
  return walk(items ?? undefined, 0)
}

/** 裁切渲染页面的一块区域 (PDF 点) → PNG / JPEG 字节 */
export function renderRegion(mupdf: Mupdf, page: MPage, r: Rect, scale: number, jpeg: boolean): Uint8Array {
  const bbox = [Math.floor(r.x0 * scale), Math.floor(r.y0 * scale), Math.ceil(r.x1 * scale), Math.ceil(r.y1 * scale)]
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, bbox, false)
  try {
    pix.clear(255)
    const dev = new mupdf.DrawDevice(mupdf.Matrix.identity, pix)
    try {
      page.run(dev, mupdf.Matrix.scale(scale, scale))
      dev.close()
    } finally {
      dev.destroy?.()
    }
    return jpeg ? pix.asJPEG(82) : pix.asPNG()
  } finally {
    pix.destroy?.()
  }
}

/**
 * 抽样统计 (判定文字版 / 扫描版用): 均匀取最多 n 页 (页数多于 3 时跳过封面),
 * 只看文本层与大图, 不收集矢量, 很快.
 */
export function samplePdf(doc: MDocument, n = 6): PdfSampleStats {
  const pages = doc.countPages()
  const from = pages > 3 ? 1 : 0
  const span = pages - from
  const picks = new Set<number>()
  const count = Math.min(n, span)
  for (let i = 0; i < count; i++) picks.add(from + Math.floor(((i + 0.5) * span) / count))
  const perPage: number[] = []
  let badChars = 0
  let verticalChars = 0
  let imagePages = 0
  for (const index of picks) {
    const page = doc.loadPage(index)
    try {
      const [x0, y0, x1, y1] = page.getBounds()
      const pageArea = Math.max(1, (x1 - x0) * (y1 - y0))
      const st = page.toStructuredText('preserve-images')
      let chars = 0
      let imageArea = 0
      let vertical = false
      try {
        st.walk({
          onImageBlock(b: number[]) { imageArea = Math.max(imageArea, (b[2] - b[0]) * (b[3] - b[1])) },
          beginLine(_b: number[], wmode: number) { vertical = wmode === 1 },
          onChar(c: string) {
            if (!c.trim()) return
            chars++
            if (isBadChar(c)) badChars++
            if (vertical) verticalChars++
          },
        })
      } finally {
        st.destroy?.()
      }
      perPage.push(chars)
      if (imageArea >= pageArea * 0.5) imagePages++
    } finally {
      page.destroy?.()
    }
  }
  return { pages, perPage, badChars, verticalChars, imagePages }
}
