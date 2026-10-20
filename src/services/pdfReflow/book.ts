/**
 * 块序列 → 章节文件 + 目录 + 页码锚点 (纯函数).
 *  - 有书签: 按一级书签切章, 目录照书签层级 (标题去掉多余空白)
 *  - 没书签: 按一级标题切章, 目录取一、二级标题
 *  - 单章过大时在标题处再切, 保证 foliate 分节加载顺畅
 * 每个块有稳定 id (b序号), 页码锚点记下每页各块的位置, 供原版 ⇄ 电子书互切时对齐到段.
 */
import { lineText } from './layout.ts'
import type { Block, OutlineNode } from './types.ts'

export interface ChapterOut {
  title: string
  /** 章节文件名 (相对 OPF), 如 Text/c003.xhtml */
  href: string
  /** 块在全书块序列里的下标区间 [start, end) */
  start: number
  end: number
}

export interface TocOut {
  label: string
  href: string
  children: TocOut[]
}

/** 页码锚点: anchors[页] = 该页起始的各块 [页内 y 比例, href#id] */
export type PageAnchors = Array<Array<[number, string]>>

export const blockId = (i: number) => `b${i}`

const norm = (s: string) => s.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase()

const blockText = (b: Block) => lineText(b)

/** 章节最多字数, 超过时在下一个标题处切开 */
const SOFT_CHARS = 60_000
/** 超过这么多字就在任意块处切开 */
const HARD_CHARS = 150_000

function matchHeading(blocks: Block[], title: string, page: number | undefined, from = 0): number {
  if (page === undefined) return -1
  const t = norm(title)
  if (t.length < 2) return -1
  for (let i = from; i < blocks.length; i++) {
    const b = blocks[i]
    if (b.page < page) continue
    if (b.page > page + 1) break
    if (b.kind !== 'h' && b.kind !== 'p') continue
    const h = norm(blockText(b))
    if (h && (h === t || (h.length >= 2 && (h.includes(t) || t.includes(h))))) return i
  }
  return -1
}

function firstOnPage(blocks: Block[], page: number): number {
  const i = blocks.findIndex(b => b.page >= page)
  return i < 0 ? blocks.length : i
}

/**
 * 书签 / 标题 → 每个目录项落在哪个块.
 * 顺带按书签层级校正标题级别 (会改写 blocks): 对上书签的块定为该层级的标题,
 * 同字号的其它标题跟着用这个级别.
 */
function outlineTargets(blocks: Block[], outline: OutlineNode[]): Map<OutlineNode, number> {
  const out = new Map<OutlineNode, number>()
  const bySize = new Map<number, number[]>()
  const walk = (nodes: OutlineNode[], depth: number) => {
    for (const n of nodes) {
      if (n.page !== undefined) {
        const hit = matchHeading(blocks, n.title, n.page)
        out.set(n, hit >= 0 ? hit : firstOnPage(blocks, n.page))
        if (hit >= 0) {
          const b = blocks[hit]
          const level = Math.min(3, depth + 1)
          if (b.kind === 'h' || norm(blockText(b)) === norm(n.title)) {
            // 书签标题的空格更规整 (「第 1 章 AI Agent 入门」), 文字一致时用它
            if (n.title && norm(blockText(b)) === norm(n.title)) {
              b.spans = [{ text: n.title, ...(b.spans.every(sp => sp.bold || !sp.text.trim()) ? { bold: true } : {}) }]
            }
            b.kind = 'h'
            b.level = level
            if (b.size) {
              const k = Math.round(b.size * 2) / 2
              bySize.set(k, [...(bySize.get(k) ?? []), level])
            }
          }
        }
      }
      walk(n.children, depth + 1)
    }
  }
  walk(outline, 0)
  if (bySize.size) {
    const levelOf = new Map([...bySize].map(([k, ls]) => [k, Math.round(ls.reduce((a, b) => a + b, 0) / ls.length)]))
    const matched = new Set(out.values())
    blocks.forEach((b, i) => {
      if (b.kind !== 'h' || matched.has(i) || !b.size) return
      const level = levelOf.get(Math.round(b.size * 2) / 2)
      if (level) b.level = level
      // 比书签里最深一级还小的字号: 放到最低一级
      else if (Math.max(...levelOf.keys()) > b.size) b.level = 3
    })
  }
  return out
}

export interface BookPlan {
  chapters: ChapterOut[]
  toc: TocOut[]
  anchors: PageAnchors
}

