// 手机竖屏适配审计: 2024–2026 年主流机型 × 主要页面, 自动查横向溢出 / 半截出屏 / 触控目标过小 /
// 字号过小 / 刘海与手势条遮挡 / 文字被裁切, 并留截图。结果是回归基线, 不是一次性检查。
//
// 先 npm run build && npx vite preview --port 4173 --strictPort, 再:
//   npm run e2e:mobile                    全部机型
//   DEVICES=se,fold-cover npm run e2e:mobile   只跑部分 (按 id)
//   STRICT=1 npm run e2e:mobile           有 error 级问题时退出码 1
// 报告: /tmp/lightread-mobile/report.json, 截图: /tmp/lightread-mobile/shots/
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.env.E2E_BASE ?? 'http://localhost:4173'
const OUT = '/tmp/lightread-mobile'
const FIX = join(OUT, 'fixtures')
rmSync(join(OUT, 'shots'), { recursive: true, force: true })
mkdirSync(join(OUT, 'shots'), { recursive: true })
mkdirSync(FIX, { recursive: true })

/**
 * 机型: CSS 视口 (竖屏), DPR, 安全区 (状态栏 / 刘海 / 灵动岛, 底部手势条).
 * 安卓按 edge-to-edge 估: 状态栏约 24–32dp, 手势条约 16–24dp.
 */
export const DEVICES = [
  { id: 'fold-cover', name: 'Galaxy Z Fold6/7 外屏', w: 344, h: 882, dpr: 3, top: 28, bottom: 16, android: true },
  { id: 's24', name: 'Galaxy S24/S25 · 华为 nova', w: 360, h: 780, dpr: 3, top: 28, bottom: 16, android: true },
  { id: 'flip', name: 'Galaxy Z Flip6/7', w: 360, h: 880, dpr: 3, top: 28, bottom: 16, android: true },
  { id: 'se', name: 'iPhone SE (3rd)', w: 375, h: 667, dpr: 2, top: 20, bottom: 0 },
  { id: 'mini', name: 'iPhone 13 mini', w: 375, h: 812, dpr: 3, top: 50, bottom: 34 },
  { id: 's24u', name: 'Galaxy S24+/S25 Ultra', w: 384, h: 832, dpr: 3.75, top: 28, bottom: 16, android: true },
  { id: 'iphone16e', name: 'iPhone 16e / 14', w: 390, h: 844, dpr: 3, top: 47, bottom: 34 },
  { id: 'iphone16', name: 'iPhone 15/16', w: 393, h: 852, dpr: 3, top: 59, bottom: 34 },
  { id: 'xiaomi', name: '小米 14/15 · vivo · OPPO', w: 393, h: 873, dpr: 2.75, top: 32, bottom: 16, android: true },
  { id: 'iphone17', name: 'iPhone 16 Pro / 17 / 17 Pro', w: 402, h: 874, dpr: 3, top: 62, bottom: 34 },
  { id: 'pixel', name: 'Pixel 9/10 · OnePlus', w: 412, h: 915, dpr: 2.625, top: 28, bottom: 16, android: true },
  { id: 'air', name: 'iPhone Air', w: 420, h: 912, dpr: 3, top: 62, bottom: 34 },
  { id: 'plus', name: 'iPhone 15/16 Plus', w: 430, h: 932, dpr: 3, top: 59, bottom: 34 },
  { id: 'promax', name: 'iPhone 16/17 Pro Max', w: 440, h: 956, dpr: 3, top: 62, bottom: 34 },
  { id: 'fold-inner', name: 'Galaxy Z Fold 内屏', w: 690, h: 838, dpr: 2.6, top: 28, bottom: 16, android: true },
]

// ---- 测试文件 ----
const write = (name, text) => { writeFileSync(join(FIX, name), text); return join(FIX, name) }
const novel = Array.from({ length: 4 }, (_, i) => `第${'一二三四'[i]}章 一个名字相当长的章节标题用来测试换行\n\n` +
  '夜色像一块浸了水的墨布，慢慢压下来。他把灯芯挑亮了一点，书页上的字便站得直了些。\n'.repeat(30)).join('\n')
