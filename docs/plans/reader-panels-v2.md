# 阅读器面板 v2：版式回「排版」，带读改为列表

> 2026-10-17 · 状态：已实现 · 原型：`docs/prototypes/reader-panels-v2.html`（直接用浏览器打开）
> 现状与选择器说明已同步到 `docs/reader-panels.md` v2。

## 1. 为什么改

「模式 › 阅读方式」把**设一次就不动的版式**（翻页 / 滚动、跨章、分栏、竖屏）和**随时开停的带读**（自动翻页、打字机、歌词、听书）混在一个标题下：标题层级不对称（「阅读方式 › 翻页方式 › 翻页」三重同义），行随选择出现 / 消失，「竖屏：单栏连续 / 同横屏」看不懂，带读页签只切换不启动、开始按钮在约 10 项参数之后（桌面需要滚动），速度一个值 5 个控件且与自动翻页的控件不一致。

## 2. 新分工（按读者心里的问题）

| 读者在想 | 去哪 | 性质 |
|---|---|---|
| 书页长什么样、怎么翻 | **排版 › 页面** | 设置，设一次 |
| 此刻换个环境 | 模式 › 场景 | 一键开关，可还原（不变） |
| 让什么带着我读 | **模式 › 带读** | 动作：开始 / 暂停 / 退出 |

与微信读书、Apple Books、Kindle 一致：翻页方式在 Aa 面板。10-16 把版式搬进模式的理由（带读在不同版式下动法不同）改由「带读每行的版式说明 + 跳转」解决。

## 3. 排版 › 页面（`TypographyPanel`）

自上而下，替换现在的只读入口 `.tp-jump`：

1. **翻页方式**：三张带示意图的卡片，一行，`role="group" aria-label="翻页方式"`，每张是 `button`（名字即可访问名）：
   - 翻页 → `reader.flow='paginated'`（`continuousScroll` 不动）
   - 按章滚动 → `flow='scrolled'`, `continuousScroll=false`
   - 连续滚动 → `flow='scrolled'`, `continuousScroll=true`

   下面一行灰字说明所选项：「左右翻页，像纸书一样」/「上下滚动，读到章末停一下」/「上下滚动，一章接一章读下去」。**数据模型不变**，不升 `SETTINGS_VERSION`。
   竖屏锁定 / 歌词临时滚动时：高亮保存的选择，下方说明改为现有 `reader.portraitLockedNote` / `reader.modeLockedNote` 的语义（文案按新位置改写，不再提「下方竖屏」，改为「可在下方关闭」）。
2. **分栏** 自动 / 单栏 / 双栏（`reader.maxColumnCount`）：**始终显示**；滚动时整组禁用（`disabled`）并注明「滚动时始终单栏」；大字等强制单栏时注明（沿用 `reader.forcedSingleColumn`）。
3. **手机竖握时改为连续滚动**：开关（`reader.portraitScroll`），副标题「横过来恢复上面的设置」。**只在触屏 / 可旋转设备显示**（`(hover: none) and (pointer: coarse)` 一类，复用 `useMediaQuery` 里已有的 MQ；没有就加一个）。
4. 进度（不变）。

固定版式书：不显示 1–3（同现状）。

## 4. 模式面板（`ReadingModePanel`）

顺序：**运行条（运行中才出现，置顶）** → 点睛阅读（插槽，不变）→ 场景（不变）→ 带读。删除整个「阅读方式」分组、`data-section="layout"`、`focus='layout'` 相关逻辑、底部 `guideExclusive` 说明。

### 4.1 运行条
沿用现有 `progress`（章名 / 剩余时间 / 进度条）+ 当前带读名 + 「暂停/继续」「退出」。自动翻页、打字机、歌词运行时都显示（自动翻页没有 progress 时只显示名字和按钮）。

### 4.2 带读列表
分组标题「带读」，右侧小字「一次运行一个」。四行，每行：名称 + 一行说明 + ⚙ 设置按钮（`aria-expanded`）+ 主按钮。

