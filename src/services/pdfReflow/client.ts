/**
 * 阅读页使用的 PDF 重排入口:
 *  - openReflowBook: 取缓存的重排包 (没有就在 Worker 里转换), 用内存加载器交给 foliate;
 *    图表在章节加载时才裁切渲染, 渲染结果也缓存
 *  - detectPdfKind: 抽样判定文字版 / 扫描版 (原版阅读页打开时用, 决定默认形态)
 * Worker 不可用 (旧 WebView、构建产物加载失败) 时在主线程做同样的事.
 */
import { initMupdf } from '../mupdf.ts'
import { getReflowFigure, getReflowPackage, putReflowFigure, putReflowPackage, reflowKey } from './cache.ts'
import { classifyPdf } from './classify.ts'
import {
  convertDocToReflow, openPdf, renderFigure, ReflowEmptyError, REFLOW_VERSION,
  type ReflowMeta, type ReflowPackage, type ReflowProgress,
} from './convert.ts'
import { figureMediaType, type FigureRef } from './epub.ts'
import { samplePdf } from './extract.ts'
import { setCachedPdfKind } from './viewMode.ts'
import type { PdfKind } from './types.ts'

export { ReflowEmptyError }

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Pending {
  resolve: (v: any) => void
  reject: (e: unknown) => void
  onProgress?: (p: ReflowProgress) => void
}

/** 一本 PDF 的转换 / 渲染引擎 (Worker 优先) */
class ReflowEngine {
  #worker: Worker | null = null
  #seq = 0
  #pending = new Map<number, Pending>()
  #local: { mupdf: any; doc: any } | null = null
  #ready: Promise<void>
  #stopLocal = false

  constructor(bytes: ArrayBuffer) {
    this.#ready = this.#start(bytes)
  }

