//! 导入 EPUB 时的元数据 + 封面, 原生实现; 结果与前端 importer.ts 的 extractFoliateMeta
//! (foliate-js epub.js 的 getMetadata / Resources.cover, 再经 flattenMeta 压平) 一致.
//!
//! 桌面导入 EPUB 时不再为取书名 / 作者 / 简介 / 语言 / 封面整本交给 foliate 打开。
//! 对齐要点 (由 testdata/epub-meta-golden.json 回归, scripts/gen-epub-meta-golden.mjs 用 foliate 生成):
//!  - container.xml 取第一个 media-type 为 OEBPS 包的 rootfile; OPF 子元素是否按命名空间匹配与 foliate 的 useNS 一致
//!  - metadata 子元素: dc 命名空间 → dc; OPF 命名空间的 meta → 有 name 属性为旧式 meta, 否则为 refines 属性
//!  - 作者: dc:creator (默认 author) + dc:contributor (默认 contributor), MARC relator 角色重映射; tidy 后 flattenMeta
//!  - 封面: properties 含 cover-image → EPUB 2 的 meta name=cover → href 含 cover 的图片 → guide 里 cover 引用
//!  - href 按 foliate resolveURL 解析 (含 `%2c` → `,`、去 query、decodeURI 保留保留字符)

use std::collections::HashMap;
use std::io::{Read, Seek};

use roxmltree::{Document, Node};
use serde::Serialize;

use crate::backup_zip::{open_entry, read_central, CdEntry};

const NS_CONTAINER: &str = "urn:oasis:names:tc:opendocument:xmlns:container";
const NS_OPF: &str = "http://www.idpf.org/2007/opf";
const NS_DC: &str = "http://purl.org/dc/elements/1.1/";
const NS_XML: &str = "http://www.w3.org/XML/1998/namespace";
const MARC_RELATORS: &str = "http://id.loc.gov/vocabulary/relators";

#[derive(Debug, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct EpubMeta {
  pub title: String,
  pub author: String,
  pub description: String,
  pub language: String,
  /// 封面在书内的路径与媒体类型 (前端据此取图); 没有封面时省略
  #[serde(skip_serializing_if = "Option::is_none")]
  pub cover_href: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub cover_media_type: Option<String>,
}

// ---------------- 文本工具 (与 foliate / JS 语义一致) ----------------

/// WHATWG strip-and-collapse ASCII whitespace
fn normalize_ws(s: &str) -> String {
  s.split(['\t', '\n', '\u{0C}', '\r', ' ']).filter(|p| !p.is_empty()).collect::<Vec<_>>().join(" ")
}

fn text_content(n: Node) -> String {
  normalize_ws(&n.descendants().filter(|d| d.is_text()).filter_map(|d| d.text()).collect::<String>())
}

/// JS decodeURI: 解码 %XX, 但解出保留字符 `;/?:@&=+$,#` 时保留原样; 非法序列返回 None (JS 抛 URIError)
fn decode_uri(s: &str) -> Option<String> {
  let b = s.as_bytes();
  let mut out: Vec<u8> = Vec::with_capacity(b.len());
  let mut i = 0;
  let hex = |i: usize| -> Option<u8> {
    let h = std::str::from_utf8(b.get(i + 1..i + 3)?).ok()?;
    u8::from_str_radix(h, 16).ok()
  };
  while i < b.len() {
    if b[i] != b'%' {
      out.push(b[i]);
      i += 1;
      continue;
    }
    let first = hex(i)?;
    if first < 0x80 {
      if b";/?:@&=+$,#".contains(&first) {
        out.extend_from_slice(&b[i..i + 3]);
      } else {
        out.push(first);
      }
      i += 3;
      continue;
    }
    let len = match first {
      0xC2..=0xDF => 2,
      0xE0..=0xEF => 3,
      0xF0..=0xF4 => 4,
      _ => return None,
    };
    let mut seq = vec![first];
    for k in 1..len {
      let at = i + 3 * k;
      if b.get(at) != Some(&b'%') {
        return None;
      }
      seq.push(hex(at)?);
    }
    std::str::from_utf8(&seq).ok()?;
    out.extend_from_slice(&seq);
    i += 3 * len;
  }
  String::from_utf8(out).ok()
}

