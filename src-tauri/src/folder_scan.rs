//! 「选择文件夹」导入的目录扫描: 一次 IPC 递归遍历并带回大小 / 修改时间.
//!
//! 以前前端用 plugin-fs 每个目录一次 `readDir`、每本候选书一次 `stat`, 几千个文件的书库要上千次 IPC.
//! 规则与 src/services/folderSource.ts 原实现一致: 不跟随符号链接; 目录深度与文件数上限由前端给;
//! 跳过以 `.` 开头的目录和前端给的忽略目录名 (folderPick.ts 的 IGNORED_DIRS, 不区分大小写);
//! 读不了的子目录静默跳过. 文件是否算书、是否忽略仍由前端判断.

use std::path::{Component, Path, PathBuf};

use serde::Serialize;

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScannedFile {
  /// 相对所选文件夹的路径, 用 `/` 分隔
  pub path: String,
  pub name: String,
  pub abs_path: String,
  pub size: u64,
  /// 毫秒时间戳; 取不到时省略
  #[serde(skip_serializing_if = "Option::is_none")]
  pub last_modified: Option<u64>,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct FolderScanResult {
  pub entries: Vec<ScannedFile>,
  /// 文件超过上限, 只返回了前 `max_files` 个
  pub truncated: bool,
}

struct Walk<'a> {
  max_files: usize,
  max_depth: usize,
  skip_dirs: &'a [String],
  seen: usize,
  out: FolderScanResult,
}

impl Walk<'_> {
  fn skip_dir(&self, name: &str) -> bool {
    let lower = name.to_lowercase();
    name.starts_with('.') || self.skip_dirs.iter().any(|d| d.to_lowercase() == lower)
  }

  fn walk(&mut self, dir: &Path, rel: &str, depth: usize) {
    let Ok(items) = std::fs::read_dir(dir) else { return }; // 无权限的子目录跳过
    for item in items.flatten() {
      if self.out.truncated {
        return;
      }
      let Ok(kind) = item.file_type() else { continue };
      if kind.is_symlink() {
        continue; // 不跟随, 避免环
      }
      let name = item.file_name().to_string_lossy().into_owned();
      let path = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
      if kind.is_dir() {
        if depth < self.max_depth && !self.skip_dir(&name) {
          self.walk(&item.path(), &path, depth + 1);
        }
        continue;
      }
      if !kind.is_file() {
        continue;
      }
      self.seen += 1;
      if self.seen > self.max_files {
        self.out.truncated = true;
        return;
      }
      let meta = item.metadata().ok();
      let last_modified = meta
        .as_ref()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64);
      self.out.entries.push(ScannedFile {
        path,
        name,
        abs_path: item.path().to_string_lossy().into_owned(),
        size: meta.map(|m| m.len()).unwrap_or(0),
        last_modified,
      });
    }
  }
}

/// 递归扫描 `root` (与 Tauri 无关, 便于单测). 根目录本身算第 1 层.
pub fn scan(root: &Path, max_files: usize, max_depth: usize, skip_dirs: &[String]) -> FolderScanResult {
  let mut walk = Walk { max_files, max_depth, skip_dirs, seen: 0, out: FolderScanResult { entries: Vec::new(), truncated: false } };
  walk.walk(root, "", 1);
  walk.out
}

#[tauri::command]
pub async fn folder_scan(root: String, max_files: usize, max_depth: usize, skip_dirs: Vec<String>) -> Result<FolderScanResult, String> {
  let root = PathBuf::from(root);
  if !root.is_absolute() || !root.is_dir() {
    return Err(format!("file: 不是文件夹 {}", root.display()));
  }
  tauri::async_runtime::spawn_blocking(move || scan(&root, max_files, max_depth, &skip_dirs))
    .await
    .map_err(|e| format!("file: {e}"))
}

/// 解析目录内的相对文件路径, 拒绝绝对路径、`..` 和符号链接逃逸.
pub fn resolve_folder_file(root: &Path, rel_path: &str) -> Result<PathBuf, String> {
  let rel = Path::new(rel_path);
  if rel_path.is_empty()
    || rel.is_absolute()
    || rel.components().any(|part| !matches!(part, Component::Normal(_)))
  {
    return Err("file: 无效的相对路径".into());
  }
  let root = root
    .canonicalize()
    .map_err(|e| format!("file: 无法打开文件夹 {e}"))?;
  let file = root
    .join(rel)
    .canonicalize()
    .map_err(|e| format!("file: 无法读取文件 {e}"))?;
  if !file.starts_with(&root) || !file.is_file() {
    return Err("file: 文件不在导入目录内".into());
  }
  Ok(file)
}

