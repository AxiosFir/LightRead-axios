/** Catalog errors are untrusted transport/server text, never display them verbatim. */
export function catalogErrorKey(error: unknown, webWithoutProxy = false): string {
  const value = error && typeof error === 'object' ? error as { name?: unknown; message?: unknown; status?: unknown } : {}
  // URLs can contain status-like numbers, credentials and long query strings.
  const message = String(value.message ?? error ?? '').replace(/https?:\/\/[^\s<>"']+/gi, '')
  if (/^(AbortError|TimeoutError)$/.test(String(value.name)) || /timed?\s*out|timeout|deadline|超时|搜索等得有点久/i.test(message)) {
    return 'catalog.searchTimeout'
  }
  const status = Number(value.status) || Number(message.match(/\b(?:401|403|404|408|429|5\d\d)\b/)?.[0])
  if (status === 408 || status === 504) return 'catalog.searchTimeout'
  if (status === 401) return 'catalog.sourceAuthRequired'
  if (status === 403) return 'catalog.sourceAccessDenied'
  if (status === 404) return 'catalog.sourceNotFound'
  if (status === 429 || /rate limit/i.test(message)) return 'catalog.sourceRateLimited'
  if (status >= 500) return 'catalog.sourceUnavailable'
  if (/failed to fetch|networkerror|load failed|network request failed|error sending request|fetch failed|connection|dns|resolve host|tls|certificate|ssl|网络|无法连接/i.test(message)) {
    return webWithoutProxy ? 'catalog.sourceUnreachableWeb' : 'catalog.sourceUnreachable'
  }
  if (value.name === 'SyntaxError' || /invalid.*(?:response|json|xml|tree)|unexpected token|json|有效的.*(?:结果|XML|目录)/i.test(message)) {
    return 'catalog.sourceInvalidResponse'
  }
  return 'catalog.sourceUnavailable'
}
