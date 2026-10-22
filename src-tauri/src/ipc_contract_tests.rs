//! 书库原生命令的 IPC 契约: 用前端实际发送的 JSON (camelCase 参数名、Channel) 走 Tauri 的真实反序列化,
//! 覆盖 src/services/backup.ts 与 src/storage/tauri.ts 的调用: 导出藏书包 → 打开 → 校验 → 解到书库 →
//! 读封面 → 换书库文件夹 → 改名. 运行: `cargo test --manifest-path src-tauri/Cargo.toml ipc_contract`

use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{
  ipc::{CallbackFn, InvokeBody, InvokeResponseBody},
  test::{get_ipc_response, mock_builder, mock_context, noop_assets, MockRuntime, INVOKE_KEY},
  webview::InvokeRequest,
  WebviewWindow, WebviewWindowBuilder,
};

use crate::{backup_zip, library_files};

fn app() -> WebviewWindow<MockRuntime> {
  let app = mock_builder()
    .invoke_handler(tauri::generate_handler![
      library_files::library_file_rename,
      library_files::library_file_size,
      library_files::library_migrate,
      crate::http_upload::http_upload_file,
      crate::folder_scan::folder_scan,
      crate::comic::comic_cbr_cache,
      crate::txt_epub::txt_epub_cache,
      crate::epub_meta::epub_metadata,
      crate::epub_meta::epub_read_entry,
      library_files::library_file_remove_derived,
      backup_zip::library_files_describe,
      backup_zip::backup_write_zip,
      backup_zip::backup_open,
      backup_zip::backup_verify,
      backup_zip::backup_extract,
      backup_zip::backup_read_entry,
    ])
    .build(mock_context(noop_assets()))
    .unwrap();
  WebviewWindowBuilder::new(&app, "main", Default::default()).build().unwrap()
}

fn call(w: &WebviewWindow<MockRuntime>, cmd: &str, args: Value) -> Result<InvokeResponseBody, Value> {
  get_ipc_response(
    w,
    InvokeRequest {
      cmd: cmd.into(),
      callback: CallbackFn(0),
      error: CallbackFn(1),
      url: if cfg!(windows) { "http://tauri.localhost" } else { "tauri://localhost" }.parse().unwrap(),
      body: InvokeBody::Json(args),
      headers: Default::default(),
      invoke_key: INVOKE_KEY.to_string(),
    },
  )
}

fn json_of(res: Result<InvokeResponseBody, Value>) -> Value {
  res.expect("command failed").deserialize::<Value>().unwrap()
}

/// 前端 `new Channel()` 传给命令的形式
const CHANNEL: &str = "__CHANNEL__:7";

fn sha(b: &[u8]) -> String {
  Sha256::digest(b).iter().map(|x| format!("{x:02x}")).collect()
}

fn library(dir: &Path, book: &[u8]) {
  std::fs::create_dir_all(dir.join("books")).unwrap();
  std::fs::create_dir_all(dir.join("covers")).unwrap();
  std::fs::write(dir.join("lightread.db"), b"sqlite").unwrap();
  std::fs::write(dir.join("books/b1.epub"), book).unwrap();
  std::fs::write(dir.join("covers/b1.jpg"), b"jpeg-bytes").unwrap();
}

