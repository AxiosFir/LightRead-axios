<div align="center">

<img src="public/favicon.svg" width="76" alt="LightRead 轻阅图标" />

# LightRead 轻阅 · 开源电子书与 PDF 阅读器

**让想读的书，变成读进去的书。**

PDF 对照翻译 · 点睛阅读 · 本地书库 · 书单 · 阅读记录 · 听书

[中文](README.md) · [English](README.en.md)

[![Latest release](https://img.shields.io/github/v/release/yzfly/LightRead?display_name=tag&sort=semver)](https://github.com/yzfly/LightRead/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/yzfly/LightRead/total)](https://github.com/yzfly/LightRead/releases)
[![License: AGPL v3+](https://img.shields.io/badge/License-AGPL_v3%2B-blue.svg)](LICENSE)

**[下载 LightRead](https://github.com/yzfly/LightRead/releases/latest)** · [安装指南](docs/installation.md) · [使用手册](docs/manual/README.md) · [反馈建议](https://github.com/yzfly/LightRead/issues)

macOS · Windows · Linux · 网页 PWA · Android（实验性）

本地阅读无需账号、无需联网。藏书、进度与笔记，默认留在自己的设备上。

<img src="docs/screenshots/feature-library.png" width="1000" alt="LightRead 轻阅本地电子书书库：封面书架、分类标签、自建书单与每本书的阅读进度" />

</div>

[PDF 翻译](#pdf-翻译外文资料也能读进去) · [点睛阅读](#点睛阅读让重点自己浮出来) · [书单](#书单把想读变成下一本) · [阅读记录](#阅读记录看见每天读过的时间) · [听书与专注](#听书与专注找到自己的阅读节奏)

## 本地书库，把散落的好书放在一起

拖入文件，就能开读。用**封面书架、标签、书单和阅读进度**整理藏书；论文有独立入口，读书与研究各得其所。

支持 **EPUB、PDF、MOBI、AZW / AZW3、TXT、Markdown**，以及 FB2、CBZ / CBR 漫画、DjVu、HTML 等格式。不支持 KFX 和 DRM 加密文件。

## PDF 翻译，外文资料也能读进去

**原文在左，译文在右。** 划词翻译、逐页版式对照，边读边标注；桌面端还可用 **BabelDOC** 生成中文或双语 PDF。

<img src="docs/screenshots/feature-pdf-translation.png" width="1000" alt="LightRead PDF 论文翻译：左侧英文原文与右侧中文译文按版式对照阅读" />

想再读深一点？桌面端的**论文 Agent 与论文十问**帮你追问论点、方法和证据，你写下的答案单独保留。[查看论文阅读指南 →](docs/paper-reading.md)

<details>
<summary>翻译与 AI 的使用条件</summary>

逐页和划词翻译使用配置的 AI 服务。BabelDOC 仅限桌面端，需额外安装运行环境与模型，并配置个人模型服务；可能产生服务商费用。论文 Agent 需安装并配置 Pi、Codex 或 Claude Code 中的一个引擎。扫描 PDF 可显示，但选文与文字分析需要文本层；目前不内置 OCR。

</details>

## 点睛阅读，让重点自己浮出来

**基础版离线标出词语与重点词；智能版用 AI 点出要句、概念和注释。** 读长文时抓住线索，复习时用章节要义、全书脉络和速读找回重点。

<img src="docs/screenshots/feature-dianjing.png" width="1000" alt="轻阅点睛阅读基础版：在电子书原文中着色标记重点词，保留完整正文与原有排版" />

图为基础版。智能版需同意后调用 AI 服务。适用于 EPUB、TXT 等流式电子书，暂不支持 PDF 和固定版式书籍。[了解点睛阅读 →](docs/manual/05-点睛阅读.md)

## 书单，把「想读」变成「下一本」

**读过的、在读的、还没找到的，都能放进同一张书单。** 支持待找清单、自动匹配入库、推荐书单和导出分享，让阅读计划有个落脚点。

<img src="docs/screenshots/feature-booklists.png" width="1000" alt="LightRead 书单管理：已收藏电子书与待找书目放在同一份阅读计划中，可找书、分享或导入书单" />

## 阅读记录，看见每天读过的时间

**今天读了多久，这周读了什么，哪本书陪你最久。** 每日目标、连续阅读、周月年趋势与阅读日历，把零散的阅读时间慢慢积累起来。

<img src="docs/screenshots/feature-reading-stats.png" width="1000" alt="轻阅阅读记录与统计：每日阅读目标、连续阅读天数、每周时长趋势、里程碑和书籍进度" />

## 听书与专注，找到自己的阅读节奏

**眼睛累了就听，想专注就换一种读法。** 听书支持调速、定时关闭与断点续听；还有打字机、歌词、自动翻页、背景音，以及夜读、护眼和大字场景。

| 听书：让书读给你听 | 阅读模式：按自己的节奏读 |
| --- | --- |
| [![轻阅听书面板：语音、语速、定时关闭与朗读控制](docs/screenshots/feature-listen.png)](docs/screenshots/feature-listen.png) | [![轻阅阅读模式：点睛阅读、夜读、护眼、墨水屏、大字、沉浸与带读设置](docs/screenshots/feature-reading-modes.png)](docs/screenshots/feature-reading-modes.png) |

桌面端支持在线语音、可下载的离线模型与系统语音；网页版使用系统语音。[听书与背景音 →](docs/manual/03-声音.md)

## 公开书源，从「想读什么」到开始阅读

**搜书、找论文、逛书单，在一个入口完成。** 连接古登堡计划、Internet Archive、arXiv、OPDS / Calibre 或自建书库。

<img src="docs/screenshots/feature-discovery.png" width="1000" alt="LightRead 公开书源与书单推荐：统一搜书、精选书单、OPDS 与自建书库入口" />

推荐书单在「设置 → 功能」中开启。书源的可用性、下载条件与授权范围以来源为准。[自建书库指南 →](docs/self-hosted-library.md)

## 换台设备，也能接着读

| 你想做的事 | 轻阅提供的方式 |
| --- | --- |
| 手机、电脑接着读 | 轻阅账号同步进度、笔记、书签、书单与阅读记录；书籍文件需另行导入 |
| 连书一起同步 | WebDAV 可选同步书籍文件，连接自己的网盘或 NAS |
| 发一段文字、一份文件 | 互传支持账号、WebDAV 与临时取件码通道 |
| 备份或搬家 | 导入 / 导出 `.okf.zip` 藏书包，桌面端可自定义书库位置 |
| 把想法留在书里 | 划线、批注、书签与书内搜索，回到上次读过的位置 |

本地数据默认留在设备上。在线书源、语音、AI 和同步按所用服务联网；远程 AI 会接收相应文本。藏书包不包含应用设置、凭据和 Agent 工作目录。[同步与备份说明 →](docs/manual/04-使用说明.md#8-多端同步)

## 下载与安装

**[前往 GitHub Releases 下载最新版 →](https://github.com/yzfly/LightRead/releases/latest)**

| 设备 | 安装包 |
| --- | --- |
| macOS | Apple 芯片选 `aarch64.dmg`；Intel 选 `x64.dmg` |
| Windows 10 / 11 | `x64-setup.exe` |
| Linux | `.deb` / `.rpm` / `.AppImage` |
| Android（实验性，arm64） | `android_arm64.apk` |

安装后，把第一本书拖进轻阅即可开始。[完整安装与升级指南](docs/installation.md) · [三分钟上手](docs/manual/README.md#三分钟上手)

<a id="android实验性"></a>
**Android 老用户：** 历史版本可能签名不同；遇到安装冲突，先保留旧应用，导出并验证应用目录外的备份，再按[迁移步骤](docs/installation.md#android实验性)操作。

<details>
<summary>开发者：从源码运行</summary>

网页版需要 Node.js；桌面版还需要 Rust 与对应平台的 Tauri 2 构建依赖。

```bash
git clone https://github.com/yzfly/LightRead.git
cd LightRead
npm install
npm run dev          # 网页开发
npm run tauri dev    # 桌面开发
```

构建：`npm run build`（前端）或 `npm run tauri build`（桌面）。技术栈：Vue 3、TypeScript、Tauri 2 / Rust、foliate-js、MuPDF / PDFium。开发约定见 [CLAUDE.md](CLAUDE.md)。

</details>

## 一起把轻阅做得更好

喜欢轻阅，欢迎 **[Star](https://github.com/yzfly/LightRead)**，也欢迎[提出建议](https://github.com/yzfly/LightRead/issues)、提交 PR 或推荐合法公开书源。

作者：**江树 / 云中江树** · 微信：**1796060717**（备注 `LightRead`）· 微信公众号：**云中江树**

<sub>本页为实际应用界面截图；书架、阅读记录与 PDF 译文使用演示数据，示例读物与封面为本项目制作，不随应用附送。[截图复现说明](docs/screenshots/README.md)</sub>

## 开源协议

[GNU Affero General Public License v3.0 or later](LICENSE)

LightRead 使用 AGPL 授权的 MuPDF，因此项目整体以 AGPL-3.0-or-later 发布。分发修改版或通过网络向用户提供修改版服务时，须依照协议提供对应源代码。

致谢：[foliate-js](https://github.com/johnfactotum/foliate-js) (MIT) · [MuPDF](https://mupdf.com/) (AGPL-3.0-or-later) · [PDFium](https://pdfium.googlesource.com/pdfium/) (BSD-3-Clause) · [BabelDOC](https://github.com/funstory-ai/BabelDOC) · 中文词表取自 [jieba](https://github.com/fxsjy/jieba) 词典 (MIT) 与 [DeepSeek-R1](https://huggingface.co/deepseek-ai/DeepSeek-R1) 分词器词表 (MIT)
