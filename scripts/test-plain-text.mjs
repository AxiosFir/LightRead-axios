// 通用纯文本 (源码 / 配置 / 日志 / README …) 的纯函数契约: 文件名识别, 内容嗅探, 代码视图分块与行号.
// 运行: npm run test:plain-text
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  codeChapters, cleanControlChars, detectReadableFormat, formatLabelOf, looksLikeText, plainTextLabel,
  prettyJsonIfMinified, textViewForBook, textViewOf,
} from '../src/services/plainText.ts'
import { detectFormat } from '../src/services/format.ts'

const bytes = s => new TextEncoder().encode(s)

test('文件名识别: 代码 / 散文 / 不认识', () => {
  for (const f of ['a.json', 'b.YAML', 'main.go', 'x.py', 'App.vue', 'run.sh', 'data.csv', 'app.log',
    'Dockerfile', 'Makefile', 'CMakeLists.txt', '.gitignore', '.env', '.env.local', '.eslintrc', '.foorc', 'Dockerfile.dev',
    'src/lib/util.rs', 'C:\\proj\\main.c']) {
    assert.equal(textViewOf(f), 'code', f)
  }
  for (const f of ['README', 'LICENSE', 'license.MIT', 'CHANGELOG', 'notes.rst', 'a.org', 'b.adoc', 'c.txt']) {
    assert.equal(textViewOf(f), 'prose', f)
  }
  for (const f of ['a.png', 'b.zip', 'c.exe', 'noext', 'foo.bar']) assert.equal(textViewOf(f), null, f)
})

test('书籍场景只认书, 主动打开的场景认所有文本', () => {
  assert.equal(detectFormat('main.go'), null)
  assert.equal(detectReadableFormat('main.go'), 'txt')
  assert.equal(detectReadableFormat('Dockerfile'), 'txt')
  assert.equal(detectReadableFormat('a.epub'), 'epub')
  assert.equal(detectReadableFormat('notes.mkd'), 'md')
  assert.equal(detectReadableFormat('page.shtml'), 'html')
  assert.equal(detectReadableFormat('a.png'), null)
  // 存成 txt 的书: 只有代码类名字才走代码视图
  assert.equal(textViewForBook('a.txt'), 'prose')
  assert.equal(textViewForBook('README'), 'prose')
  assert.equal(textViewForBook('weird.xyz'), 'prose')
  assert.equal(textViewForBook('a.ts'), 'code')
})

test('书卡角标', () => {
  assert.equal(plainTextLabel('package.json'), 'JSON')
  assert.equal(plainTextLabel('Dockerfile'), 'Dockerfile')
  assert.equal(plainTextLabel('.gitignore'), '.gitignore')
  assert.equal(formatLabelOf({ format: 'txt', fileName: 'a.py' }), 'PY')
  assert.equal(formatLabelOf({ format: 'txt', fileName: '小说.txt' }), 'TXT')
  assert.equal(formatLabelOf({ format: 'txt', fileName: 'weird.xyz' }), 'TXT')
  assert.equal(formatLabelOf({ format: 'epub', fileName: 'a.epub' }), 'EPUB')
})

test('内容嗅探: 文本 / UTF-16 / 二进制', () => {
  assert.ok(looksLikeText(bytes('hello\n\tworld\r\n中文')))
  assert.ok(looksLikeText(bytes('\x1b[32mINFO\x1b[0m ok')))
  assert.ok(looksLikeText(new Uint8Array(0)))
  assert.ok(looksLikeText(new Uint8Array([0xff, 0xfe, 0x41, 0x00])))
  assert.ok(!looksLikeText(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00])))
  const noisy = new Uint8Array(1000).fill(0x41)
  for (let i = 0; i < 30; i++) noisy[i * 30] = 0x02
  assert.ok(!looksLikeText(noisy))
})

test('控制字符清理与 JSON 展开', () => {
  assert.equal(cleanControlChars('\x1b[1;31mERR\x1b[0m a\x07b'), 'ERR ab')
  const min = JSON.stringify({ name: 'lightread', list: Array.from({ length: 40 }, (_, i) => i) })
  assert.match(prettyJsonIfMinified(min, 'a.json'), /\n {2}"name"/)
  assert.equal(prettyJsonIfMinified(min, 'a.txt'), min)
  assert.equal(prettyJsonIfMinified('{bad json' + 'x'.repeat(200), 'a.json').startsWith('{bad'), true)
})

test('代码视图: 每行一个 li, 转义, 行号续接', () => {
  const [one] = codeChapters('if (a < b && c) {\n\treturn "x"\n}\n', 'src/a.js')
  assert.equal(one.title, 'a.js')
  assert.match(one.html, /^<ol class="code" start="1" style="padding-left: 3ch">/)
  assert.equal((one.html.match(/<li>/g) ?? []).length, 3, '末尾换行不多出空行')
  assert.ok(one.html.includes('<li>if (a &lt; b &amp;&amp; c) {</li>'))
  assert.ok(one.html.includes('<li>\treturn "x"</li>'))

  const text = Array.from({ length: 2500 }, (_, i) => `line ${i + 1}`).join('\r\n')
  const parts = codeChapters(text, 'big.log')
  assert.deepEqual(parts.map(p => p.title), ['1–1000', '1001–2000', '2001–2500'])
  assert.match(parts[1].html, /start="1001" style="padding-left: 6ch"/)
  assert.ok(parts[2].html.includes('<li>line 2500</li>'))

  const [empty] = codeChapters('', 'empty.json')
  assert.equal((empty.html.match(/<li>/g) ?? []).length, 1)
})
