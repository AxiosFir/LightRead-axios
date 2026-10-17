import { shallowRef } from 'vue'
import type { PortraitProbe } from './portraitLayout'

export function readReadingViewport(): PortraitProbe & { pixelRatio: number } {
  if (typeof window === 'undefined') return { width: 1180, height: 780, pixelRatio: 1, keyboardOpen: false }
  const active = document.activeElement
  const editing = !!active && (active.matches('input:not([type=range]):not([type=checkbox]), textarea') || (active as HTMLElement).isContentEditable)
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    screenWidth: window.screen?.width,
    screenHeight: window.screen?.height,
    orientationType: window.screen?.orientation?.type,
    legacyOrientation: typeof (window as any).orientation === 'number' ? (window as any).orientation : undefined,
    pixelRatio: window.devicePixelRatio || 1,
    keyboardOpen: editing && !!window.matchMedia?.('(pointer: coarse)').matches,
  }
}
export const readingViewport = shallowRef(readReadingViewport())

/** 应用启动即检测; 窗口缩放/旋转只更新生效排版, 从不把设备尺寸写入或同步设置。 */
export function watchReadingViewport(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const update = () => {
    clearTimeout(timer)
    timer = setTimeout(() => { readingViewport.value = readReadingViewport() }, 100)
  }
  readingViewport.value = readReadingViewport()
  window.addEventListener('resize', update)
  window.addEventListener('orientationchange', update)
  window.addEventListener('focusin', update)
  window.addEventListener('focusout', update)
  window.screen?.orientation?.addEventListener?.('change', update)
  return () => {
    clearTimeout(timer)
    window.removeEventListener('resize', update)
    window.removeEventListener('orientationchange', update)
    window.removeEventListener('focusin', update)
    window.removeEventListener('focusout', update)
    window.screen?.orientation?.removeEventListener?.('change', update)
  }
}
