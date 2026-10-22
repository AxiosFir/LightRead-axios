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
      library_files::library_migrate,
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