/// foliate resolveURL(url, relativeTo) 的书内相对路径部分
fn resolve_url(url: &str, relative_to: &str) -> String {
  let url = url.replacen("%2c", ",", 1);
  let (path_part, hash) = match url.find('#') {
    Some(i) => (&url[..i], &url[i..]),
    None => (url.as_str(), ""),
  };
  let path_part = path_part.split('?').next().unwrap_or("").replace('\\', "/");
  let mut segs: Vec<&str> = if path_part.starts_with('/') {
    Vec::new()
  } else {
    let mut base: Vec<&str> = relative_to.split('/').collect();
    base.pop();
    base
  };
  let parts: Vec<&str> = path_part.trim_start_matches('/').split('/').collect();
  let last = parts.len().saturating_sub(1);
  for (i, seg) in parts.iter().enumerate() {
    match *seg {
      "." | "%2e" | "%2E" => {
        if i == last {
          segs.push("");
        }
      }
      ".." | "%2e%2e" | "%2E%2E" | ".%2e" | "%2e." => {
        segs.pop();
        if i == last {
          segs.push("");
        }
      }
      s => segs.push(s),
    }
  }
  let joined = format!("{}{}", segs.join("/"), hash);
  decode_uri(&joined).unwrap_or(url)
}

// ---------------- OPF 解析 ----------------

struct Parsed {
  property: Option<String>,
  scheme: Option<String>,
  lang: Option<String>,
  value: String,
  props: Option<HashMap<String, Vec<Parsed>>>,
  attrs: HashMap<String, String>,
}

struct Ctx<'a> {
  refines: HashMap<Option<String>, Vec<Node<'a, 'a>>>,
  prefixes: HashMap<String, String>,
}

/// foliate getPropertyURL: 有前缀且已知 → 展开为 URL; 否则 None (调用方退回原值)
fn property_url(value: Option<&str>, prefixes: &HashMap<String, String>) -> Option<String> {
  let value = value?;
  let mut it = value.split(':');
  let a = it.next()?;
  let b = it.next();
  let (prefix, reference) = match b {
    Some(b) => (Some(a), b),
    None => (None, a),
  };
  prefixes.get(prefix?).map(|base| format!("{base}{reference}"))
}

fn default_prefixes() -> HashMap<String, String> {
  [
    ("a11y", "http://www.idpf.org/epub/vocab/package/a11y/#"),
    ("dcterms", "http://purl.org/dc/terms/"),
    ("marc", "http://id.loc.gov/vocabulary/"),
    ("media", "http://www.idpf.org/epub/vocab/overlays/#"),
    ("onix", "http://www.editeur.org/ONIX/book/codelists/current.html#"),
    ("rendition", "http://www.idpf.org/vocab/rendition/#"),
    ("schema", "http://schema.org/"),
    ("xsd", "http://www.w3.org/2001/XMLSchema#"),
    ("msv", "http://www.idpf.org/epub/vocab/structure/magazine/#"),
    ("prism", "http://www.prismstandard.org/specifications/3.0/PRISM_CV_Spec_3.0.htm#"),
  ]
  .into_iter()
  .map(|(k, v)| (k.to_string(), v.to_string()))
  .collect()
}

/// foliate getPrefixes: `/(.+): +(.+)[ \t\r\n]*/g` 逐个匹配 (`.` 不跨换行, 贪婪)
fn parse_prefix_attr(value: &str, map: &mut HashMap<String, String>) {
  for line in value.split(['\n', '\r', '\u{2028}', '\u{2029}']) {
    // 贪婪: 取最后一个 ": " (冒号后至少一个空格)
    let bytes = line.as_bytes();
    let mut best = None;
    for i in 0..bytes.len() {
      if bytes[i] == b':' && bytes.get(i + 1) == Some(&b' ') && i > 0 {
        let rest = line[i + 1..].trim_start_matches(' ');
        if !rest.is_empty() {
          best = Some((i, rest));
        }
      }
    }
    if let Some((i, rest)) = best {
      map.insert(line[..i].to_string(), rest.trim_end_matches([' ', '\t']).to_string());
    }
  }
}

fn attr<'a>(n: Node<'a, 'a>, name: &str) -> Option<&'a str> {
  n.attributes().find(|a| a.name() == name && a.namespace().is_none()).map(|a| a.value())
}

fn xml_lang<'a>(n: Node<'a, 'a>) -> Option<&'a str> {
  n.attribute((NS_XML, "lang"))
}

