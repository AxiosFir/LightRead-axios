import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AutoScrollClock, ScrollAccumulator } from '../src/services/autoScroll.ts'

test('30–144 Hz: identical distance over time, including fractional pixels', () => {
  for (const hz of [30, 60, 90, 120, 144]) {
    const clock = new AutoScrollClock()
    let position = clock.step(0, 2.5)
    for (let i = 1; i <= hz * 10; i++) position += clock.step(i * 1000 / hz, 2.5)
    assert.ok(Math.abs(position - 25) < 1e-8, `${hz} Hz: ${position}`)
  }
})

test('long frames discard debt; returning from background does not jump', () => {
  const clock = new AutoScrollClock()
  clock.step(0, 60)
  assert.equal(clock.step(100, 60), 2)
  assert.equal(clock.step(110, 60), 0.6)
  assert.equal(clock.step(10_000, 60), 0)
  assert.equal(clock.step(10_010, 60), 0.6)
  clock.reset()
  assert.equal(clock.step(10_050, 60), 0)
})

test('speed changes are continuous, monotonic, and settle without restarting', () => {
  const clock = new AutoScrollClock()
  clock.step(0, 10)
  let last = 0.1
  for (let t = 10; t <= 1000; t += 10) {
    const dx = clock.step(t, 100)
    assert.ok(dx >= last && dx <= 1)
    last = dx
  }
  assert.ok(last > 0.999)
  for (let t = 1010; t <= 2000; t += 10) {
    const dx = clock.step(t, 10)
    assert.ok(dx <= last && dx >= 0.1)
    last = dx
  }
  assert.ok(last < 0.101)
})

test('native integer and fractional scrollTop retain slow movement and rebase on manual scroll', () => {
  for (const quantum of [1, 0.8, 0.5, 0]) {
    let position = 0
    const el = { scrollHeight: 10000, clientHeight: 500,
      get scrollTop() { return position },
      set scrollTop(v) { position = quantum ? Math.round(v / quantum) * quantum : v } }
    const accumulator = new ScrollAccumulator()
    for (let i = 0; i < 1200; i++) accumulator.move(el, 0.025)
    assert.ok(Math.abs(position - 30) <= Math.max(quantum, 1e-8))
    el.scrollTop = 300
    accumulator.move(el, 2)
    assert.ok(Math.abs(position - 302) <= Math.max(quantum, 1e-8))
    el.scrollTop = 9499
    accumulator.move(el, 10)
    assert.ok(position <= 9500)
  }
})
