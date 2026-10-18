import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const base = process.env.E2E_BASE || 'http://localhost:4175'
const out = process.env.E2E_OUT || '/tmp/lightread-v2-qa'
await mkdir(out, {recursive:true})
const browser = await chromium.launch()
const context = await browser.newContext({viewport:{width:392,height:850},deviceScaleFactor:1,hasTouch:true,isMobile:true,locale:'zh-CN'})
const page = await context.newPage()
const errors=[];page.on('pageerror',e=>errors.push(e.message))
await page.addInitScript(()=>localStorage.setItem('lightread-language','zh'))
const shot=async name=>page.screenshot({path:`${out}/${name}.png`,animations:'disabled'})
const reveal=async()=>{await page.evaluate(()=>document.querySelector('.content')?.dispatchEvent(new MouseEvent('click',{bubbles:true})));if(!await page.locator('.dock').isVisible())await page.mouse.click(196,350)}
try {
 await page.goto(base+'/#/library');await page.waitForSelector('input[type=file][multiple]',{state:'attached'})
 await page.locator('input[type=file][multiple]').setInputFiles([{name:'山间来信.txt',mimeType:'text/plain',buffer:Buffer.from('第一章 山里的早晨\n\n'+'车开进山里的时候，雨刚刚停。我们沿着青石路慢慢走，屋檐下的风吹过一页又一页。\n\n'.repeat(80)+'\n第二章 窗前的树\n\n'+'午后的阳光照在书页上，远处传来缓慢的脚步声。\n\n'.repeat(80))},{name:'慢读的日常.md',mimeType:'text/markdown',buffer:Buffer.from('# 慢读的日常\n\n每天留下一点时间，读书，也记录。')},{name:'给未来的笔记.txt',mimeType:'text/plain',buffer:Buffer.from('给未来的笔记\n\n一本自己的书。')}])
 await page.locator('.book-card').filter({hasText:'山间来信'}).first().waitFor()
 await shot('01-library')
 await page.locator('.book-card').filter({hasText:'山间来信'}).first().click()
 await page.waitForFunction(()=>document.querySelector('foliate-view')?.renderer?.getContents?.().length)
 await page.waitForTimeout(1000);await shot('02-reader')
 await reveal();await page.locator('.dock button').last().click()
 await shot('03-typography')
 await page.getByRole('tab',{name:'配色',exact:true}).click()
 await page.getByRole('button',{name:'夜间',exact:true}).click()
 await shot('04-reader-night')
 await page.getByRole('button',{name:'白色',exact:true}).click()
 await page.getByRole('tab',{name:'页面',exact:true}).click();await shot('05-pages')
 await page.getByRole('tab',{name:'文字',exact:true}).click()
 // Test actual webfont data in book iframe, not only an option label.
 const fontSelect=page.locator('.tp-group[data-section=text]').locator('.app-select-trigger')
 await fontSelect.click(); await page.getByRole('button',{name:'楷体',exact:true}).click()
 await page.waitForTimeout(500)
 const fontResult=await page.evaluate(async()=>{
  const doc=document.querySelector('foliate-view').renderer.getContents()[0].doc
  const faces=await doc.fonts.load('18px "Kaiti SC"','山间来信')
  return {count:faces.length,status:faces[0]?.status}
 });assert.equal(fontResult.status,'loaded');assert.ok(fontResult.count)
 await page.locator('.tp-close').click();await reveal()
 await page.locator('.dock button').nth(3).click();await shot('06-modes')
 await page.locator('.rm-close').click();await page.locator('.listen-entry').click()
 await shot('07-listening')
 await page.locator('.listen-options button').nth(0).click();await shot('08-sleep')
 await page.locator('.app-modal-close').click()
 await page.locator('.listen-options button').nth(2).click();await shot('09-speed')
 await page.locator('.app-modal-close').click()
 await page.locator('.listen-options button').nth(1).click();await shot('10-voice')
 await page.locator('.app-modal-close').click()
 await page.keyboard.press('Escape');assert.equal(await page.locator('.tts-panel').count(),0)
 await page.goto(base+'/#/library');await page.waitForTimeout(500);await shot('11-continue')
 for(const width of [320,375,414,768]){
  await page.setViewportSize({width,height:850})
  for(const route of ['library','papers','catalogs','stats','settings']){
   await page.goto(base+'/#/'+route);await page.waitForTimeout(300)
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${route} overflow ${width}`)
   await shot(`${width}-${route}`)
  }
 }
 assert.deepEqual(errors,[])
 await writeFile(`${out}/results.json`,JSON.stringify({passed:true,fontResult,errors,widths:[320,375,414,768]},null,2))
 console.log('V2 UI, bundled font, player settings, responsive routes: passed')
}finally{await browser.close()}
