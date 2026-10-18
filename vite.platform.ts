import type { Plugin } from 'vite'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** A native desktop target always wins over a preview override. Never infer UI from window size. */
export function uiTarget(env: Record<string, string | undefined>): 'desktop' | 'mobile' {
  if (env.TAURI_ENV_PLATFORM) return ['android', 'ios'].includes(env.TAURI_ENV_PLATFORM) ? 'mobile' : 'desktop'
  return env.LIGHTREAD_UI === 'mobile' ? 'mobile' : 'desktop'
}

export function mobileUi(root = fileURLToPath(new URL('.', import.meta.url))): Plugin {
  const src = resolve(root, 'src')
  const entries: string[] = JSON.parse(readFileSync(resolve(src, 'mobile/overrides.json'), 'utf8'))
  const overrides = new Map(entries.map(file => [resolve(src, file), resolve(src, 'mobile', file)]))
  return {
    name: 'lightread:mobile-ui',
    enforce: 'pre',
    resolveId(source, importer) {
      const [id, query] = source.split('?')
      const absolute = id.startsWith('.') && importer ? resolve(dirname(importer.split('?')[0]!), id)
        : id.startsWith('/src/') ? resolve(root, id.slice(1)) : id
      for (const candidate of [absolute, `${absolute}.ts`, `${absolute}.vue`, resolve(absolute, 'index.ts')]) {
        const mobile = overrides.get(candidate)
        if (mobile) return mobile + (query ? `?${query}` : '')
      }
      return null
    },
    generateBundle() {
      // Fonts are emitted through their CSS/JS imports; distribute their licenses alongside them.
      for (const name of ['edge-tts-LICENSE.txt', 'edge-tts-COPYING.txt']) {
        this.emitFile({ type: 'asset', fileName: `licenses/${name}`, source: readFileSync(resolve(root, 'src-tauri/src/mobile', name)) })
      }
      for (const name of ['Noto-LICENSE.txt', 'WenKai-LICENSE.txt']) {
        this.emitFile({ type: 'asset', fileName: `fonts/${name}`, source: readFileSync(resolve(src, 'mobile/assets/fonts', name)) })
      }
    },
  }
}
