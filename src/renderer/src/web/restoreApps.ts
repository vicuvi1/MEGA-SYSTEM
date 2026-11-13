// A restore puts the apps' own data back too (Finance, Sport Track, Waky, MAN
// keep theirs in each device's localStorage), and marks it so the app sync
// takes the restored copy as it is instead of merging the old one back in
// (2026-11-12). This device's copy from before the restore is kept next to it
// (life_sync_<setting>_before_restore), so nothing is lost.
import { APP_BLOBS, type Snapshot } from '@core/backupPlan'

export interface StoreLike {
  getItem(k: string): string | null
  setItem(k: string, v: string): void
  removeItem(k: string): void
}

export interface AppRestoreSpec {
  /** What travels (the data without device-only parts). */
  share?: (local: any) => any
  /** This device's data from what travelled (no local data yet). */
  fromShared?: (shared: any) => any
  /** This device's data after a restore: its own device-only parts plus the restored shared data. */
  adopt?: (mine: any, shared: any) => any
}

const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
/** Default: this device's own keys stay, every shared key comes from the restored copy. */
export const adoptShared = (mine: any, shared: any) => (isRecord(mine) && isRecord(shared) ? { ...mine, ...shared } : shared)

/** The sync markers of an app (see appSync.ts). */
export const syncKeys = (setting: string) => ({
  synced: `life_sync_${setting}`,
  seen: `life_sync_${setting}_seen`,
  edited: `life_sync_${setting}_edited`,
  restore: `life_sync_${setting}_restore`,
  before: `life_sync_${setting}_before_restore`
})

const parse = (raw: string | null): any => {
  try {
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/**
 * Writes the restored app data into this device's storage. `apps` = each
 * app's restored shared data (from markRestoredApps). Returns the fields put back.
 */
export function putBackApps(store: StoreLike, snap: Snapshot, apps: Record<string, unknown>, restoreId: string, now: number, specs: Record<string, AppRestoreSpec> = {}): string[] {
  const done: string[] = []
  for (const b of APP_BLOBS) {
    const spec = specs[b.field] ?? {}
    if (b.setting && apps[b.field] != null) {
      const k = syncKeys(b.setting)
      const shared = apps[b.field]
      const curRaw = store.getItem(b.localKey)
      if (curRaw) store.setItem(k.before, JSON.stringify({ at: new Date(now).toISOString(), restore: restoreId, raw: curRaw }))
      const cur = parse(curRaw)
      const next = cur != null ? (spec.adopt ?? adoptShared)(cur, shared) : snap[b.field] != null ? snap[b.field] : (spec.fromShared ?? ((x: any) => x))(shared)
      store.setItem(b.localKey, JSON.stringify(next))
      store.setItem(k.synced, JSON.stringify((spec.share ?? ((x: any) => x))(next)))
      store.setItem(k.seen, String(now))
      store.removeItem(k.edited)
      store.setItem(k.restore, restoreId)
      done.push(b.field)
    } else if (!b.setting && snap[b.field] != null) {
      const v = snap[b.field]
      store.setItem(b.localKey, typeof v === 'string' ? v : JSON.stringify(v))
      done.push(b.field)
    }
  }
  return done
}

/** The apps' data on this device, as backup fields (Finance's locked copy as its raw text). */
export function appBlobsOf(store: StoreLike | null): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const b of APP_BLOBS) {
    let raw: string | null = null
    try {
      raw = store?.getItem(b.localKey) ?? null
    } catch {
      raw = null
    }
    if (raw == null) continue
    out[b.field] = b.setting ? parse(raw) : raw
  }
  return out
}
