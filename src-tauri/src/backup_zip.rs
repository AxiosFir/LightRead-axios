//! 藏书包导出: 书和封面由原生层流式写进 ZIP, 内容不经过 WebView.
//!
//! 以前前端把整个书库逐本读进 JS 内存再用 fflate `zipSync` 打包, 几 GB 的书库会把 WebView 撑爆.
//! 现在前端只生成清单等小文本, 书 / 封面以书库相对路径 (`books/…` `covers/…`) 交给这里:
//!  - `library_files_describe`: 一次读盘同时算 SHA-256 + CRC-32 + 大小 (清单里要写 SHA-256);
//!  - `backup_write_zip`: 按前端给的顺序写 store 模式 ZIP (书籍文件本身多已压缩, 与原 `level: 0` 一致),
//!    写到 `<dest>.part`, 成功后改名; 超过 4 GB / 65535 项时自动用 ZIP64.
//! 读取方 (前端 `importBackup` 用 fflate 的 `unzipSync`) 只依赖中央目录, 与原来的包格式兼容.
//!
//! 导入同理 (`backup_open` / `backup_verify` / `backup_extract` / `backup_read_entry`): 只把清单等文本
//! (`.md` / `.json`) 交给前端解析, 书在原生层校验 SHA-256 后直接解到书库暂存文件, 不经 WebView.
//! 支持 store 与 deflate (第三方 OKF 包可能压缩) 及 ZIP64.

