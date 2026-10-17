import { shallowRef } from 'vue'

interface Confirmation { message: string; resolve: (accepted: boolean) => void }
export const confirmation = shallowRef<Confirmation | null>(null)
/** App-owned confirmation; dismissing or leaving the page always cancels. */
export function askConfirm(message: string): Promise<boolean> {
  if (confirmation.value) return Promise.resolve(false)
  return new Promise(resolve => { confirmation.value = { message, resolve } })
}
export function settleConfirmation(accepted: boolean) {
  const current = confirmation.value
  confirmation.value = null
  current?.resolve(accepted)
}
