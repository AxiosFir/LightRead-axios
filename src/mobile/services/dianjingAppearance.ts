import { guideAccent } from '../../services/readingModes/wordGuideIntensity.ts'
import { guideIntensity } from './dianjingIntensity.ts'

function mix(a: string, b: string, amount: number) {
  amount = Math.max(0, Math.min(1, amount))
  const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
  const left = rgb(a), right = rgb(b)
  return '#' + left.map((v, i) => Math.round(v + (right[i]! - v) * amount).toString(16).padStart(2, '0')).join('')
}

function contrast(a: string, b: string) {
  const luminance = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i]!, 0)
  const x = luminance(a), y = luminance(b)
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05)
}

function readable(color: string, background: string, foreground: string) {
  for (let amount = 0; amount <= 1; amount += .02) {
    const candidate = mix(color, foreground, amount)
    if (contrast(candidate, background) >= 4.5) return candidate
  }
  return foreground
}

/** Shared by the App's actual highlights and the settings sample. */
export function dianjingAppearance(fg: string, bg: string, theme: string, color: string | undefined, intensity: number, eink = false) {
  const amount = guideIntensity({ intensity })
  const base = Math.min(1, amount), multiplier = Math.max(1, amount)
  const accent = guideAccent(color, theme)
  const background = eink ? mix(bg, fg, .08) : mix(bg, accent, (.02 + .035 * base) * multiplier)
  return {
    strong: eink ? fg : readable(mix(fg, accent, (.35 + .35 * base) * multiplier), background, fg),
    weak: eink ? fg : readable(mix(fg, accent, (.2 + .25 * base) * multiplier), bg, fg),
    boundary: eink ? fg : readable(mix(fg, accent, (.25 + .4 * base) * multiplier), bg, fg),
    // Opaque theme-derived tint keeps contrast predictable across reading themes.
    background,
  }
}
