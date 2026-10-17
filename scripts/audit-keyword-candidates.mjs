// Offline, synthetic counterexamples against the actual production tokenizer/ranker.
// These are mechanism probes, NOT human judgements or a representative accuracy score.
// node scripts/audit-keyword-candidates.mjs > /tmp/lightread-keyword-audit.json
import { readFileSync } from 'node:fs'
import { parseZhLexicon } from '../src/services/readingModes/zhSegment.ts'
import { buildStats, tokenizePara, pickSection, scoreTypes, KW_DEFAULTS } from '../src/services/readingModes/keyWords.ts'
import { Terminology } from '../src/services/terminology.ts'

const lex = parseZhLexicon(readFileSync(new URL('../src/data/zh-lexicon.txt', import.meta.url), 'utf8'))
const dictionary = new Terminology(JSON.parse(readFileSync(new URL('../src/data/terminology/dictionary.json', import.meta.url), 'utf8')))
const words = ['主体间性', '先验演绎', '交往理性', '内圣外王', '可能世界语义学', '存在', '关系']
const boundaries = words.map(word => ({
  word,
  baseSegmentation: tokenizePara(word, lex).map(t => word.slice(t.index, t.index + t.len)),
  dictionaryCandidates: dictionary.hints({ subjects: ['B'] }, word).terms,
}))

// The AI keyword protocol stores type-level q/r without a sentence ID.
const occurrenceParas = [
  '存在是本体论的核心概念，哲学家在这里讨论事物如何呈现，以及主体如何理解世界。本章用几个例子说明这个问题，并在后文逐步解释相关的论证。',
  '这份表格存在一个普通笔误，管理员下午会去处理。大家把文件放到柜子里，随后一起出去吃饭。这一天过得十分平静，没有其他值得记录的事情。',
]
const stats = buildStats([{ section: 0, paras: occurrenceParas }], lex)
const selected = pickSection(occurrenceParas, 0, stats, scoreTypes(stats), { ...KW_DEFAULTS, density: .08 }, {
  mode: 'ai', ai: new Map([['存在', { r: 3, n: 1 }]]),
})

// Same opening passage, only later text changes. Check lexical prefix invariance.
let seed = 123
const pick = a => a[Math.floor((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296 * a.length)]
const names = ['阿Q', '赵太爷', '王胡', '小D', '邹七嫂', '假洋鬼子', '吴妈', '秀才']
const before = ['那天', '傍晚', '忽然', '后来', '大家', '人们', '一路', '心里']
const after = ['走进', '看见', '想起', '离开', '回到', '谈起', '遇见', '记得']
const later = Array.from({ length: 80 }, () => Array.from({ length: 4 }, () => pick(before) + pick(names) + pick(after) + '未庄，天色已经晚了。').join(''))
const opening = '邹七嫂走过门口，留下了一封信。'
const prefix = [{ section: 0, paras: [opening] }]
const early = buildStats(prefix, lex)
const full = buildStats([...prefix, { section: 1, paras: later }], lex)
const split = st => tokenizePara(opening, st.lex).map(t => opening.slice(t.index, t.index + t.len))

console.log(JSON.stringify({
  baseline: 'Current production functions (original audit: v1.18.1); synthetic authored probes; no paid model calls',
  boundaries,
  occurrenceScope: {
    text: occurrenceParas,
    aiWords: ['存在'],
    picked: selected.map(p => ({ para: p.para, word: p.word, index: p.index })),
    ordinaryUsageHighlighted: selected.some(p => p.para === 1 && p.word === '存在'),
  },
  futureVocabulary: {
    opening,
    prefixOnly: split(early), withFutureChapter: split(full),
    prefixInvariant: JSON.stringify(split(early)) === JSON.stringify(split(full)),
    futureDiscovered: [...full.newWords].sort(),
    interpretation: 'Future text changes segmentation; this probe alone does not measure plot spoilers or final highlight quality.',
  },
}, null, 2))
