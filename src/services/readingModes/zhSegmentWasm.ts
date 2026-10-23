/**
 * 中文分词核心 cutHan 的 Rust 实现 (wasm/zh-segment, 编译为 src/wasm/zh_segment.wasm, 26 KB)。
 * 页面 (仿生阅读) 与重点词 Worker 各自调用 installZhSegmentWasm(); 之后 zhSegment.cutHan 走 wasm,
 * 失败或未安装时自动用 JS 实现。词表按对象缓存到 wasm 里 (代价由 JS 算好传入, 浮点结果与 JS 逐位一致)。
 * 本模块不依赖 DOM, node 测试可用 makeWasmCut 直接接 WebAssembly 实例。
 */
import { setFastCutHan, type CutHanImpl, type ZhLexicon } from './zhSegment.ts'

interface Exports {
  memory: WebAssembly.Memory
  alloc(n: number): number
  dealloc(ptr: number, n: number): void
  lex_build(words: number, wordsLen: number, lens: number, costs: number, n: number, maxLen: number, unk: number): number
  lex_free(h: number): void
  cut(h: number, run: number, len: number, margin: number, outEnds: number, outUnsure: number): number
}

/** 由 wasm 实例构造 cutHan 实现 */
export function makeWasmCut(instance: WebAssembly.Instance): CutHanImpl {
  const x = instance.exports as unknown as Exports
  const handles = new WeakMap<ZhLexicon, number>()
  const registry = typeof FinalizationRegistry === 'undefined' ? null : new FinalizationRegistry<number>(h => x.lex_free(h))
  // 每次调用复用的暂存区 (按需扩大)
  let scratch = 0
  let scratchSize = 0
  const ensure = (bytes: number) => {
    if (bytes <= scratchSize) return scratch
    if (scratch) x.dealloc(scratch, scratchSize)
    scratchSize = Math.max(bytes, scratchSize * 2, 4096)
    scratch = x.alloc(scratchSize)
    return scratch
  }

  const handleOf = (lex: ZhLexicon): number => {
    const known = handles.get(lex)
    if (known !== undefined) return known
    let units = 0
    for (const w of lex.cost.keys()) units += w.length
    const n = lex.cost.size
    const wordsBytes = units * 2
    const pW = x.alloc(wordsBytes)
    const pL = x.alloc(n)
    const pC = x.alloc(n * 8)
    const words = new Uint16Array(x.memory.buffer, pW, units)
    const lens = new Uint8Array(x.memory.buffer, pL, n)
    const costs = new Float64Array(x.memory.buffer, pC, n)
    let at = 0
    let i = 0
    for (const [w, c] of lex.cost) {
      for (let k = 0; k < w.length; k++) words[at + k] = w.charCodeAt(k)
      at += w.length
      lens[i] = w.length
      costs[i] = c
      i++
    }
    const h = x.lex_build(pW, units, pL, pC, n, lex.maxLen, lex.unk)
    x.dealloc(pW, wordsBytes)
    x.dealloc(pL, n)
    x.dealloc(pC, n * 8)
    handles.set(lex, h)
    registry?.register(lex, h)
    return h
  }

  return (run, lex, margin) => {
    const n = run.length
    const h = handleOf(lex)
    // 布局: run (u16) | ends (u32, 8 字节对齐) | unsure (u8)
    const endsOff = Math.ceil((n * 2) / 8) * 8
    const unsureOff = endsOff + n * 4
    const base = ensure(unsureOff + n)
    const runView = new Uint16Array(x.memory.buffer, base, n)
    for (let k = 0; k < n; k++) runView[k] = run.charCodeAt(k)
    const count = x.cut(h, base, n, margin === null ? NaN : margin, base + endsOff, base + unsureOff)
    if (count === 0xffffffff) return null
    const ends = Array.from(new Uint32Array(x.memory.buffer, base + endsOff, count))
    const flags = new Uint8Array(x.memory.buffer, base + unsureOff, count)
    const unsure = Array.from(flags, f => f === 1)
    return { ends, unsure }
  }
}

let installing: Promise<boolean> | null = null

/** 下载并安装 wasm 实现; 失败时保持 JS 实现 (返回 false) */
export function installZhSegmentWasm(): Promise<boolean> {
  installing ??= (async () => {
    try {
      if (typeof WebAssembly === 'undefined') return false
      const url = new URL('../../wasm/zh_segment.wasm', import.meta.url)
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { instance } = await WebAssembly.instantiate(await res.arrayBuffer(), {})
      setFastCutHan(makeWasmCut(instance))
      return true
    } catch (e) {
      console.warn('zh segment wasm unavailable, using JS', e)
      return false
    }
  })()
  return installing
}
