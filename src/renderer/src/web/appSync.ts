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
  /** The app's name in the sync status ("Money"). */
  label?: string
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
  /** Why a round was skipped, for the sync status ("Money locked"). */
  skipNote?: string
  /** Lists where a deletion must stick: an item gone on either side since the last sync stays gone. */
  lists?: { path: string; key: (x: any) => string }[]
  /**
   * What `theirs` (a copy as it travels) is missing from `mine` (the full local
   * data): records it doesn't have or has an older edit of, and other changes.
   * Default: `gapOf` on the shared form. Must agree with `merge`, so two devices
   * never keep sending each other the same thing.
   */
  gap?: (mine: any, theirs: any) => SyncGap
  /**
   * The merged data checked against the database before it is kept (Sport
   * Track: today's water and reps always come from the one log, body_log).
   * `canWrite`: inside a change (may add rows), else a read.
   */
  finalize?: (db: any, merged: any, canWrite: boolean) => any
  /** After a restore: this device's data from its own device-only parts and the restored shared data (default: both, the restored winning). */
  adopt?: (mine: any, shared: any) => any
  /**
   * Runs before the usual round; a run it returns replaces that round (Money
   * locked with its PIN: only sealed copies travel, see financeSync.ts). Null:
   * the usual round.
   */
  custom?: (ctx: AppSyncContext) => Promise<AppSyncRun | null>
  /** Other localStorage keys whose change (from the app's frame) starts a sync soon. */
  watch?: string[]
}

/** What a `custom` round gets from the sync. */
export interface AppSyncContext {
  mirror: Mirror
  store: Storage
  /** Compare with the server's own copy (start, every few minutes, "Sync now", a copy not confirmed yet). */
  checking: boolean
  /** "Sync now": always download the server's copy. */
  full: boolean
  report: (patch: Partial<AppSyncStatus>) => void
  /** true: the server hasn't confirmed yet (the next run checks again); false: confirmed. */
  unconfirmed: (v: boolean) => void
}

/** What one copy lacks next to another: list items (records) and other changes (settings, map entries). */
export interface SyncGap {
  records: number
  other: number
}

/** How one app's sync is doing on this device (Settings → Data safety, the top-bar dot). */
export interface AppSyncStatus {
  setting: string
  label: string
  /**
   * ok: the SERVER confirmed it has everything this device has; waiting: sent
   * or merged here, not confirmed yet (tried again soon); skipped: not synced
   * on purpose (`note` says why); error: the last run failed (`error`).
   */
  state: 'ok' | 'waiting' | 'skipped' | 'error' | 'never'
  /** When the server last confirmed it (ms). */
  okAt: number | null
  /** When it last ran (ms). */
  at: number | null
  error: string | null
  note: string | null
  /** Records sent by the last run that sent any. */
  sent: number
}

/** What one run did (the "Sync Money now" button shows it). */
export interface AppSyncRun {
  ok: boolean
  /** Not synced on purpose (e.g. "Money locked"). */
  skipped?: string
  error?: string
  /** Records sent to the cloud. */
  sent: number
  /** Other changes sent (settings, deletions). */
  changes: number
  /** The server confirmed it has everything this device has. */
  confirmed: boolean
  /** Records this device took from the cloud. */
  got?: number
  /** Only a sealed copy travelled (Money locked with its PIN). */
  locked?: boolean
}

/**
 * Called before a big change of an app's data goes to the database (an import,
 * a bulk delete, a re-price…), with the copy from before and the new one: the
 * app takes a "before" backup there (one-click undo). Set once by the bridge.
 */
let bigChangeGuard: ((spec: AppSyncSpec, before: any, after: any) => Promise<unknown>) | null = null
export function setBigChangeGuard(fn: typeof bigChangeGuard) {
  bigChangeGuard = fn
}

