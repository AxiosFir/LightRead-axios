declare global {
  interface Window {
    LightReadLifecycle?: { isForeground(): boolean }
  }
}

/** Android activity visibility is authoritative when WebView reports stale visibility. */
export function readingPageVisible(): boolean {
  if (document.hidden) return false
  return window.LightReadLifecycle?.isForeground() ?? true
}
