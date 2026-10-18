import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { uiTarget, mobileUi } from '../vite.platform.ts'
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
test('desktop target wins over preview preference; mobile requires an explicit build target', () => {
  assert.equal(uiTarget({}), 'desktop')
  assert.equal(uiTarget({LIGHTREAD_UI:'mobile'}), 'mobile')
  for (const platform of ['linux','windows','macos']) assert.equal(uiTarget({TAURI_ENV_PLATFORM:platform,LIGHTREAD_UI:'mobile'}),'desktop')
  for (const platform of ['android','ios']) assert.equal(uiTarget({TAURI_ENV_PLATFORM:platform}),'mobile')
})
test('App overrides reach shared imports and leave shared engines untouched', () => {
  const resolve = mobileUi(root).resolveId
  assert.equal(resolve('./App.vue',root+'/src/main.ts'),root+'/src/mobile/App.vue')
  assert.equal(resolve('../services/tts',root+'/src/composables/useReadAloud.ts'),root+'/src/mobile/services/tts.ts')
  assert.equal(resolve('/src/styles/main.css'),root+'/src/mobile/styles/main.css')
  assert.equal(resolve(root+'/src/views/ReaderView.vue?vue&type=style'),root+'/src/mobile/views/ReaderView.vue?vue&type=style')
  assert.equal(resolve('../storage/types',root+'/src/services/edgeTts.ts'),null)
  assert.equal(resolve('./views/ReaderView.vue',root+'/src/mobile/App.vue'),null)
})
test('release gate rejects a mobile tag for desktop and a desktop tag for App', () => {
  const check = (...args) => execFileSync(process.execPath,['scripts/check-release.mjs',...args],{cwd:root,stdio:'pipe'}).toString()
  assert.match(check('--tag','v1.19.4'),/1.19.4/)
  for (const platform of ['android','ios']) assert.match(check('--platform',platform,'--tag','v2.0.0'),/2.0.0/)
  assert.throws(()=>check('--tag','v2.0.0'))
  assert.throws(()=>check('--platform','android','--tag','v1.19.4'))
  assert.throws(()=>check('--platform','unknown'))
})
