import { chromium } from 'playwright'
import assert from 'node:assert/strict'
const browser = await chromium.launch(), page = await browser.newPage()
try {
  await page.goto((process.env.E2E_BASE || 'http://127.0.0.1:4194') + '/#/library')
  await page.locator('input[type=file][multiple]').setInputFiles({ name: '计时刷新.txt', mimeType: 'text/plain', buffer: Buffer.from('阅读时长回归。'.repeat(100)) })
  await page.locator('.book-card').waitFor()
  const result = await page.evaluate(async () => {
    const { getStorage } = await import('/src/storage/index.ts')
    const storage = await getStorage(), library = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('library')
    const id = library.books[0].id, before = library.books[0].readingSeconds || 0
    const original = storage.listBooklistWanted.bind(storage)
    let release, entered
    const reached = new Promise(resolve => { entered = resolve })
    storage.listBooklistWanted = async () => { entered(); await new Promise(resolve => { release = resolve }); return original() }
    try {
      const refresh = library.refresh()
      await reached
      await library.addReadingTime(id, 30)
      release()
      await refresh
      return { before, shown: library.books.find(b => b.id === id).readingSeconds, stored: (await storage.getBook(id)).readingSeconds }
    } finally { storage.listBooklistWanted = original }
  })
  console.log(result)
  assert.equal(result.stored, result.before + 30)
  assert.equal(result.shown, result.stored, 'a stale library refresh must not erase newly credited reading time')
  console.log('PASS reading credit survives overlapping library refresh')
} finally { await browser.close() }
