// PDF → 电子书 (重排) 契约: 段落还原 (折行 ≠ 段落结束, 跨页续段, 中文折行不补空格) /
// 页眉页脚 / 标题 / 列表 / 代码 / 图表与表格 / 目录页 / 判定文字版与扫描版 / 切章与目录 / 页码锚点 /
// 打开方式; 最后用 MuPDF 生成真实 PDF 跑完整流程. 设计见 docs/plans/pdf-reflow.md.
// 运行: npm run test:pdf-reflow
import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as mupdfNs from 'mupdf'
import { joinSpans, layoutBook, lineText, tidySpans, findTables } from '../src/services/pdfReflow/layout.ts'
import { classifyPdf, canReflow } from '../src/services/pdfReflow/classify.ts'
import { anchorForPage, planBook } from '../src/services/pdfReflow/book.ts'
import { buildReflowFiles } from '../src/services/pdfReflow/epub.ts'
import { convertPdfToReflow, guessLanguage, ReflowEmptyError, renderFigure } from '../src/services/pdfReflow/convert.ts'
import { samplePdf } from '../src/services/pdfReflow/extract.ts'
import {
  cachedPdfKind, defaultPdfView, forgetPdfView, pdfOpenView, pdfViewChoice, setCachedPdfKind, setPdfViewChoice,
} from '../src/services/pdfReflow/viewMode.ts'

const mupdf = mupdfNs.default ?? mupdfNs

// ---- 合成页面 (单位 pt, 左上原点; 正文 10pt, 左边界 72, 右边界 523, 行距 15) ----

const LEFT = 72
const RIGHT = 523
/** 一行; 默认按每字 10pt 宽 (中文) 估算右端, 可用 x1 指定 */
function L(x0, y0, text, o = {}) {
  const size = o.size ?? 10
  const spans = o.spans ?? [{ text, ...(o.bold ? { bold: true } : {}), ...(o.mono ? { mono: true } : {}) }]
  return {
    x0, y0, x1: o.x1 ?? Math.min(RIGHT, x0 + [...text].length * size), y1: y0 + size, size, spans,
    mono: !!o.mono, bold: !!o.bold,
  }
}
const page = (index, lines, extra = {}) => ({ index, w: 595, h: 842, lines, vectors: extra.vectors ?? [], images: extra.images ?? [] })
const textOf = b => lineText(b)
/** 正文填充行: 让版式统计 (正文字号、行距、边界) 稳定 */
const filler = (y0, n, first = '填充正文') => Array.from({ length: n }, (_, i) =>
  L(i === 0 ? LEFT + 20 : LEFT, y0 + i * 15, `${first}${'这是用来撑满一整行的正文文字'.repeat(4)}`, { x1: i === n - 1 ? 300 : RIGHT }))

test('行内空白: 连续空白合一、去首尾; 行内的空格 (含中文之间) 保留, 等宽原样', () => {
  assert.equal(lineText({ spans: tidySpans([{ text: '第 2 章 上下文工程' }]) }), '第 2 章 上下文工程')
  assert.equal(lineText({ spans: tidySpans([{ text: '  调用 Agent  的工具 ' }]) }), '调用 Agent 的工具')
  const code = tidySpans([{ text: '    x =  1', mono: true }])
  assert.equal(code[0].text, '    x =  1')
})

test('接行: 中文不补空格, 西文补空格, 连字符断词还原', () => {
  const j = (a, b) => lineText({ spans: joinSpans([{ text: a }], [{ text: b }]) })
  assert.equal(j('两种核心范', '式，以及'), '两种核心范式，以及')
  assert.equal(j('parallel', 'units'), 'parallel units')
  assert.equal(j('de-', 'signed'), 'designed')
  assert.equal(j('Agent', '协作'), 'Agent协作')
  assert.equal(j('state-of-the-', 'Art'), 'state-of-the-Art')
})

