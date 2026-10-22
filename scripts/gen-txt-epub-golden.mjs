// 生成 src-tauri/src/testdata/txt-epub-golden.json: 用前端 convertToEpub (TXT 正文分支) 的真实输出作为
// Rust 原生实现 (src-tauri/src/txt_epub.rs) 的逐文件期望。改了 textToEpub / txtParagraphs / smartToc 的
// TXT 规则后重跑, 再跑 `cargo test --manifest-path src-tauri/Cargo.toml txt_epub` 确认两边一致。
//
//   npx vite --port 5180 --strictPort &   # 本脚本经开发服务器加载 TS 源码
//   node scripts/gen-txt-epub-golden.mjs
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'

const BASE = process.env.GOLDEN_BASE ?? 'http://127.0.0.1:5180'
const utf8 = s => Buffer.from(s, 'utf8').toString('base64')

const para = '夜色像一块浸了水的墨布，慢慢压下来。他把灯芯挑亮了一点。'
const gutenberg = Array.from({ length: 40 }, (_, i) =>
  (i % 5 === 4 ? '' : 'It was the best of times, it was the worst of times, it was the age of wisdom,'),
).join('\n')

const cases = [
  ['带序言与章节.txt', utf8(`作者的话\n\n  欢迎阅读。\n第一章 风起\n${para}\n\n${para}\n第二章 云涌\n${para}\n第 12 节 小节\n内容\n序章之后的故事很长很长很长\n`)],
  ['无章节分块.txt', utf8(Array.from({ length: 650 }, (_, i) => `第${i}段 ${para}`.replace(/^第/, '段')).join('\n'))],
  ['hard-wrapped.txt', utf8(`Chapter I\n${gutenberg}\nChapter II\n${gutenberg}\nPART 3 Finale\n${gutenberg}`)],
  ['gbk.txt', 'tdrSu9XCIL+qyrwNCqGhoaHV4srH08NHQkux4MLrtcTV/c7Eo6yy4srUu9jNy73iwuuhow0Ktdq2/tXCILzM0PgNCqGhoaG12rb+ts7E2sjdoaMNCg=='],
  ['utf16.txt', '//6PXuB6CgAAMAAwVQBUAEYALQAxADYAIABja4dlCgBqdRZZx3syABr/DlRlZwoAhVG5Ww=='],
  ['换行与空白.txt', utf8(`﻿楔子\r\n　　全角缩进段\r旧 Mac 换行\r\n\u0085不是空白\n﻿　混合空白　\n尾声 - 完\n终`)],
  ['长章节多分节.txt', utf8(Array.from({ length: 3 }, (_, i) => `第${i + 1}章 长${'😀'.repeat(20)}\n${`${para}😀\n`.repeat(700)}`).join(''))],
  ['特殊标题.txt', utf8(`序章\n开场\n番外篇2：后来\n番外\nChapter IV The End\n结束\n第一章${'字'.repeat(41)}\n不是标题\n前言后语\n也不是`)],
  ['空.txt', ''],
  ['a.b 我的书.txt', utf8('第一章 a&b <c> "d"\n\'quote\' & <tag>')],
]

const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto(BASE)
const out = await page.evaluate(async cases => {
  const { convertToEpub } = await import('/src/services/textToEpub.ts')
  const { unzipSync, strFromU8 } = await import('/node_modules/fflate/esm/browser.js')
  const result = []
  for (const [fileName, b64] of cases) {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
    const { epub } = await convertToEpub(new Blob([bytes]), fileName, 'txt')
    const files = unzipSync(new Uint8Array(await epub.arrayBuffer()))
    result.push({ fileName, inputBase64: b64, entries: Object.entries(files).map(([n, d]) => [n, strFromU8(d)]) })
  }
  return result
}, cases)
await browser.close()
writeFileSync('src-tauri/src/testdata/txt-epub-golden.json', JSON.stringify({
  note: 'scripts/gen-txt-epub-golden.mjs 生成; 前端 convertToEpub (TXT 正文) 的真实输出',
  cases: out,
}, null, 1) + '\n')
console.log(`wrote ${out.length} cases: ${out.map(c => `${c.fileName}(${c.entries.length})`).join(', ')}`)
