// LT5: how full this browser's localStorage is. The embedded apps (Finance
// Helper, Waky, MAN, Sport Track) keep their data there, and browsers stop
// saving at about 5 MB per site, silently in some apps. Settings → System
// health warns from 4 MB, while there is still room to act.

/** Warn from here (bytes). */
export const STORAGE_WARN_BYTES = 4 * 1024 * 1024

export interface StorageLike {
  readonly length: number
  key(index: number): string | null
  getItem(key: string): string | null
}

/** Bytes used (browsers count UTF-16: 2 bytes a character, key and value) and the biggest keys. */
export function storageUse(store: StorageLike): { bytes: number; top: { key: string; bytes: number }[] } {
  const all: { key: string; bytes: number }[] = []
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i)
    if (key == null) continue
    all.push({ key, bytes: (key.length + (store.getItem(key)?.length ?? 0)) * 2 })
  }
  all.sort((a, b) => b.bytes - a.bytes)
  return { bytes: all.reduce((s, x) => s + x.bytes, 0), top: all.slice(0, 3) }
}

const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`

/** The warning to show, or null while there is room. */
export function storageWarning(use: { bytes: number; top: { key: string; bytes: number }[] }, warnAt = STORAGE_WARN_BYTES): string | null {
  if (use.bytes < warnAt) return null
  const biggest = use.top.map((t) => `${t.key} (${mb(t.bytes)})`).join(', ')
  return `This browser's storage is ${mb(use.bytes)} full of about 5 MB. Apps may stop saving soon. Biggest: ${biggest}. Save a backup, then clear old data in the app that uses the most.`
}
