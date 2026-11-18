// Data center (2026-11-18): how much room every copy of your data takes, how
// long that room lasts at your pace, and what may be cleaned up safely.
// Pure and tested (dataCenter.test.ts): sizes, meters, the growth forecast,
// the daily size samples, and the two clean-up plans that must never lose data
// (change history by age, deletion marks only when every device has seen them).

export type Level = 'ok' | 'warn' | 'red'

/** A server request or answer may be at most this big (Vercel). One ordinary setting must fit in one. */
export const REQUEST_CAP = 4_500_000
/**
 * An app's synced copy travels in pieces (core/settingParts.ts), so one request no longer limits it.
 * This is the size it is tested at (about 200,000 Money records); past it nothing breaks at once,
 * but saving and comparing get slow.
 */
export const PARTS_LIMIT = 48_000_000
export const PARTS_WARN = 24_000_000
export const PARTS_RED = 36_000_000
export const SYNC_WARN = 2_500_000
export const SYNC_RED = 3_500_000
/** What a browser (and the desktop app's window) lets one site keep in localStorage: about 5 million characters. */
export const LOCAL_CHARS = 5_000_000
export const LOCAL_WARN = 0.6
export const LOCAL_RED = 0.8
/** Money keeps at most this many change-history entries per device (apps/finance/js/changelog.js). */
export const HISTORY_ENTRIES = 2000
export const HISTORY_DAYS = 90
/** Turso's free plan: 5 GB of storage (the assumption shown next to the cloud bar). */
export const CLOUD_BYTES = 5_000_000_000
export const DAY_MS = 86_400_000

const enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null
/** UTF-8 bytes of a text. */
export const utf8Bytes = (s: string): number => (enc ? enc.encode(s).length : s.length)
/**
 * Bytes of a setting's value as it travels in a request: the value is JSON
 * text sent as a JSON string, so every quote and backslash in it doubles.
 */
export const requestBytes = (value: string): number => utf8Bytes(JSON.stringify(value))

