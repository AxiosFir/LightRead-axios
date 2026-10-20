import type { BookMeta } from '../storage'
import { useSettings } from '../stores/settings'
import { pdfOpenView } from './pdfReflow/viewMode'

/**
 * 书 → 阅读器路由: DjVu 走专用阅读器, 其余走 foliate (藏书与论文共用).
 * PDF 按打开方式 (services/pdfReflow/viewMode.ts): 电子书形态走 foliate (/read, 内存重排包),
 * 原版与还没判定过类型的走 PDF 阅读器 (它会抽样判定, 文字版再转去电子书形态).
 */
export function readerPath(book: Pick<BookMeta, 'id' | 'format'> & Partial<Pick<BookMeta, 'kind'>>): string {
  if (book.format === 'pdf') {
    let setting: 'auto' | 'original' = 'auto'
    try { setting = useSettings().pdfReflowDefault } catch { /* 无 pinia (测试) 时按默认 */ }
    return pdfOpenView(book, setting) === 'reflow' ? `/read/${book.id}` : `/read-paper/${book.id}`
  }
  if (book.format === 'djvu') return `/read-djvu/${book.id}`
  return `/read/${book.id}`
}
