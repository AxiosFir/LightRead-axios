import { chromium } from 'playwright'
import assert from 'node:assert/strict'

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  await page.goto((process.env.E2E_BASE || 'http://127.0.0.1:4194') + '/#/library')
  await page.locator('.library').waitFor()
  const result = await page.evaluate(async () => {
    const { createApp } = await import('/node_modules/.vite/deps/vue.js')
    const { useReadingTimer } = await import('/src/composables/useReadingTimer.ts')
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
    const library = pinia._s.get('library'), credits = []
    const original = { now: Date.now, interval: window.setInterval, add: library.addReadingTime }
    let now = Date.now(), foreground = true, tick
    let app
    const node = document.body.appendChild(document.createElement('div'))
    try {
      Date.now = () => now
      window.LightReadLifecycle = { isForeground: () => foreground }
      window.setInterval = (fn, ms, ...args) => {
        if (ms === 15000) { tick = fn; return 0 }
        return original.interval(fn, ms, ...args)
      }
      library.addReadingTime = async (id, seconds) => { credits.push({ id, seconds }) }
      app = createApp({ setup() { useReadingTimer('lifecycle-test'); return () => null } })
      app.use(pinia).mount(node)
      const advance = count => { for (let i = 0; i < count; i++) { now += 15000; tick() } }
      advance(4)
      const front = credits.reduce((n, x) => n + x.seconds, 0)
      foreground = false
      advance(4)
      const background = credits.reduce((n, x) => n + x.seconds, 0)
      foreground = true
      window.dispatchEvent(new Event('pointerdown'))
      advance(2)
      app.unmount(); app = undefined
      return { hidden: document.hidden, front, background, credits }
    } finally {
      app?.unmount()
      Date.now = original.now; window.setInterval = original.interval
      library.addReadingTime = original.add
      delete window.LightReadLifecycle
      node.remove()
    }
  })
  assert.equal(result.hidden, false, 'reproduce WebView reporting visible in the background')
  assert.equal(result.front, 60)
  assert.equal(result.background, 60, 'native background must add no reading time')
  assert.deepEqual(result.credits.map(x => x.seconds), [60, 30], 'foreground resumes and unmount flushes remaining time')
  console.log('PASS actual App reading timer: foreground credit, stale WebView visibility in native background, resume and unmount')
} finally { await browser.close() }
