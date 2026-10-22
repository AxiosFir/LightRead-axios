// 生成 src-tauri/src/testdata/epub-meta-golden.json: 用 foliate-js (makeFoliateBook) + importer 的 flattenMeta
// 对一组刻意覆盖各种写法的 EPUB 取元数据, 作为原生实现 (src-tauri/src/epub_meta.rs) 的期望。
// 升级 foliate-js 或改 importer 取元数据的规则后重跑, 再跑 `cargo test --manifest-path src-tauri/Cargo.toml epub_meta`。
//
//   npx vite --port 5180 --strictPort &
//   node scripts/gen-epub-meta-golden.mjs
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'

const BASE = process.env.GOLDEN_BASE ?? 'http://127.0.0.1:5180'
const OPF = 'http://www.idpf.org/2007/opf'
const DC = 'http://purl.org/dc/elements/1.1/'
const container = (path, extra = '') => `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles>${extra}
<rootfile full-path="${path}" media-type="application/oebps-package+xml"/></rootfiles></container>`
const spine = `<spine><itemref idref="c1"/></spine>`
const chapter = { id: 'c1', href: 'c1.xhtml', type: 'application/xhtml+xml' }
const item = ({ id, href, type, props }) => `<item id="${id}" href="${href}" media-type="${type}"${props ? ` properties="${props}"` : ''}/>`

// [名字, OPF 路径, OPF 内容, 额外文件 (路径 → 'png' | 文本), container 额外 rootfile]
const cases = [
  ['epub3-basic', 'OEBPS/content.opf', `<package xmlns="${OPF}" version="3.0"><metadata xmlns:dc="${DC}">
    <dc:title>  三体\n  地球往事 </dc:title><dc:creator>刘慈欣</dc:creator><dc:language>zh</dc:language>
    <dc:description>&lt;p&gt;一部 &amp; 小说&lt;/p&gt;</dc:description></metadata>
    <manifest>${item(chapter)}${item({ id: 'cv', href: 'Images/cover.png', type: 'image/png', props: 'cover-image' })}</manifest>${spine}</package>`,
  { 'OEBPS/Images/cover.png': 'png' }],
  ['epub2-roles', 'content.opf', `<package xmlns="${OPF}" version="2.0" xmlns:opf="${OPF}"><metadata xmlns:dc="${DC}">
    <dc:title>Two Authors</dc:title><dc:creator opf:role="aut" opf:file-as="Doe, Jane">Jane Doe</dc:creator>
    <dc:creator opf:role="aut">John Roe</dc:creator><dc:creator opf:role="trl">Tran Slator</dc:creator>
    <dc:contributor>Not An Author</dc:contributor><dc:contributor opf:role="aut">Co Author</dc:contributor>
    <dc:language>en</dc:language><dc:language>fr</dc:language><meta name="cover" content="img1"/></metadata>
    <manifest>${item(chapter)}${item({ id: 'img1', href: 'pic.jpg', type: 'image/jpeg' })}</manifest>${spine}</package>`,
  { 'pic.jpg': 'png' }],
  ['epub3-refines', 'OPS/package.opf', `<package xmlns="${OPF}" version="3.0" xml:lang="zh"><metadata xmlns:dc="${DC}">
    <dc:title id="t1">副标题</dc:title><dc:title id="t2">正标题</dc:title>
    <meta refines="#t2" property="title-type">main</meta><meta refines="#t1" property="title-type">subtitle</meta>
    <dc:creator id="c1">村上春树</dc:creator><meta refines="#c1" property="alternate-script" xml:lang="ja">村上春樹</meta>
    <meta refines="#c1" property="file-as">Murakami, Haruki</meta>
    <dc:creator id="c2">林少华</dc:creator><meta refines="#c2" property="role" scheme="marc:relators">trl</meta>
    <dc:creator id="c3">Author With Role</dc:creator><meta refines="#c3" property="alternate-script" xml:lang="en">AWR</meta>
    <meta refines="#c3" property="role" scheme="marc:relators">aut</meta>
    <dc:description>  多余   空白\n\t折叠 </dc:description></metadata>
    <manifest>${item(chapter)}${item({ id: 'x', href: '../Art/Cover%20Image.jpg', type: 'image/jpeg', props: 'nav cover-image' })}</manifest>${spine}</package>`,
  { 'Art/Cover Image.jpg': 'png' }],
  ['no-namespace-opf', 'content.opf', `<package version="2.0"><metadata xmlns:dc="${DC}"><dc:title>无命名空间</dc:title>
    <dc:creator>某人</dc:creator><meta name="cover" content="nope"/></metadata>
    <manifest>${item(chapter)}${item({ id: 'p', href: 'images/my-cover.gif', type: 'image/gif' })}</manifest>${spine}</package>`,
  { 'images/my-cover.gif': 'png' }],
  ['guide-cover', 'content.opf', `<package xmlns="${OPF}" version="2.0"><metadata xmlns:dc="${DC}"><dc:title>Guide</dc:title></metadata>
    <manifest>${item(chapter)}${item({ id: 'g', href: 'front.jpeg', type: 'image/jpeg' })}</manifest>${spine}
    <guide><reference type="cover" title="C" href="front.jpeg"/></guide></package>`,
  { 'front.jpeg': 'png' }],
  ['missing-cover-file', 'content.opf', `<package xmlns="${OPF}" version="3.0"><metadata xmlns:dc="${DC}"><dc:title>Missing</dc:title></metadata>
    <manifest>${item(chapter)}${item({ id: 'cv', href: 'gone.png', type: 'image/png', props: 'cover-image' })}</manifest>${spine}</package>`,
  {}],
  ['empty-fields', 'content.opf', `<package xmlns="${OPF}" version="3.0"><metadata xmlns:dc="${DC}"><dc:title></dc:title>
    <dc:creator></dc:creator><dc:creator>Real</dc:creator><dc:language></dc:language><dc:description></dc:description></metadata>
    <manifest>${item(chapter)}</manifest>${spine}</package>`, {}],
  ['lang-differs', 'content.opf', `<package xmlns="${OPF}" version="3.0" xml:lang="zh"><metadata xmlns:dc="${DC}"><dc:title xml:lang="en">English Title</dc:title>
    <dc:creator xml:lang="en">English Name</dc:creator><dc:creator xml:lang="zh">中文名</dc:creator></metadata>
    <manifest>${item(chapter)}</manifest>${spine}</package>`, {}],
  ['prefixed-opf', 'content.opf', `<opf:package xmlns:opf="${OPF}" version="2.0"><opf:metadata xmlns:dc="${DC}"><dc:title>Prefixed</dc:title>
    <dc:creator opf:role="edt">Ed Itor</dc:creator><dc:creator>Writer</dc:creator><opf:meta name="cover" content="c"/></opf:metadata>
    <opf:manifest><opf:item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><opf:item id="c" href="c.png" media-type="image/png"/></opf:manifest>
    <opf:spine><opf:itemref idref="c1"/></opf:spine></opf:package>`,
  { 'c.png': 'png' }],
  ['multi-rootfile', 'real.opf', `<package xmlns="${OPF}" version="3.0"><metadata xmlns:dc="${DC}"><dc:title>Real One</dc:title></metadata>
    <manifest>${item(chapter)}</manifest>${spine}</package>`, {},
  '<rootfile full-path="other.pdf" media-type="application/pdf"/>'],
  ['bom-and-percent', 'a b/content.opf', `﻿<?xml version="1.0" encoding="utf-8"?><package xmlns="${OPF}" version="3.0"><metadata xmlns:dc="${DC}">
    <dc:title>百分号%2c路径</dc:title><dc:creator>甲</dc:creator><dc:creator>乙</dc:creator></metadata>
    <manifest>${item(chapter)}${item({ id: 'cv', href: '%E5%B0%81%E9%9D%A2.png', type: 'image/png', props: 'cover-image' })}</manifest>${spine}</package>`,
  { 'a b/封面.png': 'png' }],
  ['contributor-scheme-url', 'content.opf', `<package xmlns="${OPF}" version="3.0"><metadata xmlns:dc="${DC}"><dc:title>Scheme</dc:title>
    <dc:contributor id="k">Via URL Scheme</dc:contributor><meta refines="#k" property="role" scheme="http://id.loc.gov/vocabulary/relators">aut</meta>
    <dc:contributor id="m">Other Scheme</dc:contributor><meta refines="#m" property="role" scheme="onix:codelist17">A01</meta></metadata>
    <manifest>${item(chapter)}</manifest>${spine}</package>`, {}],
]