export const sizeLabel = (b: number | null | undefined): string => {
  if (b == null || !Number.isFinite(b)) return 'unknown'
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`
  if (b >= 1e3) return `${Math.round(b / 1e3)} KB`
  return `${Math.max(0, Math.round(b))} bytes`
}

// ---------- meters ----------

export interface Meter {
  id: string
  /** "Money: synced copy". */
  label: string
  /** Where it lives, in a few words. */
  where: string
  used: number
  /** Null: no hard limit (only the size is shown). */
  limit: number | null
  warnAt: number | null
  redAt: number | null
  level: Level
  /** 'chars' for localStorage (counted in characters), else bytes. */
  unit?: 'bytes' | 'chars' | 'entries'
  note?: string
}

export const levelOf = (used: number, warnAt: number | null, redAt: number | null): Level => (redAt != null && used >= redAt ? 'red' : warnAt != null && used >= warnAt ? 'warn' : 'ok')

export function meter(m: Omit<Meter, 'level'>): Meter {
  return { ...m, level: levelOf(m.used, m.warnAt, m.redAt) }
}

/** An app's synced copy, sent in pieces: against the size it is tested at (48 MB; warn at 24 MB, red at 36 MB). */
export const partsMeter = (id: string, label: string, bytes: number, note?: string): Meter =>
  meter({ id, label, where: 'Cloud database, sent and fetched in pieces (only what changed)', used: bytes, limit: PARTS_LIMIT, warnAt: PARTS_WARN, redAt: PARTS_RED, note })

/** One value against the 4.5 MB one request may carry (warn at 2.5 MB, red at 3.5 MB). */
export const syncMeter = (id: string, label: string, bytes: number, note?: string): Meter =>
  meter({ id, label, where: 'Cloud database, sent and fetched in one request', used: bytes, limit: REQUEST_CAP, warnAt: SYNC_WARN, redAt: SYNC_RED, note })

/** This device's localStorage (all apps share about 5 million characters). */
export const localMeter = (chars: number, limit = LOCAL_CHARS): Meter =>
  meter({ id: 'local', label: 'App storage on this device', where: 'This device (localStorage): every app keeps its data here', used: chars, limit, warnAt: Math.round(limit * LOCAL_WARN), redAt: Math.round(limit * LOCAL_RED), unit: 'chars' })

export const usedText = (m: Meter): string => {
  const one = (n: number) => (m.unit === 'entries' ? n.toLocaleString('en-US') : m.unit === 'chars' ? `${(n / 1e6).toFixed(n >= 1e5 ? 1 : 2)} M characters` : sizeLabel(n))
  return m.limit == null ? one(m.used) : `${one(m.used)} of ${one(m.limit)}`
}
export const pctOf = (m: Meter): number => (m.limit ? Math.min(100, Math.round((m.used / m.limit) * 100)) : 0)

/** The meters that need a look, worst first. */
export function dataWarnings(meters: Meter[]): Meter[] {
  const rank = { red: 0, warn: 1, ok: 2 }
  return meters.filter((m) => m.level !== 'ok').sort((a, b) => rank[a.level] - rank[b.level] || pctOf(b) - pctOf(a))
}

/** One plain line for a notification or the dot's tooltip. */
export function warningLine(m: Meter): string {
  return `${m.label} is at ${usedText(m)}${m.limit ? ` (${pctOf(m)}%)` : ''}`
}

/**
 * The one notification of the day about your data (the 'backup' slot of the 4-a-day budget):
 * a red backup light first, else the fullest store past its warning level. Null: nothing to say.
 */
export function dataNotice(backupRed: string[], warnings: Meter[]): { title: string; body: string } | null {
  if (backupRed.length) return { title: 'Life System: a backup needs a look', body: `${backupRed.join(', ')}. Open the Data center.` }
  const w = dataWarnings(warnings)[0]
  if (!w) return null
  return { title: w.level === 'red' ? 'Life System: your data is nearly out of room' : 'Life System: your data is filling up', body: `${warningLine(w)}. Open the Data center.` }
}

// ---------- localStorage by key ----------

export interface KeySize {
  key: string
  label: string
  chars: number
}

const KEY_LABELS: [RegExp, string][] = [
  [/^finance-helper\.state$/, 'Money: your records'],
  [/^finance-helper\.enc$/, 'Money: locked copy'],
  [/^life_sync_app_sync_finance$/, 'Money: last synced copy'],
  [/^life_sport_tracker_v1$/, 'Sport Track: your data'],
  [/^life_sync_sport_tracker_json$/, 'Sport Track: last synced copy'],
  [/^waky_web_data_v2$/, 'Waky: your data'],
  [/^life_sync_app_sync_waky$/, 'Waky: last synced copy'],
  [/^MAN_SPARTAN_DATA$/, 'MAN: your data'],
  [/^life_sync_app_sync_man$/, 'MAN: last synced copy'],
  [/_before_restore$/, 'Copy from before a restore'],
  [/^life_offline_writes/, 'Changes waiting to be sent'],
  [/^life_sync_history$/, 'Sync history'],
  [/^finance-helper\./, 'Money: settings on this device']
]
export const keyLabel = (key: string): string => KEY_LABELS.find(([re]) => re.test(key))?.[1] ?? key

/** Every localStorage key with its size in characters (key + value), biggest first. */
export function localUsage(entries: Iterable<[string, string]>): { chars: number; keys: KeySize[] } {
  const keys: KeySize[] = []
  let chars = 0
  for (const [key, value] of entries) {
    const n = key.length + (value?.length ?? 0)
    chars += n
    keys.push({ key, label: keyLabel(key), chars: n })
  }
  keys.sort((a, b) => b.chars - a.chars)
  return { chars, keys }
}

/** The entries of a Storage (localStorage) as [key, value]. */
export function storageEntries(store: Pick<Storage, 'length' | 'key' | 'getItem'>): [string, string][] {
  const out: [string, string][] = []
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i)
    if (k != null) out.push([k, store.getItem(k) ?? ''])
  }
  return out
}

// ---------- growth and "how long is it enough" ----------

export interface Dated {
  /** When the record was made (ms). */
  at: number
  bytes: number
}

/**
 * Money's records with the time each was made and its size as stored. Reads
 * only: lists of records with an id (transactions, people, goals…).
 */
export function moneyRecords(state: unknown): Dated[] {
  const s = (state ?? {}) as Record<string, unknown>
  const out: Dated[] = []
  for (const list of ['tx', 'recurring', 'invoices', 'netWorth', 'goals', 'goalAllocations', 'reconciliations', 'people']) {
    const rows = s[list]
    if (!Array.isArray(rows)) continue
    for (const r of rows) {
      if (!r || typeof r !== 'object') continue
      const x = r as Record<string, unknown>
      const at = Number(x.createdAt) || Date.parse(String(x.date ?? '')) || Number(x.updatedAt) || 0
      if (at > 0) out.push({ at, bytes: utf8Bytes(JSON.stringify(r)) + 1 })
    }
  }
  return out
}

/** Bytes added per day by records made in the last `days` days. */
export function recordRate(records: Dated[], now: number, days: number): number {
  const first = records.reduce((m, r) => Math.min(m, r.at), Infinity)
  if (!Number.isFinite(first)) return 0
  // A history shorter than the window: divide by the days there really are (at least a week), not by the window.
  const span = Math.max(7, Math.min(days, (now - first) / DAY_MS))
  const from = now - span * DAY_MS
  const sum = records.reduce((n, r) => (r.at >= from && r.at <= now ? n + r.bytes : n), 0)
  return sum / span
}

export interface Sample {
  /** YYYY-MM-DD. */
  day: string
  /** Size of each thing that day (bytes, or characters for localStorage). */
  sizes: Record<string, number>
}

/** Daily samples kept: every day for the last 60, then the first of each month, at most 3 years. */
export function addSample(history: Sample[], s: Sample): Sample[] {
  const byDay = new Map(history.filter((x) => x && typeof x.day === 'string' && x.sizes).map((x) => [x.day, x]))
  byDay.set(s.day, { day: s.day, sizes: { ...(byDay.get(s.day)?.sizes ?? {}), ...s.sizes } })
  const all = [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1))
  const cut = new Date(Date.parse(s.day + 'T00:00:00Z') - 60 * DAY_MS).toISOString().slice(0, 10)
  const oldest = new Date(Date.parse(s.day + 'T00:00:00Z') - 3 * 366 * DAY_MS).toISOString().slice(0, 10)
  const months = new Set<string>()
  return all.filter((x) => {
    if (x.day >= cut) return true
    if (x.day < oldest) return false
    const m = x.day.slice(0, 7)
    if (months.has(m)) return false
    months.add(m)
    return true
  })
}

/**
 * Growth per day of one size from the daily samples: from the oldest sample
 * inside `days` to the newest. Null with less than 14 days between them (too
 * little to say anything).
 */
export function sampleRate(history: Sample[], id: string, today: string, days = 180): number | null {
  const from = new Date(Date.parse(today + 'T00:00:00Z') - days * DAY_MS).toISOString().slice(0, 10)
  const pts = history.filter((x) => x.day >= from && x.day <= today && typeof x.sizes?.[id] === 'number').sort((a, b) => (a.day < b.day ? -1 : 1))
  if (pts.length < 2) return null
  const a = pts[0]
  const b = pts[pts.length - 1]
  const span = (Date.parse(b.day) - Date.parse(a.day)) / DAY_MS
  if (span < 14) return null
  return (b.sizes[id] - a.sizes[id]) / span
}

export interface Forecast {
  id: string
  label: string
  /** Growth per day used for the estimate (the fastest of what is known). */
  perDay: number
  /** Days until the limit; null: not growing, or no limit in sight (over 30 years). */
  days: number | null
  /** The month it is reached ("Mar 2029"). */
  when: string | null
  text: string
  /** What the estimate rests on, in plain words. */
  assumption: string
  level: Level
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "about 2 years 4 months", rounded down (an estimate should not promise more time than there is). */
export function spanText(days: number): string {
  if (days < 1) return 'less than a day'
  if (days < 14) return `about ${Math.floor(days)} day${Math.floor(days) === 1 ? '' : 's'}`
  if (days < 60) return `about ${Math.floor(days / 7)} weeks`
  const months = Math.floor(days / 30.44)
  if (months < 12) return `about ${months} months`
  const y = Math.floor(months / 12)
  const m = months % 12
  return `about ${y} year${y === 1 ? '' : 's'}${m ? ` ${m} month${m === 1 ? '' : 's'}` : ''}`
}

const rateText = (perDay: number, unit: Meter['unit']): string => {
  const perMonth = perDay * 30.44
  return unit === 'chars' ? `${Math.round(perMonth).toLocaleString('en-US')} characters a month` : `${sizeLabel(perMonth)} a month`
}

/**
 * When a meter reaches its limit at the given pace. `rates`: every growth
 * estimate there is (records of the last 90 days, of the last year, the daily
 * samples), with what each rests on; the FASTEST is used, so the date is the
 * earliest of them (conservative). The limit used is the hard one.
 */
export function forecast(m: Meter, rates: { perDay: number | null; from: string }[], now: number): Forecast {
  const known = rates.filter((r): r is { perDay: number; from: string } => r.perDay != null && Number.isFinite(r.perDay))
  const base = { id: m.id, label: m.label, level: m.level }
  if (m.limit == null) return { ...base, perDay: 0, days: null, when: null, text: `${m.label}: no fixed limit.`, assumption: '' }
  if (!known.length) return { ...base, perDay: 0, days: null, when: null, text: `${m.label}: not enough history yet. This page takes one size sample a day; come back in two weeks.`, assumption: 'No growth numbers yet.' }
  const best = known.reduce((a, b) => (b.perDay > a.perDay ? b : a))
  const left = m.limit - m.used
  if (left <= 0) return { ...base, perDay: best.perDay, days: 0, when: null, text: `${m.label} is at its limit now (${usedText(m)}).`, assumption: best.from, level: 'red' }
  if (best.perDay <= 0) return { ...base, perDay: best.perDay, days: null, when: null, text: `${m.label} is not growing: no limit in sight.`, assumption: best.from }
  const days = left / best.perDay
  if (days > 30 * 365.25) return { ...base, perDay: best.perDay, days: null, when: null, text: `${m.label}: enough for more than 30 years at your pace (${rateText(best.perDay, m.unit)}).`, assumption: best.from }
  const d = new Date(now + days * DAY_MS)
  const when = `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
  const level: Level = days < 90 ? 'red' : days < 365 ? 'warn' : m.level
  return { ...base, perDay: best.perDay, days, when, text: `At your pace (${rateText(best.perDay, m.unit)}), ${m.label} reaches its limit in ${spanText(days)} (${when}).`, assumption: best.from, level }
}

