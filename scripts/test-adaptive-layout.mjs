import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPinia } from 'pinia'
import { useSettings, settingsDefaults } from '../src/stores/settings.ts'
import { screenLayout, resolveReaderPrefs, resolvePdfPrefs, emptyLayoutOverrides, restoreLayoutOverrides } from '../src/services/adaptiveLayout.ts'
import { readingViewport } from '../src/services/readingViewport.ts'
import { readSyncedSettings, createSettingsSyncPort, initSettingsMeta } from '../src/services/sync/settingsSync.ts'
const base = settingsDefaults()
const portrait = screenLayout({width:392,height:872,keyboardOpen:false})
const landscape = screenLayout({width:1280,height:800,keyboardOpen:false})
const resolve = (preset, reader = base.reader, overrides = emptyLayoutOverrides().reader) => resolveReaderPrefs(reader,overrides,preset)

test('手机、高DPI、平板与桌面按可用CSS窗口选预设, 横屏窄窗不强行双栏',()=>{
 assert.equal(portrait.reader.flow,'scrolled');assert.equal(portrait.reader.maxColumnCount,1);assert.equal(portrait.reader.fontSize,18)
 assert.equal(landscape.reader.flow,'paginated');assert.equal(landscape.reader.maxColumnCount,2);assert.equal(landscape.reader.fontSize,20)
 const phone=screenLayout({width:872,height:392,screenWidth:872,screenHeight:392,keyboardOpen:false})
 assert.equal(phone.reader.maxColumnCount,1);assert.equal(phone.reader.fontSize,18);assert.equal(phone.pageMargin,24)
 const tablet=screenLayout({width:820,height:1180,keyboardOpen:false});assert.equal(tablet.reader.flow,'scrolled');assert.equal(tablet.reader.fontSize,20)
 const narrow=screenLayout({width:500,height:800,screenWidth:1920,screenHeight:1080,keyboardOpen:false});assert.equal(narrow.orientation,'portrait')
})
test('占满屏宽的短分屏窗口按窗口方向, 键盘打开时仍保留设备方向',()=>{
 const p={width:820,height:450,screenWidth:820,screenHeight:1180,orientationType:'portrait-primary'}
 assert.equal(screenLayout({...p,keyboardOpen:false}).orientation,'landscape')
 assert.equal(screenLayout({...p,keyboardOpen:true}).orientation,'portrait')
})
test('未设置时横竖屏自动切换, 不改保存的值',()=>{
 const reader=structuredClone(base.reader),before=structuredClone(reader)
 assert.equal(resolve(portrait,reader).flow,'scrolled');assert.equal(resolve(landscape,reader).flow,'paginated')
 assert.deepEqual(reader,before)
})
test('手动的字号/行距/边距/翻页逐项覆盖自动值, 包括与旧默认值相同的选择',()=>{
 const manual=emptyLayoutOverrides().reader;Object.assign(manual,{fontSize:true,lineHeight:true,gap:true,flow:true})
 for(const preset of [portrait,landscape]) {
  const actual=resolve(preset,{...base.reader,fontSize:18,lineHeight:2,gap:10,flow:'paginated'},manual)
  assert.equal(actual.fontSize,18);assert.equal(actual.lineHeight,2);assert.equal(actual.gap,10);assert.equal(actual.flow,'paginated')
  assert.equal(actual.maxColumnCount,preset.reader.maxColumnCount)
 }
})
test('竖屏手动双栏即生效; 明确的滚动选择优先于分栏',()=>{
 const manual={...emptyLayoutOverrides().reader,maxColumnCount:true}
 assert.equal(resolve(portrait,{...base.reader,maxColumnCount:2},manual).flow,'paginated')
 assert.equal(resolve(portrait,{...base.reader,maxColumnCount:2,flow:'scrolled'},{...manual,flow:true}).flow,'scrolled')
})
test('关闭自动适配使用原设置; 大字场景期间不被自动字号覆盖',()=>{
 assert.deepEqual(resolve(portrait,{...base.reader,portraitScroll:false}),{...base.reader,portraitScroll:false})
 assert.equal(resolveReaderPrefs({...base.reader,fontSize:30},emptyLayoutOverrides().reader,landscape,{largeText:{applied:{'reader.fontSize':30}}}).fontSize,30)
})
test('PDF 默认适配和手动翻页/双页/缩放优先级',()=>{
 const m=emptyLayoutOverrides().pdf
 assert.equal(resolvePdfPrefs(base.pdf,m,portrait,true).fit,'fitW')
 assert.equal(resolvePdfPrefs(base.pdf,m,landscape,true).fit,'fitH')
 const actual=resolvePdfPrefs({...base.pdf,mode:'scroll',spreadMode:'single',fit:'fitW'},{mode:true,spreadMode:true,fit:true},landscape,true)
 assert.equal(actual.mode,'scroll');assert.equal(actual.spreadMode,'single');assert.equal(actual.fit,'fitW')
})
test('旧自定义值和有修改时间的默认值迁移为手动; 未改项目可自动',()=>{
 const defaults=readSyncedSettings(base),values={...defaults,'reader.gap':10}
 const flags=restoreLayoutOverrides(undefined,values,defaults,{'reader.fontSize':{t:123}})
 assert.equal(flags.reader.gap,true);assert.equal(flags.reader.fontSize,true);assert.equal(flags.reader.flow,false)
 assert.equal(restoreLayoutOverrides(emptyLayoutOverrides(),values,defaults,{'reader.fontSize':{t:123}}).reader.fontSize,false)
})
test('手动选择当前默认值仍记住, 持久化重载后旋转不改变字号; 重置恢复自动',()=>{
 readingViewport.value={width:392,height:872,keyboardOpen:false}
 const s=useSettings(createPinia());s.setReaderPreference('fontSize',18)
 assert.equal(s.layoutOverrides.reader.fontSize,true)
 const persisted=JSON.parse(JSON.stringify(s.$state));const reload=useSettings(createPinia());reload.$patch(persisted)
 readingViewport.value={width:1280,height:800,keyboardOpen:false}
 assert.equal(reload.readerPrefs.fontSize,18);assert.equal(reload.readerPrefs.maxColumnCount,2)
 reload.resetReader();assert.equal(reload.readerPrefs.fontSize,20)
})
test('自动尺寸变化不污染同步值; 老客户端同步来的默认值也保持手动',()=>{
 const s=useSettings(createPinia()),before=readSyncedSettings(s.$state)
 readingViewport.value={width:392,height:872,keyboardOpen:false};void s.readerPrefs
 readingViewport.value={width:1280,height:800,keyboardOpen:false};void s.readerPrefs
 assert.deepEqual(readSyncedSettings(s.$state),before)
 const meta=initSettingsMeta(null,before,readSyncedSettings(base),1)
 createSettingsSyncPort({state:()=>s.$state,meta,includeSecrets:false}).apply([{path:'reader.fontSize',value:18,stamp:{t:100,d:'old'},changed:false}])
 assert.equal(s.layoutOverrides.reader.fontSize,true);assert.equal(s.readerPrefs.fontSize,18)
})

