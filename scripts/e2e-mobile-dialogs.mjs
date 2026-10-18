// Real App forms: dismissal must retain the underlying route, including its query.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
const base = process.env.E2E_BASE || 'http://localhost:4192'
const out = process.env.SHOTS_DIR || '/tmp/lightread-mobile-dialogs'
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
const p = await browser.newPage({ viewport: { width: 392, height: 872 }, serviceWorkers: 'block' })
p.setDefaultTimeout(12000)
const errors = [], checks = []
p.on('pageerror', e => errors.push(e.message))
const dialog = () => p.getByRole('dialog')
const check = text => { checks.push(text); console.log('PASS', text) }
const route = () => p.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$route.fullPath)
async function go(to) {
  await p.evaluate(async to => { await document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(to) }, to)
  await p.locator(to.startsWith('/catalogs') ? '.source-group' : '.library').first().waitFor()
}
async function close(method, expectedRoute) {
  if (method === 'back') await p.evaluate(() => history.back())
  if (method === 'escape') await p.keyboard.press('Escape')
  if (method === 'button') await dialog().getByRole('button', { name: '关闭', exact: true }).click()
  if (method === 'mask') await p.locator('.app-modal-mask').click({ position: { x: 3, y: 3 } })
  await dialog().waitFor({ state: 'hidden' })
  await p.waitForTimeout(120)
  assert.equal(await route(), expectedRoute, method + ' changed the page')
  assert.equal(await p.locator('#app').evaluate(e => e.inert), false)
}
async function exercise(name, open) {
  const expected = await route()
  for (const method of ['escape', 'button', 'mask', 'back']) {
    await open()
    await dialog().waitFor()
    assert.equal(await p.locator('#app').evaluate(e => e.inert), true)
    await p.keyboard.press('Shift+Tab')
    assert.ok(await dialog().evaluate(e => e.contains(document.activeElement)), 'focus escaped dialog')
    await close(method, expected)
  }
  check(name + ': Escape / close / mask / history Back retain route and restore background')
}
try {
  await p.goto(base + '/#/catalogs')
  await p.locator('.source-group').first().waitFor()
  await go('/library?view=booklists')
  await exercise('new booklist', () => p.locator('.booklist-create').click())
  await p.locator('.booklist-create').click()
  await dialog().getByRole('textbox').fill('弹窗回归书单')
  await dialog().getByRole('button', { name: '创建书单', exact: true }).click()
  await dialog().waitFor({ state: 'hidden' })
  const manage = () => p.locator('.booklist-overview-head').getByRole('button', { name: '管理', exact: true }).click()
  await exercise('manage booklists', manage)
  await manage()
  await dialog().getByRole('button', { name: '删除', exact: true }).click()
  await p.locator('.confirm-cancel').waitFor()
  assert.equal(await p.locator('.app-modal-mask').first().evaluate(e => e.inert), true)
  await p.evaluate(() => history.back())
  await p.locator('.confirm-cancel').waitFor({ state: 'hidden' })
  assert.equal(await dialog().count(), 1)
  assert.equal(await p.locator('.app-modal-mask').evaluate(e => e.inert), false)
  await close('button', '/library?view=booklists')
  check('nested delete confirmation: Back closes only confirmation and keeps booklist')
  await go('/catalogs')
  await exercise('add source', () => p.locator('.add-source-card').click())
  await go('/library')
  const openUrl = async () => {
    await p.locator('.add-fab').click()
    await dialog().getByRole('button', { name: /从链接添加/ }).click()
    await dialog().getByRole('heading', { name: '从链接添加', exact: true }).waitFor()
  }
  await exercise('import from URL', openUrl)
  // Hold a controlled download to verify all dismissal paths while busy.
  let releaseDownload, downloadStarted
  const started = new Promise(resolve => { downloadStarted = resolve })
  const held = new Promise(resolve => { releaseDownload = resolve })
  await p.route('**/dialog-fixture.txt', async r => { downloadStarted(); await held; await r.fulfill({ status: 503, body: 'fixture unavailable' }) })
  await openUrl()
  await dialog().locator('input').fill(base + '/dialog-fixture.txt')
  await dialog().getByRole('button', { name: '下载到藏书', exact: true }).click()
  await started
  assert.ok(await dialog().getByRole('button', { name: '关闭', exact: true }).isDisabled())
  await p.keyboard.press('Escape')
  await p.evaluate(() => history.back())
  await p.waitForTimeout(200)
  assert.equal(await route(), '/library')
  assert.equal(await dialog().count(), 1)
  releaseDownload()
  await dialog().getByRole('button', { name: '关闭', exact: true }).waitFor({ state: 'visible' })
  await p.waitForFunction(() => !document.querySelector('.app-modal-close').disabled)
  await close('button', '/library')
  check('active URL download retains its dialog on Escape / Back; error restores close control')
  // Short viewports represent available space above an on-screen keyboard.
  for (const theme of ['light', 'dark']) {
    await p.evaluate(theme => { document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('settings').appearance = theme }, theme)
    for (const width of [320, 392, 768]) {
      await p.setViewportSize({ width, height: 460 })
      await go('/library?view=booklists')
      await manage()
      await p.waitForTimeout(350)
      const bounds = await dialog().evaluate(e => {
        const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, overflow: e.scrollWidth > e.clientWidth + 1 }
      })
      assert.ok(bounds.x >= -1 && bounds.y >= -1 && bounds.right <= width + 1 && bounds.bottom <= 461 && !bounds.overflow, JSON.stringify(bounds))
      await p.screenshot({ path: `${out}/manage-${theme}-${width}.png` })
      await close('button', '/library?view=booklists')
    }
  }
  check('manage form stays inside 320 / 392 / 768 × 460, light and dark')
  assert.deepEqual(errors, [])
  writeFileSync(out + '/results.json', JSON.stringify({ ok: true, checks, errors }, null, 2))
} catch (e) {
  await p.screenshot({ path: out + '/failure.png' })
  writeFileSync(out + '/results.json', JSON.stringify({ ok: false, checks, errors, failure: String(e.stack) }, null, 2))
  throw e
} finally { await browser.close() }
