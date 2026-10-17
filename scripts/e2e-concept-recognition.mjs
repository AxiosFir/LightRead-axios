import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const browser = await chromium.launch()
const base = process.env.E2E_BASE ?? 'http://localhost:4173'
const text = Array.from({ length: 12 }, (_, i) => `第${i}个例子讨论主体间性，作者从不同的经验出发解释这个概念的意义，再通过人与人的交往说明问题。读者可以结合前面的例子思考这些说法。`).join('\n\n')
try {
  for (const mode of ['worker', 'fallback', 'missing-asset']) {
    const context = await browser.newContext({ serviceWorkers: 'block' })
    try {
      if (mode === 'fallback') await context.route('**/keyWords.worker-*.js', r => r.abort())
      if (mode === 'missing-asset') await context.route('**/concepts-*.json', r => r.fulfill({ status: 503, body: '' }))
      await context.addInitScript(() => {
        localStorage.setItem('lightread-settings', JSON.stringify({ version: 14, language: 'zh',
          dianjing: { level: 'basic', density: 'normal' },
          readingMode: { wordGuide: { enabled: true, mark: 'keywords' } } }))
      })
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', e => errors.push(e.message))
      await page.goto(`${base}/#/library`)
      await page.setInputFiles('input[type=file][multiple]', {
        name: '哲学导论.txt', mimeType: 'text/plain', buffer: Buffer.from(text) })
      await page.locator('.book-card').filter({ hasText: '哲学导论' }).click()
      await page.waitForFunction(() => {
        const doc = document.querySelector('foliate-view')?.renderer?.getContents?.()[0]?.doc
        if (!doc) return false
        return [...doc.defaultView.CSS.highlights].some(([name, ranges]) => name.startsWith('lr-wg-kw-') && ranges.size)
      }, null, { timeout: 15000 })
      const words = await page.evaluate(() => {
        const doc = document.querySelector('foliate-view').renderer.getContents()[0].doc
        return [...doc.defaultView.CSS.highlights].filter(([name]) => name.startsWith('lr-wg-kw-'))
          .flatMap(([, ranges]) => [...ranges].map(r => r.toString()))
      })
      if (mode !== 'missing-asset') {
        assert.ok(words.includes('主体间性'), JSON.stringify(words))
        assert.ok(!words.includes('主体'))
      }
      assert.deepEqual(errors, [])
      console.log('PASS', mode, JSON.stringify(words))
    } finally { await context.close() }
  }
} finally { await browser.close() }
