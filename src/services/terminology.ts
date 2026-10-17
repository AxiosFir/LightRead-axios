/** Experimental, dependency-free terminology candidates. Not wired into production ranking.
 * Usable by both browser and relay once the hybrid extraction experiment is evaluated.
 * A single primary subject plus secondary subjects covers cross-disciplinary books.
 * Dictionary membership supplies candidates, not a decision to highlight them.
 */
export interface TermDomain { id: string; zh: string; en: string; aliases: string[]; anchors: string[] }
export interface TermPack {
  id: string
  domains: string[]
  source: string
  role: 'term' | 'name' | 'idiom' | 'phrase'
  /** Source DF is preserved, but is NOT a relevance score. */
  entries: Array<[string, number | null]>
}
export interface TermData { version: string; domains: TermDomain[]; packs: TermPack[] }
export interface TermBook { title?: string; subjects?: string[]; tags?: string[] }
export interface TermHints { primary: string; related: string[]; terms: string[] }
export interface TermSpan { word: string; start: number; end: number; packs: string[] }
interface Trie { next: Map<string, Trie>; packs: string[] }
const trie = (): Trie => ({ next: new Map(), packs: [] })

const CLASS_IDS = 'ABCDEFGH IJK NOPQRSTUV XZ'.replaceAll(' ', '').split('')
const asciiLower = (s: string) => s.replace(/[A-Z]/g, c => c.toLowerCase())
const wordChar = (c: string | undefined) => !!c && /[a-z0-9_]/i.test(c)

function positions(text: string, word: string): number[] {
  const out: number[] = []
  const haystack = asciiLower(text)
  const needle = asciiLower(word)
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + needle.length)) {
    if (/[a-z0-9]/.test(needle[0]) && wordChar(haystack[at - 1])) continue
    if (/[a-z0-9]/.test(needle.at(-1)!) && wordChar(haystack[at + needle.length])) continue
    out.push(at)
  }
  return out
}

/** Fail closed for malformed packs; a caller can fall back to normal AI selection. */
export function parseTermData(raw: unknown): TermData {
  const d = raw as TermData
  if (!d || typeof d.version !== 'string' || !Array.isArray(d.domains) || !Array.isArray(d.packs)) throw new Error('invalid terminology data')
  if (d.domains.some(x => !x || typeof x.id !== 'string')) throw new Error('invalid terminology domain')
  const ids = new Set(d.domains.map(x => x.id))
  if (ids.size !== CLASS_IDS.length || d.domains.length !== ids.size || CLASS_IDS.some(id => !ids.has(id))) throw new Error('incomplete terminology taxonomy')
  for (const domain of d.domains) {
    if (typeof domain.zh !== 'string' || typeof domain.en !== 'string' || !Array.isArray(domain.aliases) || !Array.isArray(domain.anchors)
      || [...domain.aliases, ...domain.anchors].some(w => typeof w !== 'string' || !w.trim())) throw new Error('invalid terminology domain')
  }
  const packIds = new Set<string>()
  for (const p of d.packs) {
    if (!p || typeof p.id !== 'string' || packIds.has(p.id) || typeof p.source !== 'string'
      || !['term', 'name', 'idiom', 'phrase'].includes(p.role) || !Array.isArray(p.domains) || !p.domains.length
      || p.domains.some(id => !ids.has(id)) || !Array.isArray(p.entries)) throw new Error('invalid terminology pack')
    packIds.add(p.id)
    for (const e of p.entries) if (!Array.isArray(e) || typeof e[0] !== 'string' || !e[0].trim()
      || e.length !== 2 || e[0].length > 256
      || (e[1] !== null && (!Number.isSafeInteger(e[1]) || e[1] < 0))) throw new Error('invalid terminology entry')
  }
  return d
}

export class Terminology {
  readonly data: TermData
  #indexes = new Map<string, Trie>()

  constructor(raw: unknown) { this.data = parseTermData(raw) }

