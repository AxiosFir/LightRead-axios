/**
 * 块序列 → EPUB 3 (复用 epubWriter 的 OPF / nav / NCX / 打包).
 * 每个块带 id 与 data-p (原版页码, 0 起) / data-y (页内比例), 供原版 ⇄ 电子书互切时对齐到段.
 */
import {
  buildContainerXml, buildCoverXhtml, buildNav, buildNcx, buildOpf, escapeXml, normalizeLanguage, stripInvalidXmlChars,
  zipEpub, type EpubEntry, type ManifestItem, type TocNode,
} from '../epubWriter.ts'
import { blockId, type BookPlan, type TocOut } from './book.ts'
import type { Block, Rect, RSpan } from './types.ts'

const REFLOW_CSS = `
html { line-height: 1.75; }
body { margin: 0; }
p { margin: 0 0 0.55em; text-align: justify; overflow-wrap: break-word; }
.indent p { text-indent: 2em; }
.block p { margin-bottom: 0.9em; }
h1, h2, h3 { line-height: 1.4; margin: 1.3em 0 0.6em; font-weight: 600; text-indent: 0; text-align: left; break-after: avoid; }
h1 { font-size: 1.5em; }
h2 { font-size: 1.28em; }
h3 { font-size: 1.1em; }
section > h1:first-child, section > h2:first-child, section > h3:first-child { margin-top: 0.4em; }
p.li { text-indent: -1.1em; padding-left: 1.1em; text-align: left; }
p.small { font-size: 0.86em; opacity: 0.85; text-indent: 0; }
p.quote { text-indent: 0; padding: 0.2em 0 0.2em 0.9em; border-left: 3px solid rgba(127, 127, 127, 0.4); }
p.caption { text-indent: 0; text-align: center; font-size: 0.86em; opacity: 0.8; margin: -0.2em 0 1em; }
figure { margin: 1em 0; text-align: center; break-inside: avoid; }
figure img { max-width: 100%; height: auto; border-radius: 3px; }
figure.page img { max-height: 95vh; }
code, pre {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", "Noto Sans Mono CJK SC", monospace;
  font-size: 0.86em;
}
:not(pre) > code { padding: 0.1em 0.3em; border-radius: 4px; background: rgba(127, 127, 127, 0.14); word-break: break-all; }
pre {
  margin: 0 0 1em; padding: 0.8em 1em; border-radius: 6px; background: rgba(127, 127, 127, 0.12);
  white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.5; text-indent: 0; text-align: left;
}
pre code { font-size: 1em; }
`

function inline(spans: RSpan[]): string {
  return spans.map(s => {
    let html = escapeXml(stripInvalidXmlChars(s.text))
    if (s.mono) html = `<code>${html}</code>`
    if (s.italic) html = `<i>${html}</i>`
    if (s.bold) html = `<b>${html}</b>`
    return html
  }).join('')
}

/** 图表引用: 阅读时按需从 PDF 裁切渲染 (转换时不渲染, 首次打开快) */
export interface FigureRef {
  page: number
  rect: Rect
  /** 含位图: JPEG; 否则 PNG */
  raster: boolean
}

export const figureMediaType = (ref: Pick<FigureRef, 'raster'>) => (ref.raster ? 'image/jpeg' : 'image/png')
export const figureHref = (i: number, ref: Pick<FigureRef, 'raster'>) => `Images/f${i}.${ref.raster ? 'jpg' : 'png'}`

/**
 * 重排电子书的包: 文本文件 (XHTML / CSS / OPF / 目录) 与图表引用.
 * 路径都是 zip 内完整路径 (OEBPS/...), 与 foliate EPUB 加载器的 loadText / loadBlob 一致.
 */
export interface ReflowFiles {
  files: Record<string, string>
  figures: Record<string, FigureRef>
}

function blockHtml(b: Block, i: number): string {
  const attrs = `id="${blockId(i)}" data-p="${b.page}" data-y="${Math.round(b.y * 1000) / 1000}"`
  switch (b.kind) {
    case 'h': {
      const level = Math.min(3, Math.max(1, b.level ?? 1))
      // 标题本身就是粗体
      return `<h${level} ${attrs}>${inline(b.spans.map(sp => ({ ...sp, bold: false })))}</h${level}>`
    }
    case 'pre':
      return `<pre ${attrs}><code>${escapeXml(stripInvalidXmlChars(b.spans.map(s => s.text).join('')))}</code></pre>`
    case 'figure':
      return b.rect ? `<figure ${attrs}><img src="../${escapeXml(figureHref(i, { raster: !!b.raster }))}" alt=""/></figure>` : ''
    default: {
      const cls = [b.kind === 'li' ? 'li' : '', b.kind === 'caption' ? 'caption' : '', b.small ? 'small' : '', b.quote ? 'quote' : '']
        .filter(Boolean).join(' ')
      return `<p ${attrs}${cls ? ` class="${cls}"` : ''}>${inline(b.spans)}</p>`
    }
  }
}

