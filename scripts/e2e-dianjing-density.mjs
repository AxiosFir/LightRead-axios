import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
const base=process.env.E2E_BASE||'http://127.0.0.1:4192',out=process.env.E2E_OUT||'/tmp/lightread-dianjing-density'
await mkdir(out,{recursive:true,mode:0o700})
const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:392,height:850},hasTouch:true,isMobile:true,locale:'zh-CN',serviceWorkers:'block'})
page.setDefaultTimeout(15000)
await page.addInitScript(()=>{localStorage.setItem('lightread-language','zh');window.__picks=0;const Base=Worker;window.Worker=class extends Base{constructor(...args){super(...args);this.addEventListener('message',e=>{if(e.data?.type==='picked')window.__picks++})}}})
const errors=[],passed=[],counts=[];let ok=false
page.on('pageerror',e=>errors.push(e.message))
const reveal=()=>page.evaluate(()=>{document.querySelector('.bar-peek.top')?.dispatchEvent(new MouseEvent('mouseenter'));document.querySelector('footer.bar.bottom')?.dispatchEvent(new MouseEvent('mouseenter'))})
const details=async()=>{await reveal();await page.locator('.dock button').nth(3).click();await page.locator('.dj-toggle .dj-switch input').check();await page.locator('.dj-adjust').click();await page.getByRole('button',{name:'重点词',exact:true}).click()}
const count=()=>page.evaluate(()=>document.querySelector('foliate-view').renderer.getContents().reduce((sum,{doc})=>sum+[...doc.defaultView.CSS.highlights].filter(([key])=>key.startsWith('lr-wg-kw-')).reduce((n,[,marks])=>n+marks.size,0),0))
try{
 await page.goto(base+'/#/library')
 const topics=['主体间性','现象学','经验主义','理性主义','存在主义','解释学','自然科学','社会科学','认识论','方法论','辩证法','语言学','心理学','人类学','社会学','历史学','美学','伦理学','本体论','逻辑学']
 const paras=Array.from({length:90},(_,i)=>`第${i+1}段讨论${topics[i%topics.length]}，作者从${topics[(i+3)%topics.length]}和${topics[(i+7)%topics.length]}的角度解释经验。阅读让我们在文字之间发现新的理解。读者通过比较、思考与交流，逐渐形成自己的观点。`).join('\n\n')
 await page.setInputFiles('input[type=file][multiple]',{name:'点睛密度验证.txt',mimeType:'text/plain',buffer:Buffer.from('第一章 阅读与思考\n\n'+paras)})
 await page.locator('.book-card').filter({hasText:'点睛密度验证'}).click()
 await page.waitForFunction(()=>document.querySelector('foliate-view')?.renderer?.getContents?.().length)
 await details();await page.locator('.dj-density').waitFor();await page.waitForFunction(()=>window.__picks>0)
 const slider=page.locator('.dj-density input[type=range]')
 const strength=page.locator('.dj-strength')
 assert.equal(await slider.inputValue(),'50');assert.equal(await strength.inputValue(),'50')
 const guide=()=>page.evaluate(()=>JSON.parse(JSON.stringify(document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('settings').readingMode.wordGuide)))
 const originalColor=(await guide()).color;assert.equal((await guide()).intensity,1)
 const guideCSS=()=>page.evaluate(()=>document.querySelector('foliate-view').renderer.getContents().map(({doc})=>[...doc.querySelectorAll('style')].map(s=>s.textContent).filter(s=>s.includes('lr-wg-kw-s')).join('')).join(''))
 const middleCSS=await guideCSS();await strength.fill('100');assert.equal((await guide()).intensity,3)
 await page.waitForTimeout(200);assert.notEqual(await guideCSS(),middleCSS);assert.equal((await guide()).color,originalColor)
 await strength.fill('50');assert.equal((await guide()).intensity,1)
 passed.push('new middle defaults, 3× maximum intensity changes actual reader CSS and preserves hue')
 for(const value of [1,25,50,75,100]){
  const previous=await page.evaluate(()=>window.__picks);await slider.fill(String(value));await slider.dispatchEvent('input')
  await page.waitForFunction(n=>window.__picks>n,previous);await page.waitForTimeout(120)
  counts.push({value,count:await count()})
 }
 assert.ok(new Set(counts.map(x=>x.count)).size>3,JSON.stringify(counts));passed.push('real Worker and renderer produce intermediate keyword densities')
 await slider.fill('37');await slider.dispatchEvent('input');await slider.focus();await page.keyboard.press('ArrowRight')
 assert.equal(await slider.inputValue(),'38');assert.equal(await page.locator('.density-presets .active').count(),0)
 await page.getByRole('button',{name:'增加标记密度',exact:true}).click();assert.equal(await slider.inputValue(),'39')
 await page.getByRole('button',{name:'减少标记密度',exact:true}).click();assert.equal(await slider.inputValue(),'38')
 for(const [name,value] of [['少','1'],['适中','50'],['多','100']]){await page.locator('.density-presets').getByRole('button',{name,exact:true}).click();assert.equal(await slider.inputValue(),value)}
 assert.equal(await page.getByRole('button',{name:'增加标记密度',exact:true}).isDisabled(),true)
 await slider.fill('37');await slider.dispatchEvent('input')
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('lightread-settings') || '{}').dianjing?.densityFine?.value===37)
 const savedUrl=page.url();await page.reload();await page.waitForFunction(()=>document.querySelector('foliate-view')?.renderer?.getContents?.().length);assert.equal(page.url(),savedUrl);await details();assert.equal(await slider.inputValue(),'37');passed.push('slider, keyboard, steppers, preset bounds and reload persistence')
 await page.locator('.dj-settings .dj-switch input').uncheck();assert.equal(await slider.isDisabled(),false);assert.equal(await page.locator('.dj-settings .dj-preview .marked').count(),0);await page.locator('.dj-settings .dj-switch input').check()
 for(const width of [320,375,414,768])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:850});await page.evaluate(theme=>{const s=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('settings');s.appearance=theme;s.reader.theme=theme},theme)
  assert.ok(await page.locator('.dj-settings').evaluate(el=>el.scrollWidth<=el.clientWidth+1),`${width}/${theme}`)
  assert.ok(await page.locator('.density-presets').evaluate(el=>[...el.children].every(b=>b.scrollWidth<=b.clientWidth+1)))
  await page.screenshot({path:`${out}/settings-${width}-${theme}.png`})
 }
 passed.push('off-state preview and settings layout at 320/375/414/768 in light/dark')
 await page.setViewportSize({width:392,height:850});await page.evaluate(()=>{const s=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('settings');s.appearance='light';s.reader.theme='light'})
 await slider.fill('50');await slider.dispatchEvent('input');await page.locator('.dj-settings .dj-swatch').last().click();await page.screenshot({path:out+'/settings.png'})
 await page.keyboard.press('Escape');await page.keyboard.press('Escape');await page.screenshot({path:out+'/reader.png'})
 assert.deepEqual(errors,[]);ok=true;console.log('PASS',passed,counts)
}catch(e){await page.screenshot({path:out+'/failure.png'});throw e}finally{await writeFile(out+'/results.json',JSON.stringify({ok,passed,counts,errors},null,2));await browser.close()}
