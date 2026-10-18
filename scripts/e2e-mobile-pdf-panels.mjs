import { chromium } from 'playwright'
import assert from 'node:assert/strict'
const fixture = process.env.PDF_FIXTURE
assert.ok(fixture, 'Provide a local text PDF with the search word (PDF_SEARCH defaults to learning)')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 392, height: 872 }, hasTouch: true, isMobile: true })
page.setDefaultTimeout(20000)
const clickHighlight = async () => {
  const highlight = page.locator('.p-hl-rect').first()
  await highlight.scrollIntoViewIfNeeded()
  const r = await highlight.boundingBox()
  // Highlight geometry has pointer-events:none; the canvas handles coordinate hit testing.
  await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2)
  await page.locator('.anno-pop').waitFor()
}
try {
  await page.goto((process.env.E2E_BASE || 'http://127.0.0.1:4194') + '/#/library')
  await page.locator('input[type=file][multiple]').setInputFiles(fixture)
  await page.locator('.book-card').click()
  await page.waitForFunction(() => [...document.querySelectorAll('.paper canvas')].some(c => c.width > 100))
  await page.getByRole('button', { name: /书内搜索/ }).click()
  await page.locator('.pdf-search-input').fill(process.env.PDF_SEARCH || 'learning')
  await page.locator('.pdf-search-input').press('Enter')
  const match = page.locator('.p-search-rect.active').first()
  await match.waitFor()
  for (const width of [320, 392, 768]) {
    await page.setViewportSize({ width, height: 872 })
    const search = await page.locator('.pdf-search').evaluate(el => ({
      overflow: el.scrollWidth - el.clientWidth,
      controls: [...el.querySelectorAll('button')].map(b => { const r = b.getBoundingClientRect(); return { width: r.width, height: r.height } }),
    }))
    assert.ok(search.overflow <= 1, `PDF search overflow at ${width}px`)
    assert.ok(search.controls.every(r => r.width >= 44 && r.height >= 44), `PDF search touch targets at ${width}px`)
  }
  await page.setViewportSize({ width: 392, height: 872 })
  await match.scrollIntoViewIfNeeded()
  const r = await match.boundingBox()
  await page.mouse.dblclick(r.x + r.width / 2, r.y + r.height / 2)
  await page.locator('.sel-act').filter({ hasText: '写想法' }).click()
  await page.getByRole('dialog', { name: '写想法' }).waitFor()
  await page.locator('.note-input').fill('QA PDF note')
  // Guard the native contract: undefined means no change in SQLite, not clear.
  await page.evaluate(async () => {
    const storage = await (await import('/src/storage/index.ts')).getStorage()
    const update = storage.updateAnnotation.bind(storage)
    window.__pdfNotePatches = []
    storage.updateAnnotation = (id, patch) => { window.__pdfNotePatches.push({ ...patch }); return update(id, patch) }
  })
  await page.locator('.anno-pop').getByRole('button', { name: '保存想法', exact: true }).click()
  await page.locator('.pdf-search button[title^="关闭搜索"]').click()
  await clickHighlight()
  await page.locator('.note-input').fill('')
  await page.locator('.anno-pop').getByRole('button', { name: '保存想法', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.__pdfNotePatches), [{ note: 'QA PDF note' }, { note: '' }])
  await page.reload()
  await clickHighlight()
  assert.equal(await page.locator('.note-input').inputValue(), '')
  const route = page.url()
  await page.goBack()
  await page.locator('.anno-pop').waitFor({ state: 'hidden' })
  assert.equal(page.url(), route, 'Back closes the note without leaving the PDF')
  await clickHighlight()
  await page.locator('.anno-pop').getByRole('button', { name: '删除划线', exact: true }).click()
  await page.locator('.p-hl-rect').waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '更多操作', exact: true }).click()
  await page.getByRole('menuitem', { name: '文件属性', exact: true }).click()
  await page.getByRole('dialog').waitFor()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: /书内搜索/ }).click()
  await page.getByRole('button', { name: '目录', exact: true }).click()
  await page.locator('.pdf-search-input').focus()
  assert.ok(await page.locator('.side-drawer').isVisible())
  await page.keyboard.press('Escape')
  // Escape in the search input must not bubble and close the underlying drawer too.
  await page.locator('.pdf-search').waitFor({ state: 'hidden' })
  assert.ok(await page.locator('.side-drawer').isVisible())
  await page.locator('.paper-header button').first().focus()
  await page.keyboard.press('Escape')
  await page.locator('.side-drawer').waitFor({ state: 'hidden' })
  console.log('PASS PDF note clear/reload/delete, modal Back, properties and layered panel closing')
} finally { await browser.close() }
