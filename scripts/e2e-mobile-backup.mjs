import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { unzipSync } from 'fflate'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 392, height: 872 }, userAgent: 'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/155 Mobile Safari/537.36' })
const base = process.env.E2E_BASE || 'http://127.0.0.1:4194'
const body = Buffer.from('完整备份回归。\n'.repeat(22000))
try {
  await page.goto(base + '/#/library')
  await page.locator('input[type=file][multiple]').setInputFiles({ name: '备份验证.txt', mimeType: 'text/plain', buffer: body })
  await page.locator('.book-card').waitFor()
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/settings?page=data'))
  await page.locator('#settings-data:visible').waitFor()
  await page.evaluate(() => {
    window.backupTest = { mode: 'cancel', calls: [], chunks: [] }
    window.__TAURI_INTERNALS__ = { invoke: async (command, args, options) => {
      const test = window.backupTest
      test.calls.push({ command, options })
      if (command === 'plugin:dialog|save') return test.mode === 'cancel' ? null : 'content://test/backup.zip'
      if (command === 'plugin:fs|write_file') {
        if (test.mode === 'error') throw new Error('controlled write failure')
        test.chunks.push(Array.from(args)); return
      }
      throw new Error('Unexpected native command: ' + command)
    } }
  })
  const button = page.getByRole('button', { name: '导出藏书包', exact: true })
  await button.click()
  await page.waitForFunction(() => backupTest.calls.length > 0 && !document.querySelector('#settings-data .row-actions button').disabled)
  assert.equal(await page.evaluate(() => backupTest.chunks.length), 0)
  assert.deepEqual(await page.evaluate(() => backupTest.calls.map(c => c.command)), ['plugin:dialog|save'])
  for (const mode of ['error', 'success']) {
    await page.evaluate(mode => { backupTest.mode = mode; backupTest.calls = []; backupTest.chunks = [] }, mode)
    await button.click()
    await page.getByText(mode === 'error' ? /controlled write failure/ : '藏书包已导出', { exact: mode === 'success' }).waitFor()
    if (mode === 'success') {
      const { calls, chunks } = await page.evaluate(() => backupTest)
      assert.ok(chunks.length > 1)
      assert.ok(chunks.every(c => c.length <= 256 * 1024))
      const writes = calls.filter(c => c.command === 'plugin:fs|write_file')
      assert.equal(JSON.parse(writes[0].options.headers.options).append, false)
      assert.ok(writes.slice(1).every(c => JSON.parse(c.options.headers.options).append))
      const entries = unzipSync(Buffer.concat(chunks.map(c => Buffer.from(c))))
      const content = Object.entries(entries).find(([name]) => /^assets\/books\/.*\/content\.txt$/.test(name))
      assert.ok(content)
      assert.deepEqual(Buffer.from(content[1]), body)
      assert.ok(entries['manifest.json'] && entries['index.md'])
    }
  }
  console.log('PASS native backup contract: cancel, write failure, chunked complete ZIP and original book bytes')
} catch(e) { console.log(await page.locator('[role=alert],[role=status],#settings-data').allTextContents()); console.log(await page.evaluate(()=>({mode:backupTest.mode,calls:backupTest.calls,chunkSizes:backupTest.chunks.map(c=>c.length)}))); throw e } finally { await browser.close() }