use std::{
  collections::BTreeMap,
  fs::File,
  io::{BufWriter, Read, Seek, SeekFrom, Write},
  path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{ipc::Channel, Manager};

use crate::http_upload::{resolve_library_file, FileRef};

const BUF: usize = 1024 * 1024;
const U32_MAX: u64 = 0xFFFF_FFFF;
/// UTF-8 文件名标志 (书名 / 路径可能含中文)
const FLAG_UTF8: u16 = 1 << 11;
/// DOS 时间 1980-01-01 00:00 (包内时间戳无意义, 清单里有真正的导出时间)
const DOS_TIME: u16 = 0;
const DOS_DATE: u16 = (1 << 5) | 1;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct FileDigest {
  pub size: u64,
  pub sha256: String,
  pub crc32: u32,
}

/// 一次读盘算出大小 + SHA-256 + CRC-32
pub fn digest_file(path: &Path) -> Result<FileDigest, String> {
  let mut file = File::open(path).map_err(|e| format!("file: {e}"))?;
  let mut sha = Sha256::new();
  let mut crc = crc32fast::Hasher::new();
  let mut size = 0u64;
  let mut buf = vec![0u8; BUF];
  loop {
    let n = file.read(&mut buf).map_err(|e| format!("file: {e}"))?;
    if n == 0 {
      break;
    }
    sha.update(&buf[..n]);
    crc.update(&buf[..n]);
    size += n as u64;
  }
  let sha256 = sha.finalize().iter().map(|b| format!("{b:02x}")).collect();
  Ok(FileDigest { size, sha256, crc32: crc.finalize() })
}

/// 包内的一项: 小文本直接给内容, 书 / 封面给书库相对路径
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZipEntry {
  pub path: String,
  #[serde(default)]
  pub text: Option<String>,
  #[serde(default)]
  pub rel: Option<String>,
}

/// 已解析好的一项 (与 Tauri 无关, 便于单测)
pub enum Source {
  Bytes(Vec<u8>),
  File(PathBuf),
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct ZipProgress {
  pub done: usize,
  pub total: usize,
}

struct CentralRecord {
  name: Vec<u8>,
  crc32: u32,
  size: u64,
  offset: u64,
}

/// 包内路径: 相对、用 `/`、不含 `..` (防止解压时越出目录)
fn safe_entry_name(path: &str) -> Result<Vec<u8>, String> {
  let ok = !path.is_empty()
    && !path.starts_with('/')
    && !path.contains('\\')
    && !path.contains('\0')
    && path.split('/').all(|seg| !seg.is_empty() && seg != "." && seg != "..");
  if ok && path.len() <= u16::MAX as usize {
    Ok(path.as_bytes().to_vec())
  } else {
    Err(format!("request: 不允许的包内路径 {path}"))
  }
}

fn put16(out: &mut Vec<u8>, v: u16) {
  out.extend_from_slice(&v.to_le_bytes());
}
fn put32(out: &mut Vec<u8>, v: u32) {
  out.extend_from_slice(&v.to_le_bytes());
}
fn put64(out: &mut Vec<u8>, v: u64) {
  out.extend_from_slice(&v.to_le_bytes());
}

fn clamp32(v: u64, zip64: bool) -> u32 {
  if zip64 { U32_MAX as u32 } else { v as u32 }
}

/// 写 store 模式 ZIP. `zip64_threshold` 只为单测可调 (正式值为 4 GB - 1).
pub fn write_zip<W: Write>(
  out: W,
  entries: Vec<(String, Source)>,
  zip64_threshold: u64,
  mut progress: impl FnMut(ZipProgress),
) -> Result<u64, String> {
  let io = |e: std::io::Error| format!("file: {e}");
  let mut w = BufWriter::with_capacity(BUF, out);
  let mut pos = 0u64;
  let mut central = Vec::with_capacity(entries.len());
  let total = entries.len();
  let mut buf = vec![0u8; BUF];

  for (i, (path, source)) in entries.into_iter().enumerate() {
    progress(ZipProgress { done: i, total });
    let name = safe_entry_name(&path)?;
    // 先拿到 CRC 和大小, 本地头里直接写真实值 (不用数据描述符, 兼容性最好)
    let (crc32, size) = match &source {
      Source::Bytes(bytes) => (crc32fast::hash(bytes), bytes.len() as u64),
      Source::File(p) => {
        let d = digest_file(p)?;
        (d.crc32, d.size)
      }
    };
    let offset = pos;
    let big = size >= zip64_threshold;
    let mut head = Vec::with_capacity(30 + name.len() + 20);
    put32(&mut head, 0x0403_4b50);
    put16(&mut head, if big { 45 } else { 20 });
    put16(&mut head, FLAG_UTF8);
    put16(&mut head, 0); // store
    put16(&mut head, DOS_TIME);
    put16(&mut head, DOS_DATE);
    put32(&mut head, crc32);
    put32(&mut head, clamp32(size, big));
    put32(&mut head, clamp32(size, big));
    put16(&mut head, name.len() as u16);
    put16(&mut head, if big { 20 } else { 0 });
    head.extend_from_slice(&name);
    if big {
      put16(&mut head, 0x0001);
      put16(&mut head, 16);
      put64(&mut head, size);
      put64(&mut head, size);
    }
    w.write_all(&head).map_err(io)?;
    pos += head.len() as u64;

    match source {
      Source::Bytes(bytes) => w.write_all(&bytes).map_err(io)?,
      Source::File(p) => {
        let mut file = File::open(&p).map_err(io)?;
        let mut crc = crc32fast::Hasher::new();
        let mut copied = 0u64;
        loop {
          let n = file.read(&mut buf).map_err(io)?;
          if n == 0 {
            break;
          }
          crc.update(&buf[..n]);
          w.write_all(&buf[..n]).map_err(io)?;
          copied += n as u64;
        }
        if copied != size || crc.finalize() != crc32 {
          return Err(format!("file: 导出时文件被改动 {}", p.display()));
        }
      }
    }
    pos += size;
    central.push(CentralRecord { name, crc32, size, offset });
  }
  progress(ZipProgress { done: total, total });

  let cd_offset = pos;
  for rec in &central {
    let big_size = rec.size >= zip64_threshold;
    let big_offset = rec.offset >= zip64_threshold;
    let mut extra = Vec::new();
    if big_size {
      put64(&mut extra, rec.size);
      put64(&mut extra, rec.size);
    }
    if big_offset {
      put64(&mut extra, rec.offset);
    }
    let zip64 = !extra.is_empty();
    let mut h = Vec::with_capacity(46 + rec.name.len() + 4 + extra.len());
    put32(&mut h, 0x0201_4b50);
    // made by: Unix + ZIP 4.5. 标为 MS-DOS 时 Info-ZIP 会按 OEM 码页转换本地头里的中文名
    put16(&mut h, (3 << 8) | 45);
    put16(&mut h, if zip64 { 45 } else { 20 });
    put16(&mut h, FLAG_UTF8);
    put16(&mut h, 0);
    put16(&mut h, DOS_TIME);
    put16(&mut h, DOS_DATE);
    put32(&mut h, rec.crc32);
    put32(&mut h, clamp32(rec.size, big_size));
    put32(&mut h, clamp32(rec.size, big_size));
    put16(&mut h, rec.name.len() as u16);
    put16(&mut h, if zip64 { 4 + extra.len() as u16 } else { 0 });
    put16(&mut h, 0); // comment
    put16(&mut h, 0); // disk
    put16(&mut h, 0); // internal attrs
    put32(&mut h, 0o100644 << 16); // external attrs: 普通文件 rw-r--r--
    put32(&mut h, clamp32(rec.offset, big_offset));
    h.extend_from_slice(&rec.name);
    if zip64 {
      put16(&mut h, 0x0001);
      put16(&mut h, extra.len() as u16);
      h.extend_from_slice(&extra);
    }
    w.write_all(&h).map_err(io)?;
    pos += h.len() as u64;
  }
  let cd_size = pos - cd_offset;
  let count = central.len() as u64;

  let mut tail = Vec::new();
  let zip64_end = count >= 0xFFFF || cd_offset >= zip64_threshold || cd_size >= zip64_threshold;
  if zip64_end {
    let record_at = pos;
    put32(&mut tail, 0x0606_4b50);
    put64(&mut tail, 44);
    put16(&mut tail, 45);
    put16(&mut tail, 45);
    put32(&mut tail, 0);
    put32(&mut tail, 0);
    put64(&mut tail, count);
    put64(&mut tail, count);
    put64(&mut tail, cd_size);
    put64(&mut tail, cd_offset);
    put32(&mut tail, 0x0706_4b50);
    put32(&mut tail, 0);
    put64(&mut tail, record_at);
    put32(&mut tail, 1);
  }
  put32(&mut tail, 0x0605_4b50);
  put16(&mut tail, 0);
  put16(&mut tail, 0);
  put16(&mut tail, if zip64_end { 0xFFFF } else { count as u16 });
  put16(&mut tail, if zip64_end { 0xFFFF } else { count as u16 });
  put32(&mut tail, clamp32(cd_size, zip64_end));
  put32(&mut tail, clamp32(cd_offset, zip64_end));
  put16(&mut tail, 0);
  w.write_all(&tail).map_err(io)?;
  pos += tail.len() as u64;
  w.flush().map_err(io)?;
  Ok(pos)
}

fn library_path<R: tauri::Runtime>(app: &tauri::AppHandle<R>, root: &str, rel: String) -> Result<PathBuf, String> {
  resolve_library_file(app.path().app_data_dir().ok(), &FileRef { root: root.to_string(), rel })
}

#[tauri::command]
pub async fn library_files_describe<R: tauri::Runtime>(app: tauri::AppHandle<R>, root: String, rels: Vec<String>) -> Result<Vec<FileDigest>, String> {
  let paths = rels.into_iter().map(|rel| library_path(&app, &root, rel)).collect::<Result<Vec<_>, _>>()?;
  tauri::async_runtime::spawn_blocking(move || paths.iter().map(|p| digest_file(p)).collect())
    .await
    .map_err(|e| format!("file: {e}"))?
}

/// 按顺序把 `entries` 写成 `dest` (store 模式 ZIP). 先写 `<dest>.part`, 成功后改名, 失败删除半截文件.
#[tauri::command]
pub async fn backup_write_zip<R: tauri::Runtime>(
  app: tauri::AppHandle<R>,
  root: String,
  dest: String,
  entries: Vec<ZipEntry>,
  on_progress: Channel<ZipProgress>,
) -> Result<u64, String> {
  let dest = PathBuf::from(dest);
  if !dest.is_absolute() {
    return Err("file: 保存位置必须是绝对路径".into());
  }
  let mut sources = Vec::with_capacity(entries.len());
  for entry in entries {
    let source = match (entry.text, entry.rel) {
      (Some(text), None) => Source::Bytes(text.into_bytes()),
      (None, Some(rel)) => Source::File(library_path(&app, &root, rel)?),
      _ => return Err(format!("request: 包内项需要 text 或 rel 之一 {}", entry.path)),
    };
    sources.push((entry.path, source));
  }
  tauri::async_runtime::spawn_blocking(move || {
    let mut part = dest.clone().into_os_string();
    part.push(".part");
    let part = PathBuf::from(part);
    let result = File::create(&part)
      .map_err(|e| format!("file: {e}"))
      .and_then(|file| write_zip(file, sources, U32_MAX, |p| { let _ = on_progress.send(p); }))
      .and_then(|size| std::fs::rename(&part, &dest).map(|_| size).map_err(|e| format!("file: {e}")));
    if result.is_err() {
      let _ = std::fs::remove_file(&part);
    }
    result
  })
  .await
  .map_err(|e| format!("file: {e}"))?
}

// ---------------- 读取 (导入) ----------------

/// 中央目录里的一项
#[derive(Debug, Clone)]
pub struct CdEntry {
  pub name: String,
  method: u16,
  flags: u16,
  pub size: u64,
  csize: u64,
  offset: u64,
}

fn le16(b: &[u8], at: usize) -> u64 {
  u16::from_le_bytes([b[at], b[at + 1]]) as u64
}
fn le32(b: &[u8], at: usize) -> u64 {
  u32::from_le_bytes([b[at], b[at + 1], b[at + 2], b[at + 3]]) as u64
}
fn le64(b: &[u8], at: usize) -> u64 {
  u64::from_le_bytes(b[at..at + 8].try_into().unwrap())
}

fn bad(msg: &str) -> String {
  format!("archive: {msg}")
}

/// 读中央目录 (支持 ZIP64). 只读文件尾部和目录本身, 不读内容.
pub fn read_central<R: Read + Seek>(f: &mut R) -> Result<Vec<CdEntry>, String> {
  let io = |e: std::io::Error| format!("file: {e}");
  let len = f.seek(SeekFrom::End(0)).map_err(io)?;
  let tail_len = len.min(22 + 0xFFFF + 20);
  let mut tail = vec![0u8; tail_len as usize];
  f.seek(SeekFrom::Start(len - tail_len)).map_err(io)?;
  f.read_exact(&mut tail).map_err(io)?;
  let eocd = (0..tail.len().saturating_sub(21))
    .rev()
    .find(|&i| le32(&tail, i) == 0x0605_4b50)
    .ok_or_else(|| bad("不是 ZIP 文件"))?;
  let (mut count, mut cd_size, mut cd_offset) = (le16(&tail, eocd + 10), le32(&tail, eocd + 12), le32(&tail, eocd + 16));
  if eocd >= 20 && le32(&tail, eocd - 20) == 0x0706_4b50 {
    let record_at = le64(&tail, eocd - 12);
    let mut rec = [0u8; 56];
    f.seek(SeekFrom::Start(record_at)).map_err(io)?;
    f.read_exact(&mut rec).map_err(io)?;
    if le32(&rec, 0) != 0x0606_4b50 {
      return Err(bad("ZIP64 结尾记录损坏"));
    }
    count = le64(&rec, 32);
    cd_size = le64(&rec, 40);
    cd_offset = le64(&rec, 48);
  }
  if cd_offset.checked_add(cd_size).is_none_or(|end| end > len) {
    return Err(bad("中央目录越界"));
  }
  let mut cd = vec![0u8; cd_size as usize];
  f.seek(SeekFrom::Start(cd_offset)).map_err(io)?;
  f.read_exact(&mut cd).map_err(io)?;
  let mut out = Vec::with_capacity(count.min(1 << 20) as usize);
  let mut at = 0usize;
  for _ in 0..count {
    if at + 46 > cd.len() || le32(&cd, at) != 0x0201_4b50 {
      return Err(bad("中央目录损坏"));
    }
    let (n, x, c) = (le16(&cd, at + 28) as usize, le16(&cd, at + 30) as usize, le16(&cd, at + 32) as usize);
    if at + 46 + n + x + c > cd.len() {
      return Err(bad("中央目录损坏"));
    }
    let name = String::from_utf8_lossy(&cd[at + 46..at + 46 + n]).into_owned();
    let (mut csize, mut size, mut offset) = (le32(&cd, at + 20), le32(&cd, at + 24), le32(&cd, at + 42));
    // ZIP64 扩展字段: 只包含值为 0xFFFFFFFF 的那几项, 顺序固定
    let mut e = at + 46 + n;
    let extra_end = e + x;
    while e + 4 <= extra_end {
      let (id, sz) = (le16(&cd, e), le16(&cd, e + 2) as usize);
      if id == 0x0001 {
        let mut p = e + 4;
        for v in [&mut size, &mut csize, &mut offset] {
          if *v == U32_MAX && p + 8 <= e + 4 + sz {
            *v = le64(&cd, p);
            p += 8;
          }
        }
      }
      e += 4 + sz;
    }
    out.push(CdEntry { name, method: le16(&cd, at + 10) as u16, flags: le16(&cd, at + 8) as u16, size, csize, offset });
    at += 46 + n + x + c;
  }
  Ok(out)
}

/// 打开一项的内容流 (store / deflate)
pub fn open_entry<'a, R: Read + Seek>(f: &'a mut R, entry: &CdEntry) -> Result<Box<dyn Read + 'a>, String> {
  let io = |e: std::io::Error| format!("file: {e}");
  if entry.flags & 1 != 0 {
    return Err(bad(&format!("不支持加密的条目 {}", entry.name)));
  }
  let mut head = [0u8; 30];
  f.seek(SeekFrom::Start(entry.offset)).map_err(io)?;
  f.read_exact(&mut head).map_err(io)?;
  if le32(&head, 0) != 0x0403_4b50 {
    return Err(bad(&format!("本地文件头损坏 {}", entry.name)));
  }
  f.seek(SeekFrom::Current((le16(&head, 26) + le16(&head, 28)) as i64)).map_err(io)?;
  let raw = f.take(entry.csize);
  match entry.method {
    0 => Ok(Box::new(raw)),
    8 => Ok(Box::new(flate2::read::DeflateDecoder::new(raw))),
    m => Err(bad(&format!("不支持的压缩方式 {m} ({})", entry.name))),
  }
}

