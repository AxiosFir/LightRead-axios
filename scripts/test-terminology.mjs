// Candidate retrieval contracts, not a reading-quality benchmark.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { Terminology, parseTermData } from '../src/services/terminology.ts'

const root = new URL('../src/data/terminology/', import.meta.url)
const bytes = readFileSync(new URL('dictionary.json', root))
const data = JSON.parse(bytes)
const coverage = JSON.parse(readFileSync(new URL('coverage.json', root)))
const manifest = JSON.parse(readFileSync(new URL('sources.json', root)))
const terms = new Terminology(data)

test('完整收录固定版本的 11 个 THUOCL 词表，去重与校验报告一致', () => {
  assert.equal(manifest.sources.length, 11)
  assert.equal(createHash('sha256').update(bytes).digest('hex'), coverage.sha256)
  assert.equal(bytes.length, coverage.bytes)
  assert.equal(new Set(data.packs.flatMap(p => p.entries.map(e => e[0]))).size, coverage.uniqueTerms)
  for (const s of manifest.sources) {
    const p = data.packs.find(p => p.id === s.id)
    const r = coverage.sources.find(r => r.id === s.id)
    assert.equal(p.entries.length, r.unique)
    assert.equal(s.sha256, r.sha256)
    assert.equal(s.license, 'MIT')
    assert.equal(new Set(p.entries.map(e => e[0])).size, p.entries.length)
  }
  assert.equal(coverage.sources.filter(s => s.id.startsWith('thuocl-')).reduce((n, s) => n + s.rows, 0), 157172)
})

test('上游四个异常频次保留词条与原值，未知频次不伪造为 0', () => {
  const anomalies = coverage.sources.flatMap(s => (s.invalidFrequencies ?? []).map(a => ({ ...a, pack: s.id })))
  assert.equal(anomalies.length, 4)
  for (const a of anomalies) {
    const p = data.packs.find(p => p.id === a.pack)
    assert.equal(p.entries.find(e => e[0] === a.word)[1], null)
    assert.equal(typeof a.raw, 'string')
  }
})

test('Wikidata 实体快照保留简繁标签、查询与来源校验', () => {
  const s = manifest.snapshots[0]
  const b = readFileSync(new URL(s.file, root))
  assert.equal(createHash('sha256').update(b).digest('hex'), s.sha256)
  const rows = JSON.parse(b).results.bindings
  const expected = [...new Set(rows.map(r => r.label.value.normalize('NFC')))].sort()
  assert.deepEqual(data.packs.find(p => p.id === s.id).entries.map(e => e[0]), expected)
  assert.equal(s.license, 'CC0-1.0')
  assert.ok(s.query.includes('Q33104279'))
})

test('22 个分类入口均有数据，明确分类号优先于标题推断', () => {
  assert.equal(data.domains.length, 22)
  for (const d of data.domains) {
    assert.ok(data.packs.some(p => p.domains.includes(d.id) && p.entries.length))
    assert.equal(terms.route({ subjects: [`CLC: ${d.id}12`] }, '').primary, d.id)
  }
  assert.equal(terms.route({ title: '哲学与法律', subjects: ['D90'] }, '').primary, 'D')
})

test('交叉领域保留相关类，缺少证据回退 Z', () => {
  const r = terms.route({ subjects: ['哲学', '医学'] }, '')
  assert.equal(r.primary, 'B')
  assert.ok(r.related.includes('R'))
  assert.equal(terms.route({}, '今天大家一起出去散步。').primary, 'Z')
  assert.equal(terms.route({ title: 'party' }, '').primary, 'Z') // not "art"
})

test('哲学复合词保持完整，全部返回原文跨度', () => {
  const text = '主体间性、先验演绎、交往理性、内圣外王与可能世界。'
  const m = terms.match({ title: '哲学' }, text)
  for (const w of ['主体间性', '先验演绎', '交往理性', '内圣外王', '可能世界']) assert.ok(m.spans.some(s => s.word === w))
  for (const s of m.spans) assert.equal(text.slice(s.start, s.end), s.word)
})

function small(entries) {
  return new Terminology({ ...data, packs: [{ id: 'fixture', domains: ['T'], source: 'test', role: 'term', entries: entries.map(w => [w, null]) }] })
}

test('ASCII 单词边界与大小写保留原文，重复出现分别定位', () => {
  const t = small(['TCP', 'TCP/IP'])
  const text = 'ATCP TCP/IP 和 tcp；TCP2 不应匹配。'
  const s = t.match({ subjects: ['T'] }, text).spans
  assert.deepEqual(s.map(x => x.word), ['TCP/IP', 'TCP', 'tcp'])
  assert.deepEqual(t.hints({ subjects: ['T'] }, text).terms, ['TCP/IP', 'tcp'])
})

test('嵌套概念保留给语境判断，提示词保留完整短语和独立出现的子词', () => {
  const t = small(['信息', '信息不对称'])
  const m = t.match({ subjects: ['T'] }, '信息不对称。信息。')
  assert.equal(m.spans.filter(s => s.word === '信息').length, 2)
  assert.deepEqual(t.hints({ subjects: ['T'] }, '信息不对称。信息。').terms, ['信息不对称', '信息'])
})

test('候选受正文、学科和预算约束，来源频次不改变次序', () => {
  assert.equal(terms.hints({ title: '哲学' }, '没有相关术语。').terms.length, 0)
  assert.deepEqual(terms.hints({ title: '哲学' }, '主体间性与交往理性。', 1).terms, ['主体间性'])
  assert.deepEqual(terms.hints({ title: '哲学' }, '主体间性。', 0).terms, [])
  assert.deepEqual(terms.hints({ title: '哲学' }, '主体间性。', -1).terms, [])
  const t = small(['网络', '协议'])
  t.data.packs[0].entries[1][1] = 999999999
  assert.deepEqual(t.hints({ subjects: ['T'] }, '网络与协议。').terms, ['网络', '协议'])
})

test('超长词条保存在数据中但不进入短语候选，输入限长', () => {
  const t = small(['一'.repeat(13), '网络'])
  assert.deepEqual(t.hints({ subjects: ['T'] }, '一'.repeat(13)).terms, [])
  assert.deepEqual(t.hints({ subjects: ['T'] }, '。'.repeat(12000) + '网络').terms, [])
})

test('损坏数据拒绝加载，未知频次允许 null', () => {
  for (const d of [null, {}, { ...data, domains: [null] }, { ...data, domains: data.domains.slice(1) },
    { ...data, packs: [...data.packs, data.packs[0]] }]) assert.throws(() => parseTermData(d))
  for (const df of [-1, NaN, 0.5, '1']) assert.throws(() => parseTermData({
    ...data, packs: [{ id: 'bad', domains: ['T'], source: 'test', role: 'term', entries: [['网络', df]] }],
  }))
})