impl<'a> Ctx<'a> {
  fn parse(&self, el: Node<'a, 'a>) -> Parsed {
    let property = attr(el, "property");
    let scheme = attr(el, "scheme");
    Parsed {
      property: property_url(property, &self.prefixes).or(property.map(str::to_string)),
      scheme: property_url(scheme, &self.prefixes).or(scheme.map(str::to_string)),
      lang: xml_lang(el).map(str::to_string),
      value: text_content(el),
      props: self.properties(Some(el)),
      attrs: el.attributes().filter(|a| a.namespace() == Some(NS_OPF)).map(|a| (a.name().to_string(), a.value().to_string())).collect(),
    }
  }

  /// el 为 None 时取全书级 (无 refines 的) meta
  fn properties(&self, el: Option<Node<'a, 'a>>) -> Option<HashMap<String, Vec<Parsed>>> {
    let key = el.map(|e| format!("#{}", attr(e, "id").unwrap_or("null")));
    let els = self.refines.get(&key)?;
    let mut map: HashMap<String, Vec<Parsed>> = HashMap::new();
    for &m in els {
      let p = self.parse(m);
      map.entry(p.property.clone().unwrap_or_else(|| "null".into())).or_default().push(p);
    }
    Some(map)
  }
}

fn prop<'b>(x: &'b Parsed, p: &str) -> Option<&'b str> {
  x.props.as_ref()?.get(p)?.first().map(|y| y.value.as_str())
}

/// makeLanguageMap 之后经 tidy / flattenMeta 取到的字符串: 简单值就是 value;
/// 语言映射对象的第一个键恒为 (x.lang ?? baseLang) → x.value
fn language_map_is_object(x: &Parsed, base_lang: &str) -> bool {
  let alts = x.props.as_ref().and_then(|p| p.get("alternate-script")).map_or(0, Vec::len);
  let alt_rep = x.attrs.get("alt-rep");
  !(alts == 0 && x.lang.as_deref().is_none_or(|l| l == base_lang) && alt_rep.is_none())
}

/// 一个 contributor 经 makeContributor → tidy → flattenMeta 得到的字符串.
/// name 是普通字符串: 结果就是它。name 是语言映射对象时: tidy 后若只剩 name 一个键, tidy 直接返回这个对象,
/// flattenMeta 取它第一个值 (恒为 x.value); 否则在 sortAs / role / code / scheme 里取第一个字符串, 都不是则为空。
fn flatten_contributor(x: &Parsed, base_lang: &str) -> String {
  if !language_map_is_object(x, base_lang) {
    return x.value.clone();
  }
  // tidy 后各键: None = 键被删; Some(None) = 还在但不是字符串; Some(Some(s)) = 字符串
  let sort_as: Option<Option<String>> = match x.props.as_ref().and_then(|p| p.get("file-as")).and_then(|v| v.first()) {
    Some(f) if language_map_is_object(f, base_lang) => Some(None),
    Some(f) => Some(Some(f.value.clone())),
    None => x.attrs.get("file-as").map(|v| Some(v.clone())),
  };
  let roles: Vec<String> = match x.props.as_ref().and_then(|p| p.get("role")) {
    Some(rs) => rs.iter().filter(|r| r.scheme.as_deref() == Some(MARC_RELATORS)).map(|r| r.value.clone()).collect(),
    None => x.attrs.get("role").cloned().into_iter().collect(),
  };
  let roles: Vec<String> = roles.into_iter().filter(|r| !r.is_empty()).collect();
  let role: Option<Option<String>> = match roles.len() {
    0 => None,
    1 => Some(Some(roles[0].clone())),
    _ => Some(None),
  };
  let code = prop(x, "term").map(str::to_string).or_else(|| x.attrs.get("term").cloned()).map(Some);
  let scheme = prop(x, "authority").map(str::to_string).or_else(|| x.attrs.get("authority").cloned()).map(Some);
  let others = [sort_as, role, code, scheme];
  if others.iter().all(Option::is_none) {
    return x.value.clone();
  }
  others.into_iter().flatten().flatten().next().unwrap_or_default()
}