/** The forecast that runs out first (for the overview number); null when none has a date. */
export const soonest = (list: Forecast[]): Forecast | null => list.filter((f) => f.days != null).sort((a, b) => a.days! - b.days!)[0] ?? null

// ---------- clean-up plans (never lose data) ----------

/** Change-history entries older than `days`: what goes and what stays. Entries without a time are kept. */
export function historyPrunePlan<T extends { at?: number | string }>(entries: T[], days: number, now: number): { keep: T[]; drop: T[]; freed: number } {
  const cut = now - Math.max(1, days) * DAY_MS
  const keep: T[] = []
  const drop: T[] = []
  for (const e of entries) {
    const at = typeof e?.at === 'number' ? e.at : Date.parse(String(e?.at ?? ''))
    if (Number.isFinite(at) && at < cut) drop.push(e)
    else keep.push(e)
  }
  return { keep, drop, freed: drop.length ? utf8Bytes(JSON.stringify(drop)) : 0 }
}

export interface DeviceSeen {
  id: string
  name?: string
  /** When this device last had the server confirm its copy of the app (ms); null: never, or unknown. */
  syncedAt: number | null
}

/**
 * Deletion marks ("tombstones": id → when deleted) that may be dropped: only
 * ones older than `days` AND that every known device has synced after. A mark
 * a device has not seen must stay, or that device would bring the deleted
 * record back. With no device list, or a device that never confirmed a sync,
 * nothing is dropped.
 */
