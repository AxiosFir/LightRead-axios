import assert from 'node:assert/strict'
import { test } from 'node:test'
import { booklistNameForPath, planFolderBooklists } from '../src/services/folderBooklists.ts'
import { IMPORT_FORMATS, planFolderPick } from '../src/services/folderPick.ts'

const file = (path, size = 1000) => ({ path, name: path.split(/[\\/]/).pop(), size })
const plan = entries => planFolderPick(entries, { formats: IMPORT_FORMATS })

test('booklist name is the complete relative parent path joined with hyphens', () => {
  assert.equal(booklistNameForPath('科幻/刘慈欣/三体.epub'), '科幻-刘慈欣')
  assert.equal(booklistNameForPath('科幻\\刘慈欣\\三体.epub'), '科幻-刘慈欣')
  assert.equal(booklistNameForPath('文学/中国/小说/三体.epub'), '文学-中国-小说')
  assert.equal(booklistNameForPath('科幻/三体.epub'), '科幻')
  assert.equal(booklistNameForPath(' 科幻 /  刘慈欣 /三体.epub'), '科幻-刘慈欣')
  assert.equal(booklistNameForPath('三体.epub'), null)
  assert.equal(booklistNameForPath('三体.epub', '科幻', true), '科幻')
  assert.equal(booklistNameForPath('刘慈欣/三体.epub', '科幻', true), '科幻-刘慈欣')
})

test('duplicate formats across categories keep every category membership', () => {
  const entries = [
    file('科幻/刘慈欣/三体.pdf'),
    file('收藏/经典/三体.mobi'),
    file('收藏/经典/三体.epub'),
  ]
  const pick = plan(entries)
  assert.deepEqual(pick.selected.map(entry => entry.path), ['收藏/经典/三体.epub'])

  const booklists = planFolderBooklists(pick)
  assert.deepEqual(booklists.map(group => group.name), ['收藏-经典', '科幻-刘慈欣'])
  for (const group of booklists) {
    assert.deepEqual(group.selected.map(entry => entry.path), ['收藏/经典/三体.epub'])
  }
})

test('a dropped category folder becomes the root of the booklist name', () => {
  const direct = plan([file('三体.epub'), file('球状闪电.pdf')])
  assert.deepEqual(planFolderBooklists(direct, { rootName: '科幻' }).map(group => group.name), ['科幻'])

  const nested = plan([file('刘慈欣/三体.epub')])
  assert.deepEqual(
    planFolderBooklists(nested, { rootName: '科幻' }).map(group => group.name),
    ['科幻-刘慈欣'],
  )
})

test('a container with multiple top-level categories does not prefix its own name', () => {
  const pick = plan([
    file('科幻/刘慈欣/三体.epub'),
    file('历史/史记.pdf'),
  ])
  assert.deepEqual(
    planFolderBooklists(pick, { rootName: '我的书库' }).map(group => group.name),
    ['历史', '科幻-刘慈欣'],
  )
})

test('existing books stay linked to their planned booklists', () => {
  const entries = [
    file('root.epub'),
    file('科幻/刘慈欣/三体.epub'),
    file('历史/史记.pdf'),
  ]
  const pick = planFolderPick(entries, {
    formats: IMPORT_FORMATS,
    existingFileNames: ['三体.epub'],
  })
  const booklists = planFolderBooklists(pick, { rootName: '我的书库' })

  assert.deepEqual(pick.selected.map(entry => entry.path), ['root.epub', '历史/史记.pdf'])
  assert.deepEqual(pick.alreadyInLibrary.map(entry => entry.path), ['科幻/刘慈欣/三体.epub'])
  assert.deepEqual(booklists.map(group => group.name), ['历史', '科幻-刘慈欣'])
  assert.deepEqual(booklists[1].existing.map(entry => entry.path), ['科幻/刘慈欣/三体.epub'])
})

test('a book can be assigned to more than two directories after deduplication', () => {
  const pick = plan([
    file('A/One/book.epub'),
    file('B/Two/book.pdf'),
    file('C/Three/book.mobi'),
  ])
  const booklists = planFolderBooklists(pick)
  assert.deepEqual(booklists.map(group => group.name), ['A-One', 'B-Two', 'C-Three'])
  assert.equal(new Set(booklists.flatMap(group => group.selected.map(entry => entry.path))).size, 1)
})