/// remapContributor: 角色映射到的键; 无角色 / 未知角色用默认键
fn contributor_keys(x: &Parsed, default_key: &str) -> Vec<String> {
  let relator = |r: Option<&str>| -> String {
    match r {
      Some("art") => "artist",
      Some("aut") => "author",
      Some("clr") => "colorist",
      Some("edt") => "editor",
      Some("ill") => "illustrator",
      Some("nrt") => "narrator",
      Some("trl") => "translator",
      Some("pbl") => "publisher",
      _ => default_key,
    }
    .to_string()
  };
  let mut keys: Vec<String> = match x.props.as_ref().and_then(|p| p.get("role")) {
    Some(rs) => rs.iter().filter(|r| r.scheme.as_deref() == Some(MARC_RELATORS)).map(|r| relator(Some(&r.value))).collect(),
    None => vec![relator(x.attrs.get("role").map(String::as_str))],
  };
  keys.dedup();
  let mut seen = Vec::new();
  keys.retain(|k| if seen.contains(k) { false } else { seen.push(k.clone()); true });
  if keys.is_empty() {
    keys.push(default_key.to_string());
  }
  keys
}

/// foliate childGetter 的匹配: useNS 时要求 OPF 命名空间, 否则只看本地名
fn matches_el(n: &Node, name: &str, use_ns: bool) -> bool {
  n.is_element() && n.tag_name().name() == name && (!use_ns || n.tag_name().namespace() == Some(NS_OPF))
}

fn child_el<'a, 'i>(n: Node<'a, 'i>, name: &str, use_ns: bool) -> Option<Node<'a, 'i>> {
  n.children().find(|c| matches_el(c, name, use_ns))
}

struct Manifest {
  id: Option<String>,
  href: Option<String>,
  media_type: Option<String>,
  properties: Vec<String>,
}

fn read_entry<R: Read + Seek>(f: &mut R, entries: &[CdEntry], name: &str) -> Option<Vec<u8>> {
  let e = entries.iter().find(|e| e.name == name)?;
  let mut data = Vec::new();
  open_entry(f, e).ok()?.read_to_end(&mut data).ok()?;
  Some(data)
}

fn xml_text(bytes: &[u8]) -> String {
  let s = String::from_utf8_lossy(bytes);
  s.strip_prefix('\u{FEFF}').unwrap_or(&s).to_string()
}

