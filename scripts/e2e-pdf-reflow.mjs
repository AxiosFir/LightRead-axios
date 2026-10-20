// Run against either desktop or App preview. PDF_FIXTURE optionally supplies a long local text PDF.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import * as mupdf from 'mupdf'

const base = process.env.E2E_BASE ?? 'http://localhost:4173'
const mobile = process.env.E2E_MOBILE === '1'
function pdf(draw) {
  const buffer = new mupdf.Buffer()
  const writer = new mupdf.DocumentWriter(buffer, 'pdf', '')
  for (let page = 0; page < 4; page++) {
    draw(writer.beginPage([0, 0, 595, 842]), page)
    writer.endPage()
  }
  writer.close()
  return Buffer.from(buffer.asUint8Array())
}
const font = new mupdf.Font('Helvetica')
const textPdf = () => pdf((dev, page) => {
  const text = new mupdf.Text()
  text.showString(font, [22, 0, 0, -22, 60, 90], `Chapter ${page + 1}`)
  for (let row = 0; row < 25; row++) {
    text.showString(font, [11, 0, 0, -11, 60, 130 + row * 18],
      `Page ${page + 1}: Local PDF reading keeps paragraphs, chapters and progress.`)
  }
  dev.fillText(text, mupdf.Matrix.identity, mupdf.ColorSpace.DeviceGray, [0], 1)
})
const image = new mupdf.Image(readFileSync(new URL('../public/icon-192.png', import.meta.url)))
const scanPdf = pdf(dev => dev.fillImage(image, [595, 0, 0, 842, 0, 0], 1))
const fixture = process.env.PDF_FIXTURE ? readFileSync(process.env.PDF_FIXTURE) : textPdf()
const browser = await chromium.launch()
try {
  const context = await browser.newContext({
    viewport: mobile ? { width: 392, height: 850 } : { width: 1280, height: 860 },
    isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block', locale: 'zh-CN',
  })
  const page = await context.newPage()
  page.setDefaultTimeout(30000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const ready = () => page.waitForFunction(() =>
    document.querySelector('foliate-view')?.renderer?.getContents?.().length && !document.querySelector('.state'),
  null, { timeout: 120000 })
  const reveal = async () => {
    if (await page.locator('header.bar.top.hidden').count()) {
      await page.locator('.content').dispatchEvent('click')
    }
    await page.locator('header.bar.top:not(.hidden)').waitFor()
  }
  await page.goto(`${base}/#/library`)
  await page.setInputFiles('input[type=file][multiple]', [
    { name: 'reflow-text.pdf', mimeType: 'application/pdf', buffer: fixture },
    { name: 'reflow-scan.pdf', mimeType: 'application/pdf', buffer: scanPdf },
  ])
  await page.waitForFunction(() => document.querySelectorAll('.book-card').length === 2)
  // A supplied PDF can carry a title that overrides its imported filename.
  await page.locator('.book-card').filter({ hasNotText: 'reflow-scan' }).first().click()
  await page.waitForURL(/#\/read\//)
  await ready()
  const bookId = new URL(page.url()).hash.split('/')[2].split('?')[0]
  await reveal()
  await page.locator('input.slider[aria-label="阅读进度"]').evaluate(el => {
    el.value = '0.6'
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await page.waitForFunction(id => {
    const state = JSON.parse(localStorage.getItem(`lightread-pdf-reflow-loc:${id}`) ?? 'null')
    return state?.page > 1
  }, bookId)
  await reveal()
  await page.locator('.pdf-switch').click()
  await page.waitForURL(/#\/read-paper\//)
  await page.locator('.p-holder canvas').first().waitFor()
  await page.reload()
  await page.locator('.p-holder canvas').first().waitFor()
  assert.match(page.url(), /#\/read-paper\//, 'original view choice survives reload')
  await page.locator('.pdf-view-switch').click()
  await page.waitForURL(/#\/read\//)
  await ready()
  await page.reload()
  await ready()
  assert.match(page.url(), /#\/read\//, 'ebook view choice survives reload')
  await page.goto(`${base}/#/library`)
  await page.locator('.book-card').filter({ hasText: 'reflow-scan' }).click()
  await page.locator('.p-holder canvas').first().waitFor()
  assert.match(page.url(), /#\/read-paper\//, 'scanned PDF retains its original layout')
  assert.equal(await page.locator('.pdf-view-switch').isDisabled(), true)
  assert.deepEqual(errors, [])
  console.log(`PASS ${mobile ? 'App' : 'desktop'} PDF defaults, progress navigation, view switching, reload persistence and scanned PDF fallback`)
} finally {
  await browser.close()
}
