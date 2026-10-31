// The embedded apps (Sport Track, Finance Helper, Waky, MAN) keep their data
// in this browser (localStorage). This copies each one to Turso
// (settings.app_sync_<app> = {savedAt, data}) and back, so every device shows
// the same thing. When both sides changed, the app's own merge decides
// (Finance Helper: newest copy of each record; the others: see their spec).
// Device-only parts (Finance Helper's PIN, rates, theme…) never travel.
import { getSetting, setSetting } from '../../../main/settings'
import type { Mirror } from './mirror'

export interface AppSyncSpec {
  /** localStorage key the app saves to. */
  localKey: string
  /** Turso settings key. */
  setting: string
  /** Older Turso backups to start from on a new device (raw app data). */
  legacySetting?: string
  /** Event that makes the open app reload (EmbedHost listens). */
  event: string
  /** What travels: the data without device-only parts. */
  share?: (local: any) => any
  /** This device's data from what travelled (no local data yet). */
  fromShared?: (shared: any) => any
  /** Both changed: `mine` is the full local data, `theirs` what travelled. */
  merge: (mine: any, theirs: any, mineIsNewer: boolean) => any
  /** Skip this round (e.g. Finance Helper locked with a PIN on this device). */
  skip?: (store: Storage) => boolean
}

const parse = (raw: string | null): any => {
  try {
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function createAppSync(mirror: Mirror, spec: AppSyncSpec, store: Storage | null = typeof localStorage !== 'undefined' ? localStorage : null) {
  const SYNCED = `life_sync_${spec.setting}` // what both sides last agreed on
  const EDITED = `life_sync_${spec.setting}_edited`
  const share = spec.share ?? ((x: any) => x)
  const fromShared = spec.fromShared ?? ((x: any) => x)
  let running: Promise<void> | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const get = (k: string) => {
    try {
      return store?.getItem(k) ?? null
    } catch {
      return null
    }
  }
  const set = (k: string, v: string) => {
    try {
      store?.setItem(k, v)
    } catch {
      /* private window */
    }
  }
  const sharedOf = (raw: string | null) => {
    const obj = parse(raw)
    return obj ? JSON.stringify(share(obj)) : null
  }
  const remoteOf = (db: any): { savedAt: number; data: any } | null => {
    const saved = parse(getSetting(db, spec.setting))
    if (saved?.data) return saved
    const legacy = spec.legacySetting ? parse(getSetting(db, spec.legacySetting)) : null
    return legacy ? { savedAt: 0, data: share(legacy) } : null
  }

  /** The app changed its data on this device (its page, the bot, a quest…). */
  const noteEdit = () => {
    if (sharedOf(get(spec.localKey)) !== get(SYNCED)) set(EDITED, String(Date.now()))
  }

  const once = async (): Promise<void> => {
    if (!store || spec.skip?.(store)) return
    const localRaw = get(spec.localKey)
    const localShared = sharedOf(localRaw)
    const synced = get(SYNCED)
    const localChanged = localShared != null && localShared !== synced
    const remoteNow = await mirror.read((db) => remoteOf(db))
    const remoteRaw = remoteNow?.data ? JSON.stringify(remoteNow.data) : null
    const remoteChanged = remoteRaw != null && remoteRaw !== synced
    if (!localChanged && !remoteChanged) return

    let merged: any
    if (localChanged) {
      const edited = Number(get(EDITED)) || Date.now()
      merged = await mirror.write((db) => {
        // Read again inside the change: another device may have just saved.
        const remote = remoteOf(db)
        const mine = parse(localRaw)
        const out = remote?.data && JSON.stringify(remote.data) !== synced ? spec.merge(mine, remote.data, edited >= (remote.savedAt || 0)) : mine
        setSetting(db as any, spec.setting, JSON.stringify({ savedAt: Date.now(), data: share(out) }))
        return out
      })
    } else {
      const mine = parse(localRaw)
      merged = mine ? spec.merge(mine, remoteNow!.data, false) : fromShared(remoteNow!.data)
    }
    set(SYNCED, JSON.stringify(share(merged)))
    const next = JSON.stringify(merged)
    if (next !== localRaw) {
      set(spec.localKey, next)
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(spec.event, { detail: { fromSync: true } }))
    }
  }

  /** Copies changes both ways; safe to call often (one run at a time). */
  const sync = (): Promise<void> => {
    if (running) return running.then(() => sync())
    running = once()
      .catch(() => {
        /* offline or another device saved first: the next run retries */
      })
      .finally(() => (running = null))
    return running
  }

  const soon = () => {
    noteEdit()
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void sync(), 1500)
  }

  return { sync, soon, spec }
}

// ---- The apps -------------------------------------------------------------

const unionBy = (key: (x: any) => string, ...lists: any[][]) => {
  const seen = new Set<string>()
  const out: any[] = []
  for (const list of lists) {
    for (const x of Array.isArray(list) ? list : []) {
      const k = key(x)
      if (seen.has(k)) continue
      seen.add(k)
      out.push(x)
    }
  }
  return out
}
const asJson = (x: any) => JSON.stringify(x)

/** Waky: every morning, night and opened chest from both; settings from the newer. */
export function mergeWaky(mine: any, theirs: any, mineIsNewer: boolean): any {
  const newer = mineIsNewer ? mine : theirs
  const older = mineIsNewer ? theirs : mine
  return {
    ...older,
    ...newer,
    days: { ...(older?.days ?? {}), ...(newer?.days ?? {}) },
    nights: { ...(older?.nights ?? {}), ...(newer?.nights ?? {}) },
    opened: { ...(older?.opened ?? {}), ...(newer?.opened ?? {}) },
    spent: unionBy(asJson, newer?.spent, older?.spent),
    shielded: unionBy(asJson, newer?.shielded, older?.shielded)
  }
}

/** MAN: diary, medals and rewards from both; counters never go down; the rest from the newer. */
export function mergeMan(mine: any, theirs: any, mineIsNewer: boolean): any {
  const newer = mineIsNewer ? mine : theirs
  const older = mineIsNewer ? theirs : mine
  const max = (k: string) => Math.max(Number(mine?.[k]) || 0, Number(theirs?.[k]) || 0)
  const diary = unionBy((d) => String(d?.id ?? asJson(d)), newer?.diary, older?.diary).sort((a, b) =>
    String(b?.createdAt ?? b?.date ?? '').localeCompare(String(a?.createdAt ?? a?.date ?? ''))
  )
  return {
    ...older,
    ...newer,
    diary,
    unlockedAchievements: unionBy(asJson, newer?.unlockedAchievements, older?.unlockedAchievements),
    claimedRewards: unionBy(asJson, newer?.claimedRewards, older?.claimedRewards),
    customRewards: unionBy((r) => String(r?.id ?? asJson(r)), newer?.customRewards, older?.customRewards),
    longestStreak: max('longestStreak'),
    totalVictories: max('totalVictories'),
    oathsSwornCount: max('oathsSwornCount'),
    urgesCrushedCount: max('urgesCrushedCount')
  }
}

export const WAKY: AppSyncSpec = {
  localKey: 'waky_web_data_v2',
  setting: 'app_sync_waky',
  legacySetting: 'waky_backup_json',
  event: 'life-waky-changed',
  merge: mergeWaky
}

export const MAN: AppSyncSpec = {
  localKey: 'MAN_SPARTAN_DATA',
  setting: 'app_sync_man',
  legacySetting: 'man_spartan_data',
  event: 'life-man-changed',
  merge: mergeMan
}