const parse = (raw: string | null): any => {
  try {
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

const isPlain = (x: any) => !!x && typeof x === 'object' && !Array.isArray(x)
/** The same data gives the same text, whatever order its fields were written in. */
export const canonical = (x: any): string =>
  JSON.stringify(x, (_k, v) => (isPlain(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v))

/**
 * What `theirs` lacks from `mine` (both as they travel), whatever the order:
 * a list item it doesn't have exactly counts as a record; a missing key or a
 * different value counts as another change. Only additions and changes count:
 * a deletion travels as a tombstone or through the three-way list check.
 */
export function gapOf(mine: any, theirs: any): SyncGap {
  const out: SyncGap = { records: 0, other: 0 }
  const walk = (a: any, b: any) => {
    if (Array.isArray(a)) {
      if (!Array.isArray(b)) {
        out.records += a.length
        return
      }
      const have = new Set(b.map(canonical))
      for (const x of a) if (!have.has(canonical(x))) out.records++
      return
    }
    if (isPlain(a)) {
      if (!isPlain(b)) {
        out.other++
        return
      }
      for (const k of Object.keys(a)) {
        if (a[k] === undefined) continue
        if (!(k in b)) {
          if (Array.isArray(a[k])) out.records += a[k].length
          else out.other++
          continue
        }
        walk(a[k], b[k])
      }
      return
    }
    if (a !== b && !(a == null && b == null)) out.other++
  }
  walk(mine, theirs)
  return out
}
const gapSize = (g: SyncGap) => g.records + g.other

// ---- Status of every app's sync on this device ------------------------------

const statuses = new Map<string, AppSyncStatus>()
/** Every app's sync status on this device (one per app synced here). */
export function appSyncStatuses(): AppSyncStatus[] {
  return [...statuses.values()]
}

/** Money and the others: not synced for this long while online turns the dot amber. */
export const STALE_MS = 15 * 60_000

/**
 * The top-bar dot's word on the apps: the worst of them. Error for over 15
 * minutes (or never synced) = bad; an error, a skipped run, a copy not
 * confirmed, or nothing confirmed for 15 minutes while online = warn.
 */
export function appSyncAlert(list: AppSyncStatus[], now: number, online: boolean): { level: 'warn' | 'bad'; text: string; short: string } | null {
  let worst: { level: 'warn' | 'bad'; text: string; short: string } | null = null
  const put = (level: 'warn' | 'bad', text: string, short: string) => {
    if (!worst || (level === 'bad' && worst.level === 'warn')) worst = { level, text, short }
  }
  for (const s of list) {
    const stale = s.okAt == null || now - s.okAt > STALE_MS
    if (s.state === 'error') put(stale && online ? 'bad' : 'warn', `${s.label} not synced: ${s.error ?? 'error'}`, `${s.label} not synced`)
    else if (s.state === 'skipped') put('warn', `${s.label}: skipped (${s.note ?? 'locked'})`, `${s.label}: skipped`)
    else if (s.state === 'waiting' && online) put('warn', `${s.label} waiting to sync`, `${s.label} waiting`)
    else if (s.state === 'ok' && online && stale) put('warn', `${s.label} not synced for ${Math.round((now - (s.okAt ?? now)) / 60_000)} min`, `${s.label} not synced`)
  }
  return worst
}

/** One app's line in the sync panel ("synced 3 min ago", "skipped (Money locked)", the error). */
export function appSyncLine(s: AppSyncStatus, now = Date.now()): string {
  if (s.state === 'skipped') return `skipped (${s.note ?? 'locked'})`
  if (s.state === 'error') return `not synced: ${s.error ?? 'error'}`
  if (s.state === 'waiting') return 'waiting for the cloud to confirm'
  if (s.state === 'never' || s.okAt == null) return 'not checked yet'
  const min = Math.floor((now - s.okAt) / 60_000)
  return `synced ${min < 1 ? 'just now' : min < 60 ? `${min} min ago` : `${Math.floor(min / 60)} h ago`}`
}

/** One line for a run ("Sent 37 records · cloud up to date"). */
export function appSyncRunText(r: AppSyncRun): string {
  if (r.skipped) return `Not synced: skipped (${r.skipped})`
  if (!r.ok) return `Not synced: ${r.error ?? 'error'}. Nothing was lost; it tries again by itself.`
  const sent = r.sent ? `Sent ${r.sent} record${r.sent === 1 ? '' : 's'}` : r.changes ? `Sent ${r.changes} change${r.changes === 1 ? '' : 's'}` : 'Nothing to send'
  return r.confirmed ? `${sent} · cloud up to date` : `${sent} · the cloud hasn't confirmed it yet, trying again`
}

// ---- Sync history (Settings → Data safety → Show history) -------------------

/** One remembered sync event on this device. */
export interface AppSyncEvent {
  at: number
  setting: string
  label: string
  /** "sent 37 records · cloud up to date", "skipped (Money locked)", "failed: offline". */
  text: string
  /** The same event in a row (a repeated skip or error) is kept once, counted. */
  times?: number
}

/** Kept on this device only (localStorage), at most this many per app. */
export const HISTORY_KEY = 'life_sync_history'
export const HISTORY_PER_APP = 20

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
const shortError = (e?: string) => {
  const t = String(e ?? 'error').split(/(?<=\.)\s/)[0].replace(/\.$/, '')
  return t.length > 80 ? `${t.slice(0, 79)}…` : t
}

/**
 * A run as one plain history line, or null when there is nothing worth
 * remembering (a routine check that found nothing to do). `manual`: "Sync now"
 * was pressed, so even "nothing to send" is remembered.
 */
export function appSyncEventText(r: AppSyncRun, manual = false): string | null {
  if (r.skipped) return `skipped (${r.skipped})`
  if (!r.ok) return `failed: ${shortError(r.error)}`
  const parts: string[] = []
  if (r.sent) parts.push(`sent ${plural(r.sent, 'record')}${r.locked ? ' (locked)' : ''}`)
  else if (r.changes) parts.push(r.locked ? 'sent the locked copy' : `sent ${plural(r.changes, 'change')}`)
  if (r.got) parts.push(`got ${plural(r.got, 'record')}${r.locked ? ' from the locked copy' : ''}`)
  if (!parts.length) {
    if (!manual) return null
    parts.push('nothing to send')
  }
  parts.push(r.confirmed ? 'cloud up to date' : 'waiting for the cloud')
  return parts.join(' · ')
}

const readHistory = (store: Storage | null): AppSyncEvent[] => {
  try {
    const list = JSON.parse(store?.getItem(HISTORY_KEY) || '[]')
    return Array.isArray(list) ? list.filter((e) => e && typeof e.text === 'string' && Number.isFinite(e.at)) : []
  } catch {
    return []
  }
}

/** Every app's last events on this device, newest first. */
export function appSyncHistory(store: Storage | null = typeof localStorage !== 'undefined' ? localStorage : null): AppSyncEvent[] {
  return readHistory(store).sort((a, b) => b.at - a.at)
}

/** Remembers one event: capped per app, and a full storage never breaks a sync (older events go first). */
export function addAppSyncEvent(store: Storage | null, e: AppSyncEvent): void {
  if (!store) return
  const list = readHistory(store)
  const last = list.filter((x) => x.setting === e.setting).sort((a, b) => b.at - a.at)[0]
  if (last && last.text === e.text && /^(skipped|failed|nothing)/.test(e.text)) {
    last.at = e.at
    last.times = (last.times ?? 1) + 1
  } else list.push(e)
  const keep = (per: number) => {
    const out: AppSyncEvent[] = []
    for (const app of new Set(list.map((x) => x.setting))) out.push(...list.filter((x) => x.setting === app).sort((a, b) => b.at - a.at).slice(0, per))
    return out
  }
  for (const per of [HISTORY_PER_APP, 5, 1]) {
    try {
      store.setItem(HISTORY_KEY, JSON.stringify(keep(per)))
      return
    } catch {
      /* storage full: keep fewer */
    }
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const two = (n: number) => String(n).padStart(2, '0')
/** "13 Nov 21:40 · Money · sent 37 records · cloud up to date" (this device's time, the same on every system). */
export function appSyncEventLine(e: AppSyncEvent): string {
  const d = new Date(e.at)
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${two(d.getHours())}:${two(d.getMinutes())} · ${e.label} · ${e.text}${(e.times ?? 1) > 1 ? ` (${e.times} times)` : ''}`
}

class StorageFullError extends Error {}

/** `onSynced`: after each sync run (e.g. Waky's times go into the sleep log). */
export function createAppSync(mirror: Mirror, spec: AppSyncSpec, store: Storage | null = typeof localStorage !== 'undefined' ? localStorage : null, onSynced?: () => void) {
  const SYNCED = `life_sync_${spec.setting}` // what both sides last agreed on
  // When you last changed the app here, on the shared edit timeline (below).
  // Cleared once that edit is synced, so an old time never stands for a newer edit.
  const EDITED = `life_sync_${spec.setting}_edited`
  // The `editedAt` of the database copy this device last agreed with. Edit
  // times are only ever compared with `editedAt` values: an edit made after
  // seeing a copy counts as later than it (at least its editedAt + 1), even
  // when this device's clock is behind the one that wrote it.
  const SEEN = `life_sync_${spec.setting}_seen`
  // The restore this device last took (a restore marks the database copy with
  // an id: a device that hasn't seen it takes that copy as it is, see below).
  const RESTORED = `life_sync_${spec.setting}_restore`
  // Set while the server hasn't confirmed it holds what this device sent or
  // has: the next run compares with the server's own copy and sends again.
  const UNCONFIRMED = `life_sync_${spec.setting}_unconfirmed`
  const STATUS = `life_sync_${spec.setting}_status`
  const label = spec.label ?? spec.setting.replace(/^app_sync_/, '')
  const share = spec.share ?? ((x: any) => x)
  const fromShared = spec.fromShared ?? ((x: any) => x)
  /** What `theirs` (as it travels) lacks from this device's full data. */
  const gapFor = (mine: any, theirs: any): SyncGap => (spec.gap ? spec.gap(mine, theirs) : gapOf(share(mine), theirs))
  let running: Promise<AppSyncRun> | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let fails = 0
  // A send of only what the cloud lacked (no edit here), to stop two devices
  // ever trading the same copy back and forth: at most one a minute.
  let gapPushAt = 0

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
  /** A write that must not fail silently (the app's data, the agreed copy). */
  const setStrict = (k: string, v: string) => {
    try {
      store?.setItem(k, v)
    } catch (e) {
      throw new StorageFullError(`This device's storage is full, so ${label}'s newest data couldn't be saved here (${String((e as Error)?.name ?? e)}). The cloud copy has it.`)
    }
  }
  const del = (k: string) => {
    try {
      store?.removeItem(k)
    } catch {
      /* private window */
    }
  }

  const status: AppSyncStatus = { setting: spec.setting, label, state: 'never', okAt: null, at: null, error: null, note: null, sent: 0, ...(parse(get(STATUS)) ?? {}) }
  status.label = label
  statuses.set(spec.setting, status)
  const report = (patch: Partial<AppSyncStatus>) => {
    Object.assign(status, patch, { at: Date.now() })
    set(STATUS, JSON.stringify(status))
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') window.dispatchEvent(new CustomEvent('life-app-sync', { detail: { ...status } }))
  }

  /** An edit's time: this device's clock, but never before the copy it was made on. */
  const editStamp = () => Math.max(Date.now(), (Number(get(SEEN)) || 0) + 1)
  const sharedOf = (raw: string | null) => {
    const obj = parse(raw)
    return obj ? JSON.stringify(share(obj)) : null
  }
  const remoteOf = (db: any): { savedAt: number; editedAt?: number; restore?: string; data: any } | null => {
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
      if (raw !== agreedRaw) set(EDITED, String(editStamp()))
      return
    }
    if (sharedOf(raw) !== get(SYNCED)) set(EDITED, String(editStamp()))
  }

  /**
   * Does the SERVER hold everything in `state`? `expected`: the text this run
   * believes is there (what it wrote, or this device's copy of the database);
   * `full`: always download the server's copy and compare.
   */
  /** Records `next` has that this device's copy (`localShared`, as it travels) lacked. */
  const gotOf = (next: any, localShared: string | null): number => {
    try {
      return gapFor(next, localShared ? JSON.parse(localShared) : {}).records
    } catch {
      return 0
    }
  }

  const serverHas = async (state: any, expected: string | null, full: boolean): Promise<boolean> => {
    // The size + start check answers "same text" without a download; what that text lacks is still compared.
    const serverRaw = await mirror.serverSetting(spec.setting, full ? undefined : expected)
    const data = parse(serverRaw)?.data
    if (!data) return state == null
    return gapSize(gapFor(state, data)) === 0
  }

  const once = async (opts: { check?: boolean; full?: boolean }): Promise<AppSyncRun> => {
    const none: AppSyncRun = { ok: true, sent: 0, changes: 0, confirmed: false }
    if (!store) return none
    if (spec.skip?.(store)) {
      report({ state: 'skipped', note: spec.skipNote ?? 'locked', error: null })
      return { ...none, skipped: spec.skipNote ?? 'locked' }
    }
    // A check (startup, every few minutes, "Sync now", or a copy not confirmed yet)
    // compares with the server's own copy, not only with what this device last agreed.
    const checking = !!opts.check || !!opts.full || get(UNCONFIRMED) != null
    if (checking) await mirror.refresh()
    if (spec.custom) {
      const own = await spec.custom({ mirror, store, checking, full: !!opts.full, report, unconfirmed: (v) => (v ? set(UNCONFIRMED, '1') : del(UNCONFIRMED)) })
      if (own) return own
    }
    const localRaw = get(spec.localKey)
    const localShared = sharedOf(localRaw)
    const synced = get(SYNCED)
    let localChanged = localShared != null && localShared !== synced
    const realEdit = localChanged
    const { remote: remoteNow, raw: mirrorRaw } = await mirror.read((db) => ({ remote: remoteOf(db), raw: getSetting(db as any, spec.setting) }))
    // A restore happened (here or on another device) that this device hasn't taken yet:
    // the restored copy wins as it is. Merging would bring back what the restore removed.
    // This device's copy from before is kept next to it (nothing is lost).
    if (remoteNow?.data && remoteNow.restore && String(remoteNow.restore) !== get(RESTORED)) {
      const mine = parse(localRaw)
      if (localRaw != null) set(`${SYNCED}_before_restore`, JSON.stringify({ at: new Date().toISOString(), restore: String(remoteNow.restore), raw: localRaw }))
      const next = mine != null ? (spec.adopt ?? ((m: any, d: any) => (m && typeof m === 'object' && !Array.isArray(m) && d && typeof d === 'object' && !Array.isArray(d) ? { ...m, ...d } : d)))(mine, remoteNow.data) : fromShared(remoteNow.data)
      const text = JSON.stringify(next)
      if (text !== localRaw) setStrict(spec.localKey, text)
      setStrict(SYNCED, JSON.stringify(share(next)))
      set(SEEN, String(Number(remoteNow.editedAt ?? remoteNow.savedAt) || 0))
      set(RESTORED, String(remoteNow.restore))
      del(EDITED)
      del(UNCONFIRMED)
      agreedRaw = text
      if (text !== localRaw && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(spec.event, { detail: { fromSync: true } }))
      report({ state: 'ok', okAt: Date.now(), error: null, note: null })
      return { ...none, confirmed: true, got: text !== localRaw ? gotOf(next, localShared) : 0 }
    }
    // A big change made here (an import, a bulk delete, a re-price): a "before" backup first.
    if (realEdit && bigChangeGuard && synced != null && localShared != null) await bigChangeGuard(spec, parse(synced), parse(localShared)).catch(() => {})
    const remoteRaw = remoteNow?.data ? JSON.stringify(remoteNow.data) : null
    const remoteChanged = remoteRaw != null && remoteRaw !== synced
    // The copy here says something the database's log doesn't (Sport Track's
    // water and reps): put it right even when nothing else changed.
    const drifted = !localChanged && !remoteChanged && !!spec.finalize && localRaw != null && (await mirror.read((db) => JSON.stringify(spec.finalize!(db, parse(localRaw), false)) !== localRaw))
    const quiet = !localChanged && !remoteChanged && !drifted
    if (quiet && !checking) {
      if (localShared != null) agreedRaw = localRaw
      return none
    }
    if (localRaw == null && !remoteNow?.data) {
      // Nothing on either side: nothing to lose.
      del(UNCONFIRMED)
      report({ state: 'ok', okAt: Date.now(), error: null, note: null })
      return { ...none, confirmed: true }
    }

    let merged: any
    let wrote: string | null = null
    let sent: SyncGap = { records: 0, other: 0 }
    let gapPush = false
    // The editedAt of the copy this run agrees on (kept as SEEN).
    let agreedAt = Number(remoteNow?.editedAt ?? remoteNow?.savedAt) || 0
    if (!localChanged) {
      // Not edited here: only the other side changed, or this is a check. Merge here,
      // then send back whatever the database's copy lacks (records, edits, settings):
      // before this, a merged result that only lived here was never sent again.
      const mine = parse(localRaw)
      let plain = mine ? pruneDeleted(spec, spec.merge(mine, remoteNow?.data ?? share(mine), false), parse(synced), share(mine), remoteNow?.data ?? share(mine)) : fromShared(remoteNow!.data)
      // The database's copy may be off from the log (Sport Track): check first.
      if (spec.finalize) plain = await mirror.read((db) => spec.finalize!(db, plain, false))
      if (!remoteNow?.data) localChanged = true
      else if (spec.finalize && !quiet) localChanged = JSON.stringify(share(plain)) !== remoteRaw
      else gapPush = localChanged = gapSize(gapFor(plain, remoteNow.data)) > 0
      // Nothing changed on either side (a check): the data here stays exactly as it is.
      merged = quiet ? (mine ?? plain) : plain
      if (gapPush && Date.now() - gapPushAt < 60_000) {
        // Sent one a moment ago: keep the merge here, send on the next try.
        localChanged = false
        set(UNCONFIRMED, '1')
      }
    }
    if (localChanged) {
      if (gapPush) gapPushAt = Date.now()
      // Not edited here (only the log check or a gap asked for a write): the other side is the newer one.
      // No marker (the app saved without telling us): the edit is now.
      const edited = realEdit ? Math.max(Number(get(EDITED)) || Date.now(), (Number(get(SEEN)) || 0) + 1) : -1
      merged = await mirror.write((db) => {
        // Read again inside the change: another device may have just saved.
        const remote = remoteOf(db)
        const mine = parse(localRaw) ?? (remote?.data ? fromShared(remote.data) : null)
        if (!mine) return null
        // The other copy's last real change: a write of only the log's numbers (Sport Track) keeps `editedAt`.
        const theirsAt = Number(remote?.editedAt ?? remote?.savedAt) || 0
        agreedAt = theirsAt
        let out = remote?.data && JSON.stringify(remote.data) !== synced ? pruneDeleted(spec, spec.merge(mine, remote.data, edited >= theirsAt), parse(synced), share(mine), remote.data) : mine
        if (spec.finalize) out = spec.finalize(db, out, true)
        if (!remote?.data || JSON.stringify(share(out)) !== JSON.stringify(remote.data)) {
          const at = Date.now()
          sent = remote?.data ? gapFor(out, remote.data) : { records: 0, other: 1 }
          // Only the log check or a gap asked for this write (nothing edited here): the copy's last real change stays as it was.
          // A real edit is stamped after the copy it merged with, whatever this clock says.
          const editedAt = realEdit ? Math.max(at, edited, theirsAt + 1) : theirsAt || at
          agreedAt = editedAt
          // The restore mark stays on the copy, so a device that was away still takes the restored copy first.
          const restore = (remote as any)?.restore
          wrote = JSON.stringify({ savedAt: at, editedAt, data: share(out), ...(restore ? { restore } : {}) })
          setSetting(db as any, spec.setting, wrote)
        }
        return out
      })
    }
    if (merged == null) return none
    // Until the server confirms it, the next run checks again (and sends again).
    if (wrote != null) set(UNCONFIRMED, '1')
    // You changed the app again while this sync was waiting (Y4): never overwrite
    // that newer edit; the next run merges it.
    if (get(spec.localKey) !== localRaw) {
      if (localChanged) {
        setStrict(SYNCED, JSON.stringify(share(merged)))
        set(SEEN, String(agreedAt))
      }
      soon()
      return { ok: true, sent: sent.records, changes: sent.other, confirmed: false }
    }
    const next = JSON.stringify(merged)
    const got = next !== localRaw ? gotOf(merged, localShared) : 0
    // The app's data first: the agreed copy is only moved once the data it describes is kept.
    if (next !== localRaw) setStrict(spec.localKey, next)
    setStrict(SYNCED, JSON.stringify(share(merged)))
    set(SEEN, String(agreedAt))
    del(EDITED)
    agreedRaw = next
    if (next !== localRaw && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(spec.event, { detail: { fromSync: true } }))
    // Synced only once the SERVER has it (on the desktop a write is saved on this PC first).
    let confirmed = false
    if (wrote != null || checking || get(UNCONFIRMED) != null) {
      confirmed = await serverHas(merged, wrote ?? (mirrorRaw as string | null), !!opts.full)
      if (confirmed) del(UNCONFIRMED)
      else set(UNCONFIRMED, '1')
    }
    if (confirmed) report({ state: 'ok', okAt: Date.now(), error: null, note: null, ...(sent.records ? { sent: sent.records } : {}) })
    else if (wrote != null || checking) report({ state: 'waiting', error: null, note: null })
    return { ok: true, sent: sent.records, changes: sent.other, confirmed, got }
  }

  const retryLater = () => {
    if (retryTimer) clearTimeout(retryTimer)
    const wait = Math.min(10 * 60_000, 30_000 * 2 ** Math.min(fails, 5))
    fails++
    retryTimer = setTimeout(() => {
      retryTimer = null
      void sync({ check: true })
    }, wait)
    ;(retryTimer as any)?.unref?.()
  }

  /** Copies changes both ways; safe to call often (one run at a time). `check`: compare with the server's own copy. */
  const sync = (opts: { check?: boolean; full?: boolean } = {}): Promise<AppSyncRun> => {
    if (running) return running.then(() => sync(opts))
    const remember = (r: AppSyncRun) => {
      const text = appSyncEventText(r, !!opts.full)
      if (text) addAppSyncEvent(store, { at: Date.now(), setting: spec.setting, label, text })
      return r
    }
    running = once(opts)
      .then((r) => {
        if (r.skipped || r.confirmed || get(UNCONFIRMED) == null) fails = 0
        else retryLater()
        return remember(r)
      })
      .catch((e): AppSyncRun => {
        // Offline, storage full, or another device saved first: shown in the
        // sync status (never silent), nothing lost, and tried again later.
        set(UNCONFIRMED, '1')
        const error = String((e as Error)?.message ?? e).slice(0, 240)
        report({ state: 'error', error, note: null })
        retryLater()
        return remember({ ok: false, error, sent: 0, changes: 0, confirmed: false })
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

  // The app's frame saved another key this sync reads (Money's sealed data while it's locked).
  if (spec.watch?.length && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('storage', (e) => {
      if (e.key && spec.watch!.includes(e.key)) soon()
    })
  }

  return { sync, soon, spec, status: () => ({ ...status }) }
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

const ENTRY_TIME = ['updatedAt', 'editedAt', 'at', 'ts']
const isRecord = isPlain
/**
 * One record (a Waky morning, night or chest) changed on both devices: every
 * field from both. A field both have: the record with the later time
 * (`updatedAt`, `editedAt`, `at`, `ts`) wins, else the newer copy.
 */
export function mergeEntry(older: any, newer: any): any {
  if (!isRecord(older) || !isRecord(newer)) return newer ?? older
  for (const k of ENTRY_TIME) {
    const o = Number(older[k])
    const n = Number(newer[k])
    if (Number.isFinite(o) && Number.isFinite(n) && o !== n) return o > n ? { ...newer, ...older } : { ...older, ...newer }
  }
  return { ...older, ...newer }
}
/** Two maps of records (day → record): every key from both, each record merged field by field. */
export function mergeEntries(older: any, newer: any): Record<string, any> {
  const out: Record<string, any> = { ...(isRecord(older) ? older : {}) }
  for (const [k, v] of Object.entries(isRecord(newer) ? newer : {})) out[k] = k in out ? mergeEntry(out[k], v) : v
  return out
}

/** Waky: every morning, night and opened chest from both (field by field); settings from the newer. */
export function mergeWaky(mine: any, theirs: any, mineIsNewer: boolean): any {
  const newer = mineIsNewer ? mine : theirs
  const older = mineIsNewer ? theirs : mine
  return {
    ...older,
    ...newer,
    days: mergeEntries(older?.days, newer?.days),
    nights: mergeEntries(older?.nights, newer?.nights),
    opened: mergeEntries(older?.opened, newer?.opened),
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
  label: 'Waky',
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
  label: 'MAN',
  setting: 'app_sync_man',
  legacySetting: 'man_spartan_data',
  event: 'life-man-changed',
  merge: mergeMan,
  lists: [
    { path: 'diary', key: (d) => String(d?.id ?? JSON.stringify(d)) },
    { path: 'customRewards', key: (r) => String(r?.id ?? JSON.stringify(r)) }
  ]
}