test('段落还原: 满行折行接上、首行缩进与不满行分段 (微信读书把折行当段落结束)', () => {
  const lines = [
    L(LEFT + 20, 100, '第六章（Agent 的评估）构建一套科学的评估方法论。覆盖评估环境（工具调用型和人机交互型两种核心范', { x1: RIGHT }),
    L(LEFT, 115, '式，以及章末单独讨论的仿真环境）、数据集的设计原则、评估驱动的模型选型，以及将评估结果转化为系统', { x1: RIGHT + 6 }),
    L(LEFT, 130, '改进的完整闭环。', { x1: 230 }),
    L(LEFT + 20, 145, '第七章（模型后训练）深入监督微调与强化学习这两种后训练技术，以核心论点串起整章的内容与实验，', { x1: RIGHT }),
    L(LEFT, 160, '最后讨论数据与环境。', { x1: 250 }),
    ...filler(190, 6),
  ]
  const { blocks } = layoutBook([page(0, lines)])
  const paras = blocks.filter(b => b.kind === 'p')
  assert.ok(textOf(paras[0]).includes('两种核心范式，以及章末'), textOf(paras[0]))
  assert.ok(textOf(paras[0]).endsWith('完整闭环。'))
  assert.ok(textOf(paras[1]).startsWith('第七章'))
  assert.ok(textOf(paras[1]).endsWith('数据与环境。'))
})

test('跨页续段: 上页末行满行、下页首行不缩进 → 接成一段; 页眉页码去掉', () => {
  const head = i => L(250, 30, '深入理解 AI Agent', { size: 8, x1: 330 })
  const num = i => L(290, 810, String(i + 7), { size: 8, x1: 300 })
  const pages = [0, 1, 2].map(i => page(i, [
    head(i),
    ...filler(80, 5, `第${i}页`),
    ...(i === 0 ? [L(LEFT + 20, 160, '这一段从第一页开始写，一直写到页面的最底部还没有写完，最后一行写满了整整一行而且没有句号', { x1: RIGHT })] : []),
    ...(i === 1 ? [L(LEFT, 60, '于是接在第二页的开头继续写完。', { x1: 230 })] : []),
    num(i),
  ]))
  const { blocks } = layoutBook(pages)
  const all = blocks.map(textOf).join('\n')
  assert.ok(!all.includes('深入理解 AI Agent'), '页眉应去掉')
  assert.ok(!/^\d+$/m.test(all), '页码应去掉')
  const cont = blocks.find(b => textOf(b).includes('没有句号'))
  assert.ok(textOf(cont).endsWith('没有句号于是接在第二页的开头继续写完。'), textOf(cont))
  assert.equal(cont.page, 0)
})

test('标题: 大字号 → 标题; 独立的整行粗体短行 → 小标题; 冒号结尾的粗体引导语不是标题', () => {
  const lines = [
    L(LEFT, 60, '第 1 章 AI Agent 入门', { size: 18, x1: 260 }),
    ...filler(90, 4),
    L(LEFT, 170, '必需：阅读全书的基础', { bold: true, x1: 180 }),
    ...filler(190, 3),
    L(LEFT, 250, '模型返回工具调用请求：', { bold: true, x1: 190 }),
    ...filler(270, 3),
  ]
  const { blocks } = layoutBook([page(0, lines), page(1, [L(LEFT, 60, '第 2 章 上下文工程', { size: 18, x1: 240 }), ...filler(90, 4)])])
  const heads = blocks.filter(b => b.kind === 'h').map(textOf)
  assert.deepEqual(heads, ['第 1 章 AI Agent 入门', '必需：阅读全书的基础', '第 2 章 上下文工程'])
  assert.equal(blocks.find(b => textOf(b) === '第 1 章 AI Agent 入门').level, 1)
  assert.ok(blocks.find(b => b.kind === 'p' && textOf(b) === '模型返回工具调用请求：'))
})

test('列表: 小圆点位图 → 「• 」, 悬挂缩进的续行接在本项里', () => {
  const lines = [
    ...filler(60, 3),
    L(LEFT + 12, 120, '第一项写得很长很长一直写到这一行的末尾也没有写完的那种列表项的正文内容啊', { x1: RIGHT }),
    L(LEFT + 12, 135, '这是第一项的续行。', { x1: 220 }),
    L(LEFT + 12, 150, '第二项。', { x1: 140 }),
    ...filler(180, 3),
  ]
  const images = [{ x0: LEFT, y0: 123, x1: LEFT + 4, y1: 127 }, { x0: LEFT, y0: 153, x1: LEFT + 4, y1: 157 }]
  const { blocks } = layoutBook([page(0, lines, { images })])
  const items = blocks.filter(b => b.kind === 'li').map(textOf)
  assert.deepEqual(items, ['• 第一项写得很长很长一直写到这一行的末尾也没有写完的那种列表项的正文内容啊这是第一项的续行。', '• 第二项。'])
})

