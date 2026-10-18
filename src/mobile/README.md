# App 2.0 与桌面 1.x 的边界

桌面、默认 Web/PWA 继续使用 `src/` 原有界面，版本 1.19.4。Android / iOS 使用本目录的 App 2.0 界面与平台配置中的 2.0.0 版本。不是按窗口宽度切换产品；桌面缩窄窗口仍是原版。

`vite.platform.ts` 在移动构建中依据 `overrides.json` 替换模块，覆盖共享模块间接导入的排版、主题、文案和语音调度。阅读引擎、存储、同步、PDF 等仍共用。不要把 App 专属修改写回对应的桌面文件。新增覆盖文件需登记清单。

- 桌面：`TAURI_ENV_PLATFORM=linux npm run build`（原生 CLI 自动设置实际平台）。
- App 预览：`TAURI_ENV_PLATFORM=android npm run build`，随后同环境启动 `vite preview`。
- 浏览器开发：`LIGHTREAD_UI=mobile npm run dev`。原生桌面平台优先于这个预览参数。
- 原生：`npx tauri android build --apk --target aarch64 --debug`，沿用已有固定签名，不修改应用 ID。
- 版本校验：桌面 `node scripts/check-release.mjs --tag v1.19.4`；App 加 `--platform android --tag v2.0.0`。
- 回归：`node --test scripts/test-platform-boundary.mjs scripts/test-mobile-tts.mjs scripts/test-apk-layout.mjs`。桌面用原有 `e2e-smoke.mjs`；App 用 `e2e-v2.mjs`、`e2e-mobile.mjs`。

字体仅通过 App 的 CSS / JS 依赖打包，许可一起分发。原生语音协议更新通过 Rust 平台条件限定 Android/iOS；桌面协议与行为保持 1.x。`src-tauri/src/mobile/edge_gec.rs` 的测试可独立用 `rustc --edition 2021 --test` 运行，不需要构建桌面壳。

现有全平台 Release 工作流仍面向统一版本的 1.x，不能直接用于 App 2.0 发布；版本检查会拒绝把 v2.0.0 当成桌面版本。App 2.0 当前仅候选 APK / 草稿 PR，发布前须建立独立移动发布与更新通道，不能将 App 版本作为桌面 latest 更新。
