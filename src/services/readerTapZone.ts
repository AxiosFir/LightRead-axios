/**
 * 轻点正文的分区: 横屏 / 桌面按左·中·右三等分 (左上一页 · 中间工具栏 · 右下一页);
 * 竖屏 (手机竖着拿) 拇指在上下方向够得着、左右两侧很窄, 改按上·中·下三等分。
 * 自动阅读开着时 (含暂停中) 不设翻页区, 整屏轻点只用来暂停 / 继续, 免得误点翻走。
 */
export type TapZone = 'prev' | 'menu' | 'next'

export interface TapZoneInput {
  /** 相对阅读区左上角的坐标 */
  x: number
  y: number
  width: number
  height: number
  portrait: boolean
  autoReading: boolean
}

export function tapZone({ x, y, width, height, portrait, autoReading }: TapZoneInput): TapZone {
  if (autoReading) return 'menu'
  const [pos, size] = portrait ? [y, height] : [x, width]
  if (!(size > 0)) return 'menu'
  if (pos < size / 3) return 'prev'
  if (pos > size * 2 / 3) return 'next'
  return 'menu'
}
