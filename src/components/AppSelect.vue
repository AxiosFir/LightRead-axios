<script setup lang="ts" generic="T extends string | number | (string | number)[]">
import { computed, ref, useAttrs, useSlots, type VNode } from 'vue'
import AppModal from './AppModal.vue'
import { t } from '../i18n'

defineOptions({ inheritAttrs: false })
interface Option { value: string | number; label: string; description?: string; disabled?: boolean; group?: string }
const props = defineProps<{ modelValue: T; options?: Option[]; multiple?: boolean; disabled?: boolean; title?: string; description?: string; hint?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: T]; change: [] }>()
const slots = useSlots(), attrs = useAttrs()
const opened = ref(false)
const query = ref('')
// Accept declarative options as well as data, keeping translated labels and optgroups reactive.
function textOf(children: unknown): string {
  if (typeof children === 'string' || typeof children === 'number') return String(children)
  return Array.isArray(children) ? children.map(child => textOf(child?.children ?? child)).join('') : ''
}
function collect(nodes: VNode[], group?: string): Option[] {
  return nodes.flatMap(node => {
    if (node.type === 'option') return [{ value: node.props?.value ?? textOf(node.children), label: textOf(node.children).trim(), disabled: node.props?.disabled != null && node.props.disabled !== false, group }]
    return Array.isArray(node.children) ? collect(node.children as VNode[], node.type === 'optgroup' ? String(node.props?.label ?? '') : group) : []
  })
}
const options = computed(() => props.options ?? collect(slots.default?.() ?? []))
const filtered = computed(() => options.value.filter(option => !query.value.trim() || `${option.label} ${option.description ?? ''} ${option.group ?? ''}`.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())))
const isSelected = (value: string | number) => Array.isArray(props.modelValue) ? props.modelValue.includes(value) : props.modelValue === value
const label = computed(() => options.value.filter(option => isSelected(option.value)).map(option => option.label).join(', ') || options.value[0]?.label || t('common.choose'))
const heading = computed(() => props.title || String(attrs['aria-label'] || t('common.choose')))
function choose(option: Option) {
  if (option.disabled) return
  const value = props.multiple ? (isSelected(option.value) ? (props.modelValue as (string | number)[]).filter(item => item !== option.value) : [...(Array.isArray(props.modelValue) ? props.modelValue : []), option.value]) : option.value
  if (props.multiple || value !== props.modelValue) { emit('update:modelValue', value as T); emit('change') }
  if (!props.multiple) opened.value = false
}
function moveFocus(event: KeyboardEvent) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  const buttons = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('.app-select-option:not(:disabled)')]
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  event.preventDefault()
  buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
}
</script>

<template>
  <button v-bind="attrs" type="button" class="input app-select-trigger" :disabled="disabled" aria-haspopup="dialog" :aria-expanded="opened" @click="query = ''; opened = true">
    <span>{{ label }}</span>
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
    <!-- Keep one root so parent scoped sizing and flex-order reach the trigger.
         AppModal teleports its dialog to body, outside this button. -->
    <AppModal v-if="opened" :title="heading" :description="description" initial-focus=".app-select-option[aria-pressed='true'], .app-select-option:not(:disabled)" @close="opened = false">
      <div v-if="options.length > 12" class="app-select-search"><input v-model="query" type="search" class="input" :placeholder="t('common.search')" :aria-label="t('common.search')" /></div>
      <div class="app-select-list" role="group" :aria-label="heading" @keydown="moveFocus">
        <template v-for="(option, index) in filtered" :key="option.value">
          <p v-if="option.group && (index === 0 || filtered[index - 1].group !== option.group)" class="app-select-group">{{ option.group }}</p>
          <button type="button" class="app-select-option" :data-value="option.value" :disabled="option.disabled" :aria-pressed="isSelected(option.value)" @click="choose(option)">
            <span class="app-select-copy"><span class="app-select-name">{{ option.label }}</span><span v-if="option.description" class="app-select-description">{{ option.description }}</span></span>
            <span class="app-select-check" :class="{ multiple }" aria-hidden="true"><svg v-if="isSelected(option.value)" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m5 12 4 4L19 6" /></svg></span>
          </button>
        </template>
        <p v-if="!filtered.length" class="app-select-group">{{ t('reader.noResults') }}</p>
      </div>
      <template v-if="hint || multiple" #footer><button v-if="multiple" type="button" class="btn btn-primary app-select-done" @click="opened = false">{{ t('common.done') }}</button><span v-else>{{ hint }}</span></template>
    </AppModal>
  </button>
</template>

<style scoped>
.app-select-trigger { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; min-height: 44px; text-align: left; cursor: pointer; }
.app-select-trigger span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.app-select-trigger svg { flex-shrink: 0; color: var(--text-3); }
.app-select-search { position: sticky; top: 0; z-index: 1; padding: 12px; background: var(--card); }
.app-select-search input { width: 100%; min-height: 44px; font-size: 16px; }
.app-select-list { padding: 8px; }
.app-select-group { padding: 12px; color: var(--text-3); font-size: 12px; }
.app-select-option { display: flex; align-items: center; gap: 16px; width: 100%; min-height: 48px; padding: 12px; border: 1px solid transparent; border-radius: var(--radius-lg); background: transparent; color: var(--text); text-align: left; cursor: pointer; }
.app-select-option + .app-select-option { margin-top: 2px; }
.app-select-option[aria-pressed='true'] { background: var(--brand-light); border-color: var(--brand); }
.app-select-copy { flex: 1; min-width: 0; }
.app-select-name { display: block; font-size: 15px; font-weight: 500; line-height: 1.5; overflow-wrap: anywhere; }
.app-select-description { display: block; margin-top: 3px; font-size: 12px; line-height: 1.5; color: var(--text-3); }
.app-select-check { display: grid; place-items: center; width: 22px; height: 22px; flex-shrink: 0; border: 1.5px solid var(--border-strong); border-radius: 50%; }
.app-select-check.multiple { border-radius: 5px; }
[aria-pressed='true'] .app-select-check { background: var(--brand); border-color: var(--brand); color: var(--on-brand); }
.app-select-option:focus-visible { outline: 2px solid var(--brand); outline-offset: -3px; }
.app-select-done { min-height: 44px; width: 100%; }
@media (hover: hover) { .app-select-option:not([aria-pressed='true']):hover { background: var(--surface-2); } }
</style>