/// 从 EPUB (ZIP) 读出与 extractFoliateMeta 一致的元数据; 封面只给路径
pub fn epub_meta<R: Read + Seek>(f: &mut R) -> Result<EpubMeta, String> {
  let bad = |m: &str| format!("epub: {m}");
  let entries = read_central(f)?;
  let opt = roxmltree::ParsingOptions { allow_dtd: true, ..Default::default() };

  let container_raw = read_entry(f, &entries, "META-INF/container.xml").ok_or_else(|| bad("缺少 container.xml"))?;
  let container_text = xml_text(&container_raw);
  let container = Document::parse_with_options(&container_text, opt).map_err(|e| bad(&format!("container.xml: {e}")))?;
  let opf_path = container
    .descendants()
    .filter(|n| n.is_element() && n.tag_name().namespace() == Some(NS_CONTAINER) && n.tag_name().name() == "rootfile")
    .find(|n| attr(*n, "media-type") == Some("application/oebps-package+xml"))
    .and_then(|n| attr(n, "full-path"))
    .ok_or_else(|| bad("container 里没有包文档"))?
    .to_string();

  let opf_raw = read_entry(f, &entries, &opf_path).ok_or_else(|| bad("缺少包文档"))?;
  let opf_text = xml_text(&opf_raw);
  let opf = Document::parse_with_options(&opf_text, opt).map_err(|e| bad(&format!("OPF: {e}")))?;
  let root = opf.root_element();

  // childGetter: 文档根的默认命名空间是 OPF, 或给 OPF 声明了前缀 → 按命名空间匹配
  let use_ns = root.namespaces().any(|ns| ns.uri() == NS_OPF);
  let matches = |n: &Node, name: &str| matches_el(n, name, use_ns);
  let child = |n, name| child_el(n, name, use_ns);

  let metadata = child(root, "metadata").ok_or_else(|| bad("没有 metadata"))?;
  let mut dc: Vec<Node> = Vec::new();
  let mut metas: Vec<Node> = Vec::new();
  let mut legacy: Vec<Node> = Vec::new();
  for el in metadata.children().filter(Node::is_element) {
    if el.tag_name().namespace() == Some(NS_DC) {
      dc.push(el);
    } else if el.tag_name().namespace() == Some(NS_OPF) && el.tag_name().name() == "meta" {
      if attr(el, "name").is_some() {
        legacy.push(el);
      } else {
        metas.push(el);
      }
    }
  }
  let base_lang = xml_lang(metadata).or_else(|| xml_lang(root)).unwrap_or("und").to_string();
  let mut prefixes = default_prefixes();
  if let Some(v) = root.attribute(("http://www.idpf.org/2007/ops", "prefix")).filter(|v| !v.is_empty()).or_else(|| attr(root, "prefix")) {
    parse_prefix_attr(v, &mut prefixes);
  }
  let mut refines: HashMap<Option<String>, Vec<Node>> = HashMap::new();
  for &m in &metas {
    refines.entry(attr(m, "refines").map(str::to_string)).or_default().push(m);
  }
  let ctx = Ctx { refines, prefixes };
  let dc_of = |name: &str| -> Vec<Parsed> { dc.iter().filter(|n| n.tag_name().name() == name).map(|&n| ctx.parse(n)).collect() };

  let titles = dc_of("title");
  let main_title = titles.iter().find(|x| prop(x, "title-type") == Some("main")).or(titles.first());
  let title = main_title.map(|x| x.value.clone()).unwrap_or_default();

  let languages: Vec<String> = dc_of("language").into_iter().map(|x| x.value).filter(|v| !v.is_empty()).collect();
  let language = languages.join(", ");
  let description = dc_of("description").into_iter().next().map(|x| x.value).unwrap_or_default();

  let mut authors: Vec<String> = Vec::new();
  for (list, default_key) in [(dc_of("creator"), "author"), (dc_of("contributor"), "contributor")] {
    for x in &list {
      if contributor_keys(x, default_key).iter().any(|k| k == "author") {
        authors.push(flatten_contributor(x, &base_lang));
      }
    }
  }
  let author = authors.into_iter().filter(|a| !a.is_empty()).collect::<Vec<_>>().join(", ");

  // ---- 封面 ----
  let manifest: Vec<Manifest> = child(root, "manifest")
    .map(|m| {
      m.children()
        .filter(|c| matches(c, "item"))
        .map(|it| Manifest {
          id: attr(it, "id").map(str::to_string),
          href: attr(it, "href").map(|h| resolve_url(h, &opf_path)),
          media_type: attr(it, "media-type").map(str::to_string),
          properties: attr(it, "properties").map(|p| p.split(js_space).map(str::to_string).collect()).unwrap_or_default(),
        })
        .collect()
    })
    .unwrap_or_default();
  let by_id = |id: Option<&str>| id.and_then(|id| manifest.iter().find(|m| m.id.as_deref() == Some(id)));
  let cover_meta_content = opf
    .descendants()
    .filter(|n| n.is_element() && n.tag_name().name() == "meta" && (!use_ns || n.tag_name().namespace() == Some(NS_OPF)))
    .find(|n| attr(*n, "name") == Some("cover"))
    .and_then(|n| attr(n, "content"));
  let guide_cover_href = child(root, "guide").and_then(|g| {
    g.children()
      .filter(|c| matches(c, "reference"))
      .find(|r| attr(*r, "type").unwrap_or("").split(js_space).any(|t| t == "cover"))
      .and_then(|r| attr(r, "href").map(|h| resolve_url(h, &opf_path)))
  });
  let cover = manifest
    .iter()
    .find(|m| m.properties.iter().any(|p| p == "cover-image"))
    .or_else(|| by_id(cover_meta_content))
    .or_else(|| {
      manifest.iter().find(|m| {
        m.href.as_deref().is_some_and(|h| h.contains("cover")) && m.media_type.as_deref().is_some_and(|t| t.starts_with("image"))
      })
    })
    .or_else(|| guide_cover_href.as_deref().and_then(|h| manifest.iter().find(|m| m.href.as_deref() == Some(h))));
  let (cover_href, cover_media_type) = match cover {
    Some(m) if m.href.as_deref().is_some_and(|h| entries.iter().any(|e| e.name == h)) => (m.href.clone(), m.media_type.clone()),
    _ => (None, None),
  };

  Ok(EpubMeta { title, author, description, language, cover_href, cover_media_type })
}

