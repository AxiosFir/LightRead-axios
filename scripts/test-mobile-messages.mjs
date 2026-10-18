import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toast, toasts } from '../src/mobile/services/toast.ts'

const clear = () => { while (toasts.length) toasts[0].dismiss() }
test('passive results replace stale messages instead of stacking', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  try {
    toast('first', 'success'); toast('second', 'success'); toast('third')
    assert.equal(toasts.length, 1); assert.equal(toasts[0].message, 'third')
    t.mock.timers.tick(7000); assert.equal(toasts.length, 0)
  } finally { clear(); t.mock.timers.reset() }
})
test('an error and an actionable message each get their full display time', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  try {
    toast('failed', 'error'); toast('undo available', 'success', 2600, { label: 'Undo', run() {} })
    toast('status one'); toast('status two')
    assert.equal(toasts.length, 1); assert.equal(toasts[0].message, 'failed')
    t.mock.timers.tick(6500); assert.equal(toasts[0].message, 'undo available')
    t.mock.timers.tick(7999); assert.equal(toasts[0].message, 'undo available')
    t.mock.timers.tick(1); assert.equal(toasts[0].message, 'status two')
  } finally { clear(); t.mock.timers.reset() }
})
test('duplicate errors coalesce and a queued message can be dismissed by its caller', () => {
  try {
    const close = toast('offline', 'error'); const duplicate = toast('offline', 'error')
    const queued = toast('unneeded', 'error'); queued()
    assert.equal(toasts.length, 1); duplicate(); close(); assert.equal(toasts.length, 0)
  } finally { clear() }
})
test('errors interrupt passive success without discarding actionable feedback', () => {
  try {
    toast('saved', 'success'); toast('network error', 'error')
    assert.equal(toasts[0].message, 'network error')
    clear()
    toast('action', 'success', 2600, { label: 'Open', run() {} }); toast('error', 'error')
    assert.equal(toasts[0].message, 'action'); toasts[0].dismiss(); assert.equal(toasts[0].message, 'error')
  } finally { clear() }
})
test('long errors remain readable; interaction pauses and resumes the remaining time', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  try {
    toast('长错误内容'.repeat(50), 'error'); t.mock.timers.tick(60000); assert.equal(toasts.length, 1)
    clear(); toast('Saved', 'success'); t.mock.timers.tick(1000); toasts[0].pause()
    t.mock.timers.tick(60000); assert.equal(toasts.length, 1)
    toasts[0].resume(); t.mock.timers.tick(1599); assert.equal(toasts.length, 1)
    t.mock.timers.tick(1); assert.equal(toasts.length, 0)
  } finally { clear(); t.mock.timers.reset() }
})
