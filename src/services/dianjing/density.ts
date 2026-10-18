/** Optional fine adjustment between the established density presets. */
export const DENSITY_AMOUNTS = { low: 1, normal: 50, high: 100 } as const
export type DensityPreset = keyof typeof DENSITY_AMOUNTS

export function densityAmount(value: unknown, fallback = 50): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.max(1, Math.min(100, value))) : fallback
}

export function densityBand(value: number) {
  const amount = densityAmount(value)
  const lower: DensityPreset = amount <= 50 ? 'low' : 'normal'
  const upper: DensityPreset = amount <= 50 ? 'normal' : 'high'
  const fraction = (amount - DENSITY_AMOUNTS[lower]) / (DENSITY_AMOUNTS[upper] - DENSITY_AMOUNTS[lower])
  return { lower, upper, fraction }
}

/** Keep common marks; progressively exchange the differing candidates in stable order.
 * A finite paragraph changes in whole marks, never partial words or sentences.
 */
export function blendDensity<T>(lower: T[], upper: T[], fraction: number, key: (item: T) => string): T[] {
  if (fraction <= 0) return lower
  if (fraction >= 1) return upper
  const a = new Set(lower.map(key)), b = new Set(upper.map(key))
  const removing = lower.filter(item => !b.has(key(item)))
  const adding = upper.filter(item => !a.has(key(item)))
  // Spread additional marks across the passage instead of filling its first half.
  // Ranking is deterministic so nudging the slider does not reshuffle existing marks.
  const rank = (value: string) => {
    let h = 0x811c9dc5
    for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 0x01000193)
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
    return (h ^ (h >>> 13)) >>> 0
  }
  const take = (items: T[], share: number) => items.map((item, i) => ({ item, i, rank: rank(key(item)) }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .slice(0, Math.round(items.length * share)).map(({ item }) => item)
  const kept = new Set(take(removing, 1 - fraction).map(key))
  const added = new Set(take(adding, fraction).map(key))
  return lower.filter(item => b.has(key(item)) || kept.has(key(item)))
    .concat(adding.filter(item => added.has(key(item))))
}
