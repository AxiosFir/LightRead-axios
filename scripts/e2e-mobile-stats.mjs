import { chromium } from 'playwright'
import assert from 'node:assert/strict'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 392, height: 872 } })
try {
  await page.goto((process.env.E2E_BASE || 'http://localhost:4194') + '/#/library')
  await page.locator('input[type=file][multiple]').setInputFiles({
    name: '日期详情回归.txt', mimeType: 'text/plain', buffer: Buffer.from('阅读记录测试。\n'.repeat(100)),
  })
  await page.locator('.book-card').waitFor()
  await page.evaluate(async () => {
    const library = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('library')
    await library.addReadingTime(library.books[0].id, 475)
  })
  await page.locator('.nav a[href="#/stats"]').click()
  assert.equal((await page.locator('.ring-value').innerText()).replace(/\s/g, ''), '7分钟')
  assert.equal((await page.locator('.total-value').innerText()).replace(/\s/g, ''), '7分钟')
  const durations = await page.evaluate(async () => {
    const { formatReadingTime } = await import('/src/composables/useReadingTimer.ts')
    return [59, 89, 475, 3599, 3600].map(formatReadingTime)
  })
  assert.deepEqual(durations, ['不足 1 分钟', '1 分钟', '7 分钟', '59 分钟', '1 小时 0 分钟'])
  await page.locator('.ms .link').click()
  await page.locator('.dd-panel').waitFor()
  await page.evaluate(() => history.back())
  await page.locator('.dd-panel').waitFor({ state: 'hidden' })
  await page.waitForURL(/#\/stats$/)
  await page.locator('.ms .link').click()
  await page.locator('.dd-panel button.row').first().click()
  await page.waitForURL(/#\/read\//)
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/stats'))
  await page.locator('.ms .link').click()
  await page.keyboard.press('Escape')
  await page.locator('.dd-panel').waitFor({ state: 'hidden' })
  assert.match(page.url(), /#\/stats$/)
  console.log('PASS date sheet: history Back, open book, Escape')
} finally { await browser.close() }