const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto(BASE)
const out = await page.evaluate(async ({ cases, chapterXhtml }) => {
  const { makeFoliateBook } = await import('/src/services/foliateBook.ts')
  const { flattenMeta } = await import('/src/services/importer.ts')
  const { zipSync, strToU8 } = await import('/node_modules/fflate/esm/browser.js')
  // 1×1 PNG
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0))
  const container = (path, extra) => `<?xml version="1.0"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles>${extra}\n<rootfile full-path="${path}" media-type="application/oebps-package+xml"/></rootfiles></container>`
  const result = []
  for (const [name, opfPath, opf, extra, extraRoot = ''] of cases) {
    const dir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''
    const files = {
      mimetype: [strToU8('application/epub+zip'), { level: 0 }],
      'META-INF/container.xml': strToU8(container(opfPath, extraRoot)),
      [opfPath]: strToU8(opf),
      [dir + 'c1.xhtml']: strToU8(chapterXhtml),
    }
    for (const [p, kind] of Object.entries(extra)) files[p] = kind === 'png' ? png : strToU8(kind)
    const zip = zipSync(files)
    const book = await makeFoliateBook(new File([zip], name + '.epub'))
    const meta = book.metadata ?? {}
    let cover = null
    try { cover = await book.getCover?.() } catch { cover = null }
    const coverItem = book.resources?.cover
    let b64 = ''
    for (let i = 0; i < zip.length; i += 0x8000) b64 += String.fromCharCode(...zip.subarray(i, i + 0x8000))
    result.push({
      name,
      epubBase64: btoa(b64),
      expected: {
        title: flattenMeta(meta.title),
        author: flattenMeta(meta.author),
        description: flattenMeta(meta.description),
        language: flattenMeta(meta.language),
        // foliate 对清单里有、包里没有的封面会返回 4 字节的垃圾 Blob, 导入时存成坏封面;
        // 原生实现有意不复刻 (没有封面), 期望以 ZIP 里确实存在该文件为准
        coverHref: cover && coverItem?.href in files ? coverItem.href : null,
        coverType: cover && coverItem?.href in files ? cover.type || null : null,
        foliateJunkCover: !!cover && !(coverItem?.href in files),
      },
    })
    book.destroy?.()
  }
  return result
}, { cases, chapterXhtml: '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>c</title></head><body><p>x</p></body></html>' })
await browser.close()
writeFileSync('src-tauri/src/testdata/epub-meta-golden.json', JSON.stringify({
  note: 'scripts/gen-epub-meta-golden.mjs 生成; foliate-js + importer.flattenMeta 的真实结果',
  cases: out,
}, null, 1) + '\n')
for (const c of out) console.log(c.name.padEnd(24), JSON.stringify(c.expected))