/// 读取扫描目录内的单个文件. 原生拖拽没有对话框授予的 fs scope, 因此由 Rust
/// 校验路径必须位于当次扫描根目录内, 再把字节传给前端.
#[tauri::command]
pub async fn folder_read_file(root: String, rel_path: String) -> Result<tauri::ipc::Response, String> {
  let root = PathBuf::from(root);
  if !root.is_absolute() || !root.is_dir() {
    return Err(format!("file: 不是文件夹 {}", root.display()));
  }
  let file = resolve_folder_file(&root, &rel_path)?;
  tauri::async_runtime::spawn_blocking(move || {
    std::fs::read(file)
      .map(tauri::ipc::Response::new)
      .map_err(|e| format!("file: 读取文件失败 {e}"))
  })
  .await
  .map_err(|e| format!("file: {e}"))?
}

#[cfg(test)]
mod tests {
  use super::*;

  fn tree(name: &str) -> PathBuf {
    let base = std::env::temp_dir().join(format!("lr-scan-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&base);
    for (rel, len) in [
      ("a.epub", 3),
      ("sub/b.pdf", 5),
      ("sub/deep/c.txt", 1),
      (".git/x.epub", 9),
      ("__MACOSX/._a.epub", 2),
      ("@eaDir/thumb.jpg", 2),
    ] {
      let p = base.join(rel);
      std::fs::create_dir_all(p.parent().unwrap()).unwrap();
      std::fs::write(p, vec![0u8; len]).unwrap();
    }
    base
  }

  fn paths(r: &FolderScanResult) -> Vec<String> {
    let mut v: Vec<_> = r.entries.iter().map(|e| e.path.clone()).collect();
    v.sort();
    v
  }

  #[test]
  fn walks_recursively_with_sizes_and_skips_ignored_dirs() {
    let base = tree("walk");
    let skip = vec!["__macosx".to_string(), "@eadir".to_string()];
    let r = scan(&base, 100, 8, &skip);
    assert_eq!(paths(&r), vec!["a.epub", "sub/b.pdf", "sub/deep/c.txt"]);
    assert!(!r.truncated);
    let b = r.entries.iter().find(|e| e.path == "sub/b.pdf").unwrap();
    assert_eq!((b.size, b.name.as_str()), (5, "b.pdf"));
    assert!(b.abs_path.ends_with("b.pdf") && b.last_modified.is_some());
    std::fs::remove_dir_all(base).unwrap();
  }

  #[test]
  fn respects_depth_and_file_limits() {
    let base = tree("limits");
    let skip = vec!["__macosx".to_string(), "@eadir".to_string()];
    // 第 1 层是根: 深度 2 能进 sub, 进不了 sub/deep
    assert_eq!(paths(&scan(&base, 100, 2, &skip)), vec!["a.epub", "sub/b.pdf"]);
    let r = scan(&base, 1, 8, &skip);
    assert_eq!(r.entries.len(), 1);
    assert!(r.truncated);
    std::fs::remove_dir_all(base).unwrap();
  }

  #[test]
  fn resolves_only_files_inside_the_scan_root() {
    let base = tree("read");
    let root = base.canonicalize().unwrap();
    assert_eq!(
      resolve_folder_file(&root, "sub/b.pdf").unwrap(),
      root.join("sub/b.pdf").canonicalize().unwrap()
    );
    assert!(resolve_folder_file(&root, "../outside.pdf").is_err());
    assert!(resolve_folder_file(&root, "sub").is_err());
    assert!(resolve_folder_file(&root, "missing.pdf").is_err());
    std::fs::remove_dir_all(base).unwrap();
  }

  #[cfg(unix)]
  #[test]
  fn does_not_follow_symlinks() {
    let base = tree("links");
    std::os::unix::fs::symlink(&base, base.join("loop")).unwrap();
    std::os::unix::fs::symlink(base.join("a.epub"), base.join("link.epub")).unwrap();
    let r = scan(&base, 100, 8, &[]);
    assert!(paths(&r).iter().all(|p| !p.starts_with("loop") && p != "link.epub"));
    std::fs::remove_dir_all(base).unwrap();
  }
}
