import { chromium } from 'playwright'
import assert from 'node:assert/strict'

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 392, height: 872 } })
  await page.goto((process.env.E2E_BASE || 'http://127.0.0.1:4194') + '/#/manual?doc=03-%E5%A3%B0%E9%9F%B3.md')
  const link = page.locator('.manual-content a[href*=".md#"]').first()
  await link.waitFor()
  const href = await link.getAttribute('href')
  await link.click()
  const target = decodeURIComponent(href.split('#')[1])
  await page.waitForFunction(target => {
    const y = document.getElementById(target)?.getBoundingClientRect().y
    return y != null && y >= 0 && y < innerHeight
  }, target)
  assert.ok(decodeURIComponent(new URL(page.url()).hash).endsWith('#' + target))
  await page.locator('.manual-select').click()
  await page.locator('.app-select-option[data-value="03-声音.md"]').click()
  const localLink = page.locator('.manual-content a[href^="#"]').first()
  await localLink.waitFor()
  const localTarget = decodeURIComponent((await localLink.getAttribute('href')).slice(1))
  await localLink.click()
  await page.waitForFunction(target => {
    const y = document.getElementById(target)?.getBoundingClientRect().y
    return y != null && y >= 0 && y < innerHeight
  }, localTarget)
  console.log('PASS App manual cross-chapter and same-chapter anchor navigation')
} finally { await browser.close() }