/// JS 的 `/\s/`
fn js_space(c: char) -> bool {
  matches!(c,
    '\t' | '\n' | '\u{0B}' | '\u{0C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'..='\u{200A}'
    | '\u{2028}' | '\u{2029}' | '\u{202F}' | '\u{205F}' | '\u{3000}' | '\u{FEFF}')
}

/// 读书库里的 EPUB, 返回元数据 (封面字节由前端用 backup_read_entry 同款命令另取)
#[tauri::command]
pub async fn epub_metadata<R: tauri::Runtime>(app: tauri::AppHandle<R>, root: String, rel: String) -> Result<EpubMeta, String> {
  use crate::http_upload::{resolve_library_file, FileRef};
  use tauri::Manager;
  let path = resolve_library_file(app.path().app_data_dir().ok(), &FileRef { root, rel })?;
  tauri::async_runtime::spawn_blocking(move || epub_meta(&mut std::fs::File::open(&path).map_err(|e| format!("file: {e}"))?))
    .await
    .map_err(|e| format!("file: {e}"))?
}

/// 读书库 EPUB 里的一个文件 (封面图)
#[tauri::command]
pub async fn epub_read_entry<R: tauri::Runtime>(app: tauri::AppHandle<R>, root: String, rel: String, path: String) -> Result<tauri::ipc::Response, String> {
  use crate::http_upload::{resolve_library_file, FileRef};
  use tauri::Manager;
  let file = resolve_library_file(app.path().app_data_dir().ok(), &FileRef { root, rel })?;
  tauri::async_runtime::spawn_blocking(move || {
    let mut f = std::fs::File::open(&file).map_err(|e| format!("file: {e}"))?;
    let entries = read_central(&mut f)?;
    read_entry(&mut f, &entries, &path).map(tauri::ipc::Response::new).ok_or_else(|| format!("epub: 缺少 {path}"))
  })
  .await
  .map_err(|e| format!("file: {e}"))?
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn resolves_like_foliate() {
    assert_eq!(resolve_url("Images/cover.jpg", "OEBPS/content.opf"), "OEBPS/Images/cover.jpg");
    assert_eq!(resolve_url("../img/a%20b.png", "OEBPS/text/content.opf"), "OEBPS/img/a b.png");
    assert_eq!(resolve_url("/root.png", "OEBPS/content.opf"), "root.png");
    assert_eq!(resolve_url("c.png?x=1", "content.opf"), "c.png");
    assert_eq!(resolve_url("a%2Fb.png", "content.opf"), "a%2Fb.png");
    assert_eq!(resolve_url("x%2cy.png", "content.opf"), "x,y.png");
    assert_eq!(resolve_url("%E5%B0%81%E9%9D%A2.jpg", "o/p.opf"), "o/封面.jpg");
  }

  #[test]
  fn decode_uri_rejects_malformed() {
    assert_eq!(decode_uri("a%zz"), None);
    assert_eq!(decode_uri("%E5%B0"), None);
    assert_eq!(decode_uri("a%23b"), Some("a%23b".into()));
  }

  /// 与 foliate + flattenMeta 逐项比对; 样本由 scripts/gen-epub-meta-golden.mjs 生成
  #[test]
  fn matches_foliate_golden() {
    use base64::Engine as _;
    let golden: serde_json::Value = serde_json::from_str(include_str!("testdata/epub-meta-golden.json")).unwrap();
    let cases = golden["cases"].as_array().unwrap();
    assert!(cases.len() >= 10);
    for case in cases {
      let name = case["name"].as_str().unwrap();
      let bytes = base64::engine::general_purpose::STANDARD.decode(case["epubBase64"].as_str().unwrap()).unwrap();
      let got = epub_meta(&mut std::io::Cursor::new(bytes)).unwrap_or_else(|e| panic!("{name}: {e}"));
      let want = &case["expected"];
      assert_eq!(got.title, want["title"].as_str().unwrap(), "{name}: title");
      assert_eq!(got.author, want["author"].as_str().unwrap(), "{name}: author");
      assert_eq!(got.description, want["description"].as_str().unwrap(), "{name}: description");
      assert_eq!(got.language, want["language"].as_str().unwrap(), "{name}: language");
      assert_eq!(got.cover_href.as_deref(), want["coverHref"].as_str(), "{name}: cover");
      assert_eq!(got.cover_media_type.as_deref(), want["coverType"].as_str(), "{name}: cover type");
    }
  }
}