| 行 | 名称 | 说明（按**生效版式**，翻页 / 滚动） | 主按钮 |
|---|---|---|---|
| 自动翻页 | 滚动版式下叫「自动滚动」 | 复用 `guideLayoutNote` 的判断：每隔几秒翻一页 / 匀速往下滚；墨水屏整屏推进 | 开始 / 暂停 |
| 打字机 | | 打满一页翻页 / 当前行保持在视线处 | 开始 / 暂停（运行中；退出在运行条） |
| 歌词 | | 一行一行亮起；翻页版式下加「临时改为滚动，结束恢复翻页」 | 开始 / 暂停（`driver='pace'` 时）；手动 / 跟听书运行中主按钮为「退出」 |
| 听书 | | 朗读这本书；正在听书且歌词没开时，说明换成按钮「显示歌词」（`modes.startLyric('tts')`） | 打开 ›（`open-tts`） |

- 说明后面带一个链接「当前翻页，改 ›」/「当前滚动，改 ›」：`emit('open-typography', 'page')`（`TypographySection` 没有 `page` 就加，滚到页面分区）。听书行不带。
- 开始一个带读时若另一个在运行：照现在 `stopForExternal` 停掉它，并 toast「已停止{名称}」（复用 `readingMode.autoStopped` / `ttsPaused` / `typewriterStopped` / `lyricStopped`，缺的补 key）。
- ⚙ 展开该行的设置，**同一时间只展开一行**；默认展开 `modes.panelTab` 记住的那一行（沿用该状态当「上次展开的带读」，听书不展开）。运行中的行高亮（浅品牌底）。
- `!supported`（固定版式等）时打字机 / 歌词行的开始按钮禁用，说明换成 `readingMode.modeUnsupported`。
- 手机上点「开始」后收起面板（自动翻页现有逻辑，打字机 / 歌词同样）。

### 4.3 各行的设置：常用两项外露，其余收进「更多」
用原生 `<details>`，展开状态不必持久化。

| 行 | 外露 | 更多 |
|---|---|---|
| 自动翻页 | 速度 | — |
| 打字机 | 出字（逐字/逐句/逐行）、速度 | 后文、标点停顿、墨迹未干、打字声（含音色 / 音量 / 试听） |
| 歌词 | 换行（自动/跟听书/手动，下方保留对应 hint）、速度（仅自动） | 聚焦、其余行、位置、字号、标点停顿 |

### 4.4 统一速度控件
三处速度都用 `LevelSlider`（自动翻页已在用）：带「慢 · 中 · 快」刻度，右侧显示当前值（「8 秒/页」「300 字/分」），点值可直接输入（失焦 / 回车生效，越界收敛并回显——沿用 `onSpeedExact`）。删除 −/+ 按钮和「慢 / 适中 / 快」预设 chip（预设值作为刻度位置）。

### 4.5 去掉的文字
- `readingMode.guideExclusive`（改为 toast）
- 键盘提示 `keysHint` / `lyricKeysHint` 不再作为段落：放到对应开始按钮的 `title`。
- 场景下的 `scenesHint` 保留。

## 5. 联动改动
- `ReaderView`：排版里的 `.tp-jump` 与「打开模式并定位到 layout」的连线删掉；模式的「改 ›」打开排版并定位 `page`。`reader.flowJump` 不再使用就删 key（中英同删）。
- i18n：新增 / 改写的文案中英两个字典同时加，放在原分区。
- 选择器约束（CLAUDE.md）：e2e 里依赖的 `getByRole('group', { name: '分栏' })` 及其「自动 / 单栏 / 双栏」按钮、「翻页」「滚动」按钮、`[title="阅读模式"]`、`.rm-panel`、`.auto-panel`（保留在自动翻页设置容器上）、`.rm-close` 继续可用；位置变了的（分栏与翻页方式现在在排版面板）**改 e2e 去排版面板找**。「滚动」按钮被拆成「按章滚动 / 连续滚动」，e2e 相应改。`.rm-panel` 的「自动翻页」页签改为列表行：e2e 里点页签的地方改为点该行的开始 / ⚙。
- 文档：`docs/reader-panels.md` 按本文改成 v2（§3.1、§3.2、§5 选择器清单），`docs/reading-modes.md` 若提到页签同步改。

## 6. 验收
- `npx vue-tsc -b`
- `npm run test:reader-pages`、`test:sync-settings`、`test:reading-modes`、`test:auto-scroll`
- `npm run build`，重启 `npx vite preview --port 4173 --strictPort`，`npm run e2e`、`npm run e2e:mobile`（无新增 error）、`npm run e2e:continuous-scroll`
- 深色主题下两面板无裸色值（只用令牌）；手机抽屉触控目标 ≥44px（⚙ 与开始按钮）。
