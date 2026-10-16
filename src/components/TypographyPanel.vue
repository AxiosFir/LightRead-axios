<script setup lang="ts">
/**
 * 「排版」面板 (docs/reader-panels.md §3.1): 书页长什么样 —— 字和颜色的值只在这里调。
 * 桌面为顶栏下的浮层卡片, 手机为底部抽屉 (遮罩由 ReaderView 的 sheet-scrim 提供)。
 *   文字 (字号 / 行距 / 边距 / 字体; 更多: 字距 / 对齐 / 导入字体)
 *   配色 (主题 / 调暗)
 *   页面 (版式: 只显示当前值, 点了去「模式 › 阅读方式」; 进度显示)
 * 书页怎么动 (翻页 / 滚动 / 跨章 / 分栏 / 竖屏 + 带读) 只在「模式 › 阅读方式」设置, 这里不重复。
 * 「模式」里的场景 (夜读、大字…) 只是一键套用这里的值, 本面板顶部提示哪些场景开着, 可跳去管理。
 * e2e 依赖: .theme-btn (5 个, 第 3 个护眼绿)、.tp-jump (版式入口, 见 scripts/e2e-full.mjs)。
 */
import { computed, nextTick, onMounted, ref } from 'vue'
import { t } from '../i18n'
import { useSettings } from '../stores/settings'
import { READER_THEME_CHOICES, FONT_FAMILIES } from '../services/readerTheme'
import { listSystemFonts, importFontFile } from '../services/fonts'
import { isTauri } from '../storage/types'
import { toast } from '../services/toast'
import { DIM_MAX } from '../services/readingModes/eyeCare'
import type { ReadingModes } from '../composables/useReadingModes'

export type TypographySection = 'text' | 'color' | 'layout'

const props = defineProps<{
  modes: ReadingModes
  /** 生效的排版方式 (竖屏锁定时为滚动) */
  effectiveFlow: 'paginated' | 'scrolled'
  /** 固定版式 (漫画 / 版式 EPUB) */
  fixedLayout: boolean
  /** 竖屏单栏滚动锁定生效中 */
  portraitLocked: boolean
  /** 带读 (歌词) 临时改成了单栏滚动, 结束后恢复保存的版式 */
  modeLocked?: boolean
  /** 打开时滚到这个分区 (从「模式」的「在排版里微调」跳来) */
  focus?: TypographySection | null
}>()

const emit = defineEmits<{
  close: []
  /** 打开「模式」面板管理场景 */
  /** 打开「模式」面板: 管理场景, 或 'layout' 定位到「阅读方式」的版式 */
  'open-modes': [section?: 'layout']
}>()

const settings = useSettings()
const desktop = isTauri()
const root = ref<HTMLElement>()

const THEME_LABEL_KEYS: Record<string, string> = {
  light: 'reader.themeLight', sepia: 'reader.themeSepia', green: 'reader.themeGreen', dark: 'reader.themeDark', auto: 'reader.themeAuto',
}
const themeLabel = (name: string) => (THEME_LABEL_KEYS[name] ? t(THEME_LABEL_KEYS[name]) : name)

// ---- 文字 ----
function setFontSize(raw: string | number) {
  const n = Math.round(Number(raw))
  if (!Number.isFinite(n)) return
  settings.reader.fontSize = Math.min(64, Math.max(8, n))
}

// 系统字体只枚举一次 (桌面版)
const systemFonts = sharedSystemFonts
async function loadSystemFonts() {
  if (!desktop || systemFonts.value.length || systemFontsLoading) return
  systemFontsLoading = true
  try {
    systemFonts.value = await listSystemFonts()
  } catch { /* 枚举失败不影响预设字体 */ } finally {
    systemFontsLoading = false
  }
}

async function importFont() {
  try {
    const font = await importFontFile()
    if (!font) return
    if (!settings.customFonts.some(f => f.file === font.file)) settings.customFonts.push(font)
    settings.reader.fontFamily = `custom:${font.name}`
    toast(t('reader.fontImported', { name: font.name }), 'success')
  } catch (e: any) {
    toast(t('reader.fontImportFailed', { msg: e?.message ?? e }), 'error', 5000)
  }
}

function onLetterSpacing(e: Event) {
  const n = Number((e.target as HTMLInputElement).value)
  if (Number.isFinite(n)) settings.reader.letterSpacing = Math.min(0.2, Math.max(0, Math.round(n * 100) / 100))
}

