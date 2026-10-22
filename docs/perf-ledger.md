# 性能账本

按「先测量 → 定位 → 修 → 复测 → 无提升就回退」的流程记录每次尝试（含回退的），避免同一个死路被反复尝试。

## 如何测

```bash
# 生成 fixture (2.5MB/200 章 TXT + 40 页 PDF), 路径随意
BIG_TXT=/path/大部头.txt PDF_FIXTURE=/path/fixture.pdf
npm run build && npx vite preview --port 4173 --strictPort &
node scripts/perf.mjs          # 打开耗时 / 翻页 / 字号拖动 / PDF 打开与翻页 + 长任务统计
```

跑 3 次取范围；chromium headless, 1280×800, DPR 2。定位用 CDP `Profiler` 或
`browser.startTracing` 看 `RunTask` / `Commit` 分布，别猜。

## 2026-08-17 基线 (v1.1.14)

| 指标 | 数值 |
|---|---|
| 启动包 (index.html 预加载 JS+CSS) | 292 kB raw / 110 kB gzip |
| 大书导入 | 180–195 ms |
| 打开大书 (点击→正文) | 190–250 ms |
| 20 次翻页 (净) | 34–40 ms |
| 字号拖动 8 档 (净) | 42–44 ms |
| **打开 PDF (点击→首页 canvas)** | **657–781 ms, 最长任务 383–467 ms** |
| PDF 翻页 (慢 6 / 快 10) | 11–17 ms |

只有 PDF 打开是真瓶颈。

## 尝试记录

| 想法 | 基线 → 结果 | 结论 | 原因 |
|---|---|---|---|
| MuPDF 位图零拷贝：用 `DrawDevice` 直接画到不透明白底 RGBA `Pixmap`，`getPixels()` 视图直接喂 `ImageData`，去掉逐字节 RGB→RGBA 的 JS 循环 | PDF 打开 657–781 → 515–534 ms；最长任务 383–467 → 233–250 ms；`renderBitmapCanvas` 自身耗时 158 → ~3 ms | **保留** | DPR 2 整页 ≈ 20MB，JS 循环每页 ~50 ms。顺带修掉 `sourceX * 4`（源是 3 字节/像素）的潜在越界。 |
| 当前页组先渲染，相邻页组预载排队逐页、每页之间 `setTimeout(0)` 让出主线程 | 首页 paint 从「所有预载页一起提交」变为独立提交；最长任务 233–250 → 167–200 ms；「canvas 出现」指标 490–534 ms (噪声内) | **保留** | 之前 4 页挤在一条微任务链里，首页要等预载页全部栅格化 + 一次性 Commit ~126 ms。 |
| `onMounted` 一开始就 `initMupdf()` 预热 wasm，与读库 / PDFium 打开并行 | 485–582 ms vs 490–534 ms | 回退 | 噪声内。wasm 编译本来就在后台线程，主线程此时也在忙。 |
| `createImageBitmap` + `bitmaprenderer` 代替 `putImageData` | 每页 18 ms vs 16 ms (微基准) | 未采用 | 没有更快。 |
| MuPDF 渲 RGB(无 alpha) 再转 RGBA | RGB 栅格 8.8 ms/页 vs RGBA 19.7 ms/页，但需要再做一次 20MB 转换 | 未采用 | 转换成本抵消收益；除非改用 worker + SIMD。 |

## 剩下的成本 (未做)

DPR 2 下每页 ≈ 20MB 位图，固有成本：`clear` ~5 ms、MuPDF `run` ~15 ms、`putImageData` ~16 ms、合成器 Commit (headless 软件光栅) ~80 ms/页。再往下要靠 Worker + `OffscreenCanvas`/`ImageBitmap` 把栅格化搬离主线程，或先低分辨率再升清——都是结构性改动，需要新的测量再决定。

## 2026-10-22 原生化盘点 (v2.2.0 之后)

目标是「书的字节不在 WebView 里搬运」; 只在 WebView 内渲染的引擎 (foliate / MuPDF / PDFium wasm) 必须拿到字节, 不在此列。

| 改动 | 结果 | 结论 |
|---|---|---|
| 藏书包导出 / 导入改为 Rust 流式 ZIP (`backup_zip.rs`, store + deflate + ZIP64) | 导出不再把整库读进 JS 再 `zipSync`; 导入只把清单文本交给 JS, 书校验 SHA-256 后直接解到书库 | **保留** (内存上限与书库大小无关; 未做耗时对比) |
| 换书库文件夹 `library_migrate` (`std::fs::copy`) | 以前逐个 `readFile → writeFile` 经 WebView | **保留** |
| `http_upload` 书库文件改为流式上传 (显式 Content-Length, 不用分块编码) + `http_upload_file` 带进度 | 同步上传不再把整本书读进 Rust 内存; 互传「发送书籍」不再读进 WebView | **保留** |
| TXT → EPUB 转换移到 Rust? 实测浏览器内 JS: 2.5 MB 95 ms / 10 MB 238 ms / 30 MB 618 ms (Chromium headless, 4236 章) | 最多省几百毫秒, 且 EPUB 字节仍要经 IPC 交给 foliate, 还要重新证明分章规则一致 | **不做** |
| 选择文件夹导入的目录扫描 `folder_scan` (一次 IPC 递归遍历 + 大小 / 修改时间) | 以前每个目录一次 `readDir`、每本候选书一次 `stat` | **保留** |
| 书源 / 链接下载改为原生下载到磁盘? | 桌面 `fetchRemote` 已走 plugin-http (Rust reqwest); `importFile` 仍要字节给 foliate 取元数据, 原生落盘再读回只多一次磁盘往返 | **不做** |
| 导入时元数据 (书名/作者/封面) 移到 Rust? | foliate (EPUB/MOBI/AZW3/FB2/CBZ) 与 PDFium 封面渲染都在 WebView; 桌面 IPC 已是原始二进制, 只省一次写盘 | **不做** |

仍是瓶颈的只有 PDF 打开 (见上文 2026-08-17)。真要原生化需要 Rust 端渲染位图 + 改 PaperReaderView 的渲染管线, 属于结构性改动, 先测量再决定。