#[test]
fn backup_export_import_migrate_and_rename_roundtrip() {
  let base: PathBuf = std::env::temp_dir().join(format!("lr-ipc-{}", std::process::id()));
  let _ = std::fs::remove_dir_all(&base);
  let (src_lib, dst_lib, moved) = (base.join("lib"), base.join("restore"), base.join("moved"));
  let book: Vec<u8> = (0..300_000u32).map(|i| (i % 251) as u8).collect();
  library(&src_lib, &book);
  library(&dst_lib, b"other");
  let root = src_lib.to_str().unwrap();
  let w = app();

  // 导出: 先描述 (清单要 SHA-256), 再按顺序写包 (exportBackupToFile)
  let digests = json_of(call(&w, "library_files_describe", json!({ "root": root, "rels": ["books/b1.epub"] })));
  assert_eq!(digests[0]["size"], json!(book.len()));
  assert_eq!(digests[0]["sha256"], json!(sha(&book)));
  let archive = base.join("export.okf.zip");
  call(&w, "backup_write_zip", json!({
    "root": root,
    "dest": archive.to_str().unwrap(),
    "entries": [
      { "path": "assets/books/b1/content.epub", "rel": "books/b1.epub" },
      { "path": "assets/books/b1/cover.jpg", "rel": "covers/b1.jpg" },
      { "path": "index.md", "text": "---\nokf_version: '0.1'\n---\n# 书库" },
      { "path": "manifest.json", "text": "{}" },
    ],
    "onProgress": CHANNEL,
  }))
  .expect("backup_write_zip");
  assert!(archive.is_file());
  assert!(!base.join("export.okf.zip.part").exists());

  // 导入 (importBackupFromFile): 只拿文本项
  let src = archive.to_str().unwrap();
  let index = json_of(call(&w, "backup_open", json!({ "src": src })));
  assert_eq!(index["texts"]["manifest.json"], json!("{}"));
  assert!(index["texts"].get("assets/books/b1/content.epub").is_none());

  let verdict = json_of(call(&w, "backup_verify", json!({ "src": src, "checks": [
    { "path": "assets/books/b1/content.epub", "byteLength": book.len(), "sha256": sha(&book) },
    { "path": "assets/books/b1/cover.jpg" },
    { "path": "assets/books/b1/content.epub", "sha256": "deadbeef" },
    { "path": "assets/missing.pdf", "byteLength": 1 },
  ]})));
  assert_eq!(verdict, json!(["", "", "sha256", "missing"]));

  let restore_root = dst_lib.to_str().unwrap();
  let staged = "books/sync-restore-1.part";
  let extracted = json_of(call(&w, "backup_extract", json!({
    "src": src, "path": "assets/books/b1/content.epub", "root": restore_root, "rel": staged,
  })));
  assert_eq!(extracted, json!(sha(&book)));
  assert_eq!(std::fs::read(dst_lib.join(staged)).unwrap(), book);

  match call(&w, "backup_read_entry", json!({ "src": src, "path": "assets/books/b1/cover.jpg" })).unwrap() {
    InvokeResponseBody::Raw(bytes) => assert_eq!(bytes, b"jpeg-bytes"),
    other => panic!("封面应以二进制返回: {other:?}"),
  }

  // addBookFromStaged → library_file_rename
  call(&w, "library_file_rename", json!({ "root": restore_root, "from": staged, "to": "books/new.epub" })).unwrap();
  assert_eq!(std::fs::read(dst_lib.join("books/new.epub")).unwrap(), book);
  // updateBook 改名时旧文件不存在: 前端靠 "os error 2" 识别并跳过
  let missing = call(&w, "library_file_rename", json!({ "root": restore_root, "from": "books/gone.epub", "to": "books/x.epub" }))
    .unwrap_err();
  assert!(missing.as_str().unwrap().contains("os error 2"), "{missing}");

  // 路径越界一律拒绝
  assert!(call(&w, "backup_extract", json!({ "src": src, "path": "index.md", "root": restore_root, "rel": "../evil" })).is_err());
  assert!(call(&w, "backup_write_zip", json!({
    "root": root, "dest": base.join("bad.zip").to_str().unwrap(),
    "entries": [{ "path": "../escape", "text": "x" }], "onProgress": CHANNEL,
  })).is_err());
  assert!(!base.join("bad.zip").exists() && !base.join("bad.zip.part").exists());

  // 换书库文件夹 (migrateLibraryTo)
  let bytes = json_of(call(&w, "library_migrate", json!({
    "fromRoot": root, "toRoot": moved.to_str().unwrap(), "onProgress": CHANNEL,
  })));
  assert_eq!(bytes, json!(6 + book.len() + 10));
  assert_eq!(std::fs::read(moved.join("books/b1.epub")).unwrap(), book);
  assert_eq!(std::fs::read(moved.join("lightread.db")).unwrap(), b"sqlite");
  assert!(call(&w, "library_migrate", json!({ "fromRoot": root, "toRoot": "relative/path", "onProgress": CHANNEL })).is_err());

  std::fs::remove_dir_all(&base).unwrap();
}