// ---- 页面: 当前生效的版式 (竖屏锁定 / 歌词临时滚动时注明原因) ----
const flowName = computed(() => {
  if (props.fixedLayout) return t('reader.flowFixed')
  const name = t(props.effectiveFlow === 'scrolled' ? 'reader.scrolled' : 'reader.paginated')
  if (props.portraitLocked) return t('reader.flowNamePortrait', { name })
  if (props.modeLocked) return t('reader.flowNameLyric', { name })
  return name
})

// ---- 配色 ----
function onDim(e: Event) {
  const n = Number((e.target as HTMLInputElement).value)
  if (Number.isFinite(n)) settings.readingMode.eyeCare.dim = Math.min(DIM_MAX, Math.max(0, Math.round(n)))
}

// ---- 场景提示: 改了排版却不显眼的场景 (夜读 / 护眼就是选中的主题本身, 不重复提示) ----
const sceneNames = computed(() => {
  const names: string[] = []
  if (props.modes.largeTextOn.value) names.push(t('readingMode.modeLargeText'))
  if (props.modes.einkActive.value) names.push(t('readingMode.modeEink'))
  if (props.modes.immersive.value) names.push(t('readingMode.modeImmersive'))
  return names.join(t('reader.sceneSep'))
})

// ---- 「更多」折叠: 按设备记住展开状态 (只是便利, 读不到就收起) ----
const MORE_KEY = 'lightread-typography-more'
function loadMore(): { text: boolean } {
  try {
    const v = JSON.parse(localStorage.getItem(MORE_KEY) || 'null')
    return { text: !!v?.text }
  } catch {
    return { text: false }
  }
}
const more = ref(loadMore())
function onMoreToggle(which: 'text', e: Event) {
  more.value = { ...more.value, [which]: (e.target as HTMLDetailsElement).open }
  try { localStorage.setItem(MORE_KEY, JSON.stringify(more.value)) } catch { /* 存储不可用 */ }
}

onMounted(async () => {
  void loadSystemFonts()
  if (!props.focus) return
  await nextTick()
  root.value?.querySelector<HTMLElement>(`[data-section="${props.focus}"]`)?.scrollIntoView({ block: 'start' })
})
</script>

<script lang="ts">
import { ref as sharedRef } from 'vue'
/** 系统字体列表在面板多次打开之间共用 */
const sharedSystemFonts = sharedRef<string[]>([])
let systemFontsLoading = false
</script>

