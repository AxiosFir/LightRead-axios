import { onScopeDispose, ref, type Ref } from 'vue'

/** 响应式 matchMedia: 旋转屏幕 / 拖动窗口时实时更新; 不支持 matchMedia 的环境恒为 false */
export function useMediaQuery(query: string): Ref<boolean> {
  const mql = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query)
    : null
  const matches = ref(!!mql?.matches)
  if (!mql) return matches
  const onChange = (e: MediaQueryListEvent) => { matches.value = e.matches }
  // 旧 WebView (Safari < 14) 只有 addListener
  if (typeof mql.addEventListener === 'function') mql.addEventListener('change', onChange)
  else mql.addListener?.(onChange)
  onScopeDispose(() => {
    if (typeof mql.removeEventListener === 'function') mql.removeEventListener('change', onChange)
    else mql.removeListener?.(onChange)
  })
  return matches
}

/**
 * 与 styles/main.css「尺寸层」同一组断点; JS 里判断布局只用这几个, 别另写数字。
 * phone: 手机布局 (底部标签栏 / 阅读器底部工具栏), compact: 紧凑密度, narrow: 小屏手机,
 * touch: 以触屏为主 (没有悬停、指针粗), 决定文案里说「点」还是「拖入」等。
 */
export const MQ = {
  phone: '(max-width: 720px)',
  compact: '(max-width: 600px)',
  narrow: '(max-width: 380px)',
  touch: '(hover: none) and (pointer: coarse)',
} as const

/** 一次性判断 (事件回调里用; 模板里用 useMediaQuery 保持响应式) */
export function matchesMQ(query: string): boolean {
  try { return !!window.matchMedia?.(query).matches } catch { return false }
}
