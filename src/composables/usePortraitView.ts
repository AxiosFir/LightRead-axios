import { computed, type ComputedRef } from 'vue'
import { isPortraitView } from '../services/portraitLayout'
import { readingViewport } from '../services/readingViewport'

/** 与默认排版共用窗口尺寸, 防止手势方向与正文排版不同步。 */
export function usePortraitView(): ComputedRef<boolean> {
  return computed(() => isPortraitView(readingViewport.value))
}
