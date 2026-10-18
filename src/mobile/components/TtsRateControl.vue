<script setup lang="ts">
import { t } from '../../i18n'
import { TTS_RATE_MIN, TTS_RATE_MAX, TTS_RATE_STOPS, rateText } from '../../services/ttsRate'
const props = defineProps<{ modelValue: number }>()
const emit = defineEmits<{ 'update:modelValue': [value: number] }>()
function setRate(value: number) {
  if (!Number.isFinite(value)) return
  emit('update:modelValue', Math.round(Math.min(TTS_RATE_MAX, Math.max(TTS_RATE_MIN, value)) * 20) / 20)
}
</script>

<template>
  <section class="rate-control" :aria-label="t('tts.rate')">
    <div class="rate-current"><output aria-live="polite">{{ modelValue.toFixed(2) }}</output><span>×</span></div>
    <div class="rate-stepper">
      <button type="button" :aria-label="t('v2.rateDecrease')" :disabled="modelValue <= TTS_RATE_MIN" @click="setRate(props.modelValue - .05)">−</button>
      <input type="range" :min="TTS_RATE_MIN" :max="TTS_RATE_MAX" step=".05" :value="modelValue" :aria-label="t('tts.rate')" :aria-valuetext="rateText(modelValue)" @input="setRate(Number(($event.target as HTMLInputElement).value))" />
      <button type="button" :aria-label="t('v2.rateIncrease')" :disabled="modelValue >= TTS_RATE_MAX" @click="setRate(props.modelValue + .05)">+</button>
    </div>
    <div class="rate-ends"><span>{{ rateText(TTS_RATE_MIN) }} · {{ t('readingMode.speedSlow') }}</span><span>{{ rateText(TTS_RATE_MAX) }} · {{ t('readingMode.speedFast') }}</span></div>
    <div class="rate-presets">
      <button v-for="rate in TTS_RATE_STOPS" :key="rate" type="button" :class="{ active: Math.abs(rate - modelValue) < .001 }" :aria-pressed="Math.abs(rate - modelValue) < .001" @click="setRate(rate)">{{ rateText(rate) }}<template v-if="rate === 1"> · {{ t('tts.rateNormal') }}</template></button>
    </div>
    <div class="rate-help"><span>{{ t('v2.rateStepHint') }}</span><button type="button" @click="setRate(1)">{{ t('v2.rateReset') }}</button></div>
    <p>{{ t('v2.rateContinueHint') }}</p>
  </section>
</template>

<style scoped>
.rate-control { display: grid; gap: 12px; min-width: 0; }
.rate-current { display: flex; align-items: baseline; justify-content: center; gap: 4px; padding: 8px 0; font-variant-numeric: tabular-nums; }
.rate-current output { font-size: 48px; line-height: 1.2; font-weight: 600; letter-spacing: -1px; color: var(--text); }
.rate-current > span { font-size: 18px; color: var(--text-2); }
.rate-stepper { display: grid; grid-template-columns: 44px minmax(0, 1fr) 44px; align-items: center; gap: 16px; }
.rate-stepper input { width: 100%; min-width: 0; height: 44px; margin: 0; accent-color: var(--brand); }
.rate-stepper button { width: 44px; height: 44px; font-size: 24px; padding: 0; }
.rate-control button { min-height: 44px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--card); color: var(--text-2); cursor: pointer; }
.rate-ends, .rate-help { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--text-3); }
.rate-presets { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 8px; }
.rate-presets button { padding: 8px 2px; font-size: 13px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.rate-presets .active { background: var(--brand-light); color: var(--brand); border-color: var(--brand); font-weight: 600; }
.rate-help button { color: var(--brand); background: none; border: 0; padding: 8px 0; font-size: 13px; }
.rate-control p { margin: 0; font-size: 12px; color: var(--text-3); line-height: 1.7; }
.rate-control button:disabled { opacity: .4; cursor: not-allowed; }
.rate-control :is(button, input):focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
.rate-control button:active:not(:disabled) { background: var(--surface-2); }
@media (hover: hover) { .rate-control button:hover:not(:disabled) { border-color: var(--brand); } }
@media (max-width: 359px) { .rate-stepper { gap: 12px; } .rate-presets button { font-size: 12px; } }
</style>