/// 把一项写进 `out`, 返回 (字节数, SHA-256)
fn copy_entry<R: Read + Seek>(f: &mut R, entry: &CdEntry, out: &mut dyn Write) -> Result<(u64, String), String> {
  let mut reader = open_entry(f, entry)?;
  let mut sha = Sha256::new();
  let mut buf = vec![0u8; BUF];
  let mut size = 0u64;
  loop {
    let n = reader.read(&mut buf).map_err(|e| bad(&format!("{} 解压失败: {e}", entry.name)))?;
    if n == 0 {
      break;
    }
    sha.update(&buf[..n]);
    out.write_all(&buf[..n]).map_err(|e| format!("file: {e}"))?;
    size += n as u64;
  }
  Ok((size, sha.finalize().iter().map(|b| format!("{b:02x}")).collect()))
}

/// 前端要解析的文本项 (清单 / 概念文档 / JSON) 与所有项的大小
#[derive(Debug, Serialize)]
pub struct BackupIndex {
  pub texts: BTreeMap<String, String>,
  pub sizes: BTreeMap<String, u64>,
}

/// 文本项上限: 再大就不是清单了, 当作资源留在原生层
const TEXT_LIMIT: u64 = 32 * 1024 * 1024;

pub fn open_index<R: Read + Seek>(f: &mut R) -> Result<BackupIndex, String> {
  let entries = read_central(f)?;
  let mut texts = BTreeMap::new();
  let mut sizes = BTreeMap::new();
  for entry in &entries {
    sizes.insert(entry.name.clone(), entry.size);
    let is_text = entry.name.ends_with(".md") || entry.name.ends_with(".json");
    if is_text && entry.size <= TEXT_LIMIT {
      let mut bytes = Vec::with_capacity(entry.size as usize);
      copy_entry(f, entry, &mut bytes)?;
      if let Ok(text) = String::from_utf8(bytes) {
        texts.insert(entry.name.clone(), text);
      }
    }
  }
  Ok(BackupIndex { texts, sizes })
}

