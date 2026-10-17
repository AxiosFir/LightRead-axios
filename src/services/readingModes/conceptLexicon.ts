import conceptUrl from '../../data/terminology/concepts.json?url'
import { Terminology } from '../terminology.ts'

let pending: Promise<Terminology | null> | null = null
/** Optional local asset. Failure keeps the existing tokenizer/ranker available.
 * Shared by the worker and main-thread fallback, never calls a remote AI service.
 */
export function loadConceptLexicon(): Promise<Terminology | null> {
  if (!pending) {
    // Worker contexts do not inherit the main window's compatibility polyfills.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    pending = fetch(conceptUrl, { signal: controller.signal })
      .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json() })
      .then(raw => new Terminology(raw))
      .catch(() => { pending = null; return null })
      .finally(() => clearTimeout(timer))
  }
  return pending
}
