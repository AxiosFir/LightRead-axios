// 同步大文件: 书的内容不整本读进 JS (几十 MB 的书曾让安卓 / 手机浏览器同步时卡死、闪退).
// 分块 SHA-256 与 node crypto 一致; 存储能原生算指纹时不读文件; 后端能直接写盘时走暂存文件下载.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { runSync } from '../src/services/sync/engine.ts'
import { CHUNKED_HASH_THRESHOLD, Sha256, sha256Blob, sha256Hex } from '../src/services/sync/hash.ts'
import { createMemorySyncStore } from '../src/services/sync/baseline.ts'
import { createFakeDav, createFakeStorage, enc, tr } from './sync-test-fakes.mjs'

const nodeHash = bytes => createHash('sha256').update(bytes).digest('hex')
const hexOf = bytes => Buffer.from(bytes).toString('hex')

function bytes(n, seed = 7) {
  const out = new Uint8Array(n)
  let x = seed
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) >>> 0
    out[i] = x >>> 24
  }
  return out
}

test('增量 SHA-256: 各种长度与分块方式都与 node crypto 一致', () => {
  for (const n of [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000, 70_001]) {
    const data = bytes(n, n + 1)
    assert.equal(hexOf(new Sha256().update(data).digest()), nodeHash(data), `一次喂入 ${n}`)
    const h = new Sha256()
    for (let i = 0, step = 1; i < n; i += step, step = (step * 3 + 1) % 97 + 1) h.update(data.subarray(i, i + step))
    assert.equal(hexOf(h.digest()), nodeHash(data), `零碎喂入 ${n}`)
  }
})

test('sha256Blob: 阈值以上分块计算, 结果与整块一致', async () => {
  const small = bytes(1234)
  assert.equal(await sha256Blob(new Blob([small])), nodeHash(small))
  const big = bytes(CHUNKED_HASH_THRESHOLD + 5 * 1024 * 1024 + 3)
  const blob = new Blob([big])
  // 大文件不应整块读出
  blob.arrayBuffer = () => { throw new Error('整本读进内存了') }
  assert.equal(await sha256Blob(blob), nodeHash(big))
  assert.equal(await sha256Hex(small), nodeHash(small))
})

const BOOK = enc('%EPUB large book stand-in')
const COVER = enc('cover')
let clock = 1_700_000_000_000

async function device(name) {
  const storage = createFakeStorage()
  await storage.init()
  return { name, storage, store: createMemorySyncStore(`dev-${name}`) }
}
const sync = (dev, remote) => runSync({
  storage: dev.storage, remote, store: dev.store, syncFiles: true, now: () => (clock += 1000),
  deviceName: dev.name, app: 'test', t: tr,
})
const addBook = dev => dev.storage.addBook({
  title: '大书', author: '某人', format: 'pdf', fileName: 'big.pdf', tags: [], addedAt: clock,
}, new Blob([BOOK]), new Blob([COVER]))

test('存储能原生算指纹时, 扫描不读书籍文件', async () => {
  const dav = createFakeDav()
  const A = await device('A')
  const id = await addBook(A)
  const getBookFile = A.storage.getBookFile
  let reads = 0
  A.storage.getBookFile = async bid => { reads++; return getBookFile(bid) }
  A.storage.hashBookFile = async bid => sha256Blob(await getBookFile(bid))
  const r = await sync(A, dav.remote())
  assert.equal(reads, 1, '只有上传时读一次 (假后端不认本地文件引用)')
  assert.equal(r.uploadedFiles, 2)
  assert.ok([...dav.files.keys()].some(k => k.endsWith(`/files/${nodeHash(BOOK)}`)))
  assert.ok(id)
})

/** 给设备装上「暂存文件」能力, 给后端装上「直接下载到暂存文件」能力, 记录调用 */
function nativeFiles(dev, dav, { corrupt = false } = {}) {
  const staged = new Map() // rel → Uint8Array
  const calls = []
  dev.storage.stageBookFile = async tag => ({
    kind: 'local-file', root: '', rel: `books/sync-${tag}.part`,
    blob: async () => new Blob([staged.get(`books/sync-${tag}.part`)]),
  })
  dev.storage.addBookFromStaged = async (meta, ref, cover) => {
    calls.push('addBookFromStaged')
    const data = staged.get(ref.rel)
    staged.delete(ref.rel)
    return dev.storage.addBook(meta, new Blob([data]), cover)
  }
  dev.storage.discardStaged = async ref => {
    calls.push('discardStaged')
    staged.delete(ref.rel)
  }
  const remote = dav.remote()
  const getFile = remote.getFile
  remote.getFile = async name => {
    calls.push(`getFile ${name.endsWith('.cover') ? 'cover' : 'book'}`)
    return getFile(name)
  }
  remote.downloadFileTo = async (name, dest) => {
    calls.push('downloadFileTo')
    const blob = await getFile(name)
    if (!blob) return null
    const data = new Uint8Array(await blob.arrayBuffer())
    if (corrupt) data[0] ^= 1
    staged.set(dest.rel, data)
    return { sha256: nodeHash(data), size: data.length }
  }
  return { remote, calls, staged }
}

test('后端能直接写盘时: 书走暂存文件下载, 校验通过才收进书库', async () => {
  const dav = createFakeDav()
  const A = await device('A')
  const B = await device('B')
  await addBook(A)
  await sync(A, dav.remote())

  const { remote, calls, staged } = nativeFiles(B, dav)
  const r = await sync(B, remote)
  assert.equal(r.downloadedBooks, 1)
  assert.deepEqual(calls, ['downloadFileTo', 'getFile cover', 'addBookFromStaged'], '书本身不经 getFile')
  assert.equal(staged.size, 0)
  const [book] = await B.storage.listBooks()
  assert.equal(book.title, '大书')
  assert.equal(book.hasCover, true)
  assert.deepEqual(new Uint8Array(await (await B.storage.getBookFile(book.id)).arrayBuffer()), BOOK)
})

test('暂存下载校验不通过: 丢掉暂存文件, 书保持仅元数据, 下次再试', async () => {
  const dav = createFakeDav()
  const A = await device('A')
  const B = await device('B')
  await addBook(A)
  await sync(A, dav.remote())

  const bad = nativeFiles(B, dav, { corrupt: true })
  const r = await sync(B, bad.remote)
  assert.equal(r.downloadedBooks, 0)
  assert.equal(r.pendingBooks, 1)
  assert.deepEqual(bad.calls, ['downloadFileTo', 'discardStaged'])
  assert.equal(bad.staged.size, 0)
  assert.equal((await B.storage.listBooks()).length, 0)

  const good = nativeFiles(B, dav)
  const r2 = await sync(B, good.remote)
  assert.equal(r2.downloadedBooks, 1)
})
