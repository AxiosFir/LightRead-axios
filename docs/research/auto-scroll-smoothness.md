# 自动滚动流畅度审查

2026-10-16。用户在手机和 Surface 上都感到自动滚动不够稳定。审查基线为 v1.18.1；本轮同时检查重排图书、跨章连续容器和 PDF。以下浏览器结果来自 Linux 无头 Chromium，不等同于两类设备的实机体验。

## 确认的问题

1. `ReaderView`、`PaperReaderView` 原先用 `min(实际帧间隔, 100ms)` 推进。卡帧后会一次补最多六个 60 Hz 帧的距离。90 秒/屏时，注入 180ms 主线程忙等，手机尺寸 390×844 的单步从约 0.157px 增至 0.938px，960×1127 从约 0.209px 增至 1.252px，均约六倍。
2. 每次速度设置变化都重新启动引擎。重排书还调用 `driftEnd()`，将当前亚像素补偿归并到原生滚动位置。测试确认每次调速触发一次结束；连续拖动速度条会重复打断。
3. foliate 分支把 `exact - scrollTop` 限制为非负数，但滚动位置并非始终为整数。分数缩放下向上量化时，负补偿被丢弃，会使逻辑位移失真。
4. PDF 每帧以实际 `scrollTop` 加位移再写回，没有保留被原生 setter 量化的零头。若每帧位移小于半个量化单位，理论上可以一直不动；纯函数测试覆盖整数、0.8px、0.5px 和连续值。
5. 正文 `touchstart` 设置最长 60 秒等待，只有 `touchend` 解除；系统手势触发 `touchcancel` 时会继续等。后台返回也没有显式重置时钟。

原跨章测试的“auto”场景是直接调用 `scrollBy`，速度约 1.5 屏/秒。它验证跨章停滞和回跳，但不能证明实际自动阅读在慢速下平稳。因此保留原测试，另增 `smooth` 场景走界面启动、调速、逐帧推进和触摸取消。

## 其他产品与平台依据

| 来源 | 已核实的做法 | 对本项目的意义 |
| --- | --- | --- |
| [Moon+ Reader 官方介绍](https://www.moondownload.com/index.html) | 提供像素、行、页等五类自动滚动方式，可实时调速 | 学习速度控制和模式区分；未取得其实现源码，也未做实机横向比较，不能声称采用其底层算法 |
| [KOReader AutoTurn 源码](https://github.com/koreader/koreader/blob/master/plugins/autoturn.koplugin/main.lua) | 按经过时间调度下一次相对视图推进，输入时暂停或重新调度 | 适合离散翻页与墨水屏参考；不是 LCD 连续滚动的帧同步实现 |
| [Librera VerticalModeController 源码](https://github.com/foobnix/LibreraReader/blob/master/app/src/main/java/com/foobnix/sys/VerticalModeController.java) | 线程按速度设置 sleep，再向 UI 线程提交逐像素推进 | 说明“自动滚动”不必然采用显示帧同步；本项目不照搬固定 sleep 的循环 |
| [MDN requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame) | 回调通常跟随刷新率；后台常暂停；按时间戳计算而非固定每帧距离 | 保留 rAF，支持 30–144 Hz，后台恢复重置时间 |
| [MDN scrollTop](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollTop) | 现代浏览器允许小数，缩放和设备影响精度 | 使用实际写回值和有符号残差，不假设所有浏览器都以 1 CSS px 量化 |

## 本轮实现

共用 `AutoScrollClock`：用 rAF 时间戳积分，一帧最多推进 1/30 秒的距离，不保留丢帧债务；间隔超过 250ms 的首次恢复帧不推进。速度变化采用时间常数 120ms 的指数过渡，并使用解析积分，避免依赖刷新率的近似。匀速时 30、60、90、120、144 Hz 在相同时间内距离一致。代价是持续严重掉帧时主动减慢，优先保持文字可跟随，而非追赶墙上时钟。

滚动模式调速只改变目标速度；离散翻页仍重建计时器。页面可见性变化重置时钟。重排书保留原生 `scrollTop` 加 transform 补偿的架构，修正有符号残差和零值附近 transform 反复清除；暂停时由原生 setter 合并到最近可表示位置。PDF 加浮点累计器，外部滚动改变实际位置时重新跟随。补上触摸取消的恢复。

没有改动跨章预载、上下章节回收和阅读锚点补偿。这些逻辑已有 Surface 回跳的历史修复，需要独立证据才调整。`getVisibleRange` 每 250ms 的可见区遍历仍可能在复杂长章带来主线程开销；这次没有采到足以归因的数据，不把所有卡顿都归咎于它。后续若真机仍出现周期性停顿，应录制长任务、可见区计算、章节加载和点睛绘制的耗时，再决定缓存范围、减少扫描或分批绘制。

## 复现与验收

```bash
npm run test:auto-scroll
npm run build
# 构建后重启 vite preview，避免旧资源清单
SCENARIO=smooth npm run e2e:continuous-scroll
SCENARIO=basic npm run e2e:continuous-scroll
```

`smooth` 使用实际界面启动，测试 90 秒/屏、180ms 忙等、连续调速、触摸取消，以及 1/1.25/1.5/2 倍 CSS 缩放下的残差守恒。CSS 缩放验证量化算法，不冒充 Windows 系统缩放或 Surface 硬件验收。`BASELINE=1` 可对旧构建采样，跳过新行为断言。

本地实测（同一 Chromium、同一测试夹具）：

| 视口 | 普通帧位移 | 忙等后的最大单步：修改前 → 后 | 每次调速结束引擎：前 → 后 |
| --- | --- | --- | --- |
| 390×844 | 0.157px | 0.938 → 0.313px | 1 → 0 |
| 960×1127 | 0.209px | 1.252 → 0.417px | 1 → 0 |

两种视口均通过触摸取消后恢复测试。四种 CSS 缩放下，400 次 0.075px 指令累计均为 30px，误差小于 0.000001px。这里测量的是逻辑与补偿位移，不是肉眼评分或 GPU 输出的流畅率。

仍需真机验证手机 WebView 与 Surface WebView2：常用速度、系统缩放、高刷新率、长章节、图片加载、点睛开启、后台返回和手动拖动后恢复。当前改动可以减少已确认的速度突变，不能消除主线程完全阻塞时缺失的画面。