<template>
  <section ref="root" class="settings-pop card" role="dialog" :aria-label="t('reader.typography')">
    <header class="tp-head">
      <strong>{{ t('reader.dockTypography') }}</strong>
      <button class="tp-close" type="button" :title="t('common.close')" :aria-label="t('common.close')" @click="emit('close')">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M6.3 6.3a1 1 0 0 1 1.4 0L12 10.58l4.3-4.3a1 1 0 1 1 1.4 1.42L13.42 12l4.3 4.3a1 1 0 0 1-1.42 1.4L12 13.42l-4.3 4.3a1 1 0 0 1-1.4-1.42L10.58 12l-4.3-4.3a1 1 0 0 1 0-1.4z"/></svg>
      </button>
    </header>

    <!-- 开着的场景: 关闭后恢复原来的排版 -->
    <p v-if="sceneNames" class="tp-scenes" role="note">
      <span>{{ t('reader.scenesOn', { names: sceneNames }) }}</span>
      <button type="button" class="tp-link" @click="emit('open-modes')">{{ t('reader.manageScenes') }}</button>
    </p>

    <!-- 文字 -->
    <section class="tp-group" data-section="text" :aria-label="t('reader.groupText')">
      <h3 class="tp-title">{{ t('reader.groupText') }}</h3>
      <div class="set-row">
        <span class="tp-label">{{ t('reader.fontSize') }}</span>
        <button type="button" class="step-btn" :title="t('reader.fontSmaller')" :aria-label="t('reader.fontSmaller')" @click="setFontSize(settings.reader.fontSize - 1)">A−</button>
        <input v-model.number="settings.reader.fontSize" type="range" min="8" max="64" step="1" :aria-label="t('reader.fontSize')" />
        <button type="button" class="step-btn big" :title="t('reader.fontLarger')" :aria-label="t('reader.fontLarger')" @click="setFontSize(settings.reader.fontSize + 1)">A+</button>
        <input
          class="input set-num"
          type="number"
          min="8"
          max="64"
          step="1"
          inputmode="numeric"
          :value="settings.reader.fontSize"
          :aria-label="t('reader.fontSize')"
          @change="setFontSize(($event.target as HTMLInputElement).value)"
        />
      </div>
      <div class="set-row">
        <span class="tp-label">{{ t('reader.lineHeight') }}</span>
        <input v-model.number="settings.reader.lineHeight" type="range" min="1.2" max="2.6" step="0.1" :aria-label="t('reader.lineHeight')" />
        <span class="tp-value">{{ settings.reader.lineHeight.toFixed(1) }}</span>
      </div>
      <div class="set-row">
        <span class="tp-label">{{ t('reader.margin') }}</span>
        <input v-model.number="settings.reader.gap" type="range" min="2" max="16" step="1" :aria-label="t('reader.margin')" />
        <span class="tp-value">{{ settings.reader.gap }}%</span>
      </div>
      <div class="set-row">
        <span class="tp-label">{{ t('reader.font') }}</span>
        <select v-model="settings.reader.fontFamily" class="input" :aria-label="t('reader.font')">
          <option v-for="f in FONT_FAMILIES" :key="f.labelKey" :value="f.value">{{ t(f.labelKey) }}</option>
          <optgroup v-if="settings.customFonts.length" :label="t('reader.customFonts')">
            <option v-for="f in settings.customFonts" :key="f.file" :value="`custom:${f.name}`">{{ f.name }}</option>
          </optgroup>
          <optgroup v-if="systemFonts.length" :label="t('reader.systemFonts')">
            <option v-for="name in systemFonts" :key="name" :value="`&quot;${name}&quot;`">{{ name }}</option>
          </optgroup>
        </select>
      </div>
      <details class="tp-more" :open="more.text" @toggle="onMoreToggle('text', $event)">
        <summary>
          <span>{{ t('reader.more') }}</span>
          <svg class="tp-chev" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M6.3 9.3a1 1 0 0 1 1.4 0L12 13.58l4.3-4.3a1 1 0 1 1 1.4 1.42l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 0 1 0-1.4z"/></svg>
        </summary>
        <div class="tp-more-body">
          <div class="set-row">
            <span class="tp-label">{{ t('reader.letterSpacing') }}</span>
            <input
              type="range"
              min="0"
              max="0.2"
              step="0.01"
              :value="settings.reader.letterSpacing"
              :aria-label="t('reader.letterSpacing')"
              :aria-valuetext="`${settings.reader.letterSpacing.toFixed(2)}em`"
              @input="onLetterSpacing"
            />
            <span class="tp-value">{{ settings.reader.letterSpacing.toFixed(2) }}em</span>
          </div>
          <div class="set-row">
            <span class="tp-label">{{ t('reader.justify') }}</span>
            <div class="seg" role="group" :aria-label="t('reader.justify')">
              <button type="button" :class="{ active: settings.reader.justify }" :aria-pressed="settings.reader.justify" @click="settings.reader.justify = true">{{ t('reader.justifyOn') }}</button>
              <button type="button" :class="{ active: !settings.reader.justify }" :aria-pressed="!settings.reader.justify" @click="settings.reader.justify = false">{{ t('reader.justifyOff') }}</button>
            </div>
          </div>
          <div v-if="desktop" class="set-row">
            <span class="tp-label"></span>
            <button type="button" class="btn btn-sm" @click="importFont">{{ t('reader.importFont') }}</button>
            <span class="font-hint">ttf / otf / woff2</span>
          </div>
        </div>
      </details>
    </section>

    <!-- 配色 -->
    <section class="tp-group" data-section="color" :aria-label="t('reader.groupColor')">
      <h3 class="tp-title">{{ t('reader.groupColor') }}</h3>
      <div class="set-row">
        <span class="tp-label">{{ t('reader.theme') }}</span>
        <div class="theme-btns" role="group" :aria-label="t('reader.theme')">
          <button
            v-for="choice in READER_THEME_CHOICES"
            :key="choice.name"
            type="button"
            class="theme-btn"
            :class="{ active: settings.reader.theme === choice.name }"
            :style="{ background: choice.bg, color: choice.fg }"
            :title="themeLabel(choice.name)"
            :aria-label="themeLabel(choice.name)"
            :aria-pressed="settings.reader.theme === choice.name"
            @click="settings.reader.theme = choice.name"
          >{{ t('reader.themeSample') }}</button>
        </div>
      </div>
      <div class="set-row">
        <span class="tp-label">{{ t('reader.dim') }}</span>
        <input
          type="range"
          min="0"
          :max="DIM_MAX"
          step="5"
          :value="settings.readingMode.eyeCare.dim"
          :aria-label="t('reader.dim')"
          :aria-valuetext="`${settings.readingMode.eyeCare.dim}%`"
          @input="onDim"
        />
        <span class="tp-value">{{ settings.readingMode.eyeCare.dim }}%</span>
      </div>
      <p v-if="modes.einkActive.value" class="set-note" role="note">{{ t('reader.einkColorNote') }}</p>
    </section>

    <!-- 页面: 页眉页脚的进度; 翻页 / 滚动等版式与带读同在「模式 › 阅读方式」, 这里只显示当前值并跳过去 -->
    <section class="tp-group" data-section="layout" :aria-label="t('reader.groupPage')">
      <h3 class="tp-title">{{ t('reader.groupPage') }}</h3>
      <div class="set-row">
        <span class="tp-label">{{ t('reader.groupLayout') }}</span>
        <button type="button" class="tp-jump" :aria-label="t('reader.flowJump', { name: flowName })" @click="emit('open-modes', 'layout')">
          <span>{{ flowName }}</span>
          <span class="tp-jump-hint">{{ t('reader.flowJumpHint') }}</span>
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M9.3 6.3a1 1 0 0 1 1.4 0l5 5a1 1 0 0 1 0 1.4l-5 5a1 1 0 1 1-1.4-1.4L13.58 12 9.3 7.7a1 1 0 0 1 0-1.4z"/></svg>
        </button>
      </div>
      <div class="set-row">
        <span class="tp-label">{{ t('reader.progressDisplay') }}</span>
        <div class="seg" role="group" :aria-label="t('reader.progressDisplay')">
          <button type="button" :class="{ active: settings.reader.progressDisplay === 'both' }" :aria-pressed="settings.reader.progressDisplay === 'both'" @click="settings.reader.progressDisplay = 'both'">{{ t('reader.progressBoth') }}</button>
          <button type="button" :class="{ active: settings.reader.progressDisplay === 'page' }" :aria-pressed="settings.reader.progressDisplay === 'page'" @click="settings.reader.progressDisplay = 'page'">{{ t('reader.progressPage') }}</button>
          <button type="button" :class="{ active: settings.reader.progressDisplay === 'percent' }" :aria-pressed="settings.reader.progressDisplay === 'percent'" @click="settings.reader.progressDisplay = 'percent'">{{ t('reader.progressPercent') }}</button>
        </div>
      </div>
    </section>
  </section>
