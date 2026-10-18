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
  assert.equal(resolve('/src/main.ts'),root+'/src/mobile/main.ts')
  assert.equal(resolve('../composables/useReadingTimer.ts',root+'/src/views/ReaderView.vue'),root+'/src/mobile/composables/useReadingTimer.ts')
  assert.equal(resolve('../services/updater',root+'/src/views/SettingsView.vue'),root+'/src/mobile/services/updater.ts')
  assert.equal(resolve('./App.vue',root+'/src/main.ts'),root+'/src/mobile/App.vue')
  assert.equal(resolve('../services/tts',root+'/src/composables/useReadAloud.ts'),root+'/src/mobile/services/tts.ts')
  assert.equal(resolve('/src/styles/main.css'),root+'/src/mobile/styles/main.css')
  assert.equal(resolve(root+'/src/views/ReaderView.vue?vue&type=style'),root+'/src/mobile/views/ReaderView.vue?vue&type=style')
  for (const component of ['AppModal','ConfirmHost','ToastHost']) assert.equal(resolve(`../components/${component}.vue`,root+'/src/views/LibraryView.vue'),`${root}/src/mobile/components/${component}.vue`)
  assert.equal(resolve('../services/toast',root+'/src/components/BooklistImportDialog.vue'),root+'/src/mobile/services/toast.ts')
  assert.equal(resolve('../storage/types',root+'/src/services/edgeTts.ts'),null)
  assert.equal(resolve('./views/ReaderView.vue',root+'/src/mobile/App.vue'),null)
})
test('release gate rejects a mobile tag for desktop and a desktop tag for App', () => {
  const check = (...args) => execFileSync(process.execPath,['scripts/check-release.mjs',...args],{cwd:root,stdio:'pipe'}).toString()
  assert.match(check('--tag','v1.20.0'),/1.20.0/)
  for (const platform of ['android','ios']) assert.match(check('--platform',platform,'--tag','v2.0.0'),/2.0.0/)
  assert.throws(()=>check('--tag','v2.0.0'))
  assert.throws(()=>check('--platform','android','--tag','v1.20.0'))
  assert.throws(()=>check('--platform','unknown'))
})
