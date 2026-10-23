// 中文分词核心 cutHan: Rust (wasm/zh-segment → src/wasm/zh_segment.wasm) 与 JS 实现逐位一致 + 速度对比。
// 语料: 仓库里的中文文档 + 词表词的随机拼接 (含代理对), 三种歧义阈值。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { cutHanJs, parseZhLexicon, segmentZh, setFastCutHan, splitRuns } from '../src/services/readingModes/zhSegment.ts'
import { buildStats, scoreTypes, tokenizePara } from '../src/services/readingModes/keyWords.ts'
import { makeWasmCut } from '../src/services/readingModes/zhSegmentWasm.ts'

const lex = parseZhLexicon(readFileSync('src/data/zh-lexicon.txt', 'utf8'))
const { instance } = await WebAssembly.instantiate(readFileSync('src/wasm/zh_segment.wasm'), {})
const wasmCut = makeWasmCut(instance)

function corpus() {
  const runs = []
  const walk = dir => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.md')) for (const r of splitRuns(readFileSync(p, 'utf8'))) if (r.kind === 'han' && r.text.length > 1) runs.push(r.text)
    }
  }
  walk('docs')
  // 随机拼接词表词 (固定种子), 夹杂扩展区汉字 (代理对) 与未登录字
  const words = [...lex.cost.keys()]
  let seed = 42
  const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n }
  for (let i = 0; i < 3000; i++) {
    let s = ''
    for (let k = 0, len = 2 + rnd(12); k < len; k++) s += rnd(15) === 0 ? '𠀀' : words[rnd(words.length)]
    runs.push(s)
  }
  return runs
}

const runs = corpus()

test('wasm cutHan matches JS on every run and margin', () => {
  assert.ok(runs.length > 5000, `语料太少: ${runs.length}`)
  for (const margin of [2, 0.5, null]) {
    for (const run of runs) {
      assert.deepEqual(wasmCut(run, lex, margin), cutHanJs(run, lex, margin), `margin=${margin} run=${run.slice(0, 30)}`)
    }
  }
})

test('wasm is at least not slower than JS (informational timing)', () => {
  const time = f => { const t = performance.now(); for (const r of runs) f(r, lex, 2); return performance.now() - t }
  time(cutHanJs); time(wasmCut) // 预热
  const js = time(cutHanJs)
  const wasm = time(wasmCut)
  const chars = runs.reduce((n, r) => n + r.length, 0)
  console.log(`  ${runs.length} 段 / ${chars} 字: JS ${js.toFixed(1)} ms, wasm ${wasm.toFixed(1)} ms (${(js / wasm).toFixed(2)}×)`)
})

test('whole pipeline (segmentZh, tokenizer, book stats, scores) is unchanged with wasm installed', () => {
  // 章节: 中文文档按文件分节、按段落切
  const sections = []
  for (const f of readdirSync('docs').filter(n => n.endsWith('.md')).sort()) {
    const paras = readFileSync(join('docs', f), 'utf8').split(/\n+/).filter(p => /\p{Script=Han}/u.test(p))
    if (paras.length) sections.push({ section: sections.length, paras })
  }
  assert.ok(sections.length >= 5)
  const run = () => {
    const segs = sections.flatMap(s => s.paras.map(p => segmentZh(p, lex)))
    const toks = sections.flatMap(s => s.paras.map(p => tokenizePara(p, lex)))
    const stats = buildStats(sections, lex)
    const scores = [...scoreTypes(stats).entries()]
    return JSON.stringify({ segs, toks, newWords: [...stats.newWords?.entries?.() ?? []], scores })
  }
  setFastCutHan(null)
  const js = run()
  setFastCutHan(wasmCut)
  const viaWasm = run()
  setFastCutHan(null)
  assert.equal(viaWasm, js)
})
