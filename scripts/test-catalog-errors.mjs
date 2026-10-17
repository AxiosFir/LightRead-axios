import assert from 'node:assert/strict'
import { test } from 'node:test'
import { catalogErrorKey } from '../src/services/catalogErrors.ts'

const native = `error sending request for url (https://archive.org/advancedsearch.php?q=${'%E6%98%8E'.repeat(200)}&rows=50)`

test('native string/object and browser network errors become short translated network hints', () => {
  for (const error of [native, new Error(native), { message: native }, new TypeError('Failed to fetch'), 'DNS error: failed to resolve host', 'TLS certificate error']) {
    assert.equal(catalogErrorKey(error), 'catalog.sourceUnreachable')
    assert.equal(catalogErrorKey(error, true), 'catalog.sourceUnreachableWeb')
  }
})

test('HTTP failures, timeouts and unreadable responses retain actionable categories', () => {
  for (const [error, key] of [
    [{ status: 401 }, 'sourceAuthRequired'],
    [new Error('访问被拒绝 (403)'), 'sourceAccessDenied'],
    [new Error('地址不存在 (404)'), 'sourceNotFound'],
    [new Error('请求过于频繁 (429)'), 'sourceRateLimited'],
    [new Error('请求失败: 503 Service Unavailable'), 'sourceUnavailable'],
    [new Error('请求失败: 504 Gateway Timeout'), 'searchTimeout'],
    [{ name: 'AbortError', message: 'signal is aborted' }, 'searchTimeout'],
    [{ name: 'TimeoutError' }, 'searchTimeout'],
    [new Error('operation timed out'), 'searchTimeout'],
    [new SyntaxError('Unexpected token < in JSON'), 'sourceInvalidResponse'],
    [new Error('Invalid Internet Archive search response'), 'sourceInvalidResponse'],
  ]) assert.equal(catalogErrorKey(error), `catalog.${key}`)
})

test('unknown or sensitive errors never become UI copy; URL numbers do not imply HTTP status', () => {
  for (const error of [undefined, null, {}, '', '<html>' + 'x'.repeat(10000), 'secret-token', new TypeError('internal bug')]) {
    assert.equal(catalogErrorKey(error), 'catalog.sourceUnavailable')
  }
  assert.equal(catalogErrorKey('error sending request for url (https://user:secret@example.test/401?q=429)'), 'catalog.sourceUnreachable')
})
