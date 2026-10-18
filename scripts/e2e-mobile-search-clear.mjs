import { chromium } from 'playwright'
import assert from 'node:assert/strict'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 392, height: 872 } })
let releaseRequest
let finishRequest
const finished = new Promise(resolve => { finishRequest = resolve })
let startedRequest
const started = new Promise(resolve => { startedRequest = resolve })
await page.route('**/philosophy-index*', async route => {
  startedRequest()
  await new Promise(resolve => { releaseRequest = resolve })
  await route.continue()
  finishRequest()
})
try {
  await page.goto((process.env.E2E_BASE || 'http://127.0.0.1:4194') + '/#/catalogs')
  await page.locator('.extra-public-sources summary').click()
  await page.locator('.extra-public-sources .public-source-row').filter({ hasText: '哲学文库' }).click()
  await page.locator('#public-source-query').fill('Marx')
  await page.locator('.public-source-search button').click()
  await started
  await page.locator('.uni-input').fill('')
  await page.locator('.uni-results').waitFor({ state: 'hidden' })
  assert.ok(await page.locator('.uni-submit').isDisabled())
  releaseRequest()
  await finished
  await page.unroute('**/philosophy-index*')
  await page.waitForTimeout(800)
  assert.equal(await page.locator('.uni-results').count(), 0, 'late old request cannot restore cleared results')
  await page.locator('.uni-input').fill('Marx')
  await page.locator('.uni-submit').click()
  await page.locator('.uni-pub').first().waitFor()
  assert.ok(await page.locator('.uni-pub').count() > 0)
  await page.locator('.uni-input').fill('')
  await page.locator('.uni-results').waitFor({ state: 'hidden' })
  await page.locator('.uni-input').fill('fhw')
  await page.locator('.uni-submit').click()
  await page.locator('.uni-empty').waitFor()
  console.log('PASS clear completed/in-flight search, discard late results, then search again')
} finally { releaseRequest?.(); await browser.close() }
