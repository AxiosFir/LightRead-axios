<script setup lang="ts">
import { t } from '../../i18n'
import { DENSITY_AMOUNTS, densityAmount } from '../../services/dianjing/density'
defineProps<{ modelValue: number; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: number] }>()
const presets = [
  { value: DENSITY_AMOUNTS.low, key: 'dianjing.densityLow' },
  { value: DENSITY_AMOUNTS.normal, key: 'dianjing.densityNormal' },
  { value: DENSITY_AMOUNTS.high, key: 'dianjing.densityHigh' },
]
const set = (value: number) => emit('update:modelValue', densityAmount(value))
</script>

<template>
  <section class="dj-density" :aria-label="t('dianjing.density')">
    <div class="density-heading"><span>{{ t('dianjing.density') }}</span><output aria-live="polite">{{ modelValue }}<small> / 100</small></output></div>
    <div class="density-stepper">
      <button type="button" :disabled="disabled || modelValue <= 1" :aria-label="t('v2.densityDecrease')" @click="set(modelValue - 1)">−</button>
      <input type="range" min="1" max="100" step="1" :disabled="disabled" :value="modelValue" :aria-label="t('dianjing.density')" :aria-valuetext="t('v2.densityValue', { value: modelValue })" @input="set(Number(($event.target as HTMLInputElement).value))" />
      <button type="button" :disabled="disabled || modelValue >= 100" :aria-label="t('v2.densityIncrease')" @click="set(modelValue + 1)">+</button>
    </div>
    <div class="density-presets" role="group" :aria-label="t('v2.densityPresets')">
      <button v-for="preset in presets" :key="preset.value" type="button" :disabled="disabled" :class="{ active: modelValue === preset.value }" :aria-pressed="modelValue === preset.value" @click="set(preset.value)">{{ t(preset.key) }}</button>
    </div>
    <p>{{ t('v2.densityHint') }}</p>
  </section>
</template>

<style scoped>
/* Hallmark · component: density control · existing LightRead tokens
 * pre-emit critique: P4 H4 E4 S5 R5 V4 */
.dj-density { display: grid; gap: 8px; min-width: 0; }
.density-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; font-size: 13px; color: var(--text-2); }
.density-heading output { font-size: 24px; line-height: 1.3; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--text); }
.density-heading small { font-size: 12px; font-weight: 400; color: var(--text-3); }
.density-stepper { display: grid; grid-template-columns: 44px minmax(0, 1fr) 44px; align-items: center; gap: 12px; }
.density-stepper input { width: 100%; height: 44px; min-width: 0; margin: 0; accent-color: var(--brand); }
.dj-density button { min-height: 44px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--card); color: var(--text-2); cursor: pointer; }
.density-stepper button { padding: 0; font-size: 22px; }
.density-presets { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.density-presets button { font-size: 13px; padding: 8px 4px; white-space: nowrap; }
.density-presets .active { border-color: var(--brand); background: var(--brand-light); color: var(--brand); font-weight: 600; }
.dj-density p { margin: 0; font-size: 12px; line-height: 1.7; color: var(--text-3); }
.dj-density button:disabled, .dj-density input:disabled { opacity: .4; cursor: not-allowed; }
.dj-density :is(button, input):focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
.dj-density button:active:not(:disabled) { background: var(--surface-2); }
@media (hover: hover) { .dj-density button:hover:not(:disabled) { border-color: var(--brand); } }
</style>
