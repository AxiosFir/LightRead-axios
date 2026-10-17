import { Terminology, type TermBook } from '../terminology.ts'

/** Preserve paragraph-local evidence. Overlapping windows cover unusually long
 * paragraphs too, without allowing a concept to cross a paragraph boundary.
 */
export function paragraphConcepts(paras: string[], book: TermBook, terms: Terminology): string[][] {
  return paras.map(text => {
    const words = new Set<string>()
    for (let at = 0; at < text.length; at += 12_000 - 12) {
      const chunk = text.slice(at, at + 12_000)
      for (const span of terms.match(book, chunk, true).spans) {
        // Core concepts remain available in cross-disciplinary books. General
        // corpora are routed by subject; membership never supplies an AI vote.
        if (span.word.length >= 4 && /^[\p{Script=Han}A-Za-z0-9-]+$/u.test(span.word)) words.add(span.word)
      }
      if (at + 12_000 >= text.length) break
    }
    return [...words]
  })
}
