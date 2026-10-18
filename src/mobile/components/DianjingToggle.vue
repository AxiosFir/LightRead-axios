<script setup lang="ts">
import AppSelect from '../../components/AppSelect.vue'
import DianjingDensityControl from './DianjingDensityControl.vue'
import { readDensity, setDensity } from '../services/dianjingDensity'
import { dianjingAppearance } from '../services/dianjingAppearance'
import { WORD_GUIDE_STOPS, guideIntensity, intensityFromSlider, intensityToSlider } from '../services/dianjingIntensity'
import { djColors, djThemeName } from '../services/dianjing/theme'
/**
 * 点睛阅读, 放在「阅读模式」面板顶部 (docs/reader-panels.md §3.2, docs/manual/05-点睛阅读.md)。
 * 关: 标题 + 副标题 + 总开关。开: 「基础 / 智能」两个版本, 下面只显示所选版本的选项——
 *   基础 (不联网): 标出「词与词 / 重点词」, 重点词的标记多少, 明显程度、颜色;
 *   智能 (AI): 密度、标记、体裁、速读 / 脉络入口与本章状态; AI 用不了时可一步「先用基础版」。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { t } from '../../i18n'
import { useSettings } from '../../stores/settings'
import type { Dianjing } from '../../composables/useDianjing'
import AppModal from '../../components/AppModal.vue'
import { GUIDE_COLORS, GUIDE_COLOR_DEFAULT, guideAccent } from '../../services/readingModes/wordGuideIntensity'
import { READER_THEMES, resolveReaderTheme, resolveReaderColors } from '../../services/readerTheme'
import { resolvedTheme } from '../../services/appearance'
import type { DjLevel } from '../../services/dianjing/level'

const props = defineProps<{ dj: Dianjing }>()
const emit = defineEmits<{ 'open-settings': []; 'open-outline': []; 'open-skim': [] }>()

const detailsOpen = ref(false)
watch(() => props.dj.overlayOpen.value, open => { if (open) detailsOpen.value = false })
const settings = useSettings()
const on = computed(() => props.dj.on.value)
const level = computed(() => props.dj.level.value)
const levels: ReadonlyArray<{ value: DjLevel; key: string }> = [
  { value: 'basic', key: 'dianjing.levelBasic' },
  { value: 'smart', key: 'dianjing.levelSmart' },
]
const wg = computed(() => settings.readingMode.wordGuide)
const guideColor = computed(() => wg.value.color ?? GUIDE_COLOR_DEFAULT)
/** 色块按当前正文主题显示实际颜色 (夜间用亮色) */
const swatchTheme = computed(() => resolveReaderTheme(settings.reader.theme, resolvedTheme.value === 'dark'))
const status = computed(() => props.dj.status.value)
const pct = computed(() => Math.round(props.dj.progress.value * 100))

const density = computed({ get: () => readDensity(settings.dianjing), set: value => setDensity(settings.dianjing, value) })

const kinds = [
  { value: 'key', key: 'dianjing.kindKey' },
  { value: 'term', key: 'dianjing.kindTerm' },
  { value: 'note', key: 'dianjing.kindNote' },
  { value: 'kw', key: 'dianjing.kindKw' },
] as const

/** 基础版标什么: 词与词 / 重点词 */
const marks = [
  { value: 'boundary', key: 'dianjing.markBoundary' },
  { value: 'keywords', key: 'dianjing.markKeywords' },
] as const
const mark = computed(() => (wg.value.mark === 'keywords' ? 'keywords' : 'boundary'))

