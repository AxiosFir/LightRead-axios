// App dev server; nonfocused lyrics must suppress keyword tint as well as text.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
const base=process.env.E2E_BASE||'http://127.0.0.1:4194',out=process.env.E2E_OUT||'/tmp/lightread-lyric-highlights'
await mkdir(out,{recursive:true,mode:0o700})
const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:600,height:400}}),passed=[]
try {
 await page.goto(base)
 await page.evaluate(async()=>{
  const theme=await import('/src/mobile/services/readerTheme.ts')
  const frame=document.createElement('iframe');frame.id='lyric-fixture';Object.assign(frame.style,{position:'fixed',inset:'0',width:'550px',height:'150px',border:'0',zIndex:'999999'});document.body.append(frame)
  const doc=frame.contentDocument;doc.open();doc.write('<html><head></head><body><p style="font:32px monospace;white-space:pre">FOCUS KEYWORD SUFFIX</p></body></html>');doc.close();const style=doc.createElement('style');doc.head.append(style);window.fixture={theme,frame,doc,style}
 })
 for(const theme of ['light','sepia','green','dark','eink','eink-dark'])for(const mode of ['dim','hide'])for(const intensity of [1,3]){
  const clip=await page.evaluate(({theme,mode,intensity})=>{
   const f=window.fixture,doc=f.doc,win=doc.defaultView;win.CSS.highlights.clear()
   const name=theme==='eink'?'light':theme==='eink-dark'?'dark':theme,style={eink:theme.startsWith('eink'),wordGuideIntensity:intensity,wordGuideColor:'rose'}
   f.style.textContent=f.theme.getReaderCSS({theme:name,fontFamily:'',fontSize:32,lineHeight:1.6},false,style)
   const word=doc.createRange();word.setStart(doc.querySelector('p').firstChild,6);word.setEnd(word.startContainer,13)
   f.keyword=new win.Highlight(word);f.keyword.priority=10;win.CSS.highlights.set('lr-wg-kw-s',f.keyword)
   const outside=word.cloneRange();outside.setStart(outside.startContainer,9);const lyric=new win.Highlight(outside);lyric.priority=90;win.CSS.highlights.set('lr-ly-'+mode,lyric)
   const r=outside.getBoundingClientRect(),b=f.frame.getBoundingClientRect();return{x:Math.ceil(r.x+b.x),y:Math.ceil(r.y+b.y),width:Math.floor(r.width)-1,height:Math.floor(r.height)-1}
  },{theme,mode,intensity})
  const marked=await page.screenshot({clip});await page.evaluate(()=>fixture.doc.defaultView.CSS.highlights.delete('lr-wg-kw-s'));const plain=await page.screenshot({clip})
  if(!marked.equals(plain)){await writeFile(`${out}/${theme}-${mode}-${intensity}-marked.png`,marked);await writeFile(`${out}/${theme}-${mode}-${intensity}-plain.png`,plain)}
  assert.ok(marked.equals(plain),`${theme}/${mode}/${intensity}: keyword tint leaks outside lyric focus`)
  passed.push({theme,mode,intensity})
 }
 await writeFile(out+'/results.json',JSON.stringify({ok:true,passed},null,2));console.log('PASS lyric focus keyword suppression',passed.length)
}finally{await browser.close()}
