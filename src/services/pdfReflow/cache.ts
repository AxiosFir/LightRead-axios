/**
 * 重排包与已渲染图表的本机缓存: 独立的 IndexedDB `lightread-derived` (网页与 Tauri webview 都可用).
 * 内容都能从 PDF 重新生成, 不同步、不进备份; 只留最近用过的几本, 删书时一并清掉.
 */
import type { ReflowPackage } from './convert.ts'

const DB_NAME = 'lightread-derived'
const PACKAGES = 'reflow'
const FIGURES = 'reflowFigures'
/** 保留最近用过的重排包数 */
const KEEP_PACKAGES = 12

interface PackageRow {
  key: string
  bookId: string
  usedAt: number
  pkg: ReflowPackage
}

interface FigureRow {
  /** `${包 key}|${图路径}` */
  key: string
  pkgKey: string
  bookId: string
  data: Blob
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('indexedDB unavailable'))
        return
      }
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        const pk = db.createObjectStore(PACKAGES, { keyPath: 'key' })
        pk.createIndex('bookId', 'bookId')
        const fg = db.createObjectStore(FIGURES, { keyPath: 'key' })
        fg.createIndex('pkgKey', 'pkgKey')
        fg.createIndex('bookId', 'bookId')
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    dbPromise.catch(() => { dbPromise = null })
  }
  return dbPromise
}

const done = <T>(req: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  req.onsuccess = () => resolve(req.result)
  req.onerror = () => reject(req.error)
})

const finished = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve()
  tx.onerror = () => reject(tx.error)
  tx.onabort = () => reject(tx.error)
})

/** 缓存键: 书 + 文件大小 + 版面规则版本 (换了文件或升级规则就重新生成) */
export const reflowKey = (bookId: string, size: number, version: number) => `${bookId}:${size}:v${version}`

export async function getReflowPackage(key: string): Promise<ReflowPackage | undefined> {
  try {
    const db = await openDb()
    const tx = db.transaction(PACKAGES, 'readwrite')
    const store = tx.objectStore(PACKAGES)
    const row = await done(store.get(key)) as PackageRow | undefined
    if (row) store.put({ ...row, usedAt: Date.now() })
    await finished(tx)
    return row?.pkg
  } catch (e) {
    console.warn('[pdf-reflow] cache read', e)
    return undefined
  }
}

export async function putReflowPackage(key: string, bookId: string, pkg: ReflowPackage): Promise<void> {
  try {
    const db = await openDb()
    const tx = db.transaction([PACKAGES, FIGURES], 'readwrite')
    const packages = tx.objectStore(PACKAGES)
    const figures = tx.objectStore(FIGURES)
    // 同一本书的旧版本 (文件换了 / 规则升级) 先删
    const old = await done(packages.index('bookId').getAll(bookId)) as PackageRow[]
    for (const row of old) if (row.key !== key) await dropPackage(packages, figures, row.key)
    packages.put({ key, bookId, usedAt: Date.now(), pkg } satisfies PackageRow)
    const all = await done(packages.getAll()) as PackageRow[]
    const stale = all.filter(r => r.key !== key).sort((a, b) => b.usedAt - a.usedAt).slice(KEEP_PACKAGES - 1)
    for (const row of stale) await dropPackage(packages, figures, row.key)
    await finished(tx)
  } catch (e) {
    console.warn('[pdf-reflow] cache write', e)
  }
}

async function dropPackage(packages: IDBObjectStore, figures: IDBObjectStore, key: string) {
  packages.delete(key)
  const keys = await done(figures.index('pkgKey').getAllKeys(key))
  for (const k of keys) figures.delete(k)
}

export async function getReflowFigure(pkgKey: string, path: string): Promise<Blob | undefined> {
  try {
    const db = await openDb()
    const row = await done(db.transaction(FIGURES).objectStore(FIGURES).get(`${pkgKey}|${path}`)) as FigureRow | undefined
    return row?.data
  } catch {
    return undefined
  }
}

export async function putReflowFigure(pkgKey: string, bookId: string, path: string, data: Blob): Promise<void> {
  try {
    const db = await openDb()
    const tx = db.transaction(FIGURES, 'readwrite')
    tx.objectStore(FIGURES).put({ key: `${pkgKey}|${path}`, pkgKey, bookId, data } satisfies FigureRow)
    await finished(tx)
  } catch (e) {
    console.warn('[pdf-reflow] figure cache write', e)
  }
}

/** 删书时清掉它的重排缓存 */
export async function dropReflowCache(bookId: string): Promise<void> {
  try {
    const db = await openDb()
    const tx = db.transaction([PACKAGES, FIGURES], 'readwrite')
    const packages = tx.objectStore(PACKAGES)
    const figures = tx.objectStore(FIGURES)
    for (const k of await done(packages.index('bookId').getAllKeys(bookId))) packages.delete(k)
    for (const k of await done(figures.index('bookId').getAllKeys(bookId))) figures.delete(k)
    await finished(tx)
  } catch (e) {
    console.warn('[pdf-reflow] cache drop', e)
  }
}
