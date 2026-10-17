import {chromium} from 'playwright'
import {writeFileSync,mkdirSync} from 'node:fs'
mkdirSync('/tmp/lightread-global-ui',{recursive:true})
const browser=await chromium.launch({headless:true})
const results=[]
for (const width of [320,360,392]) for (const language of ['zh','en']) {
const page=await browser.newPage({viewport:{width,height:800},isMobile:true,hasTouch:true})
await page.addInitScript(language=>localStorage.setItem('lightread-settings',JSON.stringify({version:16,language,features:{transfer:true,recommendedBooklists:true}})),language)
for(const route of ['library','papers','catalogs','settings','stats','transfer','manual']) {
 await page.goto('http://localhost:4173/#/'+route)
 await page.waitForTimeout(1200)
 const rows=await page.evaluate(()=>{
  const result=[], walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT)
  let node
  while(node=walker.nextNode()) {
   const el=node.parentElement,text=node.textContent.trim()
   if(!el||!text||el.closest('script,style,.manual-content')||!el.getClientRects().length)continue
   if(el.closest('details:not([open])') && !el.closest('summary'))continue
   const style=getComputedStyle(el);if(style.visibility==='hidden')continue
   const range=document.createRange();range.selectNodeContents(node)
   const rects=[...range.getClientRects()].filter(r=>r.width>0&&r.height>0),lines=new Set(rects.map(r=>Math.round(r.top)))
   if(lines.size>2)result.push({tag:el.tagName,cls:el.className,text,lines:lines.size})
  }
  return result
 })
 results.push({width,language,route,rows})
}
await page.goto('http://localhost:4173/#/settings?section=ai')
await page.locator('#ai-provider').click()
await page.waitForTimeout(300)
await page.screenshot({path:`/tmp/lightread-global-ui/ai-${language}-${width}.png`})
await page.close()
}
mkdirSync('/tmp/lightread-global-ui',{recursive:true})
writeFileSync('/tmp/lightread-global-ui/copy-audit.json',JSON.stringify(results,null,2))
console.log(JSON.stringify(results,null,2))
await browser.close()
