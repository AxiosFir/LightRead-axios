// Rebuild the published desktop code with audited version metadata only.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
assert.equal(process.env.RELEASE_TAG, 'v2.1.0')
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
assert.equal(git('rev-parse', 'HEAD'), 'ef05a36c3da912635c824789ab07c280752a03d0')
assert.equal(git('status', '--porcelain', '--untracked-files=no'), '')
const files = ['package.json', 'package-lock.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'src-tauri/tauri.conf.json']
for (const file of files) {
  let text = readFileSync(file, 'utf8')
  if (file.endsWith('.json')) {
    const data = JSON.parse(text)
    assert.equal(data.version, '1.19.4')
    data.version = '2.1.0'
    if (file === 'package-lock.json') {
      assert.equal(data.packages[''].version, '1.19.4')
      data.packages[''].version = '2.1.0'
    }
    const matches = [...text.matchAll(/"version": "1\.19\.4"/g)]
    assert.equal(matches.length, file === 'package-lock.json' ? 2 : 1)
    text = text.replaceAll('"version": "1.19.4"', '"version": "2.1.0"')
  } else {
    const pattern = /(name = "lightread"\r?\nversion = ")1\.19\.4(")/
    assert.match(text, pattern)
    text = text.replace(pattern, '$12.1.0$2')
  }
  writeFileSync(file, text)
}
assert.deepEqual(git('diff', '--name-only').split('\n').sort(), files.sort())
// Audit every changed line: no application behavior, dependency or identity changes.
const patch = git('diff', '--no-ext-diff', '--no-color')
for (const line of patch.split('\n')) {
  if (/^[+-]/.test(line) && !/^(---|\+\+\+)/.test(line)) {
    assert.match(line, /^[+-]\s*(?:"version": "(?:1\.19\.4|2\.1\.0)",?|version = "(?:1\.19\.4|2\.1\.0)")$/)
  }
}
writeFileSync('desktop-version.patch', patch + '\n')
console.log('Frozen desktop source prepared with version metadata only; application code unchanged.')