const statusText = computed(() => {
  const code = props.dj.errorCode.value
  switch (status.value) {
    case 'loading': return t('dianjing.statusLoading', { pct: pct.value })
    case 'ready': return t('dianjing.statusReady', { pct: pct.value })
    case 'quota': return t(code === 'budget' ? 'dianjing.statusBudget' : 'dianjing.statusQuota')
    case 'offline': return t('dianjing.statusOffline')
    case 'unsupported': return t('dianjing.unsupported')
    case 'error':
      if (code === 'config') return t('dianjing.statusConfig')
      if (code === 'auth') return t('dianjing.statusAuth')
      return t('dianjing.statusError')
    default: return ''
  }
})
const needsSettings = computed(() => status.value === 'quota' || (status.value === 'error' && ['config', 'auth'].includes(props.dj.errorCode.value ?? '')))
/** 智能版眼下用不了 (额度、配置、密钥、离线): 给一步换成基础版 */
const offerBasic = computed(() => needsSettings.value || status.value === 'offline')

const genre = computed({
  get: () => settings.dianjing.fiction[props.dj.engine.host.bookId] ?? '',
  set: (v: string) => props.dj.setFiction(v === 'fiction' || v === 'nonfiction' ? v : null),
})
const autoGenreLabel = computed(() =>
  t('dianjing.genreAutoIs', { kind: t(props.dj.fiction.value ? 'dianjing.genreFiction' : 'dianjing.genreNonfiction') }),
)

/** 总开关: 状态以 dj 为准 (智能版可能先弹同意说明而没打开), 复选框显示随之校正 */
function onSwitch(e: Event) {
  const el = e.target as HTMLInputElement
  props.dj.toggle()
  el.checked = on.value
}

async function openSettings() {
  detailsOpen.value = false
  await nextTick()
  emit('open-settings')
}

function openSkim() {
  detailsOpen.value = false
  props.dj.openSkim()
  emit('open-skim')
}
function openOutline() {
  detailsOpen.value = false
  props.dj.openOutline()
  emit('open-outline')
}
const strengthLabel = computed(() => WORD_GUIDE_STOPS.reduce((best, stop) => Math.abs(stop.value - guideIntensity(wg.value)) < Math.abs(best.value - guideIntensity(wg.value)) ? stop : best, WORD_GUIDE_STOPS[0]!))
const previewPaper = computed(() => resolveReaderColors(settings.reader.theme, resolvedTheme.value === 'dark', { eink: settings.readingMode.eink.enabled }))
const previewColors = computed(() => {
  const theme = previewPaper.value
  return dianjingAppearance(theme.fg, theme.bg, swatchTheme.value, guideColor.value, guideIntensity(wg.value), settings.readingMode.eink.enabled)
})
const previewStyle = computed(() => on.value ? {
  color: previewColors.value.strong,
  backgroundColor: mark.value === 'keywords' ? previewColors.value.background : 'transparent',
} : {})
function previewMarkStyle(index: number) {
  if (level.value !== 'smart') return previewStyle.value
  const c = djColors(djThemeName(swatchTheme.value, settings.readingMode.eink.enabled))
  return index === 3 ? { color: c.term, textDecoration: `underline dotted ${c.term} 1px` } : { textDecoration: `underline solid ${c.key} .06em` }
}
const previewParts = computed(() => [
  { text: t('v2.djSample1'), marked: false },
  { text: t('v2.djSample2'), marked: on.value && (mark.value === 'boundary' || density.value >= 35) },
  { text: t('v2.djSample3'), marked: false },
  { text: t('v2.djSample4'), marked: on.value },
  { text: t('v2.djSample6'), marked: false },
  { text: t('v2.djSample7'), marked: on.value && (mark.value === 'boundary' || density.value >= 75) },
  { text: t('v2.djSample8'), marked: false },
])

</script>

<template>
  <section class="dj-toggle" :class="{ on }">
    <label class="dj-head">
      <span class="dj-head-text">
        <span class="dj-title">{{ t('dianjing.title') }}</span>
        <span class="dj-sub">{{ t('dianjing.subtitle') }}</span>
      </span>
      <span class="dj-switch">
        <input
          type="checkbox"
          role="switch"
          :checked="on"
          :aria-checked="on"
          :disabled="status === 'unsupported'"
          @change="onSwitch"
        />
        <span class="dj-switch-track" aria-hidden="true"></span>
      </span>
    </label>

    <p v-if="status === 'unsupported'" class="dj-status">{{ t('dianjing.unsupported') }}</p>

