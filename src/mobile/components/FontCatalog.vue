<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import AppModal from './AppModal.vue'
import { t } from '../../i18n'
import { useSettings } from '../../stores/settings'
import { fontAvailable, injectFontIntoDoc } from '../services/fonts'
import { FONT_RESOURCES, downloadFontResource, installedResource, type FontResource } from '../services/fontResources'
import { openExternalLink } from '../../services/transfer'

const emit = defineEmits<{ close: [] }>()
const settings = useSettings()
const busy = ref(''), fraction = ref(0), error = ref(''), available = ref(new Set<string>())
let controller: AbortController | undefined
let disposed = false
const name = (font: FontResource) => settings.language === 'en' ? font.nameEn : font.name
const selected = (font: FontResource) => available.value.has(font.id) && settings.readerPrefs.fontFamily === `custom:${font.name}`
const preparing = (font: FontResource) => available.value.has(font.id) || fraction.value >= 0.9
onMounted(async () => {
  for (const font of FONT_RESOURCES) {
    const installed = installedResource(font, settings.customFonts)
    if (installed && await fontAvailable(installed).catch(() => false)) {
      if (disposed) return
      available.value.add(font.id)
      if (selected(font)) void injectFontIntoDoc(document, installed, () => !disposed && selected(font))
    }
  }
})
onBeforeUnmount(() => { disposed = true; controller?.abort() })
async function useFont(font: FontResource) {
  if (busy.value) return
  error.value = ''; busy.value = font.id; fraction.value = 0
  controller = new AbortController()
  const signal = controller.signal
  try {
    let installed = installedResource(font, settings.customFonts)
    if (!installed || !(await fontAvailable(installed))) {
      installed = await downloadFontResource(font, signal, value => { fraction.value = value })
      if (!settings.customFonts.some(item => item.file === installed!.file)) settings.customFonts.push(installed)
    }
    if (disposed || signal.aborted) return
    available.value.add(font.id)
    await injectFontIntoDoc(document, installed, () => !disposed && !signal.aborted)
    if (disposed || signal.aborted) return
    settings.setReaderPreference('fontFamily', `custom:${font.name}`)
  } catch (cause) {
    if (!disposed && !signal.aborted) error.value = t('fontCatalog.failed', { msg: cause instanceof Error ? cause.message : String(cause) })
  } finally { busy.value = ''; controller = undefined }
}
function cancel() { controller?.abort() }
async function open(url: string) {
  try { await openExternalLink(url) }
  catch { error.value = t('fontCatalog.openFailed') }
}
</script>

<template>
  <AppModal :title="t('fontCatalog.title')" :description="t('fontCatalog.hint')" @close="emit('close')">
    <div class="font-catalog">
      <p v-if="error" class="font-error" role="alert">{{ error }}</p>
      <article v-for="font in FONT_RESOURCES" :key="font.id" class="font-resource" :data-font-id="font.id">
        <div class="font-resource-heading"><h3>{{ name(font) }}</h3><span>{{ t(`fontCatalog.style.${font.style}`) }}</span></div>
        <p v-if="available.has(font.id) && selected(font)" class="font-resource-sample" :style="{ fontFamily: JSON.stringify(font.name) }">{{ t('fontCatalog.sample') }}</p>
        <p v-else class="font-note">{{ t(`fontCatalog.desc.${font.id}`) }}</p>
        <p v-if="font.id === 'iansui'" class="font-note">{{ t('fontCatalog.traditional') }}</p>
        <p v-else-if="font.id === 'zhuque'" class="font-note">{{ t('fontCatalog.previewVersion') }}</p>
        <p v-else-if="font.style === 'display'" class="font-note">{{ t('fontCatalog.displayHint') }}</p>
        <div class="font-resource-actions">
          <button class="font-license" @click="open(font.licenseUrl)">OFL 1.1<span class="sr-only"> · {{ name(font) }}</span></button>
          <span class="font-resource-size" aria-live="polite">{{ busy === font.id && preparing(font) ? t('fontCatalog.preparing') : available.has(font.id) ? t('fontCatalog.downloaded') : `${(font.bytes / 1048576).toFixed(1)} MB` }}</span>
          <button v-if="busy === font.id" class="btn" @click="cancel">{{ t('common.cancel') }}<template v-if="!preparing(font)"> {{ Math.round(fraction * 100) }}%</template></button>
          <button v-else class="btn" :class="{ 'btn-primary': !selected(font) }" :disabled="!!busy || selected(font)" @click="useFont(font)">{{ selected(font) ? t('fontCatalog.current') : available.has(font.id) ? t('fontCatalog.use') : t('fontCatalog.download') }}</button>
        </div>
        <progress v-if="busy === font.id" :value="preparing(font) ? undefined : fraction" max="1" :aria-label="preparing(font) ? t('fontCatalog.preparing') : t('fontCatalog.downloading', { name: name(font) })" />
      </article>
      <div class="font-official"><div><strong>MiSans</strong><p>{{ t('fontCatalog.misansHint') }}</p></div><button class="btn" @click="open('https://hyperos.mi.com/font/download/')">{{ t('fontCatalog.official') }}</button></div>
      <div class="font-official"><div><strong>{{ t('fontCatalog.huiwen') }}</strong><p>{{ t('fontCatalog.huiwenHint') }}</p></div><button class="btn" @click="open('https://huozi.cool/')">{{ t('fontCatalog.official') }}</button></div>
      <p class="font-note">{{ t('fontCatalog.licenseHint') }}</p>
    </div>
  </AppModal>
</template>

<style scoped>
.font-catalog { padding: 0 20px 20px; }
.font-resource { padding: 20px 0; border-bottom: 1px solid var(--border); }
.font-resource-heading { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px 12px; }
.font-resource-heading h3 { font-size: 16px; font-weight: 600; margin: 0; }
.font-resource-heading > span,.font-resource-size,.font-note { font-size: 12px; color: var(--text-3); }
.font-resource-sample { margin: 12px 0; font-size: 20px; line-height: 1.6; color: var(--text); overflow-wrap: anywhere; }
.font-resource-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.font-resource-actions > .btn { margin-left: auto; }
.font-license { padding: 0; border: 0; background: transparent; color: var(--brand); text-decoration: underline; cursor: pointer; min-height: 44px; }
.font-resource .btn,.font-official .btn { min-height: 44px; }
.font-resource progress { display: block; width: 100%; margin-top: 10px; height: 6px; accent-color: var(--brand); }
.font-error { padding: 12px; color: var(--danger); background: var(--surface-2); overflow-wrap: anywhere; border-radius: var(--radius); }
.font-note { line-height: 1.6; margin: 6px 0; }
.font-official { display: flex; align-items: center; gap: 12px; padding: 20px 0; }
.font-official > div { flex: 1; min-width: 0; }.font-official p { font-size: 12px; line-height: 1.6; color: var(--text-3); margin: 6px 0 0; }.font-official .btn { flex-shrink: 0; }
</style>
