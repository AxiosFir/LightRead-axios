import { chromium } from 'playwright'
import assert from 'node:assert/strict'

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  await page.goto((process.env.E2E_BASE || 'http://127.0.0.1:4194') + '/#/library')
  const result = await page.evaluate(async () => {
    const { clearLegacyUiCaches } = await import('/src/mobile/services/nativeCacheCleanup.ts')
    const url = new URL('/qa-offline-asset', location.href).href
    const entries = {
      'lightread-ambient-v1': 'downloaded recording',
      'other-offline-resources': 'retained data',
      'workbox-precache-v2-old-ui': 'obsolete interface',
      'workbox-runtime-old-ui': 'obsolete runtime',
    }
    for (const [name, body] of Object.entries(entries)) {
      await (await caches.open(name)).put(url, new Response(body))
    }
    await clearLegacyUiCaches(caches)
    await clearLegacyUiCaches(caches)
    const remaining = {}
    for (const name of await caches.keys()) remaining[name] = await (await (await caches.open(name)).match(url))?.text()
    return remaining
  })
  assert.deepEqual(result, {
    'lightread-ambient-v1': 'downloaded recording',
    'other-offline-resources': 'retained data',
  })
  console.log('PASS real Cache Storage retains recording/data bytes and removes only legacy UI; repeated cleanup is safe')
} finally { await browser.close() }
