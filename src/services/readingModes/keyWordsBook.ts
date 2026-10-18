/**
 * 「重点词」的一本书 (纯逻辑, 无 DOM): 收集各节段落 → 全书统计 → 按节选词。
 * 在 Worker 里跑 (keyWords.worker.ts); 没有 Worker 时由 keyWordsClient.ts 在主线程直接用。
 *
 * 全书统计还没做完时 (刚打开书), 先用已收到的分节当作「本书」来算; 做完后调用方重新取词并重画。
 */
import {
  KW_AI_DENSITY, KW_DEFAULTS, KW_DENSITY, buildStats, pickSection, scoreTypes,
  type AiWord, type KwLevel, type KwPick, type KwStats, type KwType,
} from './keyWords.ts'
import type { ZhLexicon } from './zhSegment.ts'
import type { Terminology, TermBook } from '../terminology.ts'
import { paragraphConcepts } from './conceptRecognition.ts'
import { blendDensity, densityBand } from '../dianjing/density.ts'

export interface KwPickRequest {
  book?: TermBook
  section: number
  paras: string[]
  level: KwLevel
  /** Legacy fine adjustment 1–100; App may extend to 300 (3× old high budget). */
  densityAmount?: number
  /** 小说: K、B 只用读到本节为止的文本 */
  spoilerSafe: boolean
  /** 智能版: AI 词 [词, 重要度, 块数] 与各段是否已有 AI 结果 (没有的段用离线结果) */
  smart?: { words: Array<[string, number, number]>; aiParas: ArrayLike<number> } | null
}

/** 选词结果打包成 Int32Array: 每个词 4 个数 [段, 段内起点, 长度, 标志 (1 = 强样式, 2 = AI 词)] */
export function packPicks(picks: KwPick[]): Int32Array {
  const out = new Int32Array(picks.length * 4)
  picks.forEach((p, i) => {
    out[i * 4] = p.para
    out[i * 4 + 1] = p.index
    out[i * 4 + 2] = p.len
    out[i * 4 + 3] = (p.strong ? 1 : 0) | (p.ai ? 2 : 0)
  })
  return out
}

/** 一本书最多统计这么多字 (超长的书只取前面的部分, 控制 Worker 内存) */
export const MAX_BOOK_CHARS = 1_500_000

export class KwBook {
  readonly lex: ZhLexicon
  #sections = new Map<number, string[]>()
  #chars = 0
  #stats: KwStats | null = null
  /** 统计覆盖了哪些节 */
  #covered = new Set<number>()
  #types = new Map<string, Map<string, KwType>>()
  #terminology: Terminology | null
  #metadata: TermBook = {}
  #metadataKey = ''
  #concepts = new Map<number, string[][]>()
  #densityCache = new Map<string, KwPick[]>()
  /** 全书统计已完成 (之后新加的节会让它变回 false) */
  complete = false

  constructor(lex: ZhLexicon, terminology: Terminology | null = null) {
    this.lex = lex
    this.#terminology = terminology
  }