</template>

<style scoped>
.settings-pop {
  position: absolute;
  top: calc(52px + var(--safe-top, 0px));
  right: 12px;
  z-index: 25;
  width: min(400px, calc(100% - 24px));
  max-height: calc(100% - 72px - var(--safe-top, 0px) - var(--safe-bottom, 0px));
  overflow-y: auto;
  padding: 14px 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  color: var(--text);
}
.tp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.tp-head strong {
  font-size: 15px;
}
.tp-close {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-2);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.tp-close:hover {
  background: var(--surface-2);
  color: var(--text);
}
.tp-scenes {
  margin: 0;
  padding: 8px 10px;
  border-radius: var(--radius);
  background: var(--brand-light);
  color: var(--text-2);
  font-size: 12px;
  line-height: 1.6;
  display: flex;
  align-items: center;
  gap: 8px;
}
.tp-scenes span {
  flex: 1;
  min-width: 0;
}
.tp-link {
  flex-shrink: 0;
  border: none;
  background: none;
  padding: 2px 4px;
  color: var(--brand);
  font-size: 12px;
  font-weight: 600;
  border-radius: var(--radius-sm);
}
.tp-link:hover {
  text-decoration: underline;
}
.tp-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
  scroll-margin-top: 8px;
}
.tp-title {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--text-3);
}
.set-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  font-size: 13px;
}
.tp-label {
  width: 40px;
  flex-shrink: 0;
  color: var(--text-2);
  overflow-wrap: anywhere;
}
.set-row input[type='range'] {
  flex: 1;
  /* 滑条默认有约 130px 的最小宽度, 字号一行 (A− 滑条 A+ 输入框) 会被撑出面板 */
  min-width: 0;
  accent-color: var(--brand);
}
.tp-value {
  width: 48px;
  flex-shrink: 0;
  text-align: right;
  color: var(--text-3);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.set-num {
  width: 58px;
  flex: none;
  height: 30px;
  font-size: 12px;
  text-align: center;
  padding: 0 4px;
}
.set-row select.input {
  flex: 1;
  min-width: 0;
  height: 32px;
}
.set-note {
  margin: -4px 0 0 50px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-3);
}
.tp-jump {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  margin-left: auto;
  padding: 0 4px 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--text);
  font-size: 13px;
}
.tp-jump-hint {
  color: var(--text-3);
  font-size: 12px;
}
.tp-jump svg {
  color: var(--text-3);
}
.tp-jump:hover {
  border-color: var(--brand);
}
.tp-jump:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 2px;
}
.font-hint {
  font-size: 12px;
  color: var(--text-3);
}
.theme-btns {
  flex: 1;
  display: flex;
  gap: 8px;
}
.theme-btn {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border-radius: 50%;
  border: 2px solid var(--border);
  font-size: 14px;
}
.theme-btn.active {
  border-color: var(--brand);
  box-shadow: 0 0 0 2px var(--brand-light);
}
/* 阅读器面板自己的分段控件 (与全局 .segmented 分开, 见 CLAUDE.md) */
.seg {
  display: flex;
  flex: 1;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.seg button {
  flex: 1;
  min-width: 0;
  height: 30px;
  padding: 0 4px;
  border: none;
  background: var(--card);
  color: var(--text-2);
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.seg button + button {
  border-left: 1px solid var(--border);
}
.seg button.active {
  background: var(--brand-light);
  color: var(--brand);
  font-weight: 500;
}
.step-btn {
  flex-shrink: 0;
  width: 34px;
  height: 30px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--card);
  color: var(--text-2);
  font-size: 12px;
  font-weight: 600;
}
.step-btn.big {
  font-size: 15px;
}
.step-btn:hover {
  color: var(--brand);
  border-color: var(--brand);
}
.step-btn:active {
  background: var(--brand-light);
  color: var(--brand);
}
.tp-more {
  margin-top: -4px;
}
.tp-more summary {
  display: flex;
  align-items: center;
  gap: 4px;
  width: fit-content;
  min-height: 28px;
  padding-left: 50px;
  list-style: none;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-3);
  user-select: none;
}
.tp-more summary::-webkit-details-marker {
  display: none;
}
.tp-more summary:hover {
  color: var(--brand);
}
.tp-chev {
  transition: transform var(--dur) var(--ease);
}
.tp-more[open] .tp-chev {
  transform: rotate(180deg);
}
.tp-more-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 8px;
}
.tp-close:focus-visible,
.tp-link:focus-visible,
.tp-more summary:focus-visible,
.seg button:focus-visible,
.step-btn:focus-visible,
.theme-btn:focus-visible {
  outline: none;
  box-shadow: var(--ring);
}
.seg button:focus-visible {
  position: relative;
  z-index: 1;
}