test('代码: 等宽行 → pre, 保留缩进与空行', () => {
  const lines = [
    ...filler(60, 3),
    L(LEFT + 10, 120, 'repeat:', { mono: true, size: 8, x1: 120 }),
    L(LEFT + 30, 135, 'context = build()', { mono: true, size: 8, x1: 200 }),
    L(LEFT + 30, 165, 'return answer', { mono: true, size: 8, x1: 180 }),
    ...filler(190, 3),
  ]
  const { blocks } = layoutBook([page(0, lines)])
  const pre = blocks.find(b => b.kind === 'pre')
  assert.ok(pre)
  const text = textOf(pre)
  assert.match(text, /^repeat:\n {3,5}context = build\(\)\n\n {3,5}return answer$/)
})

test('图表: 矢量方框 + 小字标签整块成图, 标签不进正文; 图注保留为图注', () => {
  const vectors = [
    { x0: 120, y0: 300, x1: 260, y1: 360, stroked: true },
    { x0: 300, y0: 300, x1: 450, y1: 360, stroked: true },
    { x0: 260, y0: 329, x1: 300, y1: 331, stroked: true },
  ]
  const lines = [
    ...filler(60, 5),
    L(150, 325, '上下文构造', { size: 6, x1: 180 }),
    L(330, 325, '工具执行接口', { size: 6, x1: 366 }),
    L(240, 375, '图 1-1 Agent 的三个组成部分', { size: 8, x1: 360 }),
    ...filler(410, 4),
  ]
  const { blocks } = layoutBook([page(0, lines, { vectors })])
  const fig = blocks.find(b => b.kind === 'figure')
  assert.ok(fig, '应有一张图')
  assert.ok(fig.rect.x0 <= 120 && fig.rect.x1 >= 450 && fig.rect.y0 <= 300 && fig.rect.y1 >= 360)
  const all = blocks.map(textOf).join('\n')
  assert.ok(!all.includes('上下文构造') && !all.includes('工具执行接口'), '图里的标签不应出现在正文')
  const cap = blocks.find(b => b.kind === 'caption')
  assert.equal(textOf(cap), '图 1-1 Agent 的三个组成部分')
  assert.ok(blocks.indexOf(cap) === blocks.indexOf(fig) + 1, '图注紧跟图')
})

test('代码框与提示框: 框里成段的文字照常重排, 不当成图', () => {
  const vectors = [{ x0: 60, y0: 115, x1: 535, y1: 175, stroked: false }]
  const lines = [
    ...filler(60, 3),
    L(LEFT, 120, 'def main():', { mono: true, x1: 140 }),
    L(LEFT + 20, 135, 'print("你好")  # 打招呼', { spans: [{ text: 'print("', mono: true }, { text: '你好' }, { text: '")  # 打招呼', mono: true }], x1: 260 }),
    L(LEFT, 150, 'main()', { mono: true, x1: 120 }),
    ...filler(200, 3),
  ]
  const { blocks } = layoutBook([page(0, lines, { vectors })])
  assert.ok(!blocks.some(b => b.kind === 'figure'))
  const pre = blocks.find(b => b.kind === 'pre')
  assert.ok(pre && textOf(pre).includes('你好'), '夹着中文的代码行也在代码块里')
})

test('表格: 多行多栏对齐的短文字识别为表格 (整块成图)', () => {
  const rows = [['直觉理解', '实现组件', '学术概念'], ['大脑', 'LLM', '策略'], ['眼睛', '上下文构造', '观察与历史'], ['手脚', '工具与适配', '动作接口']]
  const lines = rows.flatMap((r, i) => r.map((c, k) => L(LEFT + k * 150, 200 + i * 16, c, { x1: LEFT + k * 150 + c.length * 10 })))
  const m = { bodySize: 10, pitch: 15, indentStyle: true, headingSizes: [] }
  assert.equal(findTables(lines, m).length, 1)
  // 双栏正文不是表格
  const twoCol = Array.from({ length: 6 }, (_, i) => [L(LEFT, 100 + i * 15, '左栏正文'.repeat(5), { x1: 290 }), L(310, 100 + i * 15, '右栏正文'.repeat(5), { x1: RIGHT })]).flat()
  assert.equal(findTables(twoCol, m).length, 0)
})