  get sectionCount(): number { return this.#sections.size }
  get chars(): number { return this.#chars }
  hasSection(i: number): boolean { return this.#sections.has(i) }
  get newWords(): number { return this.#stats?.newWords.size ?? 0 }

  /** 加一节 (已有则替换); 超过字数上限时不再收 */
  addSection(section: number, paras: string[]): boolean {
    const n = paras.reduce((a, p) => a + p.length, 0)
    const old = this.#sections.get(section)
    if (old && old.length === paras.length && old.every((p, i) => p === paras[i])) return true
    if (!old && this.#chars + n > MAX_BOOK_CHARS && this.#sections.size > 0) return false
    if (old) this.#chars -= old.reduce((a, p) => a + p.length, 0)
    this.#sections.set(section, paras)
    this.#densityCache.clear()
    this.#chars += n
    this.#concepts.delete(section)
    this.#covered.delete(section)
    this.complete = false
    return true
  }

  /** 用已收到的全部分节重建统计 (新词发现 + 切分 + 记位置) */
  analyze(): KwStats {
    this.#densityCache.clear()
    const sections = [...this.#sections].map(([section, paras]) => ({ section, paras }))
    if (this.#terminology) for (const { section, paras } of sections) {
      if (!this.#concepts.has(section)) this.#concepts.set(section, paragraphConcepts(paras, this.#metadata, this.#terminology))
    }
    this.#stats = buildStats(sections, this.lex, { concepts: this.#concepts })
    this.#covered = new Set(this.#sections.keys())
    this.#types.clear()
    this.complete = true
    return this.#stats
  }

  #typesFor(limit: number, density = KW_DEFAULTS.density): Map<string, KwType> {
    const key = `${limit}:${density}`
    let t = this.#types.get(key)
    if (!t) {
      t = scoreTypes(this.#stats!, { ...KW_DEFAULTS, density }, limit)
      if (this.#types.size > 8) this.#types.delete(this.#types.keys().next().value!)
      this.#types.set(key, t)
    }
    return t
  }

  pick(req: KwPickRequest): KwPick[] {
    const extended = Number.isFinite(req.densityAmount) && req.densityAmount! > 100
    if (req.densityAmount !== undefined && !extended) {
      const { lower, upper, fraction } = densityBand(req.densityAmount)
      const preset = (level: KwLevel) => {
        const request = { ...req, level, densityAmount: undefined }
        const key = JSON.stringify(request)
        let picks = this.#densityCache.get(key)
        if (!picks) {
          picks = this.pick(request)
          if (this.#densityCache.size >= 12) this.#densityCache.clear()
          this.#densityCache.set(key, picks)
        }
        return picks
      }
      if (fraction === 0) return preset(lower)
      if (fraction === 1) return preset(upper)
      return blendDensity(preset(lower), preset(upper), fraction, p => `${p.para}:${p.index}:${p.len}`)
        .slice().sort((a, b) => a.para - b.para || a.index - b.index)
    }
    const metadataKey = JSON.stringify(req.book ?? {})
    if (metadataKey !== this.#metadataKey) {
      this.#metadataKey = metadataKey
      this.#metadata = req.book ?? {}
      this.#concepts.clear()
      this.#densityCache.clear()
      this.#stats = null
    }
    this.addSection(req.section, req.paras)
    // 还没有统计, 或统计不含这一节且还没做过全书统计: 先用已有分节算一份
    if (!this.#stats || (!this.#covered.has(req.section) && !this.complete)) this.analyze()
    const stats = this.#stats!
    const end = stats.ordEnd.get(req.section)
    const limit = req.spoilerSafe && end !== undefined ? end : stats.N
    const multiplier = extended ? Math.min(3, req.densityAmount! / 100) : 1
    const level = extended ? 'high' : req.level
    const offline = { ...KW_DEFAULTS, density: (KW_DENSITY[level] ?? KW_DENSITY.normal) * multiplier,
      // Higher density may place meaningful whole words next to one another;
      // final counts remain capped below and token ranges never overlap.
      minTokenGap: extended ? 1 : 2,
      perParaType: extended ? Math.ceil(KW_DEFAULTS.perParaType * multiplier) : KW_DEFAULTS.perParaType }
    const types = this.#typesFor(limit, extended ? offline.density : KW_DEFAULTS.density)
    const targetCount = extended
      ? Math.floor(this.pick({ ...req, level: 'high', densityAmount: undefined }).length * multiplier)
      : undefined
    const capExtended = (picks: KwPick[]) => {
      if (!extended) return picks
      // Anchor the multiplier to actual old-high marks, not only token percentage.
      // Removing low-score candidates preserves non-overlap and word boundaries.
      const target = targetCount!
      return picks.length <= target ? picks : picks.slice().sort((a, b) => b.score - a.score)
        .slice(0, target).sort((a, b) => a.para - b.para || a.index - b.index)
    }
    const smart = req.smart
    if (!smart || !smart.words.length) return pickSection(req.paras, req.section, stats, types, offline, { spoilerSafe: req.spoilerSafe, targetCount })
    const ai = new Map<string, AiWord>(smart.words.map(([w, r, n]) => [w, { r, n }]))
    const mask = smart.aiParas
    let anyAi = false
    let anyOffline = false
    for (let i = 0; i < req.paras.length; i++) { if (mask[i]) anyAi = true; else anyOffline = true }
    const aiPrm = { ...KW_DEFAULTS, density: KW_AI_DENSITY * multiplier }
    const aiPicks = anyAi
      ? pickSection(req.paras, req.section, stats, types, aiPrm, {
        ai, mode: level === 'high' ? 'aiFill' : 'ai', minR: level === 'low' ? 2 : 1, spoilerSafe: req.spoilerSafe,
      })
      : []
    const offPicks = anyOffline ? pickSection(req.paras, req.section, stats, types, offline, { spoilerSafe: req.spoilerSafe }) : []
    return capExtended([...aiPicks.filter(p => mask[p.para]), ...offPicks.filter(p => !mask[p.para])]
      .sort((a, b) => a.para - b.para || a.index - b.index))
  }
}
