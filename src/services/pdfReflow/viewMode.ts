/**
 * PDF 打开方式: 原版 (PaperReaderView) 还是电子书 (ReaderView + 重排包).
 * 规则 (2026-10-19 用户定, 同微信读书): 文字版默认电子书, 扫描版等默认原版; 论文默认原版;
 * 用户在阅读页切换过的书以切换结果为准 (按书记住, 存在本机).
 * 判定结果 (PdfKind) 也存本机, 下次打开直接按它路由, 不必再抽样.
 */
import type { PdfKind } from './types.ts'

export type PdfView = 'reflow' | 'original'
export type PdfReflowDefault = 'auto' | 'original'

interface KV {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const choiceKey = (id: string) => `lightread-pdf-view:${id}`
const kindKey = (id: string) => `lightread-pdf-kind:${id}`
/** 判定规则版本: 阈值改了就重新抽样 */
const KIND_VERSION = 1

const KINDS: PdfKind[] = ['text', 'scan', 'sparse', 'garbled', 'image', 'vertical']

function store(kv?: KV): KV | null {
  if (kv) return kv
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function pdfViewChoice(bookId: string, kv?: KV): PdfView | undefined {
  try {
    const v = store(kv)?.getItem(choiceKey(bookId))
    return v === 'reflow' || v === 'original' ? v : undefined
  } catch {
    return undefined
  }
}

/** 用户在阅读页切换形态时记下 */
export function setPdfViewChoice(bookId: string, view: PdfView, kv?: KV) {
  try { store(kv)?.setItem(choiceKey(bookId), view) } catch { /* 存储不可用时只影响这次 */ }
}

export function cachedPdfKind(bookId: string, kv?: KV): PdfKind | undefined {
  try {
    const raw = store(kv)?.getItem(kindKey(bookId))
    const m = raw && /^v(\d+):(\w+)$/.exec(raw)
    if (!m || Number(m[1]) !== KIND_VERSION) return undefined
    return KINDS.includes(m[2] as PdfKind) ? (m[2] as PdfKind) : undefined
  } catch {
    return undefined
  }
}

export function setCachedPdfKind(bookId: string, kind: PdfKind, kv?: KV) {
  try { store(kv)?.setItem(kindKey(bookId), `v${KIND_VERSION}:${kind}`) } catch { /* 忽略 */ }
}

export function forgetPdfView(bookId: string, kv?: KV) {
  try {
    store(kv)?.removeItem(choiceKey(bookId))
    store(kv)?.removeItem(kindKey(bookId))
  } catch { /* 忽略 */ }
}

/**
 * 这本 PDF 该用哪种形态打开. 返回 undefined 表示还没判定过类型 (要先抽样).
 */
export function pdfOpenView(
  book: { id: string; kind?: 'book' | 'paper' },
  setting: PdfReflowDefault,
  kv?: KV,
): PdfView | undefined {
  const choice = pdfViewChoice(book.id, kv)
  if (choice) return choice
  return defaultPdfView(book, setting, cachedPdfKind(book.id, kv))
}

/** 没有手动选择时的默认形态 (kind 未知时返回 undefined) */
export function defaultPdfView(
  book: { kind?: 'book' | 'paper' },
  setting: PdfReflowDefault,
  kind: PdfKind | undefined,
): PdfView | undefined {
  if (setting === 'original' || book.kind === 'paper') return 'original'
  if (!kind) return undefined
  return kind === 'text' ? 'reflow' : 'original'
}