/// 待校验的资源 (清单里写的长度 / SHA-256, 可缺省)
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetCheck {
  pub path: String,
  #[serde(default)]
  pub byte_length: Option<u64>,
  #[serde(default)]
  pub sha256: Option<String>,
}

/// 逐项校验; 每项返回 "" (通过) / "missing" / "size" / "sha256" / 其它错误信息
pub fn verify_assets<R: Read + Seek>(f: &mut R, checks: &[AssetCheck]) -> Result<Vec<String>, String> {
  let entries: BTreeMap<String, CdEntry> = read_central(f)?.into_iter().map(|e| (e.name.clone(), e)).collect();
  let mut out = Vec::with_capacity(checks.len());
  for check in checks {
    let Some(entry) = entries.get(&check.path) else {
      out.push("missing".into());
      continue;
    };
    let result = match copy_entry(f, entry, &mut std::io::sink()) {
      Err(e) => e,
      Ok((size, _)) if check.byte_length.is_some_and(|n| n != size) => "size".into(),
      Ok((_, sha)) if check.sha256.as_deref().is_some_and(|want| !want.eq_ignore_ascii_case(&sha)) => "sha256".into(),
      Ok(_) => String::new(),
    };
    out.push(result);
  }
  Ok(out)
}

fn find_entry<R: Read + Seek>(f: &mut R, path: &str) -> Result<CdEntry, String> {
  read_central(f)?
    .into_iter()
    .find(|e| e.name == path)
    .ok_or_else(|| bad(&format!("缺少文件 {path}")))
}

