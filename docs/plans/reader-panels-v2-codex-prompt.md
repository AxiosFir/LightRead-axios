在本仓库实现阅读器面板改版，规格见 docs/plans/reader-panels-v2.md，交互和视觉以原型 docs/prototypes/reader-panels-v2.html 为准（用浏览器打开）。动手前先读 CLAUDE.md（项目约定必须遵守），以及 docs/reader-panels.md（现状说明）。

注意：上一轮 Codex 做到一半被中断了，工作区里已经有它的半成品改动，可能涉及 TypographyPanel.vue、ReadingModePanel.vue、ReaderView.vue、i18n、e2e 脚本（e2e-smoke / e2e-full / e2e-mobile / e2e-continuous-scroll）、docs/reading-modes.md。请先用 git diff 看清现状，在此基础上接着做完。与规格无关的未提交改动（如 CatalogView.vue、catalogErrors.ts、paginator.js、settings.ts 等）是用户自己的，不要 revert、stash 或覆盖。不要 commit。

要做的事：
- 把「模式 › 阅读方式」里的版式挪回「排版 › 页面」：翻页 / 按章滚动 / 连续滚动三选一卡片，分栏一直显示（滚动时变灰），竖屏改为只在触屏设备上出现的开关。
- 模式面板只留：运行条（运行中才出现）、点睛、场景、带读列表。带读每行自带开始按钮，并说明在当前版式下怎么动，附「改 ›」跳到排版；点设置按钮展开设置，常用两项外露、其余收进「更多」；三处速度统一用 LevelSlider；互斥的提示改成 toast。
- 主要文件：ReadingModePanel.vue、TypographyPanel.vue、ReaderView.vue、i18n 的 zh.ts 和 en.ts、useMediaQuery.ts、e2e 脚本、docs/reader-panels.md。

约束：
- 样式只用 main.css 的语义令牌；图标用内联 SVG 并加 aria-hidden，不要用 emoji 或 ⚙ 字符当图标。
- 文案一律走 t()，中英两个字典同时加。
- 数据模型不变，不升 SETTINGS_VERSION。

完成后依次跑：npx vue-tsc -b；npm run test:reader-pages / test:sync-settings / test:reading-modes / test:auto-scroll；npm run build；起 npx vite preview --port 4173 --strictPort（每次 build 后都要重启 preview）；再跑 npm run e2e 和 npm run e2e:mobile。资源密集的命令用 flock /tmp/heavy.lock nice -n 10 ... 串行执行。失败就修到通过；环境原因跑不了的如实说明。

最后：把 docs/plans/reader-panels-v2.md 的状态改为「已实现」，把 docs/reader-panels.md 更新为 v2，然后用中文简短汇报改了哪些文件、和规格有出入的地方及原因、每条验证命令的结果。