/// 互传发送书籍 (src/services/transfer/http.ts nativeFileUpload) + 取大小 (sendBookToDevices)
#[test]
fn transfer_uploads_library_file_natively() {
  use std::io::{Read, Write};
  let base: PathBuf = std::env::temp_dir().join(format!("lr-ipc-up-{}", std::process::id()));
  let _ = std::fs::remove_dir_all(&base);
  let book: Vec<u8> = (0..700_000u32).map(|i| (i % 241) as u8).collect();
  library(&base, &book);
  let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
  let addr = listener.local_addr().unwrap();
  let server = std::thread::spawn(move || {
    let (mut s, _) = listener.accept().unwrap();
    let mut buf = Vec::new();
    let mut chunk = [0u8; 65536];
    loop {
      let n = s.read(&mut chunk).unwrap();
      buf.extend_from_slice(&chunk[..n]);
      if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
        if buf.len() >= i + 4 + 700_000 || n == 0 {
          s.write_all(b"HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n").unwrap();
          return (String::from_utf8_lossy(&buf[..i]).to_string(), buf[i + 4..].to_vec());
        }
      }
    }
  });
  let root = base.to_str().unwrap();
  let w = app();
  assert_eq!(json_of(call(&w, "library_file_size", json!({ "root": root, "rel": "books/b1.epub" }))), json!(book.len()));
  let res = json_of(call(&w, "http_upload_file", json!({
    "url": format!("http://{addr}/v1/transfers/t1/blob"),
    "method": "PUT",
    "headers": { "content-type": "application/octet-stream", "authorization": "Bearer x" },
    "proxy": null,
    "root": root,
    "rel": "books/b1.epub",
    "onProgress": CHANNEL,
  })));
  assert_eq!(res["status"], json!(204));
  let (head, body) = server.join().unwrap();
  assert!(head.to_ascii_lowercase().contains("authorization: bearer x"), "{head}");
  assert_eq!(body, book);
  // 书库外的路径一律拒绝
  assert!(call(&w, "http_upload_file", json!({
    "url": "http://127.0.0.1:9/", "headers": {}, "root": root, "rel": "../secret", "onProgress": CHANNEL,
  })).is_err());
  std::fs::remove_dir_all(&base).unwrap();
}

/// 选择文件夹导入 (src/services/folderSource.ts scanNativeFolder)
#[test]
fn folder_scan_matches_frontend_payload() {
  let base: PathBuf = std::env::temp_dir().join(format!("lr-ipc-scan-{}", std::process::id()));
  let _ = std::fs::remove_dir_all(&base);
  for rel in ["书/a.epub", "@eaDir/t.jpg", ".hidden/x.pdf"] {
    let p = base.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, b"abc").unwrap();
  }
  let w = app();
  let r = json_of(call(&w, "folder_scan", json!({
    "root": base.to_str().unwrap(), "maxFiles": 5000, "maxDepth": 8, "skipDirs": ["__macosx", "@eadir"],
  })));
  assert_eq!(r["truncated"], json!(false));
  let entries = r["entries"].as_array().unwrap();
  assert_eq!(entries.len(), 1, "{r}");
  assert_eq!(entries[0]["path"], json!("书/a.epub"));
  assert_eq!(entries[0]["size"], json!(3));
  assert!(entries[0]["absPath"].as_str().unwrap().ends_with("a.epub"));
  assert!(entries[0]["lastModified"].is_u64());
  assert!(call(&w, "folder_scan", json!({ "root": "relative", "maxFiles": 1, "maxDepth": 1, "skipDirs": [] })).is_err());
  std::fs::remove_dir_all(&base).unwrap();
}

/// 桌面 CBR 原生缓存 (src/storage/tauri.ts getComicCbz): 参数映射、缓存复用、失败不留文件
#[test]
fn comic_cbr_cache_matches_frontend_payload() {
  let base: PathBuf = std::env::temp_dir().join(format!("lr-ipc-cbr-{}", std::process::id()));
  let _ = std::fs::remove_dir_all(&base);
  library(&base, b"x");
  // 样本里没有图片 → 走 "无可用文件" 的报错路径; 前端据此退回 unrar wasm
  std::fs::write(base.join("books/c1.cbr"), include_bytes!("testdata/unrar-solid.rar")).unwrap();
  let w = app();
  let root = base.to_str().unwrap();
  let err = call(&w, "comic_cbr_cache", json!({ "root": root, "rel": "books/c1.cbr", "cacheRel": "books/c1.cbr.cbz" })).unwrap_err();
  assert!(err.as_str().unwrap().starts_with("archive:"), "{err}");
  assert!(!base.join("books/c1.cbr.cbz").exists() && !base.join("books/c1.cbr.cbz.part").exists());
  // 已有不旧于原书的缓存: 直接复用, 不再解包
  std::fs::write(base.join("books/c1.cbr.cbz"), b"cached").unwrap();
  assert_eq!(json_of(call(&w, "comic_cbr_cache", json!({ "root": root, "rel": "books/c1.cbr", "cacheRel": "books/c1.cbr.cbz" }))), json!(6));
  assert!(call(&w, "comic_cbr_cache", json!({ "root": root, "rel": "books/c1.cbr", "cacheRel": "../x.cbz" })).is_err());
  std::fs::remove_dir_all(&base).unwrap();
}

