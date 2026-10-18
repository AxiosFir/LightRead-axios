// Approved App 2.0 reader prototype: real renderer, ambient audio and settings.
// Speech synthesis is exercised separately in e2e-v2-reading and on Android.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
const base=process.env.E2E_BASE || 'http://127.0.0.1:4192'
const out=process.env.E2E_OUT || '/tmp/lightread-reader-refinements'
await mkdir(out,{recursive:true,mode:0o700})
const browser=await chromium.launch()
const p=await browser.newPage({viewport:{width:392,height:850},isMobile:true,hasTouch:true,locale:'zh-CN',reducedMotion:'reduce'})
p.setDefaultTimeout(15000)
await p.addInitScript(()=>localStorage.setItem('lightread-language','zh'))
const errors=[],passed=[],layouts=[]
p.on('pageerror',e=>errors.push(e.message))
const step=async(name,fn)=>{await fn();passed.push(name);console.log('PASS',name)}
const reveal=async()=>{await p.evaluate(()=>document.querySelector('.content')?.dispatchEvent(new MouseEvent('click',{bubbles:true})));if(!await p.locator('footer.bar.bottom:not(.hidden)').count())await p.mouse.click(196,350)}
const setting=()=>p.evaluate(()=>document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('settings').$state)
const ambient=()=>p.evaluate(async()=> (await import('/src/services/ambient/index.ts')).useAmbient().state)
const audit=async(selector,name)=>{
 for(const width of [320,375,392,414,768])for(const theme of ['light','dark']){
  await p.setViewportSize({width,height:width===768?1024:850})
  await p.evaluate(theme=>{document.documentElement.dataset.theme=theme},theme)
  const issues=await p.locator(selector).evaluate(el=>{
   const bad=[]
   if(el.scrollWidth>el.clientWidth+1)bad.push('horizontal overflow')
   for(const node of el.querySelectorAll('input[type=range],.progress-label,.rm-card-main,.am-scene,.rate-presets button,.dj-swatch')){
    const r=node.getBoundingClientRect(),parent=el.getBoundingClientRect()
    if(r.width && (r.left<parent.left-1||r.right>parent.right+1))bad.push(node.className+' outside panel')
   }
   const timerLabel=el.querySelector('.am-timer .am-label')
   if(timerLabel){const r=document.createRange();r.selectNodeContents(timerLabel);if(r.getClientRects().length!==1)bad.push('timer label wraps')}
   return bad
  })
  assert.deepEqual(issues,[],`${name} ${width} ${theme}`)
  layouts.push({name,width,theme})
  if(width===392)await p.screenshot({path:`${out}/${name}-${theme}.png`,animations:'disabled'})
 }
 await p.setViewportSize({width:392,height:850});await p.evaluate(()=>document.documentElement.dataset.theme='light')
}
let ok=false
try{
 await p.goto(base+'/#/library')
 await p.setInputFiles('input[type=file][multiple]',{name:'原型验收.txt',mimeType:'text/plain',buffer:Buffer.from('第一章 阅读与思考\n\n'+('阅读让我们在文字之间，发现新的理解。让思想慢下来，读者也有了自己的空间。\n\n'.repeat(160))+'\n第二章 窗前的书\n\n'+('风掠过树梢，雨声在远处落下。\n\n'.repeat(120)))})
 await p.locator('.book-card').filter({hasText:'原型验收'}).click()
 await p.waitForFunction(()=>document.querySelector('foliate-view')?.renderer?.getContents?.().length)
 await step('progress: real pages, bounds, percentage jump, undo, long numbers',async()=>{
  await reveal();await audit('.bar.bottom','footer')
  const label=p.locator('.progress-label')
  await label.click();await audit('.progress-settings','progress')
  await p.locator('.jump-input').fill('999999');await p.locator('.jump-form button').click();await p.locator('.jump-meta.error').waitFor()
  await p.getByRole('button',{name:'按百分比',exact:true}).click()
  await p.locator('.jump-input').fill('101');await p.locator('.jump-form button').click();await p.locator('.jump-meta.error').waitFor()
  await p.locator('.jump-input').fill('45.5');await p.locator('.jump-form button').click()
  await p.locator('.jump-undo').waitFor()
  assert.ok(parseFloat(await p.locator('.jump-overview strong').innerText())>40)
  await p.locator('.jump-undo').click();await p.waitForFunction(()=>parseFloat(document.querySelector('.jump-overview strong').textContent)<10)
  await p.keyboard.press('Escape');await p.setViewportSize({width:320,height:850})
  const original=await label.innerHTML()
  await label.evaluate(el=>el.innerHTML='<span class="page-number"><b>12345</b><span class="of">/99999</span></span><span class="sep">·</span><span class="pct">100.0%</span>')
  assert.ok(await label.evaluate(el=>el.scrollWidth<=el.clientWidth+1))
  await label.evaluate((el,html)=>el.innerHTML=html,original)
  await p.setViewportSize({width:392,height:850})
 })
 await step('ambient: independent playback, volume, timer, modal close and stop',async()=>{
  await reveal();await p.locator('.ambient-btn').click()
  await audit('.am-panel','ambient')
  assert.equal(await p.locator('.am-recorded').getAttribute('open'),null)
  await p.locator('.am-scenes').first().getByRole('button').first().click()
  await p.waitForFunction(async()=> (await import('/src/services/ambient/index.ts')).useAmbient().state.playing)
  await p.locator('#ambient-volume').fill('37');await p.locator('#ambient-volume').dispatchEvent('input')
  assert.equal((await ambient()).volume,.37)
  await p.locator('.am-timer button').nth(1).click();assert.ok((await ambient()).timerEndsAt)
  assert.equal(await p.locator('.am-timer-left').innerText(),'15 分钟后淡出停止')
  await p.keyboard.press('Escape');assert.equal((await ambient()).playing,true)
  await p.locator('.dock button').nth(3).click();await p.locator('.ambient-entry').click()
  assert.equal(await p.locator('.rm-panel').count(),1)
  assert.equal(await p.locator('#ambient-volume').inputValue(),'37')
  await p.locator('.am-current button').click();await p.waitForFunction(async()=> !(await import('/src/services/ambient/index.ts')).useAmbient().state.playing)
  await p.keyboard.press('Escape');assert.equal(await p.locator('.rm-panel').count(),1)
 })
 await step('Dianjing summary, live preview, secondary controls and Back',async()=>{
  await audit('.rm-panel','modes')
  await p.locator('.dj-toggle .dj-switch input').check()
  await p.locator('.dj-adjust').click();await audit('.dj-settings','dianjing')
  await p.locator('.dj-settings .dj-swatch').last().click();assert.equal((await setting()).readingMode.wordGuide.color,'forest')
  await p.locator('.dj-strength').fill('0.82');await p.locator('.dj-strength').dispatchEvent('input');assert.equal((await setting()).readingMode.wordGuide.intensity,.82)
  await p.keyboard.press('Escape');assert.equal(await p.locator('.rm-panel').count(),1)
 })
 await step('all five scene settings, state labels, toggle restoration and Back',async()=>{
  const before=JSON.stringify((await setting()).reader)
  for(const name of ['夜读','护眼','墨水屏','大字','沉浸']){
   const tile=p.locator('.rm-card-main').filter({hasText:name})
   await tile.click();assert.equal(await tile.getAttribute('aria-checked'),'true');assert.ok(await tile.locator('.rm-card-state').isVisible())
   await p.locator('.rm-scene-summary button').click();await p.locator('.rm-detail').waitFor();await audit('.rm-detail','scene-'+name)
   await p.keyboard.press('Escape');assert.equal(await p.locator('.rm-panel').count(),1)
   await tile.click();assert.equal(await tile.getAttribute('aria-checked'),'false');assert.equal(JSON.stringify((await setting()).reader),before)
  }
  await p.locator('.rm-close').click()
 })
 await step('player and speed: stepping, bounds, six presets, reset and nested ambient',async()=>{
  await reveal();await p.locator('.listen-entry').click();await audit('.tts-panel','player')
  await p.locator('.listen-options button').nth(2).click();await audit('.rate-control','rate')
  assert.equal(await p.locator('.rate-presets button').count(),6)
  await p.getByRole('button',{name:'恢复标准',exact:true}).click();await p.getByRole('button',{name:'语速提高 0.05 倍',exact:true}).click();assert.equal((await setting()).ttsRate,1.05)
  await p.locator('.rate-presets button').first().click();assert.equal(await p.getByRole('button',{name:'语速降低 0.05 倍',exact:true}).isDisabled(),true)
  await p.locator('.rate-presets button').last().click();assert.equal(await p.getByRole('button',{name:'语速提高 0.05 倍',exact:true}).isDisabled(),true)
  await p.getByRole('button',{name:'恢复标准',exact:true}).click();await p.keyboard.press('Escape');assert.equal(await p.locator('.tts-panel').count(),1)
  await p.locator('.tts-panel .ambient-entry').click();await p.locator('.am-panel').waitFor();await p.keyboard.press('Escape');assert.equal(await p.locator('.tts-panel').count(),1)
 })
 await step('reading records: goal controls, single blue completion and day details',async()=>{
  await p.evaluate(async()=>{const {recordReading}=await import('/src/services/readingLog.ts'); const book=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('library').books.find(b=>b.title==='原型验收'); await recordReading(book,1800)})
  await p.goto(base+'/#/stats');await p.locator('.card.today').waitFor();await audit('.stats','records'); assert.equal(await p.locator('.ring-fill').evaluate(el=>getComputedStyle(el).stroke),await p.locator('.met .fill').first().evaluate(el=>getComputedStyle(el).stroke)); assert.ok(await p.locator('.day-status').filter({hasText:'达标'}).count())
  await p.locator('.goal-pill').click();await p.locator('.goal-opt').filter({hasText:/^10$/}).click();assert.equal((await setting()).dailyGoalMinutes,10)
  await p.locator('.goal-pill').click();await p.locator('.goal-opt').first().click();assert.equal((await setting()).dailyGoalMinutes,0);assert.equal(await p.locator('.day-status').filter({hasText:'达标'}).count(),0);assert.ok(await p.locator('.day-status').filter({hasText:'已读'}).count());
  await p.locator('.day:not(:disabled)').last().click();await p.getByRole('dialog').waitFor();await p.keyboard.press('Escape')
 })
 assert.deepEqual(errors,[]);ok=true
}catch(e){await p.screenshot({path:out+'/failure.png'});console.error(await p.locator('body').innerText());throw e}
finally{await writeFile(out+'/results.json',JSON.stringify({ok,passed,layouts,errors},null,2));await browser.close()}
