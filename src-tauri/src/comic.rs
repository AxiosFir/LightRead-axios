//! CBR (RAR 漫画包) → CBZ, 桌面原生实现.
//!
//! 以前每次打开 CBR 都在 WebView 里用 unrar wasm 解出全部图片, 再用 fflate 重新压缩成 CBZ 交给 foliate。
//! 现在桌面第一次打开时由 Rust (UnRAR, 与 node-unrar-js 同源的 RARLAB 代码) 解包, 按原顺序写成 store 模式
//! CBZ 缓存在书库 `books/<id>.cbr.cbz`, 之后直接读缓存。移动端 / 网页版仍走 src/services/comic.ts。
//! 只收图片; 加密或没有图片时报错, 前端退回 JS 实现给出原有提示。

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use std::path::{Path, PathBuf};

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use crate::backup_zip::{write_zip, Source};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use crate::http_upload::{resolve_library_file, FileRef};

#[cfg(not(any(target_os = "android", target_os = "ios")))]
const IMAGE_EXTS: [&str; 7] = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "avif"];

#[cfg(not(any(target_os = "android", target_os = "ios")))]
/// 与 comic.ts 的 IMAGE_RE 一致
pub fn is_image(name: &str) -> bool {
  name.rsplit_once('.').is_some_and(|(_, ext)| IMAGE_EXTS.iter().any(|e| e.eq_ignore_ascii_case(ext)))
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
/// 包内路径改成 ZIP 可用的相对路径: `\` → `/`, 去掉空段 / `.` / `..`
fn zip_name(name: &str) -> Option<String> {
  let parts: Vec<&str> = name.split(['/', '\\']).filter(|s| !s.is_empty() && *s != "." && *s != "..").collect();
  (!parts.is_empty()).then(|| parts.join("/"))
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
/// 解出 `src` 里满足 `keep` 的文件 (按包内顺序), 写成 store 模式 ZIP 到 `dest`; 返回收进去的文件数.
/// 先写 `<dest>.part` 再改名, 失败删除半截文件. 与 Tauri 无关, 便于单测.
pub fn rar_to_zip(src: &Path, dest: &Path, keep: impl Fn(&str) -> bool) -> Result<usize, String> {
  let bad = |e: unrar::error::UnrarError| format!("archive: {e}");
  let mut archive = unrar::Archive::new(src).open_for_processing().map_err(bad)?;
  let mut entries = Vec::new();
  while let Some(header) = archive.read_header().map_err(bad)? {
    let entry = header.entry();
    let name = entry.filename.to_string_lossy().into_owned();
    archive = match (entry.is_file() && keep(&name), zip_name(&name)) {
      (true, Some(zip)) => {
        let (data, next) = header.read().map_err(bad)?;
        entries.push((zip, Source::Bytes(data)));
        next
      }
      _ => header.skip().map_err(bad)?,
    };
  }
  if entries.is_empty() {
    return Err("archive: RAR 包中没有找到可用的文件 (或文件已加密)".into());
  }
  let count = entries.len();
  let mut part = dest.as_os_str().to_owned();
  part.push(".part");
  let part = PathBuf::from(part);
  let result = std::fs::File::create(&part)
    .map_err(|e| format!("file: {e}"))
    .and_then(|file| write_zip(file, entries, u32::MAX as u64, |_| {}))
    .and_then(|_| std::fs::rename(&part, dest).map_err(|e| format!("file: {e}")));
  if let Err(e) = result {
    let _ = std::fs::remove_file(&part);
    return Err(e);
  }
  Ok(count)
}

/// 书库里的 CBR (`rel`) 转成 CBZ 缓存 (`cache_rel`); 缓存已存在且不比原文件旧时直接复用. 返回缓存大小.
#[tauri::command]
pub async fn comic_cbr_cache<R: tauri::Runtime>(
  app: tauri::AppHandle<R>,
  root: String,
  rel: String,
  cache_rel: String,
) -> Result<u64, String> {
  #[cfg(any(target_os = "android", target_os = "ios"))]
  {
    let _ = (app, root, rel, cache_rel);
    Err("unsupported: 移动端用前端 unrar wasm".to_string())
  }
  #[cfg(not(any(target_os = "android", target_os = "ios")))]
  {
    use tauri::Manager;
    let app_data = app.path().app_data_dir().ok();
    let src = resolve_library_file(app_data.clone(), &FileRef { root: root.clone(), rel })?;
    let dest = resolve_library_file(app_data, &FileRef { root, rel: cache_rel })?;
    tauri::async_runtime::spawn_blocking(move || {
      let modified = |p: &Path| std::fs::metadata(p).and_then(|m| m.modified()).ok();
      if let (Some(cached), Some(original)) = (modified(&dest), modified(&src)) {
        if cached >= original {
          return std::fs::metadata(&dest).map(|m| m.len()).map_err(|e| format!("file: {e}"));
        }
      }
      rar_to_zip(&src, &dest, is_image)?;
      std::fs::metadata(&dest).map(|m| m.len()).map_err(|e| format!("file: {e}"))
    })
    .await
    .map_err(|e| format!("file: {e}"))?
  }
}

#[cfg(all(test, not(any(target_os = "android", target_os = "ios"))))]
mod tests {
  use super::*;

  /// 测试样本取自 unrar crate 0.5.8 的 data/ (MIT, 见 testdata/unrar-fixtures-LICENSE-MIT.txt)
  fn fixture(name: &str, bytes: &[u8]) -> PathBuf {
    let p = std::env::temp_dir().join(format!("lr-comic-{}-{name}", std::process::id()));
    std::fs::write(&p, bytes).unwrap();
    p
  }

  fn zip_entries(path: &Path) -> Vec<(String, Vec<u8>)> {
    let mut f = std::fs::File::open(path).unwrap();
    let entries = crate::backup_zip::read_central(&mut f).unwrap();
    entries
      .iter()
      .map(|e| {
        let mut data = Vec::new();
        std::io::Read::read_to_end(&mut crate::backup_zip::open_entry(&mut f, e).unwrap(), &mut data).unwrap();
        (e.name.clone(), data)
      })
      .collect()
  }

  #[test]
  fn converts_solid_and_unicode_archives() {
    for (name, bytes, want) in [
      ("solid.rar", &include_bytes!("testdata/unrar-solid.rar")[..], ".gitignore"),
      ("unicode.rar", &include_bytes!("testdata/unrar-unicode-entry.rar")[..], "unicodefilename❤\u{fe0f}.txt"),
    ] {
      let src = fixture(name, bytes);
      let dest = src.with_extension("cbz");
      // 样本里没有图片: 收全部文件来验证解包与写包
      assert_eq!(rar_to_zip(&src, &dest, |_| true).unwrap(), 1);
      let entries = zip_entries(&dest);
      assert_eq!(entries[0].0, want);
      assert!(!entries[0].1.is_empty());
      assert!(!dest.with_extension("cbz.part").exists());
      // 只收图片时没有可用文件 → 报错且不留半截文件
      let dest2 = src.with_extension("img.cbz");
      assert!(rar_to_zip(&src, &dest2, is_image).unwrap_err().starts_with("archive:"));
      assert!(!dest2.exists());
      for p in [src, dest] {
        std::fs::remove_file(p).unwrap();
      }
    }
  }

  #[test]
  fn encrypted_archive_fails_cleanly() {
    let src = fixture("crypted.rar", include_bytes!("testdata/unrar-crypted.rar"));
    let dest = src.with_extension("cbz");
    assert!(rar_to_zip(&src, &dest, |_| true).is_err());
    assert!(!dest.exists());
    std::fs::remove_file(src).unwrap();
  }

  #[test]
  fn image_filter_and_names_match_frontend_rules() {
    for ok in ["a.JPG", "dir/b.jpeg", "c.png", "d.webp", "e.avif", "f.gif", "g.bmp"] {
      assert!(is_image(ok), "{ok}");
    }
    for no in ["a.txt", "jpg", "cover.jpg.zip", "noext"] {
      assert!(!is_image(no), "{no}");
    }
    assert_eq!(zip_name("ch1\\001.jpg").as_deref(), Some("ch1/001.jpg"));
    assert_eq!(zip_name("/../x/./y.png").as_deref(), Some("x/y.png"));
    assert_eq!(zip_name("../.."), None);
  }
}
