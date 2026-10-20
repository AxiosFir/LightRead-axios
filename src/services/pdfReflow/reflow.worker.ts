/**
 * PDF 重排 Worker: 打开一次 PDF, 先转换出重排包, 之后按需裁切渲染图表.
 * 消息: load(bytes) → convert(meta) → render(ref)*; 每条带 id, 回复同 id.
 */
import { convertDocToReflow, openPdf, renderFigure, ReflowEmptyError, type ReflowMeta } from './convert.ts'
import type { FigureRef } from './epub.ts'

/* eslint-disable @typescript-eslint/no-explicit-any */
let mupdf: any = null
let doc: any = null
let stopped = false

const post = (msg: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer)

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data ?? {}
  const { id, type } = msg
  try {
    if (type === 'load') {
      mupdf ??= (await import('mupdf')).default
      doc?.destroy?.()
      doc = openPdf(mupdf, msg.bytes as ArrayBuffer)
      post({ id, type: 'ok' })
    } else if (type === 'convert') {
      if (!doc) throw new Error('pdf not loaded')
      stopped = false
      const pkg = await convertDocToReflow(mupdf, doc, msg.meta as ReflowMeta,
        p => post({ id, type: 'progress', progress: p }), () => stopped)
      post({ id, type: 'ok', pkg })
    } else if (type === 'render') {
      if (!doc) throw new Error('pdf not loaded')
      const bytes = renderFigure(mupdf, doc, msg.ref as FigureRef)
      post({ id, type: 'ok', bytes }, [bytes.buffer as ArrayBuffer])
    } else if (type === 'stop') {
      stopped = true
    } else if (type === 'close') {
      doc?.destroy?.()
      doc = null
      post({ id, type: 'ok' })
    }
  } catch (err: any) {
    post({ id, type: 'error', empty: err instanceof ReflowEmptyError, aborted: err?.name === 'AbortError', message: String(err?.message ?? err) })
  }
}
