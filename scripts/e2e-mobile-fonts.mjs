import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
const base = process.env.E2E_BASE || 'http://localhost:4193'
const resources = process.env.FONT_FIXTURES || '/tmp/lightread-font-resources-20261018'
const out = process.env.SHOTS_DIR || '/tmp/lightread-mobile-fonts'
const catalog = JSON.parse(readFileSync(new URL('../src/mobile/data/font-catalog.json', import.meta.url)))
mkdirSync(out, { recursive: true })
const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 392, height: 872 }, serviceWorkers: 'block' })
p.setDefaultTimeout(20000)
const errors = [], checks = [], requests = []
p.on('pageerror', e => errors.push(e.message))
let responseMode = 'normal', releaseHeld
await p.route('https://gitcode.com/**/reader-fonts-20261018/*', async r => {
  const name = new URL(r.request().url()).pathname.split('/').at(-1)
  requests.push(name)
  if (responseMode === 'error') return r.fulfill({ status: 503, body: 'controlled unavailable response' })
  if (responseMode === 'hold') { await new Promise(resolve => { releaseHeld = resolve }); return r.abort().catch(() => {}) }
  const bytes = Buffer.from(readFileSync(resources + '/' + name))
  if (responseMode === 'tamper') bytes[bytes.length - 1] ^= 1
  await r.fulfill({ status: 200, contentType: 'application/zip', body: bytes })
})
const state = () => p.evaluate(() => JSON.parse(JSON.stringify(document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('settings').$state)))
const row = id => p.locator(`[data-font-id="${id}"]`)
async function openCatalog() {
  await p.evaluate(() => document.querySelector('.content')?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  await p.locator('.dock button').last().click()
  await p.locator('.font-catalog-entry').click()
  await p.locator('.font-catalog').waitFor()
}
const check = message => { checks.push(message); console.log('PASS', message) }
try {
  await p.goto(base + '/#/library')
  await p.locator('input[type=file][multiple]').setInputFiles({ name: '字体回归.txt', mimeType: 'text/plain', buffer: Buffer.from('第一章 山水与阅读\n\n' + '山光悦鸟性，潭影空人心。理想国中的正义与智慧，值得认真阅读。\n\n'.repeat(100)) })
  await p.locator('.book-card').click()
  await p.waitForFunction(() => document.querySelector('foliate-view')?.renderer?.getContents?.().length)
  await openCatalog()
  assert.equal(await p.locator('.font-resource').count(), 10)
  assert.equal(requests.length, 0, 'opening font list must not download fonts')
  const before = (await state()).reader.fontFamily
  for (const mode of ['error', 'tamper']) {
    responseMode = mode
    await row('smiley').getByRole('button', { name: '下载并使用', exact: true }).click()
    await p.locator('.font-error').waitFor()
    assert.equal((await state()).reader.fontFamily, before)
    assert.equal((await state()).customFonts.length, 0)
    await row('smiley').getByRole('button', { name: '下载并使用', exact: true }).waitFor()
  }
  check('HTTP error and altered archive show an error; no font is installed or applied')
  responseMode = 'hold'
  await row('smiley').getByRole('button', { name: '下载并使用', exact: true }).click()
  await p.waitForTimeout(200)
  await row('smiley').getByRole('button', { name: /^取消/ }).click()
  releaseHeld?.()
  await row('smiley').getByRole('button', { name: '下载并使用', exact: true }).waitFor()
  assert.equal((await state()).customFonts.length, 0)
  check('cancel stops a pending download without changing the current font')
  responseMode = 'normal'
  for (const font of catalog) {
    await row(font.id).getByRole('button', { name: '下载并使用', exact: true }).click()
    await row(font.id).getByRole('button', { name: '使用中', exact: true }).waitFor({ timeout: 60000 })
    await p.waitForFunction(name => document.querySelector('foliate-view').renderer.getContents().every(({ doc }) => doc.__lrFont?.face.status === 'loaded' && doc.__lrFont.face.family === name), font.name)
    assert.equal((await state()).reader.fontFamily, `custom:${font.name}`)
    assert.ok(await row(font.id).locator('.font-resource-sample').isVisible())
    await row(font.id).scrollIntoViewIfNeeded()
    await p.screenshot({ path: `${out}/${font.id}.png`, animations: 'disabled' })
  }
  assert.equal((await state()).customFonts.length, 10)
  const retained = await p.evaluate(names => [...document.fonts].map(f => f.family).filter(name => names.includes(name)), catalog.map(f => f.name))
  assert.ok(retained.length <= 1, 'retained catalog faces: ' + JSON.stringify(retained))
  check('all ten original font packages download, verify, persist and render in actual reader documents')
  const count = requests.length
  await p.evaluate(() => {
    window.__fontOriginalLoad = FontFace.prototype.load
    FontFace.prototype.load = async function () {
      const loaded = await window.__fontOriginalLoad.call(this)
      if (this.family === '霞鹜文楷') await new Promise(resolve => { window.__releaseFontApply = resolve })
      return loaded
    }
  })
  await row('wenkai').getByRole('button', { name: '使用', exact: true }).click()
  await p.waitForFunction(() => !!window.__releaseFontApply)
  await row('wenkai').getByRole('button', { name: /^取消/ }).click()
  await p.evaluate(() => { FontFace.prototype.load = window.__fontOriginalLoad; window.__releaseFontApply() })
  await row('wenkai').getByRole('button', { name: '使用', exact: true }).waitFor()
  assert.equal((await state()).reader.fontFamily, 'custom:得意黑')
  assert.equal(await p.evaluate(() => document.__lrFont?.face.family), '得意黑')
  check('cancel during cached font preparation preserves the previous reader font and preview')
  await row('wenkai').getByRole('button', { name: '使用', exact: true }).click()
  await row('wenkai').getByRole('button', { name: '使用中', exact: true }).waitFor()
  assert.equal(requests.length, count)
  await p.keyboard.press('Escape')
  await p.locator('.font-catalog').waitFor({ state: 'hidden' })
  assert.ok(await p.locator('.settings-pop').isVisible(), 'close only font catalog, retain typography')
  await p.reload()
  await p.waitForFunction(() => document.querySelector('foliate-view')?.renderer?.getContents?.().some(({ doc }) => doc.__lrFont?.face.status === 'loaded'))
  assert.equal((await state()).reader.fontFamily, 'custom:霞鹜文楷')
  assert.equal(requests.length, count)
  check('switching cached fonts and reloading reader use persisted font bytes without a network request')
  await p.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('lightread-mobile-fonts')
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('files', 'readwrite')
      tx.objectStore('files').delete('idb:catalog-wenkai-v1.530.ttf')
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => { db.close(); reject(tx.error) }
    }
    request.onerror = () => reject(request.error)
  }))
  await openCatalog()
  await row('wenkai').getByRole('button', { name: '下载并使用', exact: true }).click()
  await row('wenkai').getByRole('button', { name: '使用中', exact: true }).waitFor({ timeout: 60000 })
  assert.equal(requests.length, count + 1)
  assert.equal((await state()).customFonts.length, 10)
  check('a missing selected font file can be downloaded again without duplicate entries')
  for (const theme of ['light', 'dark']) for (const width of [320, 392, 768]) {
    await p.setViewportSize({ width, height: 600 })
    await p.evaluate(theme => { document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('settings').appearance = theme }, theme)
    await p.locator('.font-catalog').evaluate(e => e.parentElement.scrollTop = 0)
    assert.ok(await p.locator('.font-catalog').evaluate(e => e.scrollWidth <= e.clientWidth + 1))
    assert.ok(await p.locator('.font-resource button').evaluateAll(es => es.every(e => e.getBoundingClientRect().height >= 44)))
    await p.screenshot({ path: `${out}/layout-${theme}-${width}.png`, animations: 'disabled' })
  }
  check('320 / 392 / 768 light and dark font catalog has no horizontal clipping and 44px actions')
  assert.deepEqual(errors, [])
  writeFileSync(out + '/results.json', JSON.stringify({ ok: true, checks, errors }, null, 2))
} catch (e) {
  await p.screenshot({ path: out + '/failure.png' })
  writeFileSync(out + '/results.json', JSON.stringify({ ok: false, checks, errors, failure: String(e.stack) }, null, 2))
  throw e
} finally { releaseHeld?.(); await b.close() }