test('目录页 (引导线 + 页码) 整页略过; 同一行被拆开的碎片接回一行', () => {
  const toc = page(0, [
    L(LEFT, 60, '目录', { size: 16, x1: 110 }),
    ...Array.from({ length: 8 }, (_, i) => L(LEFT, 90 + i * 15, `${i + 1}.1 某一节的标题 . . . . . . . . . . . . ${10 + i}`, { x1: RIGHT })),
  ])
  const body = page(1, [
    ...filler(60, 3),
    L(LEFT + 20, 120, '列表管理：借鉴', { x1: 180 }),
    L(193, 120, 'Manus', { x1: 222 }),
    L(235, 120, '的理念，提供', { x1: 300 }),
    L(312, 120, 'rewrite_todo_list', { mono: true, size: 9, x1: 400 }),
    L(410, 120, '工具。', { x1: 440 }),
    ...filler(150, 3),
  ])
  const { blocks } = layoutBook([toc, body])
  const all = blocks.map(textOf).join('\n')
  assert.ok(!all.includes('某一节的标题') && !all.includes('目录'), '目录页应略过')
  const p = blocks.find(b => textOf(b).startsWith('列表管理'))
  assert.equal(textOf(p), '列表管理：借鉴 Manus 的理念，提供 rewrite_todo_list 工具。')
  assert.ok(p.spans.some(s => s.mono && s.text.includes('rewrite_todo_list')), '行内代码保留等宽')
  assert.ok(!blocks.some(b => b.kind === 'pre'), '行内代码不单独成代码块')
})

test('判定: 文字版 / 扫描版 / 字少 (幻灯片) / 乱码 / 竖排 / 带文字层的扫描件', () => {
  const s = (perPage, o = {}) => ({ pages: 100, perPage, badChars: 0, verticalChars: 0, imagePages: 0, ...o })
  assert.equal(classifyPdf(s([1200, 980, 1500, 1100, 900, 1300])), 'text')
  assert.equal(classifyPdf(s([0, 0, 0, 0, 12, 0], { imagePages: 6 })), 'scan')
  assert.equal(classifyPdf(s([40, 35, 50, 20, 60, 30])), 'sparse')
  assert.equal(classifyPdf(s([1200, 1000, 900, 1100], { badChars: 400 })), 'garbled')
  assert.equal(classifyPdf(s([1200, 1000, 900, 1100], { verticalChars: 3000 })), 'vertical')
  assert.equal(classifyPdf(s([1200, 1000, 900, 1100, 800, 950], { imagePages: 6 })), 'image')
  assert.equal(classifyPdf(s([])), 'scan')
  assert.equal(canReflow('scan'), false)
  assert.equal(canReflow('sparse'), true)
})

test('切章与目录: 按一级书签切章, 书签层级定标题级别, 用书签的规整标题; 页码锚点可回退', () => {
  const blocks = [
    { kind: 'h', level: 3, size: 13, spans: [{ text: '引言' }], page: 0, y: 0.1 },
    { kind: 'p', spans: [{ text: '引言正文' }], page: 0, y: 0.2 },
    { kind: 'h', level: 3, size: 18, spans: [{ text: '第1 章AI Agent 入门' }], page: 2, y: 0.1 },
    { kind: 'h', level: 3, size: 14, spans: [{ text: '1.1 现代Agent' }], page: 2, y: 0.3 },
    { kind: 'p', spans: [{ text: '正文' }], page: 2, y: 0.4 },
    { kind: 'h', level: 3, size: 14, spans: [{ text: '1.2 未进书签的同级标题' }], page: 3, y: 0.1 },
    { kind: 'p', spans: [{ text: '第四页' }], page: 3, y: 0.5 },
    { kind: 'h', level: 3, size: 18, spans: [{ text: '第 2 章 上下文' }], page: 5, y: 0.1 },
  ]
  const outline = [
    { title: '引言', page: 0, children: [] },
    { title: '第 1 章 AI Agent 入门', page: 2, children: [{ title: '1.1 现代 Agent', page: 2, children: [] }] },
    { title: '第 2 章 上下文', page: 5, children: [] },
  ]
  const plan = planBook(blocks, outline, 6, '书名')
  assert.deepEqual(plan.chapters.map(c => [c.title, c.start, c.end]), [['引言', 0, 2], ['第 1 章 AI Agent 入门', 2, 7], ['第 2 章 上下文', 7, 8]])
  assert.equal(plan.toc[1].label, '第 1 章 AI Agent 入门')
  assert.equal(plan.toc[1].children[0].href, 'Text/c002.xhtml#b3')
  assert.equal(textOf(blocks[2]), '第 1 章 AI Agent 入门', '标题用书签文字')
  assert.equal(blocks[2].level, 1)
  assert.equal(blocks[3].level, 2)
  assert.equal(blocks[5].level, 2, '同字号的标题跟着书签级别')
  // 锚点: 第 4 页 (下标 3) 下半页 → 第四页那段; 没有块的第 5 页 → 前一页最后一块
  assert.equal(anchorForPage(plan.anchors, 3, 0.6), 'Text/c002.xhtml#b6')
  assert.equal(anchorForPage(plan.anchors, 3, 0), 'Text/c002.xhtml#b5')
  assert.equal(anchorForPage(plan.anchors, 4, 0), 'Text/c002.xhtml#b6')
  assert.equal(anchorForPage(plan.anchors, 99), 'Text/c003.xhtml#b7')
})

