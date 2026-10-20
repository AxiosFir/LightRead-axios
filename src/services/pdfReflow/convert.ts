/**
 * PDF → 重排电子书包的完整流程; 主线程与 Worker 通用 (传入 mupdf 模块).
 *  1. 逐页取原始几何 (0–85%)
 *  2. 整书版面分析 → 块序列, 切章与目录, 生成 XHTML (85–100%)
 * 图表不在这里渲染: 包里只记区域, 阅读时按需裁切 (renderFigure) 并缓存, 首次打开只等文字.
 * 结果确定: 同一文件、同一 REFLOW_VERSION 在任何设备上生成的章节与块 id 相同, 划线 CFI 才能多端通用.
 */
import { planBook, type PageAnchors } from './book.ts'
import { buildReflowFiles, type FigureRef, type ReflowFiles } from './epub.ts'
import { extractOutline, extractPage, renderRegion } from './extract.ts'
import { layoutBook, lineText } from './layout.ts'
import type { Block, RawPage } from './types.ts'

/** 版面规则版本: 改了会生成不同的章节 / 块, 旧缓存作废, 旧划线位置可能偏移, 改动要谨慎 */
export const REFLOW_VERSION = 1

/* eslint-disable @typescript-eslint/no-explicit-any */
type Mupdf = any

export interface ReflowMeta {
  bookId: string
  title: string
  author: string
  language?: string
}

export interface ReflowProgress {
  /** 0-1 */
  fraction: number
  stage: 'read' | 'layout'
}

export interface ReflowPackage extends ReflowFiles {
  version: number
  anchors: PageAnchors
  pageCount: number
  /** 正文字数 */
  chars: number
  language: string
}

export class ReflowEmptyError extends Error {
  constructor() {
    super('pdf-reflow-empty')
    this.name = 'ReflowEmptyError'
  }
}

/** 少于这么多字: 没有可重排的文字 (扫描件、纯图) */
export const MIN_REFLOW_CHARS = 200

/** 图片最长边 (px), 与渲染倍率上限 */
const MAX_IMAGE_PX = 1400
const MAX_SCALE = 2.5

/** 封面页: 第一页铺满大图、或几乎没有字 */
export function isCoverPage(p: RawPage | undefined): boolean {
  if (!p) return false
  const pageArea = p.w * p.h
  const imageArea = p.images.reduce((n, r) => Math.max(n, (r.x1 - r.x0) * (r.y1 - r.y0)), 0)
  const chars = p.lines.reduce((n, l) => n + lineText(l).replace(/\s/g, '').length, 0)
  return imageArea >= pageArea * 0.5 || (chars < 120 && (p.vectors.length > 0 || p.images.length > 0))
}

/** 正文语言: 中日韩字符占多数时按汉字 / 假名 / 谚文判断, 否则视为英文 */
export function guessLanguage(blocks: Block[]): string {
  let han = 0, kana = 0, hangul = 0, latin = 0
  let seen = 0
  outer: for (const b of blocks) {
    for (const s of b.spans) {
      for (const c of s.text) {
        if (/[一-鿿]/.test(c)) han++
        else if (/[぀-ヿ]/.test(c)) kana++
        else if (/[가-힯]/.test(c)) hangul++
        else if (/[A-Za-z]/.test(c)) latin++
        if (++seen > 40_000) break outer
      }
    }
  }
  if (kana > han * 0.15 && kana > 50) return 'ja'
  if (hangul > latin && hangul > han) return 'ko'
  if (han > latin * 0.3) return 'zh'
  return 'en'
}

export function openPdf(mupdf: Mupdf, data: Uint8Array | ArrayBuffer): any {
  return mupdf.Document.openDocument(data instanceof Uint8Array ? data : new Uint8Array(data), 'application/pdf')
}

export async function convertPdfToReflow(
  mupdf: Mupdf,
  data: Uint8Array | ArrayBuffer,
  meta: ReflowMeta,
  onProgress?: (p: ReflowProgress) => void,
  shouldStop?: () => boolean,
): Promise<ReflowPackage> {
  const doc = openPdf(mupdf, data)
  try {
    return await convertDocToReflow(mupdf, doc, meta, onProgress, shouldStop)
  } finally {
    doc.destroy?.()
  }
}

/** 已打开的文档 → 重排包 (不关闭文档, 之后还能用它渲染图) */
export async function convertDocToReflow(
  mupdf: Mupdf,
  doc: any,
  meta: ReflowMeta,
  onProgress?: (p: ReflowProgress) => void,
  shouldStop?: () => boolean,
): Promise<ReflowPackage> {
  const yieldNow = () => new Promise<void>(resolve => setTimeout(resolve, 0))
  const check = () => {
    if (shouldStop?.()) throw new DOMException('Aborted', 'AbortError')
  }
  const pageCount = doc.countPages()
  const pages: RawPage[] = []
  let last = Date.now()
  for (let i = 0; i < pageCount; i++) {
    check()
    try {
      pages.push(extractPage(mupdf, doc, i))
    } catch (e) {
      console.warn('[pdf-reflow] page', i, e)
      pages.push({ index: i, w: 595, h: 842, lines: [], vectors: [], images: [] })
    }
    if (Date.now() - last > 40) {
      onProgress?.({ fraction: (0.85 * (i + 1)) / pageCount, stage: 'read' })
      await yieldNow()
      last = Date.now()
    }
  }
  onProgress?.({ fraction: 0.86, stage: 'layout' })
  await yieldNow()
  check()
  const cover = isCoverPage(pages[0]) && pageCount > 1
  const { blocks, metrics } = layoutBook(pages, cover ? { skipPages: new Set([0]) } : {})
  const chars = blocks.reduce((n, b) => n + (b.kind === 'figure' ? 0 : lineText(b).replace(/\s/g, '').length), 0)
  if (chars < MIN_REFLOW_CHARS) throw new ReflowEmptyError()
  const plan = planBook(blocks, extractOutline(doc), pageCount, meta.title)
  const language = meta.language || guessLanguage(blocks)
  const files = buildReflowFiles(blocks, plan, {
    identifier: `urn:lightread:pdf-reflow:${meta.bookId}`,
    title: meta.title,
    author: meta.author,
    language,
    indentStyle: metrics.indentStyle,
    ...(cover ? { cover: { page: 0, rect: { x0: 0, y0: 0, x1: pages[0].w, y1: pages[0].h }, raster: true } } : {}),
  })
  onProgress?.({ fraction: 1, stage: 'layout' })
  return { ...files, version: REFLOW_VERSION, anchors: plan.anchors, pageCount, chars, language }
}

/** 裁切渲染一张图 (封面整页) */
export function renderFigure(mupdf: Mupdf, doc: any, ref: FigureRef): Uint8Array {
  const page = doc.loadPage(ref.page)
  try {
    const pad = ref.rect.x0 === 0 && ref.rect.y0 === 0 ? 0 : 2
    const r = ref.rect
    const box = { x0: Math.max(0, r.x0 - pad), y0: Math.max(0, r.y0 - pad), x1: r.x1 + pad, y1: r.y1 + pad }
    const longest = Math.max(box.x1 - box.x0, box.y1 - box.y0)
    const scale = Math.min(MAX_SCALE, (pad ? MAX_IMAGE_PX : 1600) / Math.max(1, longest))
    return renderRegion(mupdf, page, box, scale, ref.raster)
  } finally {
    page.destroy?.()
  }
}
