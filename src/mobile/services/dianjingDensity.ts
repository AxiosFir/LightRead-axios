import { DENSITY_AMOUNTS, densityAmount, type DensityPreset } from '../../services/dianjing/density.ts'

/** Local App fine adjustment; keep the existing synced preset backwards compatible. */
export interface DensityPrefs {
  density: DensityPreset
  densityFine?: { value: number; preset: DensityPreset }
}

export function readDensity(prefs: DensityPrefs): number {
  const fallback = DENSITY_AMOUNTS[prefs.density] ?? DENSITY_AMOUNTS.normal
  return prefs.densityFine?.preset === prefs.density ? densityAmount(prefs.densityFine.value, fallback) : fallback
}

/** App calibration: the previous maximum is now the middle; the new maximum
 * gives the picker three times that density budget. Slider positions stay 1–100. */
export function engineDensity(prefs: DensityPrefs): number {
  const value = readDensity(prefs)
  return value <= 50 ? 1 + (value - 1) * 99 / 49 : 100 + (value - 50) * 4
}

export function setDensity(prefs: DensityPrefs, value: number) {
  const amount = densityAmount(value)
  const preset = (Object.keys(DENSITY_AMOUNTS) as DensityPreset[]).reduce((best, key) =>
    Math.abs(DENSITY_AMOUNTS[key] - amount) < Math.abs(DENSITY_AMOUNTS[best] - amount) ? key : best, 'normal')
  prefs.density = preset
  prefs.densityFine = { value: amount, preset }
}