test('没有书签: 按一级标题切章, 目录取一、二级标题', () => {
  const blocks = [
    { kind: 'h', level: 1, spans: [{ text: 'Chapter One' }], page: 0, y: 0.1 },
    { kind: 'h', level: 2, spans: [{ text: 'Section A' }], page: 0, y: 0.2 },
    { kind: 'p', spans: [{ text: 'text' }], page: 0, y: 0.3 },
    { kind: 'h', level: 1, spans: [{ text: 'Chapter Two' }], page: 1, y: 0.1 },
  ]
  const plan = planBook(blocks, [], 2, 'Book')
  assert.equal(plan.chapters.length, 2)
  assert.deepEqual(plan.toc.map(t => [t.label, t.children.map(c => c.label)]), [['Chapter One', ['Section A']], ['Chapter Two', []]])
})

test('EPUB 文件: 良构 XHTML, 块带 data-p / data-y, 图表按需渲染的引用, 生成结果确定', () => {
  const blocks = [
    { kind: 'h', level: 1, spans: [{ text: '第一章 <开始> & 结束' }], page: 0, y: 0.1 },
    { kind: 'p', spans: [{ text: '正文 ' }, { text: 'Agent', bold: true }, { text: ' 与 ' }, { text: 'code()', mono: true }], page: 0, y: 0.2 },
    { kind: 'figure', spans: [], page: 1, y: 0.3, rect: { x0: 10, y0: 20, x1: 200, y1: 220 } },
    { kind: 'caption', spans: [{ text: '图 1 示意' }], page: 1, y: 0.6 },
    { kind: 'pre', spans: [{ text: 'a < b\n  c', mono: true }], page: 1, y: 0.7 },
    { kind: 'li', spans: [{ text: '• 一项' }], page: 1, y: 0.8, quote: true },
  ]
  const plan = planBook(blocks, [], 2, '书')
  const o = { identifier: 'urn:x', title: '书', author: '作者', language: 'zh', indentStyle: true }
  const a = buildReflowFiles(blocks, plan, o)
  const b = buildReflowFiles(blocks, plan, o)
  assert.equal(JSON.stringify(a), JSON.stringify(b), '同样输入生成同样的包')
  const html = a.files['OEBPS/Text/c001.xhtml']
  assert.match(html, /<h1 id="b0" data-p="0" data-y="0.1">第一章 &lt;开始&gt; &amp; 结束<\/h1>/)
  assert.match(html, /<b>Agent<\/b> 与 <code>code\(\)<\/code>/)
  assert.match(html, /<figure id="b2" data-p="1" data-y="0.3"><img src="..\/Images\/f2.png" alt=""\/><\/figure>/)
  assert.match(html, /<p id="b3"[^>]* class="caption">图 1 示意<\/p>/)
  assert.match(html, /<pre id="b4"[^>]*><code>a &lt; b\n {2}c<\/code><\/pre>/)
  assert.match(html, /class="li quote"/)
  assert.deepEqual(a.figures['OEBPS/Images/f2.png'], { page: 1, rect: { x0: 10, y0: 20, x1: 200, y1: 220 }, raster: false })
  assert.match(a.files['OEBPS/content.opf'], /href="Images\/f2.png" media-type="image\/png"/)
  // 标签配对
  const stack = []
  for (const m of html.replace(/<\?xml[^>]*\?>|<!DOCTYPE[^>]*>/g, '').matchAll(/<(\/?)([a-zA-Z0-9]+)[^>]*?(\/?)>/g)) {
    if (m[3]) continue
    if (m[1]) assert.equal(stack.pop(), m[2])
    else stack.push(m[2])
  }
  assert.equal(stack.length, 0)
  assert.equal(guessLanguage(blocks), 'zh')
})

