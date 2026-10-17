/**
 * 轻点分区 (src/services/readerTapZone.ts): 横屏左·中·右 · 竖屏上·中·下 · 自动阅读时无翻页区。
 *
 *   npm run test:reader-tap-zone
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { tapZone } from '../src/services/readerTapZone.ts'

const land = { width: 1200, height: 800, portrait: false, autoReading: false }
const port = { width: 390, height: 840, portrait: true, autoReading: false }

test('landscape: left / middle / right thirds', () => {
  assert.equal(tapZone({ ...land, x: 100, y: 400 }), 'prev')
  assert.equal(tapZone({ ...land, x: 600, y: 400 }), 'menu')
  assert.equal(tapZone({ ...land, x: 1100, y: 400 }), 'next')
  // 横屏时上下位置不影响
  assert.equal(tapZone({ ...land, x: 600, y: 10 }), 'menu')
})

test('portrait: top / middle / bottom thirds, sides do not turn pages', () => {
  assert.equal(tapZone({ ...port, x: 195, y: 100 }), 'prev')
  assert.equal(tapZone({ ...port, x: 195, y: 420 }), 'menu')
  assert.equal(tapZone({ ...port, x: 195, y: 800 }), 'next')
  assert.equal(tapZone({ ...port, x: 5, y: 420 }), 'menu')
  assert.equal(tapZone({ ...port, x: 385, y: 420 }), 'menu')
})

test('auto reading: no page-turn zones anywhere', () => {
  for (const base of [land, port]) {
    for (const [x, y] of [[0, 0], [base.width - 1, base.height - 1], [base.width / 2, base.height / 2]]) {
      assert.equal(tapZone({ ...base, autoReading: true, x, y }), 'menu')
    }
  }
})

test('zero-size area falls back to menu', () => {
  assert.equal(tapZone({ ...port, height: 0, x: 0, y: 0 }), 'menu')
})