/// 桌面 TXT 原生 EPUB 缓存 (getTextEpub) + 删书清理派生缓存 (deleteBook)
#[test]
fn txt_epub_cache_and_remove_derived() {
  let base: PathBuf = std::env::temp_dir().join(format!("lr-ipc-txt-{}", std::process::id()));
  let _ = std::fs::remove_dir_all(&base);
  library(&base, b"x");
  std::fs::write(base.join("books/t1.txt"), "第一章 开始\n正文\n".as_bytes()).unwrap();
  std::fs::write(base.join("books/t1.txt.v1.epub"), b"old layout").unwrap();
  let w = app();
  let root = base.to_str().unwrap();
  let args = json!({ "root": root, "rel": "books/t1.txt", "fileName": "我的书.txt" });
  let rel = json_of(call(&w, "txt_epub_cache", args.clone()));
  let want = format!("books/t1.txt.v{}.epub", crate::txt_epub::LAYOUT);
  assert_eq!(rel, json!(want));
  assert!(!base.join("books/t1.txt.v1.epub").exists(), "旧版式缓存应删掉");
  let epub = std::fs::read(base.join(&want)).unwrap();
  let mut f = std::io::Cursor::new(epub);
  let names: Vec<String> = crate::backup_zip::read_central(&mut f).unwrap().into_iter().map(|e| e.name).collect();
  assert_eq!(names[0], "mimetype");
  assert!(names.contains(&"OEBPS/s0.xhtml".to_string()));
  // 再次调用复用缓存 (不改写)
  let before = std::fs::metadata(base.join(&want)).unwrap().modified().unwrap();
  assert_eq!(json_of(call(&w, "txt_epub_cache", args)), json!(want));
  assert_eq!(std::fs::metadata(base.join(&want)).unwrap().modified().unwrap(), before);
  // 删书: 派生缓存全删, 原书与别的书不动
  std::fs::write(base.join("books/t1.txt.cbz"), b"x").unwrap();
  std::fs::write(base.join("books/t10.txt"), b"other").unwrap();
  assert_eq!(json_of(call(&w, "library_file_remove_derived", json!({ "root": root, "rel": "books/t1.txt" }))), json!(2));
  assert!(base.join("books/t1.txt").exists() && base.join("books/t10.txt").exists());
  assert!(!base.join(&want).exists());
  std::fs::remove_dir_all(&base).unwrap();
}

/// 桌面导入 EPUB 原生取元数据与封面 (src/storage/tauri.ts getEpubMeta)
#[test]
fn epub_metadata_and_cover_match_frontend_payload() {
  use base64::Engine as _;
  let golden: Value = serde_json::from_str(include_str!("testdata/epub-meta-golden.json")).unwrap();
  let case = golden["cases"].as_array().unwrap().iter().find(|c| c["name"] == "epub3-basic").unwrap();
  let epub = base64::engine::general_purpose::STANDARD.decode(case["epubBase64"].as_str().unwrap()).unwrap();
  let base: PathBuf = std::env::temp_dir().join(format!("lr-ipc-epub-{}", std::process::id()));
  let _ = std::fs::remove_dir_all(&base);
  library(&base, b"x");
  std::fs::write(base.join("books/e1.epub"), &epub).unwrap();
  let w = app();
  let root = base.to_str().unwrap();
  let m = json_of(call(&w, "epub_metadata", json!({ "root": root, "rel": "books/e1.epub" })));
  assert_eq!(m["title"], case["expected"]["title"]);
  assert_eq!(m["author"], case["expected"]["author"]);
  assert_eq!(m["coverHref"], case["expected"]["coverHref"]);
  assert_eq!(m["coverMediaType"], case["expected"]["coverType"]);
  match call(&w, "epub_read_entry", json!({ "root": root, "rel": "books/e1.epub", "path": m["coverHref"] })).unwrap() {
    InvokeResponseBody::Raw(bytes) => assert!(bytes.starts_with(b"\x89PNG"), "封面应是 PNG"),
    other => panic!("封面应以二进制返回: {other:?}"),
  }
  // 不是 EPUB: 报错 (前端退回 foliate)
  std::fs::write(base.join("books/bad.epub"), b"not a zip").unwrap();
  assert!(call(&w, "epub_metadata", json!({ "root": root, "rel": "books/bad.epub" })).is_err());
  std::fs::remove_dir_all(&base).unwrap();
}