fn open_archive(src: &str) -> Result<File, String> {
  let path = PathBuf::from(src);
  if !path.is_absolute() {
    return Err("file: 藏书包路径必须是绝对路径".into());
  }
  File::open(path).map_err(|e| format!("file: {e}"))
}

#[tauri::command]
pub async fn backup_open(src: String) -> Result<BackupIndex, String> {
  tauri::async_runtime::spawn_blocking(move || open_index(&mut open_archive(&src)?))
    .await
    .map_err(|e| format!("file: {e}"))?
}

#[tauri::command]
pub async fn backup_verify(src: String, checks: Vec<AssetCheck>) -> Result<Vec<String>, String> {
  tauri::async_runtime::spawn_blocking(move || verify_assets(&mut open_archive(&src)?, &checks))
    .await
    .map_err(|e| format!("file: {e}"))?
}

/// 把包内 `path` 解到书库的 `rel` (暂存文件), 返回 SHA-256; 失败删除半截文件
#[tauri::command]
pub async fn backup_extract<R: tauri::Runtime>(app: tauri::AppHandle<R>, src: String, path: String, root: String, rel: String) -> Result<String, String> {
  let dest = library_path(&app, &root, rel)?;
  tauri::async_runtime::spawn_blocking(move || {
    let mut f = open_archive(&src)?;
    let entry = find_entry(&mut f, &path)?;
    let result = File::create(&dest)
      .map_err(|e| format!("file: {e}"))
      .and_then(|out| {
        let mut out = BufWriter::with_capacity(BUF, out);
        let (_, sha) = copy_entry(&mut f, &entry, &mut out)?;
        out.flush().map_err(|e| format!("file: {e}"))?;
        Ok(sha)
      });
    if result.is_err() {
      let _ = std::fs::remove_file(&dest);
    }
    result
  })
  .await
  .map_err(|e| format!("file: {e}"))?
}

