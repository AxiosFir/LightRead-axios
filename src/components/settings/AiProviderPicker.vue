<script setup lang="ts">
import { computed } from 'vue'
import { AI_PROVIDERS } from '../../services/ai'
import { t } from '../../i18n'
import AppSelect from '../AppSelect.vue'

defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [id: string]; change: [] }>()
const options = computed(() => AI_PROVIDERS.map(provider => ({ value: provider.id, label: t(`aiProvider.${provider.id}`), description: t(`aiProvider.${provider.id}Desc`) })))
</script>

<template>
  <AppSelect id="ai-provider" :model-value="modelValue" :options="options" :title="t('aiProvider.title')" :description="t('aiProvider.description')" :hint="t('aiProvider.hint')" :aria-label="t('settings.aiProvider')" class="provider-trigger" @update:model-value="emit('update:modelValue', $event)" @change="emit('change')" />
</template>

<style scoped>
.provider-trigger { width: 100%; min-height: 48px; }
</style>
