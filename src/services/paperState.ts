import type { BookMeta } from '../storage'

/** 论文阅读状态: 手机论文页的筛选标签用 */
export type PaperState = 'unread' | 'reading' | 'done'

/** 读到最后一页算读完 (PDF 进度 = 当前页 / 总页数); 打开过或有进度算在读 */
export function paperState(book: Pick<BookMeta, 'progress' | 'lastReadAt'>): PaperState {
  const progress = book.progress ?? 0
  if (progress >= 0.999) return 'done'
  if (progress > 0 || book.lastReadAt) return 'reading'
  return 'unread'
}