  async #start(bytes: ArrayBuffer) {
    try {
      if (typeof Worker === 'undefined') throw new Error('no Worker')
      const w = new Worker(new URL('./reflow.worker.ts', import.meta.url), { type: 'module' })
      w.onmessage = e => this.#onMessage(e.data)
      w.onerror = e => {
        console.warn('[pdf-reflow] worker error', (e as ErrorEvent)?.message ?? e)
        this.#failAll(new Error('pdf-reflow-worker'))
      }
      this.#worker = w
      const copy = bytes.slice(0)
      await this.#call('load', { bytes: copy }, undefined, [copy])
    } catch (e) {
      console.warn('[pdf-reflow] worker unavailable, using main thread', e)
      this.#worker?.terminate()
      this.#worker = null
      const mupdf = await initMupdf()
      this.#local = { mupdf, doc: openPdf(mupdf, new Uint8Array(bytes)) }
    }
  }

  #failAll(err: unknown) {
    const waiting = [...this.#pending.values()]
    this.#pending.clear()
    for (const p of waiting) p.reject(err)
  }

  #onMessage(msg: any) {
    const p = this.#pending.get(msg?.id)
    if (!p) return
    if (msg.type === 'progress') {
      p.onProgress?.(msg.progress)
      return
    }
    this.#pending.delete(msg.id)
    if (msg.type === 'ok') p.resolve(msg)
    else if (msg.empty) p.reject(new ReflowEmptyError())
    else if (msg.aborted) p.reject(new DOMException('Aborted', 'AbortError'))
    else p.reject(new Error(msg.message || 'pdf-reflow'))
  }

  #call(type: string, payload: Record<string, unknown>, onProgress?: (p: ReflowProgress) => void, transfer: Transferable[] = []): Promise<any> {
    const id = ++this.#seq
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject, onProgress })
      this.#worker!.postMessage({ id, type, ...payload }, transfer)
    })
  }

  async convert(meta: ReflowMeta, onProgress?: (p: ReflowProgress) => void, signal?: AbortSignal): Promise<ReflowPackage> {
    await this.#ready
    if (this.#worker) {
      const stop = () => this.#worker?.postMessage({ type: 'stop' })
      signal?.addEventListener('abort', stop, { once: true })
      try {
        return (await this.#call('convert', { meta }, onProgress)).pkg as ReflowPackage
      } finally {
        signal?.removeEventListener('abort', stop)
      }
    }
    this.#stopLocal = false
    signal?.addEventListener('abort', () => { this.#stopLocal = true }, { once: true })
    return convertDocToReflow(this.#local!.mupdf, this.#local!.doc, meta, onProgress, () => this.#stopLocal || !!signal?.aborted)
  }

  async render(ref: FigureRef): Promise<Uint8Array> {
    await this.#ready
    if (this.#worker) return (await this.#call('render', { ref })).bytes as Uint8Array
    return renderFigure(this.#local!.mupdf, this.#local!.doc, ref)
  }

  dispose() {
    this.#failAll(new DOMException('Aborted', 'AbortError'))
    this.#worker?.terminate()
    this.#worker = null
    this.#local?.doc?.destroy?.()
    this.#local = null
  }
}

/** 1×1 透明 PNG: 图渲染失败时占位, 不让整章加载失败 */
const EMPTY_PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), c => c.charCodeAt(0))

export interface ReflowBook {
  /** foliate 的 book 对象, 直接交给 view.open */
  book: any
  pkg: ReflowPackage
  dispose(): void
}

export interface OpenReflowOptions {
  bookId: string
  /** 原 PDF 文件 */
  file: Blob
  meta: ReflowMeta
  onProgress?: (p: ReflowProgress) => void
  signal?: AbortSignal
}

/** 打开 PDF 的电子书形态. 没有可重排文字时抛 ReflowEmptyError */
export async function openReflowBook(o: OpenReflowOptions): Promise<ReflowBook> {
  const key = reflowKey(o.bookId, o.file.size, REFLOW_VERSION)
  let engine: ReflowEngine | null = null
  let disposed = false
  const getEngine = async () => {
    if (!engine) engine = new ReflowEngine(await o.file.arrayBuffer())
    return engine
  }
  let pkg = await getReflowPackage(key)
  if (!pkg) {
    try {
      pkg = await (await getEngine()).convert(o.meta, o.onProgress, o.signal)
    } catch (e) {
      ;(engine as ReflowEngine | null)?.dispose()
      if (e instanceof ReflowEmptyError) setCachedPdfKind(o.bookId, 'sparse')
      throw e
    }
    await putReflowPackage(key, o.bookId, pkg)
  }
  const files = pkg.files
  const figures = pkg.figures
  const loader = {
    loadText: (name: string) => files[name] ?? null,
    loadBlob: async (name: string, type?: string): Promise<Blob | null> => {
      const ref = figures[name]
      if (ref) {
        const mediaType = figureMediaType(ref)
        try {
          const cached = await getReflowFigure(key, name)
          if (cached) return cached
          if (disposed) return new Blob([EMPTY_PNG], { type: 'image/png' })
          const bytes = await (await getEngine()).render(ref)
          const blob = new Blob([bytes as BlobPart], { type: mediaType })
          void putReflowFigure(key, o.bookId, name, blob)
          return blob
        } catch (e) {
          if (!disposed) console.warn('[pdf-reflow] figure', name, e)
          return new Blob([EMPTY_PNG], { type: 'image/png' })
        }
      }
      const text = files[name]
      return text == null ? null : new Blob([text], { type: type || 'application/xhtml+xml' })
    },
    getSize: (name: string) => files[name]?.length ?? 0,
  }
  const { EPUB } = await import('foliate-js/epub.js')
  const book = await new EPUB(loader).init()
  return {
    book,
    pkg,
    dispose() {
      disposed = true
      ;(engine as ReflowEngine | null)?.dispose()
      engine = null
    },
  }
}

/** 抽样判定 PDF 类型并记住 (主线程, 与原版阅读页共用 MuPDF) */
export async function detectPdfKind(bookId: string, bytes: ArrayBuffer | Uint8Array): Promise<PdfKind> {
  const mupdf = await initMupdf()
  const doc = openPdf(mupdf, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
  try {
    const kind = classifyPdf(samplePdf(doc))
    setCachedPdfKind(bookId, kind)
    return kind
  } finally {
    doc.destroy?.()
  }
}