export function planBook(blocks: Block[], outline: OutlineNode[], pageCount: number, fallbackTitle: string): BookPlan {
  const targets = outlineTargets(blocks, outline)
  // 切章点: 一级书签 (至少两个); 否则一级标题
  let cuts: Array<{ at: number; title: string }> = []
  const top = outline.filter(n => targets.has(n))
  if (top.length >= 2) {
    cuts = top.map(n => ({ at: targets.get(n)!, title: n.title }))
  } else {
    const minLevel = Math.min(...blocks.filter(b => b.kind === 'h').map(b => b.level ?? 3), 9)
    cuts = blocks
      .map((b, at) => ({ b, at }))
      .filter(({ b }) => b.kind === 'h' && (b.level ?? 3) === minLevel)
      .map(({ b, at }) => ({ at, title: blockText(b) }))
  }
  cuts = cuts.filter(c => c.at < blocks.length).sort((a, b) => a.at - b.at)
  const starts: Array<{ at: number; title: string }> = []
  if (!cuts.length || cuts[0].at > 0) starts.push({ at: 0, title: cuts.length ? '' : fallbackTitle })
  for (const c of cuts) {
    if (starts.length && starts[starts.length - 1].at === c.at) starts[starts.length - 1].title ||= c.title
    else starts.push(c)
  }

  // 大章再切
  const ranges: Array<{ start: number; end: number; title: string }> = []
  for (let k = 0; k < starts.length; k++) {
    const end = k + 1 < starts.length ? starts[k + 1].at : blocks.length
    let s = starts[k].at
    let chars = 0
    let title = starts[k].title
    for (let i = s; i < end; i++) {
      const len = blockText(blocks[i]).length + (blocks[i].kind === 'figure' ? 200 : 0)
      if (i > s && ((chars > SOFT_CHARS && blocks[i].kind === 'h') || chars > HARD_CHARS)) {
        ranges.push({ start: s, end: i, title })
        s = i
        chars = 0
        title = ''
      }
      chars += len
    }
    if (end > s || !ranges.length) ranges.push({ start: s, end: Math.max(end, s), title })
  }

  const chapters: ChapterOut[] = ranges.map((r, i) => ({
    title: r.title || fallbackTitle,
    href: `Text/c${String(i + 1).padStart(3, '0')}.xhtml`,
    start: r.start,
    end: r.end,
  }))
  const hrefOfBlock = (i: number) => {
    const ch = chapters.find(c => i >= c.start && i < c.end) ?? chapters[chapters.length - 1]
    return i >= ch.start && i < ch.end ? `${ch.href}#${blockId(i)}` : ch.href
  }

  let toc: TocOut[]
  if (top.length >= 1 && targets.size) {
    const walk = (nodes: OutlineNode[]): TocOut[] => nodes.flatMap(n => {
      const children = walk(n.children)
      const at = targets.get(n)
      if (at === undefined) return children
      return [{ label: n.title || fallbackTitle, href: hrefOfBlock(Math.min(at, blocks.length - 1)), children }]
    })
    toc = walk(outline)
  } else {
    // 没书签: 一、二级标题
    const heads = blocks.map((b, i) => ({ b, i })).filter(({ b }) => b.kind === 'h')
    const levels = [...new Set(heads.map(h => h.b.level ?? 3))].sort((a, b) => a - b).slice(0, 2)
    toc = []
    for (const { b, i } of heads) {
      if (!levels.includes(b.level ?? 3)) continue
      const node: TocOut = { label: blockText(b).slice(0, 120), href: hrefOfBlock(i), children: [] }
      if ((b.level ?? 3) === levels[0] || !toc.length) toc.push(node)
      else toc[toc.length - 1].children.push(node)
    }
    if (!toc.length) toc = chapters.map(c => ({ label: c.title, href: c.href, children: [] }))
  }

  const anchors: PageAnchors = Array.from({ length: pageCount }, () => [])
  blocks.forEach((b, i) => {
    if (b.page >= 0 && b.page < pageCount) anchors[b.page].push([Math.round(b.y * 1000) / 1000, hrefOfBlock(i)])
  })
  return { chapters, toc, anchors }
}

/** 原版某页某处 → 电子书里对应的块 (那页没有块时取前面最近一页的最后一块) */
export function anchorForPage(anchors: PageAnchors, page: number, y = 0): string | undefined {
  const p = Math.min(Math.max(0, page), anchors.length - 1)
  const here = anchors[p] ?? []
  if (here.length) {
    let best = here[0]
    for (const a of here) if (a[0] <= y + 0.02) best = a
    return best[1]
  }
  for (let q = p - 1; q >= 0; q--) if (anchors[q]?.length) return anchors[q][anchors[q].length - 1][1]
  for (let q = p + 1; q < anchors.length; q++) if (anchors[q]?.length) return anchors[q][0][1]
  return undefined
}
