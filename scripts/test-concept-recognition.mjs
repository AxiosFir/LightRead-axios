import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Terminology } from '../src/services/terminology.ts'
import { parseZhLexicon } from '../src/services/readingModes/zhSegment.ts'
import { paragraphConcepts } from '../src/services/readingModes/conceptRecognition.ts'
import { buildStats, tokenizePara, forcedMatcher, scoreTypes } from '../src/services/readingModes/keyWords.ts'
import { KwBook } from '../src/services/readingModes/keyWordsBook.ts'

const json = p => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'))
const lex = parseZhLexicon(readFileSync(new URL('../src/data/zh-lexicon.txt', import.meta.url), 'utf8'))
const data = json('../src/data/terminology/concepts.json')
const terms = new Terminology(data)
const book = { title: '哲学导论' }
const phrase = '主体间性与先验演绎、内圣外王和可能世界语义学。'

test('运行词库只保留复合术语，不把人名、诗词和成语批量强制合词', () => {
  for (const p of data.packs) {
    assert.equal(p.role, 'term')
    for (const [w, df] of p.entries) { assert.ok(w.length >= 4 && w.length <= 12); assert.equal(df, null) }
  }
})

test('生产统计和选词使用相同的完整边界，基础词表保持不变', () => {
  const original = tokenizePara(phrase, lex)
  const concepts = new Map([[0, paragraphConcepts([phrase], book, terms)]])
  const stats = buildStats([{ section: 0, paras: [phrase] }], lex, { concepts })
  const tokens = tokenizePara(phrase, stats.lex, stats.concepts.get(0)[0])
  for (const w of ['主体间性', '先验演绎', '内圣外王', '可能世界语义学']) {
    assert.ok(tokens.some(t => t.text === w))
    assert.equal(stats.pos.get(w).length, 1)
    assert.ok(scoreTypes(stats).get(w).eligible)
  }
  assert.deepEqual(tokenizePara(phrase, lex), original)
  for (const t of tokens) assert.equal(phrase.slice(t.index, t.index + t.len), t.text)
})

test('交叉领域的核心概念和超过 12000 字的段落仍能识别', () => {
  const text = '。'.repeat(11998) + '主体间性。' + '。'.repeat(12000) + '内圣外王。'
  const out = paragraphConcepts([text], { subjects: ['D90'] }, terms)[0]
  assert.ok(out.includes('主体间性'))
  assert.ok(out.includes('内圣外王'))
  assert.deepEqual(paragraphConcepts(['主体', '间性'], book, terms), [[], []])
})

test('智能版只扩展实际被选中的碎片；独立出现的短词保持原文，不新增 AI 候选', () => {
  const paras = [
    '主体间性是这一节讨论的概念。作者把个人经验与公共理解进行比较，说明人们怎样在日常交往中理解彼此，这也是后面的论证所需要说明的问题。',
    '主体是这一段单独讨论的词。读者可以根据前面的几个例子思考有关的问题，并进一步了解这个词在不同条件下如何使用，以及讨论怎样展开。',
    '内圣外王是这一段的概念。作者还没有将它选作重点，读者可以根据这里提供的材料继续阅读后面的解释，也可以回到前面的几个例子再思考。',
  ]
  const b = new KwBook(lex, terms)
  const picks = b.pick({ section: 0, paras, book, level: 'normal', spoilerSafe: false,
    smart: { words: [['主体', 3, 9]], aiParas: [1, 1, 1] } })
  assert.ok(picks.some(p => p.para === 0 && p.word === '主体间性' && p.ai))
  assert.ok(picks.some(p => p.para === 1 && p.word === '主体' && p.ai))
  assert.ok(!picks.some(p => p.para === 2))
  for (const p of picks) assert.equal(paras[p.para].slice(p.index, p.index + p.len), p.word)
})

test('本书反复讨论的完整概念参与离线排序，而不是只在候选工具中出现', () => {
  const paras = Array.from({ length: 8 }, (_, i) => `第${i}个例子讨论主体间性，作者从不同的经验出发解释这个概念的意义，再通过人与人的交往说明问题。读者可以结合前面的例子思考这些说法。`)
  const picks = new KwBook(lex, terms).pick({ section: 0, paras, book, level: 'normal', spoilerSafe: false })
  assert.ok(picks.some(p => p.word === '主体间性'))
  assert.ok(!picks.some(p => ['主体', '间', '性'].includes(p.word)))
})

test('替换章节正文会失效旧统计和概念缓存', () => {
  const b = new KwBook(lex, terms)
  b.pick({ section: 0, paras: [phrase], book, level: 'normal', spoilerSafe: false })
  const paras = ['这是新的段落，没有前面的概念。']
  b.pick({ section: 0, paras, book, level: 'normal', spoilerSafe: false })
  const stats = b.analyze()
  assert.ok(!stats.pos.has('主体间性'))
  assert.equal(stats.texts.get(0), paras[0])
})

test('术语资源失败回退原有算法；混合词不得嵌入其他 ASCII 单词', () => {
  const req = { section: 0, paras: ['今天大家一起去散步，后来回家吃饭。'], level: 'normal', spoilerSafe: false }
  assert.deepEqual(new KwBook(lex, null).pick(req), new KwBook(lex).pick(req))
  const text = 'XTCP/IP2 TCP/IP'
  const tokens = tokenizePara(text, lex, forcedMatcher(['TCP/IP']))
  assert.equal(tokens.filter(t => t.forced).length, 1)
  assert.equal(tokens.find(t => t.forced).index, 9)
})
