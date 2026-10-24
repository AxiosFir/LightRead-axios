/** 回归: 直接拖入一个分类文件夹 (书在根目录或无多分类) 时, 根目录名会成为书单. */
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { zipSync, strToU8 } from 'fflate'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const base = process.env.E2E_BASE ?? 'http://localhost:4173'
const root = join(process.env.TEMP ?? '.', 'lightread-folder-root-booklist', '交易经典')
rmSync(join(process.env.TEMP ?? '.', 'lightread-folder-root-booklist'), { recursive: true, force: true })
mkdirSync(root, { recursive: true })

const epub = title => Buffer.from(zipSync({
  mimetype: [strToU8('application/epub+zip'), { level: 0 }],
  'META-INF/container.xml': strToU8('<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
  'OEBPS/package.opf': strToU8(`<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">${encodeURIComponent(title)}</dc:identifier><dc:title>${title}</dc:title><dc:creator>分类测试</dc:creator><dc:language>zh</dc:language><meta property="dcterms:modified">2026-10-24T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="ch" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="ch"/></spine></package>`),
  'OEBPS/nav.xhtml': strToU8('<html xmlns="http://www.w3.org/1999/xhtml"><head><title>目录</title></head><body><nav><ol><li><a href="chapter.xhtml">第一章</a></li></ol></nav></body></html>'),
  'OEBPS/chapter.xhtml': strToU8(`<html xmlns="http://www.w3.org/1999/xhtml"><head><title>正文</title></head><body><h1>${title}</h1></body></html>`),
}))
writeFileSync(join(root, '一本书.epub'), epub('一本书'))
writeFileSync(join(root, '另一本书.epub'), epub('另一本书'))

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
const page = await context.newPage()
page.setDefaultTimeout(15_000)
const errors = []
page.on('pageerror', error => errors.push(error.message))
await context.route('https://api.github.com/**', route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ tag_name: 'v0.0.0', assets: [] }),
}))

try {
  await page.goto(`${base}/#/library`, { waitUntil: 'networkidle' })
  await page.locator('header input[data-folder-input]').setInputFiles(root)
  const dialog = page.getByRole('dialog', { name: /从文件夹添加/ })
  await dialog.waitFor()
  const names = await dialog.locator('.folder-booklists .folder-path strong').allTextContents()
  assert.ok(names.includes('交易经典'), `missing root booklist: ${names.join(', ')}`)
  await dialog.getByRole('button', { name: '添加 2 本', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.book-card').length === 2)
  const booklist = page.locator('.booklist-chip', { hasText: '交易经典' })
  await booklist.waitFor()
  await booklist.click()
  await page.waitForFunction(() => document.querySelectorAll('.book-card').length === 2)
  assert.deepEqual(errors, [])
  console.log('PASS root folder creates a booklist for books directly inside it')
} finally {
  await browser.close()
}
