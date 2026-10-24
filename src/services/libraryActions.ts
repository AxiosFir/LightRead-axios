import { ref } from 'vue'

export type LibraryAction = 'create-booklist' | 'manage-booklists'

/** 左侧栏请求打开藏书页已有弹窗; LibraryView 挂载或已显示时消费一次. */
export const pendingLibraryAction = ref<LibraryAction | null>(null)

export function requestLibraryAction(action: LibraryAction) {
  pendingLibraryAction.value = action
}
