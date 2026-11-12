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
  /** Lists where a deletion must stick: an item gone on either side since the last sync stays gone. */
  lists?: { path: string; key: (x: any) => string }[]
  /**
   * The merged data checked against the database before it is kept (Sport
   * Track: today's water and reps always come from the one log, body_log).
   * `canWrite`: inside a change (may add rows), else a read.
   */
  finalize?: (db: any, merged: any, canWrite: boolean) => any
}

const parse = (raw: string | null): any => {
  try {
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/** `onSynced`: after each sync run (e.g. Waky's times go into the sleep log). */
export function createAppSync(mirror: Mirror, spec: AppSyncSpec, store: Storage | null = typeof localStorage !== 'undefined' ? localStorage : null, onSynced?: () => void) {
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
  const remoteOf = (db: any): { savedAt: number; editedAt?: number; data: any } | null => {
    const saved = parse(getSetting(db, spec.setting))
    if (saved?.data) return saved
    const legacy = spec.legacySetting ? parse(getSetting(db, spec.legacySetting)) : null
    return legacy ? { savedAt: 0, data: share(legacy) } : null
  }

  // The local copy as it was when this device last agreed with the database:
  // a save that leaves it unchanged is not an edit. Comparing the raw text is
  // cheap; turning a big copy into its shared form on every save was not.
  let agreedRaw: string | null = null
  /** The app changed its data on this device (its page, the bot, a quest…). */
  const noteEdit = () => {
    const raw = get(spec.localKey)
    if (agreedRaw !== null) {
      if (raw !== agreedRaw) set(EDITED, String(Date.now()))
      return
    }
    if (sharedOf(raw) !== get(SYNCED)) set(EDITED, String(Date.now()))
  }

  const once = async (): Promise<void> => {
    if (!store || spec.skip?.(store)) return
    const localRaw = get(spec.localKey)
    const localShared = sharedOf(localRaw)
    const synced = get(SYNCED)
    let localChanged = localShared != null && localShared !== synced
    const realEdit = localChanged
    const remoteNow = await mirror.read((db) => remoteOf(db))
    const remoteRaw = remoteNow?.data ? JSON.stringify(remoteNow.data) : null
    const remoteChanged = remoteRaw != null && remoteRaw !== synced
    // The copy here says something the database's log doesn't (Sport Track's
    // water and reps): put it right even when nothing else changed.
    const drifted = !localChanged && !remoteChanged && !!spec.finalize && localRaw != null && (await mirror.read((db) => JSON.stringify(spec.finalize!(db, parse(localRaw), false)) !== localRaw))
    if (!localChanged && !remoteChanged && !drifted) {
      if (localShared != null) agreedRaw = localRaw
      return
    }

    let merged: any
    if (!localChanged && spec.finalize) {
      // Only the other side changed, but the database's copy may be off from the log: check first.
      const mine = parse(localRaw)
      const plain = mine ? pruneDeleted(spec, spec.merge(mine, remoteNow?.data ?? mine, false), parse(synced), share(mine), remoteNow?.data ?? mine) : fromShared(remoteNow!.data)
      const fixed = await mirror.read((db) => spec.finalize!(db, plain, false))
      localChanged = remoteRaw == null || JSON.stringify(share(fixed)) !== remoteRaw
      merged = fixed
    }
    if (localChanged) {
      // Not edited here (only the log check asked for a write): the other side is the newer one.
      const edited = realEdit ? Number(get(EDITED)) || Date.now() : -1
      merged = await mirror.write((db) => {
        // Read again inside the change: another device may have just saved.
        const remote = remoteOf(db)
        const mine = parse(localRaw) ?? (remote?.data ? fromShared(remote.data) : null)
        if (!mine) return null
        // The other copy's last real change: a write of only the log's numbers (Sport Track) keeps `editedAt`.
        const theirsAt = Number(remote?.editedAt ?? remote?.savedAt) || 0
        let out = remote?.data && JSON.stringify(remote.data) !== synced ? pruneDeleted(spec, spec.merge(mine, remote.data, edited >= theirsAt), parse(synced), share(mine), remote.data) : mine
        if (spec.finalize) out = spec.finalize(db, out, true)
        if (!remote?.data || JSON.stringify(share(out)) !== JSON.stringify(remote.data)) {
          const at = Date.now()
          // Only the log check asked for this write (nothing edited here): the copy's last real change stays as it was.
          setSetting(db as any, spec.setting, JSON.stringify({ savedAt: at, editedAt: realEdit || !theirsAt ? at : theirsAt, data: share(out) }))
        }
        return out
      })
    } else if (!spec.finalize) {
      const mine = parse(localRaw)
      merged = mine ? pruneDeleted(spec, spec.merge(mine, remoteNow!.data, false), parse(synced), share(mine), remoteNow!.data) : fromShared(remoteNow!.data)
    }
    if (merged == null) return
    // You changed the app again while this sync was waiting (Y4): never overwrite
    // that newer edit; the next run merges it.
    if (get(spec.localKey) !== localRaw) {
      if (localChanged) set(SYNCED, JSON.stringify(share(merged)))
      soon()
      return
    }
    set(SYNCED, JSON.stringify(share(merged)))
    const next = JSON.stringify(merged)
    agreedRaw = next
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
      .finally(() => {
        running = null
        onSynced?.()
      })
    return running
  }

  const soon = () => {
    noteEdit()
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void sync(), 1500)
  }

  return { sync, soon, spec }
}

/**
 * Three-way delete check: an item that was in the last synced copy (`base`)
 * but is missing now on this device or on the other one was deleted there,
 * so it doesn't come back from the side that still has it.
 */
export function pruneDeleted(spec: Pick<AppSyncSpec, 'lists'>, merged: any, base: any, mine: any, theirs: any): any {
  if (!merged || !base || !spec.lists?.length) return merged
  const out = { ...merged }
  for (const { path, key } of spec.lists) {
    const list = (o: any) => (Array.isArray(o?.[path]) ? (o[path] as any[]) : null)
    const b = list(base)
    const m = list(mine)
    const t = list(theirs)
    const cur = list(out)
    if (!b || !cur) continue
    const has = (l: any[] | null) => (l ? new Set(l.map(key)) : null)
    const inMine = has(m)
    const inTheirs = has(t)
    const gone = new Set(b.map(key).filter((k) => (inMine && !inMine.has(k)) || (inTheirs && !inTheirs.has(k))))
    if (gone.size) out[path] = cur.filter((x) => !gone.has(key(x)))
  }
  return out
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
  merge: mergeWaky,
  lists: [
    { path: 'spent', key: (x) => JSON.stringify(x) },
    { path: 'shielded', key: (x) => JSON.stringify(x) }
  ]
}

export const MAN: AppSyncSpec = {
  localKey: 'MAN_SPARTAN_DATA',
  setting: 'app_sync_man',
  legacySetting: 'man_spartan_data',
  event: 'life-man-changed',
  merge: mergeMan,
  lists: [
    { path: 'diary', key: (d) => String(d?.id ?? JSON.stringify(d)) },
    { path: 'customRewards', key: (r) => String(r?.id ?? JSON.stringify(r)) }
  ]
}