function chapterXhtml(title: string, body: string, lang: string, indentStyle: boolean): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escapeXml(lang)}" xml:lang="${escapeXml(lang)}">
<head>
  <meta charset="utf-8"/>
  <title>${escapeXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="../Styles/reflow.css"/>
</head>
<body class="${indentStyle ? 'indent' : 'block'}">
<section>
${body}
</section>
</body>
</html>
`
}

const toTocNodes = (nodes: TocOut[]): TocNode[] => nodes.map(n => ({
  label: n.label,
  href: n.href,
  ...(n.children.length ? { children: toTocNodes(n.children) } : {}),
}))

export interface WriteOptions {
  identifier: string
  title: string
  author: string
  language: string
  indentStyle: boolean
  /** 封面: 原版第一页 */
  cover?: FigureRef
}

export function buildReflowFiles(blocks: Block[], plan: BookPlan, o: WriteOptions): ReflowFiles {
  const lang = normalizeLanguage(o.language)
  const files: Record<string, string> = {
    'META-INF/container.xml': buildContainerXml(),
    'OEBPS/Styles/reflow.css': REFLOW_CSS,
  }
  const figures: Record<string, FigureRef> = {}
  const manifest: ManifestItem[] = [
    { id: 'nav', href: 'nav.xhtml', mediaType: 'application/xhtml+xml', properties: 'nav' },
    { id: 'ncx', href: 'toc.ncx', mediaType: 'application/x-dtbncx+xml' },
    { id: 'css', href: 'Styles/reflow.css', mediaType: 'text/css' },
  ]
  const spine: Array<{ idref: string }> = []
  let coverId: string | undefined
  if (o.cover) {
    coverId = 'cover-image'
    const href = 'Images/cover.jpg'
    manifest.push({ id: coverId, href, mediaType: 'image/jpeg', properties: 'cover-image' })
    figures[`OEBPS/${href}`] = { ...o.cover, raster: true }
    manifest.push({ id: 'cover', href: 'Text/cover.xhtml', mediaType: 'application/xhtml+xml' })
    files['OEBPS/Text/cover.xhtml'] = buildCoverXhtml(`../${href}`, { title: o.title, language: lang })
    spine.push({ idref: 'cover' })
  }
  plan.chapters.forEach((ch, k) => {
    const parts: string[] = []
    for (let i = ch.start; i < ch.end; i++) {
      const b = blocks[i]
      const html = blockHtml(b, i)
      if (!html) continue
      parts.push(html)
      if (b.kind === 'figure' && b.rect) {
        const ref: FigureRef = { page: b.page, rect: b.rect, raster: !!b.raster }
        const href = figureHref(i, ref)
        figures[`OEBPS/${href}`] = ref
        manifest.push({ id: `f${i}`, href, mediaType: figureMediaType(ref) })
      }
    }
    const id = `c${k + 1}`
    manifest.push({ id, href: ch.href, mediaType: 'application/xhtml+xml' })
    spine.push({ idref: id })
    files[`OEBPS/${ch.href}`] = chapterXhtml(ch.title, parts.join('\n') || '<p></p>', lang, o.indentStyle)
  })
  const toc = toTocNodes(plan.toc)
  files['OEBPS/nav.xhtml'] = buildNav(toc, { title: o.title, language: lang, tocTitle: o.title })
  files['OEBPS/toc.ncx'] = buildNcx(toc, { identifier: o.identifier, title: o.title })
  files['OEBPS/content.opf'] = buildOpf({
    metadata: {
      identifier: o.identifier,
      title: o.title,
      authors: o.author ? [o.author] : [],
      language: lang,
      // 固定值: 同一文件在各设备上生成的包逐字节相同
      modified: '2026-01-01T00:00:00Z',
    },
    manifest,
    spine,
    ncxId: 'ncx',
    ...(coverId ? { coverId } : {}),
  })
  return { files, figures }
}

/** 打包成标准 EPUB 文件 (导出 / 测试用); render 渲染每张图 */
export async function zipReflowFiles(
  pkg: ReflowFiles,
  render: (path: string, ref: FigureRef) => Promise<Uint8Array | null> | Uint8Array | null,
  onYield?: () => Promise<void> | void,
): Promise<Uint8Array> {
  const entries: EpubEntry[] = Object.entries(pkg.files).map(([path, data]) => ({ path, data }))
  for (const [path, ref] of Object.entries(pkg.figures)) {
    const data = await render(path, ref)
    if (data) entries.push({ path, data, store: true })
    await onYield?.()
  }
  return zipEpub(entries, onYield)
}
