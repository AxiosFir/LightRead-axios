/**
 * 书架短书名 / 短作者 (src/services/displayTitle.ts): 只去掉末尾长营销括注, 保留短括注与原书名。
 *
 *   npm run test:display-title
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { shortAuthor, shortTitle } from '../src/services/displayTitle.ts'

test('drops long trailing marketing notes', () => {
  assert.equal(shortTitle('掌控习惯（樊登读书倾力推荐，美国获奖无数的现象级畅销书。得到&吴晓波倾力推荐。豆瓣评分8.3，个人实践版—习惯的力量）'), '掌控习惯')
  assert.equal(shortTitle('纳瓦尔宝典（硅谷投资人纳瓦尔十年人生智慧，教你如何获得财富与幸福。新时代创业者的《穷查理宝典》）'), '纳瓦尔宝典')
  assert.equal(shortTitle('理想国 (商务汉译世界学术名著丛书)'), '理想国')
})

test('keeps short notes, inner brackets and whole-title brackets', () => {
  assert.equal(shortTitle('关键对话：如何高效能沟通（原书第2版）'), '关键对话：如何高效能沟通（原书第2版）')
  assert.equal(shortTitle('技术的本质:技术是什么,它是如何进化的(经典版)'), '技术的本质:技术是什么,它是如何进化的(经典版)')
  assert.equal(shortTitle('（这是一个完全由括号包住的很长很长的书名）'), '（这是一个完全由括号包住的很长很长的书名）')
  assert.equal(shortTitle('  西游记 '), '西游记')
  assert.equal(shortTitle('The Little Book of Deep Learning'), 'The Little Book of Deep Learning')
})

test('author keeps the first segment before semicolons', () => {
  assert.equal(shortAuthor('[美]布莱恩•阿瑟;曹东溟 王健译'), '[美]布莱恩•阿瑟')
  assert.equal(shortAuthor('锐旗设计；https://9ppt.taobao.com'), '锐旗设计')
  assert.equal(shortAuthor('当年明月'), '当年明月')
  assert.equal(shortAuthor(''), '')
})
