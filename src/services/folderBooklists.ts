/**
 * 文件夹导入的分类规划: 文件所在目录相对导入根目录的完整路径就是书单名.
 * 例如 `科幻/刘慈欣/三体.epub` → `科幻-刘慈欣`; 根目录下的书不归入书单.
 *
 * 去重后的一本书可能来自多个分类目录 (同一本书的多个格式), 这里会保留全部归属.
 * 纯函数, 不依赖 DOM / Tauri, 测试见 scripts/test-folder-booklists.mjs.
 */
import type { FolderEntry, FolderPlan } from './folderPick.ts'

export interface FolderBooklistGroup<T extends FolderEntry> {
  name: string
  /** 尚未入库, 确认后会导入的书 */
  selected: T[]
  /** 藏书里已有, 确认后只补充书单归属的书 */
  existing: T[]
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

/** 去掉目录段首尾空白和连续空白, 避免把不可见字符带进书单名 */
function cleanSegment(segment: string): string {
  return segment.normalize('NFC').replace(/\s+/g, ' ').trim()
}

/**
 * 从文件相对路径得到书单名.
 * 返回 null 表示文件直接位于导入根目录, 不创建书单.
 */
export function booklistNameForPath(path: string): string | null {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.length < 2) return null
  const name = parts.slice(0, -1).map(cleanSegment).filter(Boolean).join('-')
  return name || null
}

/**
 * 把文件夹导入计划转换成书单分组.
 * 同一条去重记录中的 kept / dropped 文件都参与分类, 这样同一本书可进入多个书单.
 */
export function planFolderBooklists<T extends FolderEntry>(
  plan: FolderPlan<T>,
): FolderBooklistGroup<T>[] {
  const duplicatePaths = new Map<string, string[]>()
  for (const group of plan.skippedDuplicates) {
    duplicatePaths.set(group.kept.path, [group.kept.path, ...group.dropped.map(entry => entry.path)])
  }

  const groups = new Map<string, FolderBooklistGroup<T>>()
  const add = (entry: T, existing: boolean) => {
    const paths = duplicatePaths.get(entry.path) ?? [entry.path]
    const names = [...new Set(paths.map(booklistNameForPath).filter((name): name is string => !!name))]
    for (const name of names) {
      const group = groups.get(name) ?? { name, selected: [], existing: [] }
      const bucket = existing ? group.existing : group.selected
      if (!bucket.some(item => item.path === entry.path)) bucket.push(entry)
      groups.set(name, group)
    }
  }

  for (const entry of plan.selected) add(entry, false)
  for (const entry of plan.alreadyInLibrary) add(entry, true)

  return [...groups.values()]
    .map(group => ({
      ...group,
      selected: group.selected.sort((a, b) => collator.compare(a.path, b.path)),
      existing: group.existing.sort((a, b) => collator.compare(a.path, b.path)),
    }))
    .sort((a, b) => collator.compare(a.name, b.name))
}
