/** Retire old PWA UI without deleting downloaded recordings or other offline data. */
export async function clearLegacyUiCaches(storage: CacheStorage): Promise<void> {
  const names = await storage.keys()
  await Promise.all(names.filter(name => name.startsWith('workbox-')).map(name => storage.delete(name)))
}