test('打开方式: 文字版默认电子书, 扫描版 / 论文 / 「总是原版」用原版, 手动切换优先且按书记住', () => {
  const mem = new Map()
  const kv = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) }
  const book = { id: 'b1', kind: 'book' }
  assert.equal(pdfOpenView(book, 'auto', kv), undefined, '没判定过: 先抽样')
  setCachedPdfKind('b1', 'text', kv)
  assert.equal(cachedPdfKind('b1', kv), 'text')
  assert.equal(pdfOpenView(book, 'auto', kv), 'reflow')
  assert.equal(pdfOpenView(book, 'original', kv), 'original')
  assert.equal(pdfOpenView({ id: 'b1', kind: 'paper' }, 'auto', kv), 'original')
  setPdfViewChoice('b1', 'original', kv)
  assert.equal(pdfOpenView(book, 'auto', kv), 'original', '手动选择优先')
  setPdfViewChoice('b1', 'reflow', kv)
  assert.equal(pdfOpenView({ id: 'b1', kind: 'paper' }, 'original', kv), 'reflow', '论文也能手动切到电子书')
  assert.equal(defaultPdfView(book, 'auto', 'scan'), 'original')
  assert.equal(defaultPdfView(book, 'auto', 'sparse'), 'original')
  mem.set('lightread-pdf-kind:b2', 'v0:text')
  assert.equal(cachedPdfKind('b2', kv), undefined, '旧版判定结果作废')
  forgetPdfView('b1', kv)
  assert.equal(pdfViewChoice('b1', kv), undefined)
})

// ---- 用 MuPDF 生成真实 PDF, 跑完整流程 ----

const STROKE = { lineCap: 'Butt', lineJoin: 'Miter', lineWidth: 1, miterLimit: 10, dashCap: 'Butt', startCap: 'Butt', endCap: 'Butt' }

/** 两端对齐排一段西文: 非末行把空隙摊开到正好写满栏宽 */
function justify(font, size, words, x0, x1, firstIndent) {
  const width = w => [...w].reduce((n, c) => n + font.advanceGlyph(font.encodeCharacter(c.codePointAt(0)), 0) * size, 0)
  const space = width(' ')
  const lines = []
  let cur = []
  let curW = 0
  for (const w of words) {
    const avail = x1 - x0 - (lines.length === 0 ? firstIndent : 0)
    const need = curW + (cur.length ? space : 0) + width(w)
    if (cur.length && need > avail) {
      lines.push(cur)
      cur = [w]
      curW = width(w)
    } else {
      cur.push(w)
      curW = need
    }
  }
  if (cur.length) lines.push(cur)
  return lines.map((ws, i) => {
    const start = x0 + (i === 0 ? firstIndent : 0)
    const last = i === lines.length - 1
    const natural = ws.reduce((n, w) => n + width(w), 0)
    const gap = last || ws.length < 2 ? space : (x1 - start - natural) / (ws.length - 1)
    let x = start
    return ws.map(w => {
      const at = x
      x += width(w) + gap
      return { text: w, x: at }
    })
  })
}

function makePdf(pages) {
  const buf = new mupdf.Buffer()
  const writer = new mupdf.DocumentWriter(buf, 'pdf', '')
  for (const draw of pages) {
    const dev = writer.beginPage([0, 0, 595, 842])
    draw(dev)
    writer.endPage()
  }
  writer.close()
  return buf.asUint8Array()
}

function show(dev, font, size, items) {
  const text = new mupdf.Text()
  for (const { text: s, x, y } of items) text.showString(font, [size, 0, 0, -size, x, y], s)
  dev.fillText(text, mupdf.Matrix.identity, mupdf.ColorSpace.DeviceGray, [0], 1)
}

const LOREM = 'Graphical processing units were originally designed for real time image synthesis which requires highly parallel architectures that happen to be well suited for deep models and their training at scale'.split(' ')