<div class="dj-preview" :style="{ background: previewPaper.bg, color: previewPaper.fg }"><small>{{ t('v2.djPreview') }}</small><p><span v-for="(part, index) in previewParts" :key="index" :class="{ marked: part.marked }" :style="part.marked ? previewMarkStyle(index) : undefined">{{ part.text }}</span></p></div><button class="dj-adjust" type="button" :disabled="status === 'unsupported'" @click="detailsOpen = true"><span>{{ t('v2.djAdjust') }}<small>{{ t(level === 'basic' ? 'dianjing.levelBasic' : 'dianjing.levelSmart') }} · {{ t('v2.djAdjustSummary') }}</small></span><span aria-hidden="true">›</span></button>
    <AppModal v-if="detailsOpen" :title="t('dianjing.title')" @close="detailsOpen = false"><div class="dj-settings">    <label class="dj-head">
      <span class="dj-head-text">
        <span class="dj-title">{{ t('dianjing.title') }}</span>
        <span class="dj-sub">{{ t('dianjing.subtitle') }}</span>
      </span>
      <span class="dj-switch">
        <input
          type="checkbox"
          role="switch"
          :checked="on"
          :aria-checked="on"
          :disabled="status === 'unsupported'"
          @change="onSwitch"
        />
        <span class="dj-switch-track" aria-hidden="true"></span>
      </span>
    </label>

