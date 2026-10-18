<script setup lang="ts">
import { computed } from 'vue'
import { t } from '../../i18n'
import { findScene, useAmbient } from '../../services/ambient'

defineEmits<{ open: [] }>()
const ambient = useAmbient()
const state = ambient.state
const scene = computed(() => findScene(state.sceneId))
const active = computed(() => state.playing || state.loading)
</script>

<template>
  <button class="ambient-entry" :class="{ active }" type="button" @click="$emit('open')">
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9h4l5-4v14l-5-4H3zM16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14" /></svg>
    <span class="entry-copy"><strong>{{ t('ambient.title') }}</strong><small>{{ active && scene ? `${t(scene.nameKey)} · ${Math.round(state.volume * 100)}%` : t('v2.ambientIndependent') }}</small></span>
    <span class="entry-state">{{ t(state.loading ? 'ambient.preparing' : state.playing ? 'ambient.playing' : 'v2.notEnabled') }}</span>
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
  </button>
</template>

<style scoped>
.ambient-entry { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 68px; padding: 12px 16px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--card); color: var(--text-2); text-align: left; cursor: pointer; }
.ambient-entry > svg { flex-shrink: 0; }
.entry-copy { display: grid; gap: 3px; flex: 1; min-width: 0; }
.entry-copy strong { color: var(--text); font-size: 14px; font-weight: 500; }
.entry-copy small { color: var(--text-3); font-size: 12px; line-height: 1.5; }
.entry-state { font-size: 12px; white-space: nowrap; flex-shrink: 0; }
.active > svg:first-child, .active .entry-state { color: var(--brand); }
.ambient-entry:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
.ambient-entry:active { background: var(--surface-2); }
@media (hover: hover) { .ambient-entry:hover { border-color: var(--border-strong); } }
</style>