/* 触屏: 可点区域补到 44px */
@media (pointer: coarse) {
  .tp-close {
    width: 44px;
    height: 44px;
    margin: -6px -8px -6px 0;
  }
  .seg button,
  .step-btn {
    height: 44px;
  }
  .tp-jump {
    min-height: 44px;
  }
  .step-btn {
    width: 44px;
  }
  .set-num,
  .set-row select.input {
    height: 44px;
  }
  .theme-btn {
    width: 44px;
    height: 44px;
  }
  .tp-more {
    margin-top: -8px;
  }
  .tp-more summary {
    min-height: 40px;
  }
  .tp-more-body {
    padding-top: 2px;
  }
  .tp-link {
    min-height: 44px;
    padding: 0 8px;
    margin: -10px -6px -10px 0;
  }
}

/* 手机: 底部抽屉 */
@media (max-width: 720px) {
  .settings-pop {
    top: auto;
    left: 0;
    right: 0;
    bottom: 0;
    width: auto;
    max-height: 78%;
    border-radius: var(--radius-xl) var(--radius-xl) 0 0;
    border-bottom: none;
    padding: 18px max(16px, var(--lr-safe-right, 0px)) calc(16px + var(--safe-bottom, 0px)) max(16px, var(--lr-safe-left, 0px));
    box-shadow: var(--shadow-lg);
    gap: 12px;
    animation: tp-sheet-up var(--dur-slow) var(--ease);
  }
  /* 抽屉顶部的拖拽指示条 */
  .settings-pop::before {
    content: '';
    position: absolute;
    top: 7px;
    left: 50%;
    width: 36px;
    height: 4px;
    margin-left: -18px;
    border-radius: 2px;
    background: var(--border-strong);
  }
  .set-row {
    font-size: 14px;
  }
  /* 16px 以下 iOS 聚焦时会放大页面 */
  .set-num {
    font-size: 16px;
  }
  .theme-btns {
    justify-content: space-between;
  }
}
@keyframes tp-sheet-up {
  from {
    transform: translateY(40px);
    opacity: 0;
  }
  to {
    transform: none;
    opacity: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .settings-pop,
  .tp-chev {
    animation: none;
    transition: none;
  }
}
</style>