<div class="dj-preview" :style="{ background: previewPaper.bg, color: previewPaper.fg }"><small>{{ t('v2.djPreview') }}</small><p><span v-for="(part, index) in previewParts" :key="index" :class="{ marked: part.marked }" :style="part.marked ? previewMarkStyle(index) : undefined">{{ part.text }}</span></p></div><div v-if="status !== 'unsupported'" class="dj-body">
      <div class="segmented dj-levels" role="group" :aria-label="t('dianjing.level')">
        <button
          v-for="l in levels"
          :key="l.value"
          type="button"
          :class="{ active: level === l.value }"
          :aria-pressed="level === l.value"
          @click="dj.setLevel(l.value)"
        >{{ t(l.key) }}</button>
      </div>

      <!-- 基础版: 不联网; 标出词与词 / 重点词 -->
      <template v-if="level === 'basic'">
        <div class="segmented dj-marks" role="group" :aria-label="t('dianjing.basicMark')">
          <button
            v-for="m in marks"
            :key="m.value"
            type="button"
            :class="{ active: mark === m.value }"
            :aria-pressed="mark === m.value"
            @click="settings.readingMode.wordGuide.mark = m.value"
          >{{ t(m.key) }}</button>
        </div>
        <div class="dj-desc">
          <p>{{ t(mark === 'keywords' ? 'dianjing.keywordsDesc' : 'dianjing.basicDesc') }}</p>
          <p class="dj-desc-note">
            <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm4.3 6.3a1 1 0 0 0-1.4 0L11 12.17 9.1 10.3a1 1 0 1 0-1.4 1.4l2.6 2.6a1 1 0 0 0 1.4 0l4.6-4.6a1 1 0 0 0 0-1.4z"/></svg>
            {{ t('dianjing.basicNote') }}
          </p>
        </div>
        <p v-if="!dj.basicSupported.value" class="dj-note" role="note">{{ t('dianjing.basicUnsupported') }}</p>
        <p v-else-if="mark === 'keywords' && !dj.keyWordsSupported.value" class="dj-note" role="note">{{ t('dianjing.keywordsUnsupported') }}</p>
        <DianjingDensityControl v-if="mark === 'keywords' && dj.keyWordsSupported.value" v-model="density" />
        <div class="dj-field">
          <span class="dj-label">{{ t('readingMode.guideStrength') }}</span>
          <strong class="dj-strength-value">{{ t(strengthLabel.key) }}</strong><input class="dj-strength" type="range" min="0" max="100" step="1" :value="intensityToSlider(guideIntensity(wg))" :aria-label="t('readingMode.guideStrength')" :aria-valuetext="t(strengthLabel.key)" @input="settings.readingMode.wordGuide.intensity = intensityFromSlider(Number(($event.target as HTMLInputElement).value))" /><div class="dj-strength-labels"><span>{{ t('readingMode.intensitySoft') }}</span><span>{{ t('readingMode.intensityNormal') }}</span><span>{{ t('readingMode.intensityVivid') }}</span></div>
        </div>
        <div class="dj-field">
          <span class="dj-label">{{ t('readingMode.guideColor') }}</span>
          <div class="dj-swatches" role="radiogroup" :aria-label="t('readingMode.guideColor')">
            <button
              v-for="c in GUIDE_COLORS"
              :key="c.id"
              type="button"
              role="radio"
              class="dj-swatch"
              :class="{ active: guideColor === c.id }"
              :aria-checked="guideColor === c.id"
              :title="t(c.key)"
              :aria-label="t(c.key)"
              :style="{ '--sw': guideAccent(c.id, swatchTheme), '--swbg': READER_THEMES[swatchTheme].bg }"
              @click="settings.readingMode.wordGuide.color = c.id"
            >
              <span class="dj-swatch-dot" aria-hidden="true">文</span>
              <span class="dj-swatch-name">{{ t(c.key) }}</span>
            </button>
          </div>
        </div>
      </template>

      <!-- 智能版: AI 先读一遍 -->
      <template v-else>
        <div class="dj-desc">
          <p>{{ t('dianjing.smartDesc') }}</p>
        </div>
        <DianjingDensityControl v-model="density" />

        <div class="dj-row">
          <span class="dj-label">{{ t('dianjing.kinds') }}</span>
          <div class="dj-kinds">
            <label v-for="k in kinds" :key="k.value" class="dj-kind" :class="'dj-kind-' + k.value">
              <input
                type="checkbox"
                :checked="settings.dianjing.kinds[k.value] !== false"
                @change="settings.dianjing.kinds = { ...settings.dianjing.kinds, [k.value]: ($event.target as HTMLInputElement).checked }"
              />
              <span class="dj-kind-sample" aria-hidden="true" :style="k.value === 'kw' ? { '--sw': guideAccent(guideColor, swatchTheme) } : undefined"></span>
              <span>{{ t(k.key) }}</span>
            </label>
          </div>
        </div>

        <div class="dj-row">
          <span class="dj-label">{{ t('dianjing.genre') }}</span>
          <AppSelect v-model="genre" class="input dj-select" :aria-label="t('dianjing.genre')">
            <option value="">{{ autoGenreLabel }}</option>
            <option value="fiction">{{ t('dianjing.genreFiction') }}</option>
            <option value="nonfiction">{{ t('dianjing.genreNonfiction') }}</option>
          </AppSelect>
        </div>
        <p v-if="dj.fiction.value" class="dj-hint">{{ t('dianjing.fictionHint') }}</p>

        <div class="dj-actions">
          <button type="button" class="btn btn-sm" @click="openSkim">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 6h16M4 12h10M4 18h7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
            {{ t('dianjing.skim') }}
          </button>
          <button type="button" class="btn btn-sm" @click="openOutline">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 5h4v4H5zM11 7h8M8 9v6h3M11 15h8M8 15v4h3M11 19h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
            {{ t('dianjing.outline') }}
          </button>
        </div>

        <p v-if="statusText" class="dj-status" :class="'is-' + status" role="status">
          <span class="dj-dot" aria-hidden="true"></span>
          <span>{{ statusText }}</span>
        </p>
        <!-- 智能版眼下用不了: 去修好它, 或一步换成基础版接着读 -->
        <div v-if="offerBasic" class="dj-actions dj-fix">
          <button type="button" class="btn btn-sm" @click="dj.switchToBasic()">{{ t('dianjing.useBasic') }}</button>
          <button v-if="needsSettings" type="button" class="btn btn-sm" @click="openSettings">{{ t('dianjing.openSettings') }}</button>
        </div>
        <p v-if="dj.remaining.value != null && status !== 'quota'" class="dj-hint">{{ t('dianjing.remaining', { n: dj.remaining.value }) }}</p>

        <div class="dj-actions dj-minor">
          <button type="button" class="btn btn-ghost btn-sm" @click="dj.redoSection()">{{ t('dianjing.redo') }}</button>
          <button type="button" class="btn btn-ghost btn-sm" @click="dj.clearBookCache()">{{ t('dianjing.clearCache') }}</button>
        </div>
      </template>
    </div>
    </div></AppModal>
  </section>