const files = {
  novel: write('一本书名很长很长的测试小说：关于手机竖屏的一切.txt', novel),
  md: write('README.md', `# 轻阅使用指南

这是一段**粗体**、*斜体*、\`useReaderSettings({ fontSize: 18 })\` 和 [链接](https://example.com) 的段落。中文与 English mixed 的长段落，用来检查两端对齐时字间距会不会被拉开。

## 表格

| 格式 | 渲染方式 | 说明 | 是否支持目录 | 示例文件 |
|------|:----:|------|------|------|
| Markdown | 文档预览 | GFM 表格、任务清单、脚注 | 是 | README.md |
| HTML | 保留页面样式 | 去掉脚本与事件属性 | 是 | index.html |

## 代码

\`\`\`python
def very_long_function_name(argument_one, argument_two, argument_three=None, **kwargs):
    return {"key": argument_one, "other": argument_two}
\`\`\`

> 引用一段话：形式和内容是同一件事。

- [x] 已完成任务
- [ ] 未完成任务

https://example.com/a/very/long/url/that/should/wrap/instead/of/overflowing/the/screen/width/when/read/on/a/phone
`),
  html: write('page.html', `<!doctype html><html><head><title>HTML 测试页</title>
<style>.card{border:2px solid #3370ff;padding:12px;border-radius:8px}.wide{width:900px;background:#eef;padding:8px}</style></head>
<body><h1>HTML 测试页</h1><p>普通段落。</p><div class="card">卡片</div><div class="wide">固定 900px 宽的块</div>
<img src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='300'><rect width='1200' height='300' fill='%233370ff'/></svg>" alt="宽图" />
<table><tr><th>A</th><th>B</th><th>C</th></tr><tr><td>1</td><td>2</td><td>3</td></tr></table>
<pre>const aVeryLongLineOfCodeThatDoesNotWrapNaturally = someFunction(argumentNumberOne, argumentNumberTwo)</pre></body></html>`),
  code: write('config.json', JSON.stringify({ name: 'lightread', description: 'A very long description string that goes beyond the width of a phone screen for sure', list: Array.from({ length: 60 }, (_, i) => i) })),
  ts: write('readerTheme.ts', Array.from({ length: 80 }, (_, i) => `export const value${i} = computeSomethingWithAVeryLongName(${i}, { option: true, another: 'string literal' }) // 注释 ${i}`).join('\n')),
}