test('真实 PDF: 页眉页码去掉, 两端对齐的折行接成段落, 跨页续段, 标题与图; 判定为文字版', async () => {
  const times = new mupdf.Font('Times-Roman')
  const bold = new mupdf.Font('Times-Bold')
  const size = 11
  const pitch = 15
  const para = (y, words, indent = 18) => justify(times, size, words, LEFT, RIGHT, indent).map((ws, i) => ws.map(w => ({ ...w, y: y + i * pitch })))
  const pages = [0, 1, 2].map(p => dev => {
    show(dev, times, 8, [{ text: 'The Little Book', x: 260, y: 40 }])
    show(dev, times, 8, [{ text: String(p + 1), x: 295, y: 812 }])
    let y = 90
    if (p === 0) {
      show(dev, bold, 20, [{ text: 'Chapter', x: LEFT, y }, { text: 'One', x: LEFT + 75, y }])
      y += 40
    }
    for (let k = 0; k < 4; k++) {
      const words = [...LOREM, ...LOREM].slice(k * 3, k * 3 + 50 + (p === 0 && k === 3 ? 12 : 0))
      let lines = para(y, words)
      // 第一页最后一段: 写到页底且末行写满, 余下的接在第二页开头
      if (p === 0 && k === 3) {
        y = 700
        lines = para(y, words)
        const keep = lines.slice(0, -1)
        for (const ln of keep) show(dev, times, size, ln)
        break
      }
      for (const ln of lines) show(dev, times, size, ln)
      y += lines.length * pitch + 12
      if (p === 1 && k === 1) {
        const path = new mupdf.Path()
        path.rect(150, y, 450, y + 120)
        dev.strokePath(path, new mupdf.StrokeState(STROKE), mupdf.Matrix.identity, mupdf.ColorSpace.DeviceGray, [0], 1)
        show(dev, times, 6, [{ text: 'input', x: 170, y: y + 40 }, { text: 'output', x: 400, y: y + 40 }])
        show(dev, times, 8, [{ text: 'Figure 1.1 A tiny diagram', x: 240, y: y + 135 }])
        y += 160
      }
    }
    if (p === 1) {
      // 接上一页没写完的那段: 不缩进
      show(dev, times, size, [{ text: 'continued', x: LEFT, y: 60 }, { text: 'here.', x: LEFT + 48, y: 60 }])
    }
  })
  const bytes = makePdf(pages)
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf')
  assert.equal(classifyPdf(samplePdf(doc)), 'text')
  const pkg = await convertPdfToReflow(mupdf, bytes, { bookId: 't', title: 'Little', author: 'A' })
  assert.equal(pkg.language, 'en')
  const html = Object.entries(pkg.files).filter(([k]) => /Text\/c\d+\.xhtml$/.test(k)).map(([, v]) => v).join('\n')
  assert.ok(!html.includes('The Little Book'), '页眉应去掉')
  assert.match(html, /<h1[^>]*>Chapter One<\/h1>/)
  const paras = [...html.matchAll(/<p [^>]*>([^<]*)<\/p>/g)].map(m => m[1])
  assert.ok(paras.length >= 10, `段落数 ${paras.length}`)
  assert.ok(paras.every(t => !/\bunits were\b/.test(t) || t.split(' ').length > 30), '段落没有在折行处断开')
  assert.ok(paras.some(t => t.endsWith('continued here.') && t.split(' ').length > 40), '跨页续段接上')
  assert.ok(!html.includes('>input<') && !html.includes('>output<'), '图里的标签不进正文')
  const figs = Object.entries(pkg.figures)
  assert.equal(figs.length, 1)
  assert.match(html, /class="caption">Figure 1.1 A tiny diagram</)
  const png = renderFigure(mupdf, doc, figs[0][1])
  assert.deepEqual([...png.slice(1, 4)], [80, 78, 71], 'PNG')
  // 锚点: 第二页开头的续段落在第一页那段上
  assert.ok(anchorForPage(pkg.anchors, 1, 0))
})

test('真实 PDF: 只有几个字的页面判为字少, 转换报没有可重排的文字', async () => {
  const times = new mupdf.Font('Helvetica')
  const bytes = makePdf([0, 1, 2, 3].map(i => dev => show(dev, times, 24, [{ text: `Hello LightRead PDF ${i + 1}`, x: 100, y: 120 }])))
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf')
  assert.equal(classifyPdf(samplePdf(doc)), 'sparse')
  await assert.rejects(convertPdfToReflow(mupdf, bytes, { bookId: 't', title: 'x', author: '' }), ReflowEmptyError)
})