export function prunableTombstones(deleted: Record<string, number> | null | undefined, devices: DeviceSeen[], now: number, days = 90): { drop: string[]; keep: number; reason: string } {
  const all = Object.entries(deleted ?? {})
  const old = all.filter(([, ts]) => Number(ts) > 0 && Number(ts) < now - days * DAY_MS)
  if (!old.length) return { drop: [], keep: all.length, reason: `No deletion marks older than ${days} days.` }
  if (!devices.length) return { drop: [], keep: all.length, reason: 'Kept: there is no list of your devices yet, so nothing proves they have all seen these.' }
  const unsure = devices.filter((d) => d.syncedAt == null || !Number.isFinite(d.syncedAt))
  if (unsure.length) return { drop: [], keep: all.length, reason: `Kept: ${unsure.map((d) => d.name || d.id).join(', ')} has not confirmed a sync yet.` }
  const allSeenAt = Math.min(...devices.map((d) => d.syncedAt as number))
  const drop = old.filter(([, ts]) => Number(ts) < allSeenAt).map(([id]) => id)
  const behind = old.length - drop.length
  return { drop, keep: all.length - drop.length, reason: behind ? `${behind} kept: not every device has synced since they were deleted.` : 'Every device has synced since these were deleted.' }
}

// ---------- the overview ----------