test('旧客户端偏好不覆盖更新的恢复自动标记, 推断标记沿用远端时间',()=>{
 const s=useSettings(createPinia()),meta=initSettingsMeta(null,readSyncedSettings(s.$state),readSyncedSettings(base),1)
 const port=createSettingsSyncPort({state:()=>s.$state,meta,includeSecrets:false})
 meta.stamps['layoutOverrides.reader.fontSize']={t:200,d:'new'}
 port.apply([{path:'reader.fontSize',value:18,stamp:{t:100,d:'old'},changed:false}])
 assert.equal(s.layoutOverrides.reader.fontSize,false)
 port.apply([{path:'reader.fontSize',value:22,stamp:{t:300,d:'old'},changed:true}])
 assert.equal(s.layoutOverrides.reader.fontSize,true)
 assert.deepEqual(meta.stamps['layoutOverrides.reader.fontSize'],{t:300,d:'old'})
 assert.deepEqual(port.read().stamps['layoutOverrides.reader.fontSize'],{t:300,d:'old'})
 port.apply([{path:'reader.fontSize',value:18,stamp:{t:400,d:'new'},changed:true},{path:'layoutOverrides.reader.fontSize',value:false,stamp:{t:400,d:'new'},changed:true}])
 assert.equal(s.layoutOverrides.reader.fontSize,false)
})