/// 读包内一项的字节 (封面这类小文件)
#[tauri::command]
pub async fn backup_read_entry(src: String, path: String) -> Result<tauri::ipc::Response, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let mut f = open_archive(&src)?;
    let entry = find_entry(&mut f, &path)?;
    let mut bytes = Vec::with_capacity(entry.size.min(TEXT_LIMIT) as usize);
    copy_entry(&mut f, &entry, &mut bytes)?;
    Ok(tauri::ipc::Response::new(bytes))
  })
  .await
  .map_err(|e| format!("file: {e}"))?
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::io::Cursor;

  fn temp(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!("lr-backupzip-{}-{name}", std::process::id()))
  }

  /// 最小的中央目录读取: 返回 (名字, crc, 大小, 内容)
  fn read_back(zip: &[u8]) -> Vec<(String, u32, u64, Vec<u8>)> {
    let le16 = |at: usize| u16::from_le_bytes([zip[at], zip[at + 1]]) as u64;
    let le32 = |at: usize| u32::from_le_bytes(zip[at..at + 4].try_into().unwrap()) as u64;
    let le64 = |at: usize| u64::from_le_bytes(zip[at..at + 8].try_into().unwrap());
    let eocd = zip.len() - 22;
    assert_eq!(le32(eocd), 0x0605_4b50);
    let (mut count, mut cd) = (le16(eocd + 10), le32(eocd + 16));
    if count == 0xFFFF {
      let locator = eocd - 20;
      assert_eq!(le32(locator), 0x0706_4b50);
      let record = le64(locator + 8) as usize;
      assert_eq!(le32(record), 0x0606_4b50);
      count = le64(record + 32);
      cd = le64(record + 48);
    }
    let mut at = cd as usize;
    let mut out = vec![];
    for _ in 0..count {
      assert_eq!(le32(at), 0x0201_4b50);
      let crc = le32(at + 16) as u32;
      let (mut size, mut offset) = (le32(at + 24), le32(at + 42));
      let (n, x) = (le16(at + 28) as usize, le16(at + 30) as usize);
      let name = String::from_utf8(zip[at + 46..at + 46 + n].to_vec()).unwrap();
      let mut e = at + 46 + n + 4;
      if size == U32_MAX {
        size = le64(e);
        e += 16;
      }
      if offset == U32_MAX {
        offset = le64(e);
      }
      let lh = offset as usize;
      assert_eq!(le32(lh), 0x0403_4b50);
      let data_at = lh + 30 + le16(lh + 26) as usize + le16(lh + 28) as usize;
      let data = zip[data_at..data_at + size as usize].to_vec();
      assert_eq!(crc32fast::hash(&data), crc);
      out.push((name, crc, size, data));
      at += 46 + n + x;
    }
    out
  }

  #[test]
  fn reads_back_own_archives_including_zip64() {
    for threshold in [U32_MAX, 100] {
      let mut out = Cursor::new(Vec::new());
      let book: Vec<u8> = (0..5000).map(|i| (i % 13) as u8).collect();
      write_zip(&mut out, vec![
        ("assets/books/a/content.epub".to_string(), Source::Bytes(book.clone())),
        ("index.md".to_string(), Source::Bytes("# 书库".as_bytes().to_vec())),
        ("manifest.json".to_string(), Source::Bytes(b"{}".to_vec())),
      ], threshold, |_| {}).unwrap();
      let mut f = Cursor::new(out.into_inner());
      let index = open_index(&mut f).unwrap();
      assert_eq!(index.texts.get("index.md").map(String::as_str), Some("# 书库"));
      assert!(!index.texts.contains_key("assets/books/a/content.epub"));
      assert_eq!(index.sizes["assets/books/a/content.epub"], 5000);
      let sha = hex_sha(&book);
      let checks = vec![
        AssetCheck { path: "assets/books/a/content.epub".into(), byte_length: Some(5000), sha256: Some(sha.clone()) },
        AssetCheck { path: "assets/books/a/content.epub".into(), byte_length: Some(1), sha256: None },
        AssetCheck { path: "assets/books/a/content.epub".into(), byte_length: None, sha256: Some("00".into()) },
        AssetCheck { path: "nope".into(), byte_length: None, sha256: None },
      ];
      assert_eq!(verify_assets(&mut f, &checks).unwrap(), vec!["", "size", "sha256", "missing"]);
      let entry = find_entry(&mut f, "assets/books/a/content.epub").unwrap();
      let mut got = vec![];
      assert_eq!(copy_entry(&mut f, &entry, &mut got).unwrap().1, sha);
      assert_eq!(got, book);
    }
  }

  #[test]
  fn reads_deflated_entries() {
    // 手工拼一个 deflate 条目的 ZIP (第三方 OKF 包常见)
    use flate2::{write::DeflateEncoder, Compression};
    let data = "第三方 OKF 文档。".repeat(200).into_bytes();
    let mut enc = DeflateEncoder::new(Vec::new(), Compression::default());
    enc.write_all(&data).unwrap();
    let comp = enc.finish().unwrap();
    let name = b"books/x.md";
    let crc = crc32fast::hash(&data);
    let mut z = vec![];
    put32(&mut z, 0x0403_4b50); put16(&mut z, 20); put16(&mut z, 0); put16(&mut z, 8); put16(&mut z, 0); put16(&mut z, 0);
    put32(&mut z, crc); put32(&mut z, comp.len() as u32); put32(&mut z, data.len() as u32);
    put16(&mut z, name.len() as u16); put16(&mut z, 0); z.extend_from_slice(name); z.extend_from_slice(&comp);
    let cd = z.len();
    put32(&mut z, 0x0201_4b50); put16(&mut z, 20); put16(&mut z, 20); put16(&mut z, 0); put16(&mut z, 8); put16(&mut z, 0); put16(&mut z, 0);
    put32(&mut z, crc); put32(&mut z, comp.len() as u32); put32(&mut z, data.len() as u32);
    put16(&mut z, name.len() as u16); put16(&mut z, 0); put16(&mut z, 0); put16(&mut z, 0); put16(&mut z, 0); put32(&mut z, 0); put32(&mut z, 0);
    z.extend_from_slice(name);
    let cd_size = z.len() - cd;
    put32(&mut z, 0x0605_4b50); put16(&mut z, 0); put16(&mut z, 0); put16(&mut z, 1); put16(&mut z, 1);
    put32(&mut z, cd_size as u32); put32(&mut z, cd as u32); put16(&mut z, 0);
    let index = open_index(&mut Cursor::new(z)).unwrap();
    assert_eq!(index.texts["books/x.md"].as_bytes(), &data[..]);
  }

  #[test]
  fn rejects_non_zip() {
    assert!(read_central(&mut Cursor::new(b"not a zip at all, definitely".to_vec())).unwrap_err().starts_with("archive:"));
  }

  fn hex_sha(b: &[u8]) -> String {
    Sha256::digest(b).iter().map(|x| format!("{x:02x}")).collect()
  }

  #[test]
  fn writes_text_and_files_in_order() {
    let book = temp("book.epub");
    let body: Vec<u8> = (0..(2 * BUF + 33)).map(|i| (i % 253) as u8).collect();
    std::fs::write(&book, &body).unwrap();
    let mut out = Cursor::new(Vec::new());
    let mut ticks = vec![];
    let entries = vec![
      ("assets/books/a/content.epub".to_string(), Source::File(book.clone())),
      ("books/a.md".to_string(), Source::Bytes("# 书名 · 中文".as_bytes().to_vec())),
    ];
    let size = write_zip(&mut out, entries, U32_MAX, |p| ticks.push(p)).unwrap();
    let zip = out.into_inner();
    assert_eq!(size as usize, zip.len());
    let items = read_back(&zip);
    assert_eq!(items[0].0, "assets/books/a/content.epub");
    assert_eq!(items[0].3, body);
    assert_eq!(items[1].0, "books/a.md");
    assert_eq!(String::from_utf8(items[1].3.clone()).unwrap(), "# 书名 · 中文");
    assert_eq!(ticks.last(), Some(&ZipProgress { done: 2, total: 2 }));
    std::fs::remove_file(book).unwrap();
  }

  #[test]
  fn switches_to_zip64_past_threshold() {
    let mut out = Cursor::new(Vec::new());
    let entries = vec![
      ("a.txt".to_string(), Source::Bytes(vec![b'a'; 300])),
      ("b.txt".to_string(), Source::Bytes(vec![b'b'; 10])),
    ];
    // 门槛压到 100 字节: 第一项按大文件写, 第二项的偏移也超出门槛, 结尾用 ZIP64 记录
    write_zip(&mut out, entries, 100, |_| {}).unwrap();
    let items = read_back(&out.into_inner());
    assert_eq!(items.len(), 2);
    assert_eq!(items[0].2, 300);
    assert_eq!(items[1].3, vec![b'b'; 10]);
  }

  #[test]
  fn digest_matches_sha_and_crc() {
    let path = temp("digest");
    std::fs::write(&path, b"hello").unwrap();
    let d = digest_file(&path).unwrap();
    assert_eq!(d.size, 5);
    assert_eq!(d.sha256, "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    assert_eq!(d.crc32, crc32fast::hash(b"hello"));
    std::fs::remove_file(path).unwrap();
  }

  #[test]
  fn rejects_escaping_entry_names() {
    for bad in ["../x", "/abs", "a/../b", "a\\b", "", "a//b"] {
      let r = write_zip(Cursor::new(Vec::new()), vec![(bad.to_string(), Source::Bytes(vec![]))], U32_MAX, |_| {});
      assert!(r.is_err(), "{bad}");
    }
  }
}
