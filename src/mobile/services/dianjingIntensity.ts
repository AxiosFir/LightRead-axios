/** App-only intensity calibration. One is the previous maximum and new middle. */
export const WORD_GUIDE_MIN = 0.25
export const WORD_GUIDE_MAX = 3
export const WORD_GUIDE_DEFAULT = 1
export const WORD_GUIDE_STOPS = [
  { value: 0.25, key: 'readingMode.intensitySoft' },
  { value: 0.6, key: 'readingMode.intensityGentle' },
  { value: 1, key: 'readingMode.intensityNormal' },
  { value: 2, key: 'readingMode.intensityClear' },
  { value: 3, key: 'readingMode.intensityVivid' },
] as const
export function guideIntensity(prefs?: { intensity?: number; strength?: string }): number {
  const value = prefs?.intensity
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(WORD_GUIDE_MIN, Math.min(WORD_GUIDE_MAX, value)) : WORD_GUIDE_DEFAULT
}
/** Keep the normal stop at the physical midpoint of the slider. */
export function intensityFromSlider(value: number): number {
  const x = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 50
  return x <= 50 ? 0.25 + x * 0.015 : 1 + (x - 50) * 0.04
}
export function intensityToSlider(value: number): number {
  const x = guideIntensity({ intensity: value })
  return x <= 1 ? (x - 0.25) / 0.015 : 50 + (x - 1) / 0.04
}
