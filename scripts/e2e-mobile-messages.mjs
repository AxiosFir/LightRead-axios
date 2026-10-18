// Mobile development server: exercises the real message host/service, no production hooks.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
const base = process.env.E2E_BASE || 'http://localhost:4192', out = process.env.SHOTS_DIR || '/tmp/lightread-mobile-messages'
mkdirSync(out, { recursive: true })
const browser = await chromium.launch(), page = await browser.newPage({ viewport: { width: 392, height: 872 } })
page.setDefaultTimeout(10000)
const errors = [], passed = []
page.on('pageerror', e => errors.push(e.message))
await page.goto(base + '/#/library')
await page.locator('.library').waitFor()
// Use the host's exact development-module URL, including any HMR timestamp.
const hostCode = await (await page.request.get(base + '/src/mobile/components/ToastHost.vue')).text()
const serviceUrl = hostCode.match(/from ["']([^"']*mobile\/services\/toast\.ts[^"']*)["']/)?.[1]
assert.ok(serviceUrl, 'mobile host service import')
const emit = (message, type = 'info', action = false) => page.evaluate(async ({ message, type, action, serviceUrl }) => {
  const m = await import(serviceUrl)
  m.toast(message, type, 30000, action ? { label: '撤销', run: () => { window.__messageAction = (window.__messageAction || 0) + 1 } } : undefined)
}, { message, type, action, serviceUrl })
const clear = () => page.evaluate(async serviceUrl => { const m = await import(serviceUrl); while (m.toasts.length) m.toasts[0].dismiss() }, serviceUrl)
async function shot(name) {
  await page.waitForTimeout(220)
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name)
  const bounds = await page.locator('.mobile-messages .toast:visible,.app-modal:visible').evaluateAll(els => els.map(el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, right: r.right, bottom: r.bottom, scroll: el.scrollWidth, width: el.clientWidth } }))
  for (const r of bounds) { assert.ok(r.x >= -1 && r.y >= -1 && r.right <= page.viewportSize().width + 1 && r.bottom <= page.viewportSize().height + 1, name + JSON.stringify(r)); assert.ok(r.scroll <= r.width + 1, name + ': internal overflow') }
  await page.screenshot({ path: `${out}/${name}.png`, animations: 'disabled' })
}
try {
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('settings').appearance = theme }, theme)
    for (const width of [320, 375, 414, 768]) {
      await page.setViewportSize({ width, height: 900 })
      await emit('已加入书单「慢慢读」', 'success', true)
      await shot(`success-${theme}-${width}`)
      assert.equal(await page.locator('.toast').count(), 1)
      const size = await page.locator('.message-close').boundingBox(); assert.ok(size.height >= 44 && size.width >= 44)
      await page.locator('.toast-action').click()
      assert.equal(await page.locator('.toast').count(), 0)
      const long = '连接暂时未完成。请检查书源地址和网络连接后重试。\n'.repeat(16) + '完整消息结尾'
      await emit(long, 'error')
      await shot(`long-error-${theme}-${width}`)
      await page.getByRole('button', { name: '查看完整消息', exact: true }).click()
      await page.locator('.message-full').waitFor()
      assert.equal(await page.locator('.message-full').innerText(), long)
      await shot(`details-${theme}-${width}`)
      await page.keyboard.press('Escape')
      await page.locator('.app-modal').waitFor({ state: 'hidden' })
      await page.evaluate(async () => { const { askConfirm } = await import('/src/services/confirm.ts'); window.__messageConfirmation = null; void askConfirm('删除书单「慢慢读」？\n书单中的书籍仍会保留在藏书中。').then(value => window.__messageConfirmation = value) })
      await page.locator('.confirm-cancel').waitFor()
      assert.ok(await page.locator('.confirm-cancel').evaluate(el => el === document.activeElement))
      await shot(`confirm-${theme}-${width}`)
      await page.keyboard.press('Escape')
      await page.waitForFunction(() => window.__messageConfirmation === false)
    }
  }
  assert.equal(await page.evaluate(() => window.__messageAction), 8)
  passed.push('32 layouts: short/action message, long error, full details, confirmation × 4 widths × 2 themes')
  await emit('操作失败', 'error'); await emit('操作失败', 'error'); await emit('可撤销操作', 'success', true)
  assert.equal(await page.locator('.toast').count(), 1)
  assert.match(await page.locator('.toast').innerText(), /操作失败/)
  await page.locator('.message-close').click()
  assert.match(await page.locator('.toast').innerText(), /可撤销操作/)
  await page.locator('.toast-action').click()
  assert.equal(await page.locator('.toast').count(), 0)
  passed.push('duplicate error coalesces; queued actionable result remains available')
  await page.evaluate(async () => { const { askConfirm } = await import('/src/services/confirm.ts'); void askConfirm('确认操作对象').then(v => window.__messageConfirmation = v) })
  await emit('请先检查输入内容', 'error')
  await shot('message-above-confirmation')
  const toast = await page.locator('.toast').boundingBox(), footer = await page.locator('.confirm-actions').boundingBox()
  assert.ok(toast.y + toast.height < footer.y || toast.y > footer.y + footer.height, 'message must not cover confirmation buttons')
  // Android pans the visual viewport to keep an input above the keyboard.
  // Its layout viewport can stay tall, so a fixed top message must follow offsetTop.
  await page.evaluate(() => {
    Object.defineProperty(visualViewport, 'offsetTop', { configurable: true, value: 300 })
    Object.defineProperty(visualViewport, 'height', { configurable: true, value: 557 })
    visualViewport.dispatchEvent(new Event('scroll'))
  })
  await page.waitForFunction(() => document.querySelector('.toast').getBoundingClientRect().top >= 300)
  const shifted = await page.locator('.toast').boundingBox()
  assert.ok(shifted.y >= 300 && shifted.y + shifted.height <= 857, 'message stays inside the panned visual viewport')
  await page.evaluate(() => {
    delete visualViewport.offsetTop; delete visualViewport.height
    visualViewport.dispatchEvent(new Event('scroll'))
  })
  passed.push('message follows a panned visual viewport while the keyboard is open')
  await page.locator('.message-close').click(); await page.locator('.confirm-accept').click()
  await page.waitForFunction(() => window.__messageConfirmation === true)
  assert.deepEqual(errors, [])
  passed.push('confirmation accept/cancel, safe initial focus, Escape and message placement')
  writeFileSync(`${out}/results.json`, JSON.stringify({ ok: true, passed, errors }, null, 2))
  console.log('PASS', passed.join('\nPASS '))
} catch (e) {
  await page.screenshot({ path: `${out}/failure.png` })
  writeFileSync(`${out}/results.json`, JSON.stringify({ ok: false, passed, errors, error: String(e.stack) }, null, 2)); throw e
} finally { await clear(); await browser.close() }
