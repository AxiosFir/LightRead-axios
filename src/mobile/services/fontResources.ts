import { unzip } from 'fflate'
import { t } from '../../i18n'
import catalog from '../data/font-catalog.json'
import { fetchRemote } from '../../services/net'
import { saveFontResource, type CustomFont } from './fonts'

export const FONT_RESOURCES = catalog
export type FontResource = typeof catalog[number]
export const fontResourceFile = (font: FontResource) => `catalog-${font.id}-${font.version.replace(/[^a-zA-Z0-9.-]/g, '-')}.${font.fontFile.split('.').at(-1)}`
export function installedResource(font: FontResource, installed: CustomFont[]) {
  return installed.find(item => item.name === font.name && item.file.endsWith(fontResourceFile(font)))
}
async function digest(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest('SHA-256', bytes.slice().buffer)
  return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('')
}
export async function downloadFontResource(font: FontResource, signal: AbortSignal, progress: (fraction: number) => void): Promise<CustomFont> {
  const response = await fetchRemote(font.url, undefined, { signal })
  const chunks: Uint8Array[] = []
  let size = 0
  const reader = response.body?.getReader()
  if (!reader) throw new Error(t('fontCatalog.invalidPackage'))
  try {
    while (true) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > font.bytes) throw new Error(t('fontCatalog.invalidPackage'))
      chunks.push(value); progress(size / font.bytes * 0.9)
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  if (size !== font.bytes) throw new Error(t('fontCatalog.invalidPackage'))
  const archive = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { archive.set(chunk, offset); offset += chunk.byteLength }
  if (await digest(archive) !== font.sha256) throw new Error(t('fontCatalog.invalidPackage'))
  signal.throwIfAborted()
  const entries = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(archive, { filter: entry => entry.name === font.fontFile || entry.name === 'LICENSE.txt' }, (error, files) => error ? reject(error) : resolve(files))
  })
  const bytes = entries[font.fontFile], license = entries['LICENSE.txt']
  if (!bytes || bytes.length !== font.fontBytes || !license || await digest(bytes) !== font.fontSha256) throw new Error(t('fontCatalog.invalidPackage'))
  const face = new FontFace(font.name, bytes.slice().buffer)
  await face.load()
  signal.throwIfAborted()
  const installed = await saveFontResource(font.name, fontResourceFile(font), bytes, license)
  progress(1)
  return installed
}
