<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { useRoute } from 'vue-router'
import AppModal from '../../components/AppModal.vue'
import { toasts, isLongMessage, type Toast } from '../services/toast.ts'
import { t } from '../../i18n'
const route = useRoute()
const detail = ref<{ message: string; type: Toast['type'] } | null>(null)
const keyboardInset = ref(0)
const viewportTop = ref(0)
const modalOpen = ref(false)
const inlineTarget = shallowRef<HTMLElement | null>(null)
let observer: MutationObserver | undefined
const update = () => {
  const view = window.visualViewport
  viewportTop.value = Math.max(0, view?.offsetTop ?? 0)
  keyboardInset.value = view ? Math.max(0, window.innerHeight - view.height - view.offsetTop) : 0
  const dialogs = [...document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]')]
    .filter(el => el.getClientRects().length && !el.closest('[inert]'))
  const active = dialogs.at(-1)
  modalOpen.value = !!active
  // A full-screen player has no free space above its header. Reserve a row
  // inside it so messages never cover Stop or Collapse. Nested sheets still
  // use the normal floating message placement.
  inlineTarget.value = active?.matches('.tts-panel')
    ? active.querySelector<HTMLElement>('[data-message-slot]') : null
}
onMounted(() => {
  update()
  window.visualViewport?.addEventListener('resize', update)
  window.visualViewport?.addEventListener('scroll', update)
  window.addEventListener('resize', update)
  observer = new MutationObserver(update)
  observer.observe(document.body, { childList: true, subtree: true })
})
onBeforeUnmount(() => {
  observer?.disconnect()
  window.visualViewport?.removeEventListener('resize', update)
  window.visualViewport?.removeEventListener('scroll', update)
  window.removeEventListener('resize', update)
})
const reading = computed(() => /^\/(read|paper|djvu)\//.test(route.path))
function openDetail(item: Toast) { detail.value = { message: item.message, type: item.type }; item.dismiss() }
function act(item: Toast) { item.dismiss(); item.action?.run() }
function hoverPause(item: Toast, event: PointerEvent) { if (event.pointerType === 'mouse') item.pause() }
const title = (type: Toast['type']) => t(type === 'error' ? 'v2.messageError' : type === 'success' ? 'v2.messageSuccess' : 'v2.messageInfo')
</script>
<template>
  <Teleport :to="inlineTarget || 'body'">
    <div v-if="toasts.length" class="toast-wrap mobile-messages" :class="{ reading, 'above-modal': modalOpen, 'inline-message': inlineTarget }" :style="{ '--message-keyboard': `${keyboardInset}px`, '--message-viewport-top': `${viewportTop}px` }">
      <div v-for="item in toasts" :key="item.id" class="toast" :class="item.type" :role="item.type === 'error' ? 'alert' : 'status'" aria-atomic="true" @pointerenter="hoverPause(item, $event)" @pointerleave="item.resume" @focusin="item.pause" @focusout="item.resume">
        <svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path v-if="item.type === 'success'" d="m7 12 3 3 7-7"/><path v-else d="M12 7v6m0 3v1"/></svg>
        <div class="message-copy"><p :class="{ abbreviated: isLongMessage(item.message) }">{{ item.message }}</p><button v-if="isLongMessage(item.message)" class="message-detail" @click="openDetail(item)">{{ t('v2.messageDetails') }}</button></div>
        <button v-if="item.action" class="toast-action" @click="act(item)">{{ item.action.label }}</button>
        <button class="message-close" :aria-label="t('v2.dismissMessage')" @click="item.dismiss"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
      </div>
    </div>
  </Teleport>
  <AppModal v-if="detail" :title="title(detail.type)" @close="detail = null"><p class="message-full">{{ detail.message }}</p><template #footer><button class="btn btn-primary message-done" @click="detail = null">{{ t('common.close') }}</button></template></AppModal>
</template>
<style scoped>
/* Hallmark · prototype message treatment · P5 H5 E4 S5 R5 V4 */
.mobile-messages { top: auto; bottom: calc(84px + var(--lr-safe-bottom) + var(--message-keyboard)); width: min(520px, calc(100% - 32px)); max-width: calc(100% - 32px); z-index: 1500; }
.mobile-messages.reading { bottom: calc(96px + var(--lr-safe-bottom) + var(--message-keyboard)); }
.mobile-messages.above-modal { top: calc(12px + var(--lr-safe-top) + var(--message-viewport-top)); bottom: auto; }
.mobile-messages.inline-message { position: static; inset: auto; transform: none; width: 100%; max-width: none; flex: none; margin: 0; }
.toast { display: flex; width: 100%; gap: var(--space-2); padding: var(--space-2) var(--space-2) var(--space-2) var(--space-3); border: 0; border-radius: var(--radius-lg); background: var(--text); color: var(--bg); box-shadow: var(--shadow-md); line-height: 1.6; font-size: 14px; }
.toast-icon { flex: none; width: 20px; height: 20px; color: inherit !important; align-self: flex-start; margin-top: 12px; }
.message-copy { flex: 1; min-width: 0; padding: var(--space-2) 0; }
.message-copy p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.message-copy .abbreviated { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.message-close, .toast-action, .message-detail { flex: none; display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 var(--space-2); margin: 0; border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; white-space: nowrap; }
.message-close { width: 44px; padding: 0; align-self: flex-start; }
.toast-action, .message-detail { text-decoration: underline; text-underline-offset: 3px; }
.message-detail { padding: 0; }
:is(.message-close,.toast-action,.message-detail):focus-visible { outline: 2px solid currentColor; outline-offset: -3px; border-radius: var(--radius); }
:is(.message-close,.toast-action,.message-detail):active { opacity: .65; }
.message-full { margin: 0; padding: var(--space-5); font-size: 15px; line-height: 1.8; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }
.message-done { width: 100%; min-height: 48px; }
@media (min-width: 721px) { .mobile-messages { bottom: calc(24px + var(--lr-safe-bottom) + var(--message-keyboard)); } }
</style>