/** "2 h ago", "3 min ago", "just now". */
export function agoText(ms: number | null | undefined, now: number): string {
  if (ms == null || !Number.isFinite(ms)) return 'never'
  const min = Math.max(0, (now - ms) / 60_000)
  if (min < 1.5) return 'just now'
  if (min < 90) return `${Math.round(min)} min ago`
  if (min < 48 * 60) return `${Math.round(min / 60)} h ago`
  return `${Math.round(min / 1440)} days ago`
}

export interface OverviewInput {
  now: number
  /** A backup light is red (Data safety). */
  backupRed: string[]
  lastBackupAt: number | null
  syncedAt: number | null
  /** The sync has an error or a copy waiting. */
  syncTrouble: string | null
  warnings: Meter[]
}

/** The health line at the top: "All safe · last backup 2 h ago · synced 3 min ago". */
export function overviewLine(i: OverviewInput): { level: Level; text: string } {
  const tail = `last backup ${agoText(i.lastBackupAt, i.now)} · synced ${agoText(i.syncedAt, i.now)}`
  const red = i.warnings.filter((m) => m.level === 'red')
  if (i.backupRed.length) return { level: 'red', text: `Needs a look: ${i.backupRed.join(', ')} · ${tail}` }
  if (red.length) return { level: 'red', text: `Nearly full: ${red.map((m) => m.label).join(', ')} · ${tail}` }
  if (i.syncTrouble) return { level: 'warn', text: `Sync needs a look: ${i.syncTrouble} · ${tail}` }
  if (i.warnings.length) return { level: 'warn', text: `Filling up: ${i.warnings.map((m) => m.label).join(', ')} · ${tail}` }
  return { level: 'ok', text: `All safe · ${tail}` }
}
