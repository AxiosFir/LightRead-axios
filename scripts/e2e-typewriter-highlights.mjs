// App dev server: LIGHTREAD_UI=mobile npm run dev -- --port 4192
// Pixel regression: transparent text must not leave keyword backgrounds visible.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'

const base = process.env.E2E_BASE || 'http://127.0.0.1:4192'
const out = process.env.E2E_OUT || '/tmp/lightread-typewriter-highlights'
await mkdir(out, { recursive: true, mode: 0o700 })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 600, height: 400 }, deviceScaleFactor: 1 })
const passed = [], errors = []
page.on('pageerror', e => errors.push(e.message))
let ok = false
try {
  await page.goto(base)
  await page.evaluate(async () => {
    const theme = await import('/src/mobile/services/readerTheme.ts')
    const { createRevealLayer } = await import('/src/services/readingModes/revealLayer.ts')
    const frame = document.createElement('iframe')
    frame.id = 'typewriter-fixture'
    Object.assign(frame.style, { position: 'fixed', inset: '0', width: '550px', height: '150px', border: '0', zIndex: '999999' })
    document.body.append(frame)
    const doc = frame.contentDocument
    doc.open()
    doc.write('<html><head></head><body><p style="font:32px monospace;white-space:pre">PREVIEW KEYWORD SUFFIX</p></body></html>')
    doc.close()
    const style = doc.createElement('style')
    doc.head.append(style)
    window.twFixture = { doc, frame, style, theme, createRevealLayer }
  })
  for (const theme of ['light', 'sepia', 'green', 'dark', 'eink', 'eink-dark']) {
    for (const ghost of [false, true]) for (const intensity of [1, 3]) {
      await page.evaluate(({ theme, ghost, intensity }) => {
        const f = window.twFixture
        f.layer?.dispose()
        f.doc.defaultView.CSS.highlights.clear()
        const name = theme === 'eink' ? 'light' : theme === 'eink-dark' ? 'dark' : theme
        const modeStyle = { eink: theme.startsWith('eink'), wordGuideIntensity: intensity, wordGuideColor: 'forest' }
        f.style.textContent = f.theme.getReaderCSS({ theme: name, fontFamily: '', fontSize: 32, lineHeight: 1.6 }, false, modeStyle)
        f.colors = f.theme.resolveReaderColors(name, false, modeStyle)
        f.frame.style.background = f.colors.bg
        f.range = f.doc.createRange()
        f.range.setStart(f.doc.querySelector('p').firstChild, 8)
        f.range.setEnd(f.doc.querySelector('p').firstChild, 15)
        f.keyword = new f.doc.defaultView.Highlight(f.range)
        f.keyword.priority = 10
        f.doc.defaultView.CSS.highlights.set('lr-wg-kw-s', f.keyword)
        f.layer = f.createRevealLayer(f.doc, { getOverlayer: () => null, colors: () => f.colors, ghost })
      }, { theme, ghost, intensity })
      // Cover all the word, then expose its prefix: unrevealed pixels must match
      // the same text without keyword marking. This catches the original bug.
      for (const offset of [8, 11]) {
        const clip = await page.evaluate(offset => {
          const f = window.twFixture
          const hidden = f.range.cloneRange()
          hidden.setStart(hidden.startContainer, offset)
          f.layer.update(hidden, null)
          f.doc.defaultView.CSS.highlights.set('lr-wg-kw-s', f.keyword)
          const r = hidden.getBoundingClientRect(), frame = f.frame.getBoundingClientRect()
          return { x: Math.ceil(r.x + frame.x), y: Math.ceil(r.y + frame.y), width: Math.floor(r.width) - 1, height: Math.floor(r.height) - 1 }
        }, offset)
        const marked = await page.screenshot({ clip })
        await page.evaluate(() => twFixture.doc.defaultView.CSS.highlights.delete('lr-wg-kw-s'))
        const unmarked = await page.screenshot({ clip })
        assert.ok(marked.equals(unmarked), `${theme} ghost=${ghost} offset=${offset}: premature keyword background`)
        passed.push({ theme, ghost, intensity, offset })
      }
      // Finishing/exit must restore normal text and the original keyword color.
      await page.evaluate(() => {
        const f = window.twFixture
        f.doc.defaultView.CSS.highlights.set('lr-wg-kw-s', f.keyword)
        f.layer.update(null, null)
      })
      const revealed = await page.locator('#typewriter-fixture').screenshot()
      await page.evaluate(() => twFixture.layer.dispose())
      const stopped = await page.locator('#typewriter-fixture').screenshot({ path: `${out}/${theme}-${intensity}-${ghost ? 'ghost' : 'hidden'}-finished.png` })
      assert.ok(revealed.equals(stopped), 'stopping must not change revealed text')
      await page.evaluate(() => twFixture.doc.defaultView.CSS.highlights.delete('lr-wg-kw-s'))
      assert.ok(!stopped.equals(await page.locator('#typewriter-fixture').screenshot()), 'revealed keyword must retain its background')
    }
  }
  await page.evaluate(() => twFixture.frame.remove())
  await page.setViewportSize({ width: 392, height: 850 })
  await page.goto(base + '/#/library')
  await page.setInputFiles('input[type=file][multiple]', {
    name: '打字机高亮回归.txt', mimeType: 'text/plain',
    buffer: Buffer.from('第一章 阅读\n\n' + '主体间性讨论人与人的交往。读者从不同的经验理解这个概念。\n\n'.repeat(40)),
  })
  await page.locator('.book-card').filter({ hasText: '打字机高亮回归' }).click()
  await page.waitForFunction(() => document.querySelector('foliate-view')?.renderer?.getContents?.().length)
  await page.evaluate(() => {
    const settings = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('settings')
    settings.readingMode.wordGuide.enabled = true
    settings.readingMode.wordGuide.mark = 'keywords'
    settings.readingMode.typewriter.cpm = 240
    settings.readingMode.typewriter.upcoming = 'hidden'
    settings.readingMode.typewriter.sound = false
  })
  const hiddenLength = () => page.evaluate(() => document.querySelector('foliate-view').renderer.getContents().reduce((n, { doc }) => n + [...(doc.defaultView.CSS.highlights.get('lr-tw-hidden') || [])].reduce((sum, r) => sum + r.toString().length, 0), 0))
  await page.waitForFunction(() => document.querySelector('foliate-view').renderer.getContents().some(({ doc }) => doc.defaultView.CSS.highlights.get('lr-wg-kw-s')?.size))
  await page.keyboard.press('Shift+T')
  await page.locator('.rm-mini button[aria-label="暂停"]').waitFor()
  const initial = await hiddenLength()
  assert.ok(initial > 0)
  await page.waitForFunction(initial => document.querySelector('foliate-view').renderer.getContents().reduce((n, { doc }) => n + [...(doc.defaultView.CSS.highlights.get('lr-tw-hidden') || [])].reduce((sum, r) => sum + r.toString().length, 0), 0) < initial, initial)
  await page.locator('.rm-mini button[aria-label="暂停"]').click()
  const paused = await hiddenLength()
  await page.waitForTimeout(400)
  assert.equal(await hiddenLength(), paused, 'pause keeps the reveal boundary still')
  await page.screenshot({ path: `${out}/reader-paused.png` })
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.querySelector('foliate-view').renderer.getContents().every(({ doc }) => ![...doc.defaultView.CSS.highlights.keys()].some(name => name.startsWith('lr-tw-'))))
  assert.ok(await page.evaluate(() => document.querySelector('foliate-view').renderer.getContents().some(({ doc }) => doc.defaultView.CSS.highlights.get('lr-wg-kw-s')?.size)), 'exit preserves Dianjing')
  passed.push('real reader: reveal advances, pause holds, exit preserves keyword marks')
  assert.deepEqual(errors, [])
  ok = true
  console.log('PASS 48 pixel comparisons; reveal and exit in six themes × two modes; real reader lifecycle')
} finally {
  await writeFile(`${out}/results.json`, JSON.stringify({ ok, passed, errors }, null, 2))
  await browser.close()
}
