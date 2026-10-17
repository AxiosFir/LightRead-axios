/**
 * 书架上的短书名 / 短作者 (只用于手机书格与「继续阅读」展示, 不改元数据)。
 *
 * 商店来源的书名常带一长串营销括注:「掌控习惯（樊登读书倾力推荐，…）」。
 * 只去掉书名末尾 ≥ 12 字的括注, 短括注 (丛书名、版次: 「(第2版)」) 保留;
 * 去掉后为空则原样返回。作者只取分号前的第一段 (后面多是译者)。
 */
const TRAILING_NOTE = /\s*[（(【[][^（()）【】[\]]{12,}[)）】\]]\s*$/

export function shortTitle(title: string): string {
  const trimmed = title.trim()
  const short = trimmed.replace(TRAILING_NOTE, '').trim()
  return short || trimmed
}

export function shortAuthor(author: string): string {
  return author.split(/[;；]/)[0].trim()
}
