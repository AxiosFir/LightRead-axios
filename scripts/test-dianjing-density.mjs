import { test } from 'node:test'
import assert from 'node:assert/strict'
import { blendDensity, densityAmount, densityBand, DENSITY_AMOUNTS } from '../src/services/dianjing/density.ts'
import { selectKeys, selectTerms } from '../src/services/dianjing/protocol.ts'
import { readDensity, setDensity } from '../src/mobile/services/dianjingDensity.ts'
import { dianjingAppearance } from '../src/mobile/services/dianjingAppearance.ts'
import { GUIDE_COLORS } from '../src/services/readingModes/wordGuideIntensity.ts'
import { DJ_COLORS } from '../src/mobile/services/dianjing/theme.ts'

test('fine preferences preserve old presets, clamp invalid values and follow a changed preset', () => {
  for (const [density, value] of Object.entries(DENSITY_AMOUNTS)) assert.equal(readDensity({ density }), value)
  const prefs = { density: 'normal' }
  setDensity(prefs, 37)
  assert.equal(readDensity(JSON.parse(JSON.stringify(prefs))), 37)
  prefs.density = 'high'
  assert.equal(readDensity(prefs), 100)
  for (const [value, expected] of [[NaN, 50], [Infinity, 50], ['20', 50], [-3, 1], [200, 100], [36.8, 37]]) assert.equal(densityAmount(value), expected)
  assert.equal(densityBand(50).fraction, 1)
})

test('smart key sentences and terms support intermediate amounts without changing original presets', () => {
  const keys = Array.from({ length: 160 }, (_, i) => ({ id: `k${i}`, t: 'key', block: i, sentence: 0, r: i % 3 + 1, why: '' }))
  const terms = keys.map((k, i) => ({ ...k, id: `t${i}`, t: 'term', q: '概念', start: 0, end: 2, def: '定义' }))
  for (const [preset, amount] of Object.entries(DENSITY_AMOUNTS)) {
    assert.deepEqual(selectKeys(keys, () => 10, 10000, 'normal', amount), selectKeys(keys, () => 10, 10000, preset))
    assert.deepEqual(selectTerms(terms, 'normal', amount), selectTerms(terms, preset))
  }
  for (const select of [amount => selectKeys(keys, () => 10, 10000, 'normal', amount).size, amount => selectTerms(terms, 'normal', amount).length]) {
    const counts = [1, 15, 25, 40, 50, 65, 80, 100].map(select)
    assert.ok(new Set(counts).size > 3)
    assert.deepEqual(counts, [...counts].sort((a, b) => a - b))
  }
})

test('fine adjustments distribute marks through the passage and retain previously added candidates', () => {
  const candidates = Array.from({ length: 120 }, (_, i) => String(i))
  const sparse = blendDensity([], candidates, .25, value => value)
  const dense = new Set(blendDensity([], candidates, .5, value => value))
  assert.equal(sparse.length, 30)
  assert.ok(sparse.every(item => dense.has(item)))
  for (let quarter = 0; quarter < 4; quarter++) assert.ok(sparse.some(item => Math.floor(Number(item) / 30) === quarter))
})

const themes = {
  light: { bg: '#fafafa', fg: '#20252c' }, sepia: { bg: '#faf3e7', fg: '#453c2c' },
  green: { bg: '#e6efdf', fg: '#243528' }, dark: { bg: '#17181a', fg: '#c5c8ce' },
}
function contrast(a, b) {
  const luminance = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0)
  const x = luminance(a), y = luminance(b)
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05)
}
test('comfortable App colors retain readable contrast at every supported intensity and theme', () => {
  for (const [theme, { bg, fg }] of Object.entries(themes)) {
    for (const color of GUIDE_COLORS) for (const intensity of [.25, .5, .7, 1, 1.5, 2, 3]) {
      const v = dianjingAppearance(fg, bg, theme, color.id, intensity)
      assert.ok(contrast(v.strong, v.background) >= 4.5, `${theme}/${color.id}/${intensity}: strong`)
      assert.ok(contrast(v.weak, bg) >= 4.5, `${theme}/${color.id}/${intensity}: weak`)
      assert.ok(contrast(v.boundary, bg) >= 4.5, `${theme}/${color.id}/${intensity}: boundary`)
    }
    for (const key of ['key', 'term', 'note']) assert.ok(contrast(DJ_COLORS[theme][key], bg) >= 4.5, `${theme}/${key}`)
  }
  for (const [fg, bg] of [['#000000', '#ffffff'], ['#ffffff', '#000000']]) {
    const appearance = dianjingAppearance(fg, bg, 'light', 'rose', 1, true)
    assert.equal(appearance.strong, fg)
    assert.equal(appearance.weak, fg)
    assert.equal(appearance.boundary, fg)
    assert.ok(contrast(fg, appearance.background) >= 15)
  }
})

test('App middle preserves the previous maximum and the new maximum triples its budget', async () => {
  const { engineDensity } = await import('../src/mobile/services/dianjingDensity.ts')
  assert.equal(engineDensity({ density: 'normal' }), 100)
  assert.equal(engineDensity({ density: 'high' }), 300)
  const keys = Array.from({ length: 300 }, (_, i) => ({ id: `budget-${i}`, t: 'key', block: i, sentence: 0, r: 3, why: '' }))
  assert.equal(selectKeys(keys, () => 10, 6000, 'normal', 100).size, 90)
  assert.equal(selectKeys(keys, () => 10, 6000, 'normal', 300).size, 270)
  const { guideIntensity, intensityFromSlider, intensityToSlider } = await import('../src/mobile/services/dianjingIntensity.ts')
  assert.equal(guideIntensity(), 1)
  for (const [position, intensity] of [[0, .25], [50, 1], [100, 3]]) {
    assert.equal(intensityFromSlider(position), intensity)
    assert.ok(Math.abs(intensityToSlider(intensity) - position) < .0001)
  }
  const bg = '#fafafa', fg = '#20252c'
  const middle = dianjingAppearance(fg, bg, 'light', 'rose', 1)
  const high = dianjingAppearance(fg, bg, 'light', 'rose', 3)
  for (const i of [1, 3, 5]) {
    const original = parseInt(bg.slice(i, i + 2), 16)
    const a = original - parseInt(middle.background.slice(i, i + 2), 16)
    const b = original - parseInt(high.background.slice(i, i + 2), 16)
    assert.ok(Math.abs(b - a * 3) <= 2, '3× tint, allowing integer RGB rounding')
  }
})