</template>

<style scoped>
.dj-toggle {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding-bottom: var(--space-3);
  border-bottom: 1px solid var(--border);
}
.dj-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  cursor: pointer;
}
.dj-head-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.dj-title {
  font-weight: 600;
  color: var(--text);
}
.dj-sub {
  font-size: 12px;
  color: var(--text-3);
}
.dj-switch {
  position: relative;
  width: 38px;
  height: 22px;
  flex-shrink: 0;
}
.dj-switch input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: pointer;
  z-index: 1;
}
.dj-switch-track {
  position: absolute;
  inset: 0;
  border-radius: var(--radius-pill);
  background: var(--border-strong);
  transition: background var(--dur) var(--ease);
}
.dj-switch-track::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--on-brand);
  box-shadow: var(--shadow-sm);
  transition: transform var(--dur) var(--ease);
}
.dj-switch input:checked + .dj-switch-track {
  background: var(--brand);
}
.dj-switch input:checked + .dj-switch-track::after {
  transform: translateX(16px);
}
.dj-switch input:focus-visible + .dj-switch-track {
  box-shadow: var(--ring);
}
.dj-switch input:disabled {
  cursor: not-allowed;
}
.dj-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.dj-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
}
.dj-label {
  font-size: 13px;
  color: var(--text-2);
}
.dj-kinds {
  display: flex;
  gap: var(--space-3);
  flex-wrap: wrap;
}
.dj-kind {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text);
  cursor: pointer;
  min-height: 32px;
}
/* 图例: 线型区分类型 (不只靠颜色) */
.dj-kind-sample {
  display: inline-block;
  width: 16px;
  height: 0;
  border-bottom: 2px solid var(--text-2);
}
.dj-kind-term .dj-kind-sample {
  border-bottom: 1px dotted var(--text-2);
}
.dj-kind-kw .dj-kind-sample {
  width: 14px;
  height: 10px;
  border: none;
  border-radius: 3px;
  background: var(--sw, var(--text-2));
  opacity: 0.55;
}
.dj-kind-note .dj-kind-sample {
  width: 6px;
  height: 6px;
  border: none;
  border-radius: 50%;
  background: var(--text-2);
}
.dj-select {
  width: auto;
  min-width: 140px;
  height: 32px;
  padding-block: 0;
}
.dj-actions {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.dj-fix {
  margin-top: calc(-1 * var(--space-1));
}
.dj-minor {
  margin-top: calc(-1 * var(--space-1));
}
.dj-status {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 12px;
  color: var(--text-2);
  margin: 0;
  flex-wrap: wrap;
}
.dj-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-3);
  flex-shrink: 0;
}
.dj-status.is-ready .dj-dot {
  background: var(--success);
}
.dj-status.is-quota .dj-dot,
.dj-status.is-error .dj-dot {
  background: var(--warning);
}
.dj-hint {
  font-size: 12px;
  color: var(--text-3);
  margin: 0;
}
.dj-levels,
.dj-marks {
  align-self: flex-start;
}
.dj-levels button,
.dj-marks button {
  min-width: 72px;
  justify-content: center;
}
.dj-desc {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: calc(-1 * var(--space-1));
}
.dj-desc p {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-2);
}
.dj-desc .dj-desc-note {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-2);
}
.dj-note {
  margin: 0;
  padding: 8px 10px;
  border-radius: var(--radius);
  background: var(--surface-2);
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-2);
}
/* 基础版的选项: 左侧固定宽度的标签 + 右侧控件 (与面板里其他滑动条对齐) */
.dj-field {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.dj-field .dj-label {
  flex-shrink: 0;
  width: 64px;
}
.dj-field > :last-child {
  flex: 1;
  min-width: 0;
}
/* 配色: 色块里的「文」字用当前正文主题下的实际颜色 */
.dj-swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.dj-swatch {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 0;
  border: none;
  background: none;
  color: var(--text-3);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.dj-swatch-dot {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--swbg, var(--card));
  color: var(--sw);
  font-size: 16px;
  font-weight: 600;
  transition: box-shadow var(--dur) var(--ease);
}
.dj-swatch.active {
  color: var(--text);
  font-weight: 600;
}
.dj-swatch.active .dj-swatch-dot {
  border-color: var(--sw);
  box-shadow: 0 0 0 2px var(--sw);
}
.dj-swatch:focus-visible {
  outline: none;
}
.dj-swatch:focus-visible .dj-swatch-dot {
  box-shadow: var(--ring);
}
@media (hover: none) {
  .dj-swatch-dot {
    width: 40px;
    height: 40px;
  }
}

.dj-toggle { padding: 16px; border: 1px solid var(--border); border-radius: 16px; background: var(--card); gap: 14px; }
.dj-preview { border-radius: 8px; padding: 16px; font-size: 16px; line-height: 2; }.dj-preview small { display: block; opacity: .7; font-size: 11px; margin-bottom: 8px; }.dj-preview p { margin: 3px 0 0; }.dj-preview span { font-weight: inherit; }
.dj-adjust { display: flex; justify-content: space-between; align-items: center; width: 100%; min-height: 48px; border: 0; border-top: 1px solid var(--border); padding: 12px 0 0; background: none; color: var(--text); text-align: start; font: inherit; font-size: 14px; }.dj-adjust small { display: block; margin-top: 3px; color: var(--text-3); font-size: 12px; }.dj-adjust > span:last-child { font-size: 24px; }
.dj-settings { padding: 20px; display: grid; gap: 20px; }.dj-settings .dj-body { gap: 24px; }.dj-row,.dj-field { flex-direction: column; align-items: stretch; gap: 10px; }.dj-label { width: auto; flex: none; }.dj-row .segmented,.dj-field .segmented { width: 100%; }.dj-settings .dj-levels,.dj-settings .dj-marks { width: 100%; }.dj-settings .segmented button { min-height: 44px; flex: 1; }.dj-field { position: relative; }.dj-strength-value { position: absolute; right: 0; top: 0; font-size: 12px; color: var(--text-2); }.dj-strength { width: 100%; height: 44px; margin: 0; accent-color: var(--brand); }.dj-strength-labels { display: flex; justify-content: space-between; color: var(--text-3); font-size: 11px; }
.dj-swatches { display: grid; grid-template-columns: repeat(5,minmax(0,1fr)); width: 100%; gap: 6px; }.dj-swatch { width: auto; min-width: 0; min-height: 64px; padding: 6px 2px; }.dj-swatch-dot { width: 30px; height: 30px; }.dj-swatch-name { font-size: 11px; }.dj-kind { min-height: 44px; }.dj-select { width: 100%; }.dj-adjust:focus-visible { outline: 2px solid var(--brand); outline-offset: 3px; }

</style>
