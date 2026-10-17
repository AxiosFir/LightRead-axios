// Reproducible terminology data. Source snapshots are pinned by revision AND SHA-256.
// No definitions are scraped. Input-method/document frequencies are retained as
// provenance, never interpreted as reading importance.
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const root = new URL('../src/data/terminology/', import.meta.url)
const catalog = JSON.parse(await readFile(new URL('catalog.json', root), 'utf8'))
const manifest = JSON.parse(await readFile(new URL('sources.json', root), 'utf8'))
const cache = join(homedir(), '.cache/lightread/terminology')
await mkdir(cache, { recursive: true })
const packs = catalog.domains.map(d => ({
  id: `core-${d.id}`, domains: [d.id], source: 'lightread-editorial', role: 'term',
  entries: [...new Set(d.anchors)].map(w => [w, null]),
}))
for (const p of catalog.supplements) packs.push({
  id: p.id, domains: p.domains, source: p.source, role: p.role,
  entries: [...new Set(p.terms)].map(w => [w, null]),
})
const report = []
for (const source of manifest.sources) {
  const file = join(cache, `${source.sha256}.txt`)
  let bytes
  try { bytes = await readFile(file) } catch {
    const res = await fetch(source.url, { signal: AbortSignal.timeout(30_000) })
    if (!res.ok) throw new Error(`${source.id}: HTTP ${res.status}`)
    bytes = Buffer.from(await res.arrayBuffer())
  }
  if (createHash('sha256').update(bytes).digest('hex') !== source.sha256) throw new Error(`${source.id}: SHA-256 mismatch`)
  await writeFile(file, bytes)
  const words = new Map()
  let rows = 0
  const invalidFrequencies = []
  let lineNumber = 0
  // Upstream includes CR-only files as well as LF / CRLF files.
  for (const line of bytes.toString('utf8').replace(/^\uFEFF/, '').split(/\r\n|[\r\n]/)) {
    lineNumber++
    if (!line.trim()) continue
    rows++
    const [raw, rawDf, ...rest] = line.split('\t')
    const word = raw.trim().normalize('NFC')
    if (!word || rawDf === undefined || rest.length) throw new Error(`${source.id}: invalid row ${lineNumber}`)
    // Preserve every headword. Four upstream rows have missing/malformed DF;
    // retain their raw value in the audit report, never guess a frequency.
    const df = /^\d+$/.test(rawDf.trim()) && Number.isSafeInteger(Number(rawDf)) ? Number(rawDf) : null
    if (df === null) invalidFrequencies.push({ line: lineNumber, word, raw: rawDf })
    const old = words.get(word)
    words.set(word, df === null ? old ?? null : Math.max(df, old ?? 0))
  }
  const entries = [...words].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  packs.push({ id: source.id, domains: source.domains, source: source.source, role: source.role, entries })
  report.push({ id: source.id, rows, unique: entries.length, invalidFrequencies, sha256: source.sha256 })
}
for (const source of manifest.snapshots ?? []) {
  const bytes = await readFile(new URL(source.file, root))
  if (createHash('sha256').update(bytes).digest('hex') !== source.sha256) throw new Error(`${source.id}: SHA-256 mismatch`)
  const rows = JSON.parse(bytes).results.bindings
  const words = new Set(rows.map(r => r.label.value.normalize('NFC')))
  packs.push({ id: source.id, domains: source.domains, source: source.source, role: source.role,
    entries: [...words].sort().map(w => [w, null]) })
  report.push({ id: source.id, rows: rows.length, unique: words.size,
    entities: new Set(rows.map(r => r.item.value)).size, sha256: source.sha256 })
}
const data = { version: catalog.version, domains: catalog.domains, packs }
const unique = new Set(packs.flatMap(p => p.entries.map(([word]) => word)))
const output = JSON.stringify(data) + '\n'
await writeFile(new URL('dictionary.json', root), output)
await writeFile(new URL('coverage.json', root), JSON.stringify({
  version: data.version, uniqueTerms: unique.size, bytes: Buffer.byteLength(output),
  sha256: createHash('sha256').update(output).digest('hex'), sources: report,
  domains: data.domains.map(d => ({ id: d.id, name: d.zh,
    packs: packs.filter(p => p.domains.includes(d.id)).map(p => p.id),
    uniqueTerms: new Set(packs.filter(p => p.domains.includes(d.id)).flatMap(p => p.entries.map(([word]) => word))).size,
  })), references: catalog.references,
}, null, 2) + '\n')
console.log(`Built ${packs.length} packs, ${data.domains.length} domains, ${unique.size} unique terms; ${Buffer.byteLength(output)} bytes.`)
