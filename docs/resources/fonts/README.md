# App 按需字体资源（2026-10-18）

仅纳入已核对上游许可证的原始字体文件；不改字形、命名或版权信息。每个 ZIP 包含原字体、完整许可证和 SOURCE.json。SHA-256 校验包与字体两层字节。字体在用户点击时下载，保存后离线使用；字体文件不随 APK 全量打包。

| 字体 | 版本 | 来源 | 许可证 | 下载体积 |
| --- | --- | --- | --- | --- |
| 霞鹜文楷 | v1.530 | [lxgw/LxgwWenKai](https://github.com/lxgw/LxgwWenKai) | [OFL 1.1](wenkai-LICENSE.txt) | 12.3 MB |
| 霞鹜文楷屏幕版 | v1.522 | [lxgw/LxgwWenKai-Screen](https://github.com/lxgw/LxgwWenKai-Screen) | [OFL 1.1](wenkai-screen-LICENSE.txt) | 13.5 MB |
| 霞鹜臻楷 GB | v0.825 | [lxgw/LxgwZhenKai](https://github.com/lxgw/LxgwZhenKai) | [OFL 1.1](zhenkai-LICENSE.txt) | 11.2 MB |
| 芫荽 | main | [ButTaiwan/iansui](https://github.com/ButTaiwan/iansui) | [OFL 1.1](iansui-LICENSE.txt) | 4.7 MB |
| 朱雀仿宋 | v0.212 | [TrionesType/zhuque](https://github.com/TrionesType/zhuque) | [OFL 1.1](zhuque-LICENSE.txt) | 5.7 MB |
| 思源宋体 | 2.003R | [adobe-fonts/source-han-serif](https://github.com/adobe-fonts/source-han-serif) | [OFL 1.1](source-serif-LICENSE.txt) | 19.1 MB |
| 思源黑体 | 2.005R | [adobe-fonts/source-han-sans](https://github.com/adobe-fonts/source-han-sans) | [OFL 1.1](source-sans-LICENSE.txt) | 13.1 MB |
| 悠哉字体 | v0.868 | [lxgw/yozai-font](https://github.com/lxgw/yozai-font) | [OFL 1.1](yozai-LICENSE.txt) | 9.4 MB |
| 马善政楷书 | master | [googlefonts/mashanzheng](https://github.com/googlefonts/mashanzheng) | [OFL 1.1](mashanzheng-LICENSE.txt) | 3.6 MB |
| 得意黑 | v2.0.1 | [atelier-anchor/smiley-sans](https://github.com/atelier-anchor/smiley-sans) | [OFL 1.1](smiley-LICENSE.txt) | 1.6 MB |

## 适用范围与暂未镜像项

- 芫荽以繁体为主；样本文字中的部分简体字不在字库内，App 明示回退。马善政、得意黑以简体和艺术字风格为主，部分繁体同样需要回退，适合标题短文。
- 朱雀仿宋采用作者明确标为预览版的 v0.212；不把它标为正式版。臻楷选择 v0.825 的标准 GB 版本，不把更新版本的 Slab 分支冒充同一字体。
- MiSans：小米官方许可允许免费商用，但限制单独再分发字体文件。本项目不镜像，仅提供[官方下载](https://hyperos.mi.com/font/download/)入口，保留手动导入。不能将其归为 OFL 开源字体。
- 汇文系列：已取得作者[活字库官网](https://huozi.cool/)公开[授权配置](https://huozi.cool/api/license-config)，汇文明朝、汇文正楷、汇文仿宋等归为“免商可修改”，覆盖嵌入式和出版用途。该声明未明确第三方独立镜像分发条件，也未采用 OFL；App 提供作者官网获取与手动导入入口，不混入 OFL 下载目录。核验摘录见 `huiwen-author-license-2026-10-18.json`。

## 验证

`verification-2026-10-18.json` 记录字体实际家族、测试字串的缺字及原文件哈希。字串覆盖常用简繁汉字、中文标点、数字与英文，不表示所有汉字均覆盖。浏览器与 K30 的下载、应用、离线和正文检查另见验收记录。

GitCode [字体资源下载页](https://gitcode.com/langgpt/LightRead/releases/tag/reader-fonts-20261018) 已发布。10 个字体包和 4 个说明／校验文件均通过匿名 GET 下载及 SHA-256 回验，详见 `gitcode-published-2026-10-18.json`。浏览器实际阅读文档中逐款加载、错误包拒绝、取消、缓存切换、立即刷新持久化与 6 种布局检查通过；K30 验证继续记录在真机验收报告。

2026-10-18 K30 已逐款验证 10 款实际字体文件的哈希、许可证及《理想国》阅读文档 FontFace 加载；网络阻断条件下重开仍能使用已下载字体，原生返回逐层关闭窗口。大字库分块读写后，相同思源宋体下载保存阶段的 App 主进程 PSS 从约 2.2 GB 降至约 197 MiB；24 次追加采样最大约 227 MiB。10 款正文与段落实际字体及真机截图已检查；25.9 MB 本地字体经 Android 系统选择器导入、原文件校验和正文应用通过，临时导入项已清理。