// ---- 页面内检查 (在浏览器里执行) ----
function auditInPage({ safeTop, safeBottom }) {
  const W = innerWidth
  const H = innerHeight
  const issues = []
  const desc = el => {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(c => !c.startsWith('data-v')).slice(0, 2).join('.') : ''
    const label = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24)
    return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${label ? ` "${label}"` : ''}`
  }
  const visible = el => {
    for (let p = el; p && p !== document.documentElement; p = p.parentElement) {
      const s = getComputedStyle(p)
      if (p.inert || s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false
      if (p !== el && s.pointerEvents === 'none' && p.classList.contains('hidden')) return false
    }
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < H && r.right > 0 && r.left < W
  }
  // 祖先里有横向滚动 / 裁切容器: 子元素超出属于设计 (横滑列表), 不算溢出
  const insideClipX = el => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p)
      if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) return true
    }
    return false
  }
  // 元素是否钉在屏幕上: 自身或祖先 fixed / sticky, 或不在任何可纵向滚动的容器里 (页面骨架)
  const pinned = el => {
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p)
      if (s.position === 'fixed' || s.position === 'sticky') return true
      if (p !== el && /(auto|scroll)/.test(s.overflowY) && p.scrollHeight > p.clientHeight + 1) return false
    }
    return document.documentElement.scrollHeight <= H + 1
  }
  const push = (type, level, el, detail) => issues.push({ type, level, el: el ? desc(el) : '', detail })

  if (document.documentElement.scrollWidth > W + 1) push('page-overflow-x', 'error', null, `scrollWidth ${document.documentElement.scrollWidth} > ${W}`)

  const all = Array.from(document.querySelectorAll('body *')).filter(el => !(el instanceof SVGElement && el.ownerSVGElement))
  for (const el of all) {
    if (!visible(el)) continue
    const r = el.getBoundingClientRect()
    // 半截出屏: 一部分在屏内, 一部分伸出左右边缘
    if ((r.right > W + 1 || r.left < -1) && r.width < W * 1.5 && !insideClipX(el)) {
      const s = getComputedStyle(el)
      if (s.position !== 'fixed' || (r.left < W && r.right > 0)) push('clipped-x', 'error', el, `left ${Math.round(r.left)} right ${Math.round(r.right)} / ${W}`)
    }
  }

  const interactive = all.filter(el => el.matches('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=switch], [role=menuitem], summary') && visible(el))
  for (const el of interactive) {
    const r = el.getBoundingClientRect()
    // 正文里的行内链接按文字高度算, 不查
    if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') continue
    if (el.matches('input[type=range]')) continue
    // .hit 在触屏上四周外扩 8px (见 main.css), 按外扩后的可点区域算
    const pad = el.matches('.hit') && matchMedia('(pointer: coarse)').matches ? 16 : 0
    const min = Math.min(r.width, r.height) + pad
    if (min < 24) push('tap-tiny', 'error', el, `${Math.round(r.width)}×${Math.round(r.height)}`)
    else if (min < 36) push('tap-small', 'warn', el, `${Math.round(r.width)}×${Math.round(r.height)}`)
    // 系统栏遮挡: 固定在屏幕上的可点元素压在状态栏 / 刘海 / 手势条区域 (滚动内容滚到那里不算)
    if (pinned(el)) {
      if (r.top < safeTop - 1 && r.bottom > 0) push('under-status-bar', 'error', el, `top ${Math.round(r.top)} < ${safeTop}`)
      if (safeBottom && r.bottom > H - safeBottom + 1 && r.top < H) push('under-home-indicator', 'error', el, `bottom ${Math.round(r.bottom)} > ${H - safeBottom}`)
    }
  }

  // 字号: 可见文字 < 11px 记 warn (中文 12px 以下就难读)
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const seen = new Set()
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement
    if (!el || seen.has(el) || !n.textContent.trim()) continue
    seen.add(el)
    if (!visible(el)) continue
    const fs = parseFloat(getComputedStyle(el).fontSize)
    if (fs < 11) push('text-tiny', 'warn', el, `${fs}px`)
    // 文字被裁切 (溢出隐藏又没有省略号)
    const s = getComputedStyle(el)
    if (el.scrollWidth > el.clientWidth + 2 && /(hidden|clip)/.test(s.overflowX) && s.textOverflow !== 'ellipsis' && el.children.length === 0) {
      push('text-clipped', 'warn', el, `${el.scrollWidth} > ${el.clientWidth}`)
    }
  }
  return issues
}

// 阅读器正文在 foliate 的 iframe 里: 查正文元素是否超出栏宽
async function auditReaderContent(page) {
  const issues = []
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue
    try {
      const found = await frame.evaluate(() => {
        const out = []
        const body = document.body
        if (!body) return out
        const colW = document.documentElement.clientWidth
        const style = getComputedStyle(document.documentElement)
        const colWidth = parseFloat(style.columnWidth) || colW
        // 表格单元被挤到不足 3 个字宽: 表头一字一行
        for (const cell of body.querySelectorAll('th, td')) {
          const fs = parseFloat(getComputedStyle(cell).fontSize)
          const w = cell.getBoundingClientRect().width
          if (w > 0 && w < fs * 3 && cell.textContent.trim().length > 2) { out.push(`squeezed-cell "${cell.textContent.trim().slice(0, 8)}" ${Math.round(w)}px`); break }
        }
        for (const el of body.querySelectorAll('table, pre, img, div, p, ol, li')) {
          const r = el.getBoundingClientRect()
          // 横滑容器 (如 .table-wrap) 里的内容超宽属于设计
          let scroller = false
          for (let p = el.parentElement; p && p !== body; p = p.parentElement) {
            if (/(auto|scroll)/.test(getComputedStyle(p).overflowX)) { scroller = true; break }
          }
          if (!scroller && r.width > colWidth + 2 && getComputedStyle(el).overflowX === 'visible') {
            out.push(`${el.tagName.toLowerCase()}${el.className ? '.' + el.className : ''} ${Math.round(r.width)} > ${Math.round(colWidth)}`)
          }
        }
        return out.slice(0, 5)
      })
      for (const d of found) issues.push({ type: d.startsWith('squeezed-cell') ? 'table-squeezed' : 'content-wider-than-column', level: 'error', el: '', detail: d })
    } catch { /* 跨域或已卸载的 iframe */ }
  }
  return issues
}

const report = []
const onlyIds = process.env.DEVICES?.split(',').map(s => s.trim()).filter(Boolean)
const devices = onlyIds ? DEVICES.filter(d => onlyIds.includes(d.id)) : DEVICES

const browser = await chromium.launch()
for (const device of devices) {
  const ctx = await browser.newContext({
    viewport: { width: device.w, height: device.h },
    deviceScaleFactor: device.dpr,
    isMobile: true,
    hasTouch: true,
    locale: 'zh-CN',
    userAgent: device.android
      ? 'Mozilla/5.0 (Linux; Android 15; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'
      : 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  })
  await ctx.addInitScript(({ top, bottom }) => {
    // 模拟系统栏: 覆盖 --lr-safe-* (与 services/systemBars.ts 是同一组变量). init 时 <html> 还没解析,
    // 等 DOM 就绪再插样式; !important 压过原生壳写的行内值
    const inject = () => {
      if (document.getElementById('lr-e2e-safe')) return
      const style = document.createElement('style')
      style.id = 'lr-e2e-safe'
      style.textContent = `:root { --lr-safe-top: ${top}px !important; --lr-safe-bottom: ${bottom}px !important; }`
      document.head.append(style)
    }
    if (document.head) inject()
    else document.addEventListener('DOMContentLoaded', inject)
    localStorage.setItem('lightread-update-check', JSON.stringify({ at: Date.now(), info: { version: '0.0.0', hasUpdate: false, assets: [] } }))
  }, { top: device.top, bottom: device.bottom })
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', e => pageErrors.push(e.message))

  const results = []
  const check = async (label, extra = []) => {
    await page.waitForTimeout(350)
    const issues = [...await page.evaluate(auditInPage, { safeTop: device.top, safeBottom: device.bottom }), ...extra]
    const shot = join(OUT, 'shots', `${device.id}-${label}.png`)
    await page.screenshot({ path: shot })
    results.push({ label, issues, shot })
  }
  const go = async path => { await page.goto(`${BASE}/#${path}`, { waitUntil: 'load' }); await page.waitForTimeout(900) }

  await go('/library')
  await check('library-empty')
  await page.setInputFiles('input[type=file][multiple]', Object.values(files))
  await page.waitForFunction(n => document.querySelectorAll('.book-card').length >= n, Object.keys(files).length, { timeout: 30000 })
  await page.waitForTimeout(2500) // 等导入提示消失
  await check('library')
  for (const path of ['/papers', '/catalogs', '/stats', '/transfer', '/settings', '/manual']) {
    await go(path)
    await check(path.slice(1))
    if (path === '/settings') {
      // 手机设置首页是分组列表, AI 设置在二级页里
      await page.locator('.pl-row', { hasText: 'AI 助手' }).click()
      await page.waitForSelector('#ai-provider')
      await check('settings-ai')
      await page.locator('#ai-provider').click()
      await check('settings-ai-picker')
      await page.evaluate(() => document.documentElement.dataset.theme = 'dark')
      await check('settings-ai-picker-dark')
      await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
      await page.evaluate(() => document.documentElement.dataset.theme = 'light')
      await page.locator('.pl-back').click()
      await page.waitForSelector('.phone-settings')
    }
  }

  const readers = [['novel', '测试小说'], ['md', '轻阅使用指南'], ['html', 'HTML 测试页'], ['code', 'config.json'], ['ts', 'readerTheme.ts']]
  for (const [key, title] of readers) {
    await go('/library')
    await page.locator(`.book-card:has-text("${title}")`).first().click()
    await page.waitForSelector('foliate-view', { timeout: 15000 })
    await page.waitForTimeout(2500)
    await check(`read-${key}`, await auditReaderContent(page))
    if (key === 'novel' || key === 'md') {
      // 呼出工具栏: 轻点屏幕中间 (触摸). 工具栏几秒后自动收起, 每一步操作前都重新确认
      const barsShown = () => page.locator('footer.bar.bottom:not(.hidden)').isVisible().catch(() => false)
      const ensureBars = async () => {
        // 开书时工具栏是展开的, 几秒后自动收起: 先等它收起再点, 免得点击与自动收起撞车
        await page.waitForSelector('footer.bar.bottom.hidden', { timeout: 8000 }).catch(() => {})
        for (let i = 0; i < 3 && !(await barsShown()); i++) {
          await page.touchscreen.tap(device.w / 2, device.h / 2)
          await page.waitForTimeout(450)
        }
        return barsShown()
      }
      const shown = await ensureBars()
      await check(`read-${key}-bars`, shown ? [] : [{ type: 'bars-not-shown', level: 'error', el: '', detail: '轻点屏幕中间没有呼出工具栏' }])
      if (key === 'novel') {
        for (const [index, label] of [[0, 'toc'], [4, 'typography'], [3, 'modes']]) {
          try {
            if (!(await barsShown()) && !(await ensureBars())) throw new Error('工具栏没有呼出')
            await page.locator('.dock button').nth(index).click({ timeout: 3000 })
            await page.waitForTimeout(700)
            await check(`read-novel-${label}`)
            if (label === 'modes') {
              for (const guide of ['auto', 'typewriter', 'lyric']) {
                const gear = page.locator(`.rm-guide[data-guide=${guide}] .rm-gear`)
                if (await gear.getAttribute('aria-expanded') !== 'true') await gear.click()
                await check(`read-novel-modes-${guide}`)
                for (const selector of ['.rm-gear', '.rm-guide-action']) {
                  const box = await page.locator(`.rm-guide[data-guide=${guide}] ${selector}`).boundingBox()
                  if (!box || box.width < 44 || box.height < 44) throw new Error(`${guide} ${selector} 小于 44px`)
                }
              }
              await page.locator('.rm-guide[data-guide=lyric] .rm-more summary').click()
              await page.locator('.rm-position-input').scrollIntoViewIfNeeded()
              await check('read-novel-lyric-custom')
              await page.evaluate(() => document.documentElement.dataset.theme = 'dark')
              await check('read-novel-modes-dark')
              await page.evaluate(() => document.documentElement.dataset.theme = 'light')
              for (const guide of ['auto', 'typewriter', 'lyric']) {
                await page.locator(`.rm-guide[data-guide=${guide}] .rm-guide-action`).click()
                await page.locator('.rm-panel').waitFor({ state: 'hidden' })
                if (!(await barsShown()) && !(await ensureBars())) throw new Error('带读开始后工具栏没有呼出')
                await page.locator('.dock button').nth(3).click()
                await page.locator(`.rm-guide[data-guide=${guide}].is-running`).waitFor()
                await page.locator('.rm-running').getByRole('button', { name: '退出', exact: true }).click()
                await page.locator('.rm-running').waitFor({ state: 'hidden' })
              }
            }
            if (label === 'typography') {
              const toggle = page.getByRole('switch', { name: '手机竖握时改为连续滚动', exact: true })
              await toggle.scrollIntoViewIfNeeded()
              await check('read-novel-typography-page')
              await toggle.click()
              await page.getByRole('group', { name: '翻页方式', exact: true }).getByRole('button', { name: '翻页', exact: true }).click()
              await page.waitForFunction(() => !document.querySelector('foliate-view')?.renderer?.scrolled)
              await toggle.click()
              await page.waitForFunction(() => document.querySelector('foliate-view')?.renderer?.scrolled)
              if (await page.getByRole('button', { name: '翻页', exact: true }).getAttribute('aria-pressed') !== 'true') throw new Error('竖屏覆盖了保存版式')
              await page.evaluate(() => document.documentElement.dataset.theme = 'dark')
              await check('read-novel-typography-dark')
              await page.evaluate(() => document.documentElement.dataset.theme = 'light')
            }
            await page.keyboard.press('Escape')
            await page.waitForTimeout(400)
          } catch (e) {
            results.push({ label: `read-novel-${label}`, issues: [{ type: 'panel-unreachable', level: 'error', el: '', detail: e.message.split('\n')[0] }] })
          }
        }
      }
    }
  }
  if (pageErrors.length) results.push({ label: 'page-errors', issues: pageErrors.map(m => ({ type: 'page-error', level: 'error', el: '', detail: m })) })
  report.push({ device, results })
  await ctx.close()

  const errors = results.flatMap(r => r.issues).filter(i => i.level === 'error').length
  const warns = results.flatMap(r => r.issues).filter(i => i.level === 'warn').length
  console.log(`${errors ? '❌' : '✅'} ${device.name.padEnd(28)} ${device.w}×${device.h}  error ${errors}  warn ${warns}`)
}
await browser.close()

writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2))

// 汇总: 同一问题在多少台机型上出现 (全局问题优先修)
const agg = new Map()
for (const { device, results } of report) {
  for (const { label, issues } of results) {
    for (const i of issues) {
      const key = `${i.level}|${i.type}|${label}|${i.el}`
      const a = agg.get(key) ?? { ...i, label, devices: new Set(), sample: i.detail }
      a.devices.add(device.id)
      agg.set(key, a)
    }
  }
}
const rows = [...agg.values()].sort((a, b) => (a.level === b.level ? b.devices.size - a.devices.size : a.level === 'error' ? -1 : 1))
console.log(`\n共 ${rows.length} 类问题 (报告 ${join(OUT, 'report.json')})`)
for (const r of rows.slice(0, Number(process.env.TOP ?? 80))) {
  console.log(`${r.level === 'error' ? 'E' : 'w'} ${String(r.devices.size).padStart(2)}台 ${r.type.padEnd(22)} ${r.label.padEnd(20)} ${r.el}  (${r.sample})`)
}
if (process.env.STRICT && rows.some(r => r.level === 'error')) process.exit(1)