  route(book: TermBook, text: string): { primary: string; related: string[] } {
    const subjects = [...(book.subjects ?? []), ...(book.tags ?? [])].slice(0, 32).map(s => s.slice(0, 120))
    const title = (book.title ?? '').slice(0, 160)
    const sample = text.slice(0, 12_000)
    const scores = this.data.domains.map(d => {
      // A declared CLC number (e.g. B82) is stronger than inferred topic words.
      const clc = subjects.some(s => new RegExp(`^(?:CLC[:： ]*)?${d.id}(?:\\d|$)`, 'i').test(s.trim()))
      const meta = d.aliases.reduce((n, a) => n + (subjects.some(s => positions(s, a).length) ? 20 : positions(title, a).length ? 10 : 0), 0)
      const hits = d.anchors.filter(w => w.length >= 4 && positions(sample, w).length).length
      return { id: d.id, meta: clc ? 1000 : meta, hits }
    })
    scores.sort((a, b) => b.meta - a.meta || b.hits - a.hits || a.id.localeCompare(b.id))
    const first = scores[0]!
    const primary = first.meta || first.hits ? first.id : 'Z'
    const related = scores.filter(s => s.id !== primary && (s.meta > 0 || s.hits >= 2)).slice(0, 2).map(s => s.id)
    return { primary, related }
  }

  #index(pack: TermPack): Trie {
    let index = this.#indexes.get(pack.id)
    if (index) return index
    index = trie()
    for (const [word] of pack.entries) {
      // Keep complete source data, but only short, usable original spans enter prompts.
      if (word.length < 2 || word.length > 12 || /[\r\n\t<>]/.test(word)) continue
      let node = index
      // UTF-16 units preserve JS/DOM offsets, including supplementary Han.
      const normalized = asciiLower(word)
      for (let i = 0; i < normalized.length; i++) {
        const ch = normalized[i]!
        if (!node.next.has(ch)) node.next.set(ch, trie())
        node = node.next.get(ch)!
      }
      node.packs.push(pack.id)
    }
    this.#indexes.set(pack.id, index)
    return index
  }

  /** Return occurrence spans, including nested candidates, without deciding importance.
   * Scans a bounded chunk using lazy per-pack tries; no frequency-based bonus.
   */
  match(book: TermBook, rawText: string): { primary: string; related: string[]; spans: TermSpan[] } {
    const text = rawText.slice(0, 12_000)
    const routing = this.route(book, text)
    const active = new Set([routing.primary, ...routing.related])
    const haystack = asciiLower(text)
    const candidates = new Map<string, TermSpan>()
    for (const pack of this.data.packs) {
      if (!pack.domains.some(d => active.has(d))) continue
      const index = this.#index(pack)
      for (let start = 0; start < haystack.length; start++) {
        if (/[a-z0-9]/.test(haystack[start]!) && wordChar(haystack[start - 1])) continue
        let node: Trie | undefined = index
        for (let end = start; end < Math.min(start + 12, haystack.length); end++) {
          node = node.next.get(haystack[end]!)
          if (!node) break
          if (!node.packs.length || (/[a-z0-9]/.test(haystack[end]!) && wordChar(haystack[end + 1]))) continue
          const key = `${start}:${end + 1}`
          const old = candidates.get(key)
          if (old) old.packs.push(...node.packs)
          else candidates.set(key, { word: text.slice(start, end + 1), start, end: end + 1, packs: [...node.packs] })
        }
      }
    }
    return { ...routing, spans: [...candidates.values()].sort((a, b) => a.start - b.start || b.end - a.end) }
  }

  /** Conservative prompt-budget baseline: keep whole spans, deduplicate, text order.
   * This is a candidate shortlist, not a salience rank or exhaustive extraction.
   * The model must still read the passage and may choose words outside the list.
   */
  hints(book: TermBook, rawText: string, limit = 24): TermHints {
    const { primary, related, spans } = this.match(book, rawText)
    const terms = new Set<string>()
    let coveredTo = -1
    for (const span of spans) {
      if (span.start < coveredTo) continue
      coveredTo = span.end
      terms.add(span.word)
    }
    return { primary, related, terms: [...terms].slice(0, Math.max(0, Math.min(32, Math.floor(limit) || 0))) }
  }
}
