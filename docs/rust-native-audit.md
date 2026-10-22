# 原生化 (Rust) 盘点 — 2026-10-22, v2.2.1 起

原则 (CLAUDE.md「能用 Rust 就用 Rust」): 文件读写、哈希、下载、格式解析等重活放 `src-tauri/src/`; 前端只做界面和编排。
判断标准: 书的字节是否**只为搬运**经过 WebView, 以及实测的耗时 / 内存是否落在用户能感知的路径上。
网页版没有原生层, 下列 JS 实现都保留作回退。测量方法与历史见 [perf-ledger.md](perf-ledger.md)。

## 已在 Rust (本轮新增加粗)

| 能力 | 模块 | 说明 |
|---|---|---|
| **藏书包导出 / 导入** | `backup_zip.rs` | 流式 store ZIP, 读取支持 deflate / ZIP64; 书校验 SHA-256 后直接解到书库 |
| **换书库文件夹** | `library_files.rs` `library_migrate` | `std::fs::copy`, Channel 回报进度 |
| **改名 / 文件大小** | `library_file_rename` `library_file_size` | 同步改文件名不再整本读写 |
| **上传 (同步 / 互传)** | `http_upload.rs` | 从磁盘流式上传, 显式 Content-Length, `http_upload_file` 带进度 |
| **选择文件夹扫描** | `folder_scan.rs` | 一次 IPC 递归遍历 + 大小 / 修改时间 |
| **CBR → CBZ (桌面)** | `comic.rs` | 导入时 UnRAR 原生解包一次 (顺带取封面), store CBZ 缓存在 `books/<id>.cbr.cbz`, 打开直接读缓存; 删书一并删除; 移动端 / 网页仍用 unrar wasm |
| **TXT (正文) → EPUB (桌面)** | `txt_epub.rs` | 解码 / 分章 / 段落还原 / XHTML / 打包与前端 `convertToEpub` 逐字节一致 (`testdata/txt-epub-golden.json` 10 组样本, `scripts/gen-txt-epub-golden.mjs` 重新生成); 转换一次缓存为 `<书文件>.v<版式>.epub`, 版式变化自动失效; 代码视图 TXT / Markdown / HTML 仍在前端 (marked / DOMParser) |
| **导入 EPUB 元数据 + 封面 (桌面)** | `epub_meta.rs` | 与 foliate getMetadata / 封面查找 + importer flattenMeta 一致 (`testdata/epub-meta-golden.json` 12 组, `scripts/gen-epub-meta-golden.mjs` 用 foliate 生成); 有意不复刻 foliate 对缺失封面文件返回 4 字节垃圾 Blob 的问题; 失败退回 foliate |
| **在线语音 Sec-MS-GEC v2** | `edge_tts.rs` + `mobile/edge_gec.rs` | 桌面与 App 共用 (v1 已被 403) |
| 指纹 / 下载 / 分块写盘 | `library_files.rs` | 同步与导入 (issue #14) |
| 更新包下载与校验 | `app_update.rs` | 流式 SHA-256 |
| 离线语音、Edge TTS、BabelDOC、Calibre、论文 Agent、字体枚举 | 各自模块 | 既有 |

## 留在 JS — 逐项证据

| 候选 | 证据 | 结论 |
|---|---|---|
| 阅读引擎 (foliate EPUB/MOBI/AZW3/FB2/CBZ, MuPDF / PDFium wasm, djvu.js) | 渲染在 WebView 内, 必须拿到字节; 原生只会多一次 IPC | 留在 JS |
| PDF 原生渲染 | 账本: 每页成本 clear ~5 ms、MuPDF run ~15 ms、putImageData ~16 ms、合成 Commit ~80 ms。原生只能替代「run」, 却要把 DPR 2 下 ~20 MB RGBA/页经 IPC 送回再 putImageData | 收益上限 <15 ms/页且很可能为负; 真正的方向是 Worker + OffscreenCanvas, 不是 Rust |
| Markdown / HTML / 代码视图 TXT → EPUB | 依赖 marked 与 DOMParser 生成良构 XHTML; 正文 TXT 已原生 (见上) | 留在 JS |
| 导入元数据 PDF | PDFium wasm 打开 69 MB / 600 页: 热 112–118 ms (首次含 wasm 初始化 ~500 ms) + 封面 6–14 ms | 不做 |
| 书源 / 链接下载 | 桌面 `fetchRemote` 已是 plugin-http (Rust reqwest); 元数据仍需字节 | 不做 |
| MOBI/AZW3 → EPUB | 依赖 foliate 的 MOBI/KF8 解析与 DOM 改写; Rust 版等于再写一套 PalmDoc/HUFF-CDIC/KF8 解码 + HTML 重写, 而阅读 MOBI 仍要 foliate; 用户主动触发, 已分片让出主线程 | 不做 |
| 重点词全书统计 | `test:key-words`: 12.1 万字全书 221 ms、每章选词 2.7 ms; 已在 Web Worker (`keyWords.worker.ts`) 空闲时后台跑, 不占主线程 | 不做 |
| 中文分词 / 阅读模式断句 | `test:zh-segment` / `test:reading-modes` 有速度预算 (<15 ms/万字), 作用于 iframe 里的 DOM 文本 | 不做 |
| 另存为 | 复用阅读器已加载的字节 | 不做 |
| 同步合并、设置、书单等纯逻辑 | 数据量小, 有 node 契约测试 | 不做 |

## 已知待办

- PDF 打开仍是唯一实测瓶颈, 方向见上表。
