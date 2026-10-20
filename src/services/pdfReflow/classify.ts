/**
 * 判定 PDF 类型 (纯函数). 2026-10-19 用户定: 文字版默认电子书, 扫描版默认原版 PDF.
 * 阈值偏保守: 把扫描版误判成文字版, 用户一打开就是坏排版, 代价比反过来大.
 */
import type { PdfKind, PdfSampleStats } from './types.ts'

/** 每页至少这么多字才算有正文 (幻灯片、海报、绘本的字很少, 保留原版) */
export const MIN_TEXT_CHARS = 150

export function classifyPdf(s: PdfSampleStats): PdfKind {
  const sampled = s.perPage.length
  if (!sampled) return 'scan'
  const chars = s.perPage.reduce((a, b) => a + b, 0)
  const withText = s.perPage.filter(n => n >= 30).length
  if (withText <= sampled * 0.3) return s.imagePages >= sampled * 0.5 ? 'scan' : 'sparse'
  if (s.badChars > chars * 0.05) return 'garbled'
  if (s.verticalChars > chars * 0.3) return 'vertical'
  // 每页都铺满一张大图又有文字: 带 OCR 文字层的扫描件, 文字未必可靠
  if (s.imagePages >= sampled * 0.6) return 'image'
  const sorted = [...s.perPage].sort((a, b) => a - b)
  const medianChars = sorted[Math.floor(sorted.length / 2)]
  if (medianChars < MIN_TEXT_CHARS || withText < sampled * 0.6) return 'sparse'
  return 'text'
}

/** 能否切换为电子书 (没有文字层的扫描件不行, 其余都允许手动试) */
export const canReflow = (kind: PdfKind | undefined) => kind !== 'scan'
