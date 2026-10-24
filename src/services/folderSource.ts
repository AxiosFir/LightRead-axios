/**
 * 「选择文件夹」的平台适配: 桌面 (Tauri) 走系统目录对话框或原生拖拽 + Rust 目录扫描,
 * 网页走 <input type="file" webkitdirectory>。挑书规则见 folderPick.ts。
 * Android / iOS 的 WebView 与 Tauri 移动端拿不到可遍历的目录, 不提供入口。
 */
import { isTauri } from '../storage/types.ts'
import { IGNORED_DIRS, type FolderEntry } from './folderPick.ts'

/** 一次最多扫描的文件数 / 目录深度 */
export const FOLDER_MAX_FILES = 20000
export const FOLDER_MAX_DEPTH = 32

export interface FolderFile extends FolderEntry {
  /** 网页: 浏览器给的 File */
  file?: File
  /** 桌面: 绝对路径, 导入 / 上传时再读 */
  absPath?: string
  /** 桌面: 扫描根目录; 读取文件时用相对路径校验, 不依赖对话框授予的 fs 权限 */
  rootPath?: string
  lastModified?: number
}
export interface FolderScan {
  /** 所选文件夹的名字 */
  name: string
  /** 桌面: 所选目录的绝对路径 */
  rootPath?: string
  entries: FolderFile[]
  /** 文件太多, 只扫描了前 FOLDER_MAX_FILES 个 */
  truncated: boolean
}

const isMobile = () => typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

/** 当前环境能否选择文件夹 */
export function canPickFolder(): boolean {
  if (typeof window === 'undefined' || isMobile()) return false
  // iPadOS 13+ 的 Safari 伪装成 Mac, 但也选不了文件夹
  if (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1) return false
  if (isTauri()) return true
  return typeof HTMLInputElement !== 'undefined' && 'webkitdirectory' in HTMLInputElement.prototype
}

/** 桌面端是否走原生目录对话框 (网页走 webkitdirectory 输入框) */
export const useNativeFolderPicker = () => isTauri()

/** 网页: webkitdirectory 输入框选中的文件 → 条目 (路径去掉最外层的文件夹名) */
export function scanFromFileList(files: FileList | File[]): FolderScan | null {
  const list = Array.from(files)
  if (!list.length) return null
  const rel = (file: File) => (file.webkitRelativePath || file.name).replace(/\\/g, '/')
  const name = rel(list[0]).split('/')[0] || ''
  const entries = list.slice(0, FOLDER_MAX_FILES).map(file => {
    const parts = rel(file).split('/')
    return { path: (parts.length > 1 ? parts.slice(1) : parts).join('/'), name: file.name, size: file.size, file, lastModified: file.lastModified }
  })
  return { name, entries, truncated: list.length > FOLDER_MAX_FILES }
}

/** 桌面: 弹出目录对话框并递归扫描; 取消返回 null。onPicked: 选好目录、开始扫描时回调 (界面显示「正在扫描」) */
export async function scanNativeFolder(onPicked?: (name: string) => void): Promise<FolderScan | null> {
  const { open } = await import('@tauri-apps/plugin-dialog')
  // recursive: 让对话框把子目录也加入 fs 权限范围
  const picked = await open({ directory: true, recursive: true, multiple: false })
  const root = Array.isArray(picked) ? picked[0] : picked
  if (!root) return null
  return scanNativeFolderPath(root, onPicked)
}

/** 桌面: 扫描一个已知目录; 系统目录选择器和原生拖拽共用 */
export async function scanNativeFolderPath(root: string, onPicked?: (name: string) => void): Promise<FolderScan> {
  const trimmed = root.replace(/[\\/]+$/, '') || root
  const name = trimmed.split(/[\\/]/).pop() || trimmed
  onPicked?.(name)
  // 原生一次递归扫描并带回大小 / 修改时间 (src-tauri/src/folder_scan.rs); 以前每个目录一次 readDir、每本书一次 stat
  const { invoke } = await import('@tauri-apps/api/core')
  const scan = await invoke<{ entries: FolderFile[]; truncated: boolean }>('folder_scan', {
    root: trimmed, maxFiles: FOLDER_MAX_FILES, maxDepth: FOLDER_MAX_DEPTH, skipDirs: [...IGNORED_DIRS],
  })
  return {
    name,
    rootPath: trimmed,
    entries: scan.entries.map(entry => ({ ...entry, rootPath: trimmed })),
    truncated: scan.truncated,
  }
}

/** 取得条目的 File (桌面端此时才从磁盘读出) */
export async function loadFolderFile(entry: FolderFile): Promise<File> {
  if (entry.file) return entry.file
  if (!entry.rootPath) throw new Error('missing folder root')
  const { invoke } = await import('@tauri-apps/api/core')
  const bytes = await invoke<Uint8Array>('folder_read_file', {
    root: entry.rootPath,
    relPath: entry.path,
  })
  return new File([bytes as Uint8Array<ArrayBuffer>], entry.name, { lastModified: entry.lastModified })
}

/** 原生拖入单个文件: 从绝对路径拆出父目录和文件名, 再走与文件夹导入相同的受限读取命令 */
export function droppedFileEntry(path: string): { name: string; load: () => Promise<File> } {
  const normalized = path.replace(/\\/g, '/')
  const slash = normalized.lastIndexOf('/')
  const name = normalized.slice(slash + 1) || normalized
  const root = slash > 0 ? normalized.slice(0, slash) : normalized
  return {
    name,
    load: async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      const bytes = await invoke<Uint8Array>('folder_read_file', { root, relPath: name })
      return new File([bytes as Uint8Array<ArrayBuffer>], name)
    },
  }
}
