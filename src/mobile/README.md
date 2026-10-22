# App 与桌面界面的边界

桌面、默认 Web/PWA 继续使用 `src/` 原有界面，基础版本为 2.0.0。Android / iOS 使用本目录的 App 界面与平台配置中的 2.1.0 版本。不是按窗口宽度切换产品；桌面缩窄窗口仍是原版。

`vite.platform.ts` 在移动构建中依据 `overrides.json` 替换模块，覆盖共享模块间接导入的排版、主题、文案和语音调度。阅读引擎、存储、同步、PDF 等仍共用。不要把 App 专属修改写回对应的桌面文件。新增覆盖文件需登记清单。

- 桌面：`TAURI_ENV_PLATFORM=linux npm run build`（原生 CLI 自动设置实际平台）。
- App 预览：`TAURI_ENV_PLATFORM=android npm run build`，随后同环境启动 `vite preview`。
- 浏览器开发：`LIGHTREAD_UI=mobile npm run dev`。原生桌面平台优先于这个预览参数。
- 原生：`npx tauri android build --apk --target aarch64 --debug`，沿用已有固定签名，不修改应用 ID。
- 版本校验：桌面 `node scripts/check-release.mjs --tag v2.0.0`；App 加 `--platform android --tag app-v2.1.0`。
- 回归：`node --test scripts/test-platform-boundary.mjs scripts/test-mobile-tts.mjs scripts/test-apk-layout.mjs`。桌面用原有 `e2e-smoke.mjs`；App 用 `e2e-v2.mjs`、`e2e-mobile.mjs`。

字体仅通过 App 的 CSS / JS 依赖打包，许可一起分发。原生在线语音的 Sec-MS-GEC v2 (`src-tauri/src/mobile/edge_gec.rs`) 桌面与 App 共用：2026-10-22 核实旧 v1 令牌已被微软端点以 403 拒绝，桌面一并改用 v2，edge-tts 许可由 `nativeLicenses` 随所有构建分发。`src-tauri/src/mobile/edge_gec.rs` 的测试可独立用 `rustc --edition 2021 --test` 运行，不需要构建桌面壳。

2026-10-18 用户确认版本统一为 2.0.0。全平台使用 `vX.Y.Z`，Android 更新器同时兼容统一标签与历史 `app-vX.Y.Z`；旧 1.20.1 Android 更新器可识别统一标签。桌面发布仍从 `scripts/desktop-release.json` 固定的已发布源码做纯版本补丁构建，附 `desktop-version.patch` 和各平台原生版本检查报告，保持界面与功能不变。

历史 `app-v2.0.0` 保留原资产及标签。它的 APK 只识别 `app-v2.x`，后续首个高于 2.0.0 的版本还需提供同 APK 的 App 兼容发布入口（latest=false），使这些用户迁移到统一更新器。新统一版 APK 没有该限制。

2026-10-20 用户确认 PDF 双形态功能仅发布 App：`app-v2.1.0`。App 的 PDF 路由通过 `services/readerRoute.ts` 覆盖，两个阅读页和设置入口均在 `src/mobile/`；桌面仍使用原版 PDF 阅读器，不加入重排入口。基础元数据和桌面固定源码策略保持 2.0.0。
