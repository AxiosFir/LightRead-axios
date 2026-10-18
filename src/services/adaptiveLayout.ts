import type { ReaderPrefs, PdfPrefs } from '../stores/settings'
import { isPortraitView, portraitSpacing, type PortraitProbe } from './portraitLayout.ts'

export const READER_LAYOUT_KEYS = ['fontSize', 'lineHeight', 'gap', 'flow', 'maxColumnCount', 'continuousScroll'] as const
export const PDF_LAYOUT_KEYS = ['mode', 'fit', 'spreadMode'] as const
export type ReaderLayoutKey = typeof READER_LAYOUT_KEYS[number]
export type PdfLayoutKey = typeof PDF_LAYOUT_KEYS[number]
export interface LayoutOverrides {
  reader: Record<ReaderLayoutKey, boolean>
  pdf: Record<PdfLayoutKey, boolean>
}
export function emptyLayoutOverrides(): LayoutOverrides {
  return {
    reader: Object.fromEntries(READER_LAYOUT_KEYS.map(k => [k, false])) as LayoutOverrides['reader'],
    pdf: Object.fromEntries(PDF_LAYOUT_KEYS.map(k => [k, false])) as LayoutOverrides['pdf'],
  }
}

/** CSS 像素决定排版; 屏幕物理像素仅供诊断, 不把高 DPI 手机误判成桌面。 */
export function screenLayout(probe: PortraitProbe) {
  const width = Math.max(1, probe.width)
  const height = Math.max(1, probe.height)
  const portrait = isPortraitView(probe)
  const small = Math.min(width, height) < 600
  const wide = !portrait && width >= 1000
  return {
    orientation: portrait ? 'portrait' as const : 'landscape' as const,
    reader: {
      fontSize: small ? 19 : 20,
      lineHeight: portrait ? 1.95 : 1.7,
      gap: portrait ? portraitSpacing(width, 6).gapPercent : 6,
      flow: portrait ? 'scrolled' as const : 'paginated' as const,
      maxColumnCount: wide ? 2 as const : 1 as const,
      continuousScroll: true,
    },
    pdf: {
      mode: portrait || small ? 'scroll' as const : 'paged' as const,
      fit: portrait || small ? 'fitW' as const : 'fitH' as const,
      spreadMode: wide ? 'facing' as const : 'single' as const,
    },
    maxInlineSize: portrait ? 1200 : 720,
    pageMargin: height < 480 ? 24 : width <= 720 ? 36 : 48,
  }
}

/** 兼容旧存档: 自定义值和有修改记录的默认值都视作手动设置。新存档按显式标记判断。 */
export function restoreLayoutOverrides(saved: unknown, values: Record<string, unknown>, defaults: Record<string, unknown>, stamps: Record<string, { t?: number }> = {}): LayoutOverrides {
  const result = emptyLayoutOverrides()
  for (const group of ['reader', 'pdf'] as const) {
    for (const key of Object.keys(result[group])) {
      const path = `${group}.${key}`
      const flag = (saved as any)?.[group]?.[key]
      ;(result[group] as Record<string, boolean>)[key] = typeof flag === 'boolean' ? flag
        : (path in values && !Object.is(values[path], defaults[path])) || (stamps[path]?.t ?? 0) > 0
    }
  }
  return result
}

export function resolveReaderPrefs(saved: ReaderPrefs, manual: LayoutOverrides['reader'], preset: ReturnType<typeof screenLayout>, modePresets: Record<string, { applied: Record<string, unknown> }> = {}): ReaderPrefs {
  if (!saved.portraitScroll) return { ...saved }
  const result = { ...saved }
  for (const key of READER_LAYOUT_KEYS) {
    const heldByMode = Object.values(modePresets).some(p => Object.is(p.applied?.[`reader.${key}`], saved[key]))
    if (!manual[key] && !heldByMode) (result as any)[key] = preset.reader[key]
  }
  // 用户选单/双栏时, 自动的竖屏滚动不能让该选择失效。显式滚动仍然是单栏。
  if (manual.maxColumnCount && saved.maxColumnCount !== 'auto' && !manual.flow) result.flow = 'paginated'
  return result
}

export function resolvePdfPrefs(saved: PdfPrefs, manual: LayoutOverrides['pdf'], preset: ReturnType<typeof screenLayout>, enabled: boolean): PdfPrefs {
  if (!enabled) return { ...saved }
  const result = { ...saved }
  for (const key of PDF_LAYOUT_KEYS) if (!manual[key]) (result as any)[key] = preset.pdf[key]
  return result
}
