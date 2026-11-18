// Data center: everything measured on this device, in one place (2026-11-18).
// The pure rules (meters, forecast, clean-up plans) are core/dataCenter.ts;
// this reads the real places: localStorage, the browser's storage estimate,
// this device's copy of the database, Money's change history (IndexedDB), the
// app caches, and on the desktop the database file and the backup folder.
// Reads only: nothing here changes data (the daily size sample is the one write).
import { calendarDay } from '@core/dates'
import {
  CLOUD_BYTES,
  HISTORY_ENTRIES,
  REQUEST_CAP,
  SYNC_RED,
  SYNC_WARN,
  dataWarnings,
  forecast,
  localMeter,
  localUsage,
  meter,
  moneyRecords,
  prunableTombstones,
  recordRate,
  sizeLabel,
  sampleRate,
  storageEntries,
  syncMeter,
  partsMeter,
  utf8Bytes,
  addSample,
  type DeviceSeen,
  type Forecast,
  type KeySize,
  type Meter,
  type Sample
} from '@core/dataCenter'
import type { DataDeviceSeen, DataUsage } from '@shared/api'
import { life } from '../bridge'
import { hostStore } from '../web/bigStore'

/** The apps that keep their own data on the device and sync it as one copy. */
export const DATA_APPS = [
  { setting: 'app_sync_finance', sealed: 'app_sync_finance_sealed', label: 'Money', localKey: 'finance-helper.state', file: 'money' },
  { setting: 'sport_tracker_json', sealed: null, label: 'Sport Track', localKey: 'life_sport_tracker_v1', file: 'sport-track' },
  { setting: 'app_sync_waky', sealed: null, label: 'Waky', localKey: 'waky_web_data_v2', file: 'waky' },
  { setting: 'app_sync_man', sealed: null, label: 'MAN', localKey: 'MAN_SPARTAN_DATA', file: 'man' }
] as const

export interface HistoryInfo {
  entries: number
  bytes: number
  /** Money is locked with its PIN: the history is sealed and can't be read here. */
  sealed: boolean
  oldest: number | null
}
export interface CacheInfo {
  name: string
  entries: number
  bytes: number
}
export interface BeforeRestore {
  key: string
  label: string
  chars: number
  at: string | null
}

export interface Gathered {
  at: number
  meters: Meter[]
  warnings: Meter[]
  forecasts: Forecast[]
  local: { chars: number; keys: KeySize[] }
  db: DataUsage | null
  history: HistoryInfo | null
  caches: CacheInfo[]
  desktop: { dbBytes: number | null; dbFile: string | null; backupsBytes: number; backupFiles: number; backupDir: string | null } | null
  cloud: { backupsBytes: number; days: number; newestAt: string | null } | null
  beforeRestore: BeforeRestore[]
  tombstones: { count: number; old: number; bytes: number; plan: ReturnType<typeof prunableTombstones> }
  devices: DataDeviceSeen[]
}

const store = (): Storage | null => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}
const parse = <T,>(raw: string | null | undefined): T | null => {
  try {
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

// ---------- Money's change history (IndexedDB, device only) ----------

const H_DB = 'finance-helper-changes'
const H_STORE = 'kv'
const H_KEY = 'log'
function historyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(H_DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(H_STORE)
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error ?? new Error('Browser storage is not available'))
  })
}
export async function readHistoryRaw(): Promise<unknown> {
  if (typeof indexedDB === 'undefined') return null
  const db = await historyDb()
  return new Promise((resolve, reject) => {
    const r = db.transaction(H_STORE, 'readonly').objectStore(H_STORE).get(H_KEY)
    r.onsuccess = () => resolve(r.result ?? null)
    r.onerror = () => reject(r.error)
  }).finally(() => db.close())
}
export async function writeHistoryRaw(value: unknown): Promise<void> {
  const db = await historyDb()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(H_STORE, 'readwrite')
    tx.objectStore(H_STORE).put(value, H_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  }).finally(() => db.close())
}
/** The history as a list (it is stored as JSON text or as a list); null when it is sealed with the Money PIN. */
export function historyList(raw: unknown): { at?: number }[] | null {
  const v = typeof raw === 'string' ? parse<unknown>(raw) : raw
  return Array.isArray(v) ? (v as { at?: number }[]) : v == null ? [] : null
}
async function historyInfo(): Promise<HistoryInfo | null> {
  try {
    const raw = await readHistoryRaw()
    const list = historyList(raw)
    const bytes = raw == null ? 0 : utf8Bytes(typeof raw === 'string' ? raw : JSON.stringify(raw))
    if (!list) return { entries: 0, bytes, sealed: true, oldest: null }
    const times = list.map((e) => Number(e?.at)).filter((n) => n > 0)
    return { entries: list.length, bytes, sealed: false, oldest: times.length ? Math.min(...times) : null }
  } catch {
    return null
  }
}

// ---------- app caches (files the app can download again) ----------

/** Voice models are big downloads you chose: never cleared from here. */
export const keepCache = (name: string) => /voice-models/i.test(name)
export async function cacheList(): Promise<CacheInfo[]> {
  if (typeof caches === 'undefined') return []
  const out: CacheInfo[] = []
  try {
    for (const name of await caches.keys()) {
      const c = await caches.open(name)
      const reqs = await c.keys()
      let bytes = 0
      for (const req of reqs.slice(0, 400)) {
        const res = await c.match(req)
        if (!res) continue
        const len = Number(res.headers.get('content-length'))
        bytes += len > 0 ? len : (await res.clone().blob()).size
      }
      out.push({ name, entries: reqs.length, bytes })
    }
  } catch {
    /* caches are not available here (private window) */
  }
  return out.sort((a, b) => b.bytes - a.bytes)
}

// ---------- samples (the trend gets better with time) ----------

const LOCAL_SAMPLES = 'life_data_samples'
export const localSamples = (): Sample[] => parse<Sample[]>(store()?.getItem(LOCAL_SAMPLES)) ?? []
function saveLocalSample(s: Sample): Sample[] {
  const next = addSample(localSamples(), s)
  try {
    store()?.setItem(LOCAL_SAMPLES, JSON.stringify(next))
  } catch {
    /* storage full: the trend just has one day less */
  }
  return next
}

const DEVICE_ID = 'life_data_device_id'
function deviceId(): string {
  const s = store()
  let id = s?.getItem(DEVICE_ID)
  if (!id) {
    id = `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    try {
      s?.setItem(DEVICE_ID, id)
    } catch {
      /* this visit only */
    }
  }
  return id
}
const deviceName = () => (typeof window !== 'undefined' && window.desktop ? 'Desktop app' : /Mobi|Android|iPhone/i.test(navigator.userAgent) ? 'Phone browser' : 'Web browser')

// ---------- the meters ----------

const settingOf = (db: DataUsage | null, key: string) => db?.settings.find((s) => s.key === key) ?? null

/** The meters that can be read quickly (localStorage and the database copy): what the dot and the notification use. */
export function quickMeters(local: { chars: number }, db: DataUsage | null): Meter[] {
  const out: Meter[] = []
  for (const a of DATA_APPS) {
    const plain = settingOf(db, a.setting)
    const sealed = a.sealed ? settingOf(db, a.sealed) : null
    const bytes = Math.max(plain?.requestBytes ?? 0, sealed?.requestBytes ?? 0)
    out.push(partsMeter(`sync:${a.setting}`, `${a.label}: synced copy`, bytes, sealed && sealed.requestBytes > (plain?.requestBytes ?? 0) ? 'Locked with the Money PIN (the sealed copy is the bigger one).' : undefined))
  }
  if (db)
    out.push(
      meter({
        id: 'settings',
        label: 'Biggest other setting',
        where: 'Cloud database: one setting that is not an app copy must fit one request (they are fetched in groups, by size)',
        used: db.settings.filter((s) => !/^app_sync_/.test(s.key)).reduce((n, s) => Math.max(n, s.requestBytes), 0),
        limit: REQUEST_CAP,
        warnAt: SYNC_WARN,
        redAt: SYNC_RED
      })
    )
  out.push(localMeter(local.chars))
  return out
}

export async function readDb(): Promise<DataUsage | null> {
  try {
    return (await life.data.usage?.()) ?? null
  } catch {
    return null
  }
}

export const readLocal = () => {
  const s = store()
  return s ? localUsage(storageEntries(s)) : { chars: 0, keys: [] }
}

/** Quick check for the dot and the notification: the meters past their warning level. */
export async function quickWarnings(): Promise<Meter[]> {
  return dataWarnings(quickMeters(readLocal(), await readDb()))
}

const ratio = (s: { bytes: number; requestBytes: number } | null) => (s && s.bytes > 0 ? s.requestBytes / s.bytes : 1.15)

/** Everything, for the page. `sample`: also save today's size sample (once a day). */
export async function gather(sample = true): Promise<Gathered> {
  const now = Date.now()
  const today = calendarDay(new Date(now))
  const desk = typeof window !== 'undefined' ? window.desktop : undefined
  const local = readLocal()
  const [db, history, cacheInfo, estimate, backup, dbFile, cloudDays, seen] = await Promise.all([
    readDb(),
    historyInfo(),
    cacheList(),
    (typeof navigator !== 'undefined' && navigator.storage?.estimate ? navigator.storage.estimate() : Promise.resolve(null)).catch(() => null),
    desk?.backupStatus ? desk.backupStatus().catch(() => null) : Promise.resolve(null),
    desk?.dataUsage ? desk.dataUsage().catch(() => null) : Promise.resolve(null),
    life.data.cloudSnapshots ? life.data.cloudSnapshots().catch(() => []) : Promise.resolve([]),
    life.data.devicesSeen ? life.data.devicesSeen().catch(() => []) : Promise.resolve([])
  ])

  const meters = quickMeters(local, db)
  // The sync's own copies (each app's last agreed copy, a copy from before a restore) live in IndexedDB.
  const bigStore = hostStore()
  await bigStore?.ready.catch(() => {})
  const big = bigStore?.status() ?? null
  const inIdb = (big?.keys ?? []).filter((k) => k.where === 'indexeddb')
  if (big)
    meters.push(
      meter({
        id: 'synccopies',
        label: 'Sync copies on this device',
        where: big.mode === 'indexeddb' ? 'This device (IndexedDB): each app\'s last synced copy, kept out of the small app storage' : 'This device: IndexedDB is not available here, so they stay in the app storage above',
        used: inIdb.reduce((n, k) => n + k.chars, 0),
        limit: null,
        warnAt: null,
        redAt: null,
        unit: 'chars',
        note: big.error ?? undefined
      })
    )
  if (estimate?.quota) meters.push(meter({ id: 'browser', label: 'Browser storage for this app', where: 'This device: IndexedDB, caches and the offline copy of the database', used: estimate.usage ?? 0, limit: estimate.quota, warnAt: estimate.quota * 0.7, redAt: estimate.quota * 0.9 }))
  if (history) meters.push(meter({ id: 'history', label: 'Money change history', where: 'This device only (IndexedDB), 90 days kept', used: history.entries, limit: HISTORY_ENTRIES, warnAt: null, redAt: null, unit: 'entries', note: history.sealed ? 'Locked with the Money PIN: its size is known, its entries are not.' : `${sizeLabel(history.bytes)}. The oldest entries drop off by themselves at the limit.` }))
  const lifeBytes = db ? db.tables.filter((t) => t.name !== 'settings').reduce((n, t) => n + t.bytes, 0) : 0
  if (db) meters.push(meter({ id: 'life', label: 'Life tables', where: 'Cloud database and this device: points, plans, sleep, habits, logs', used: lifeBytes, limit: null, warnAt: null, redAt: null, note: `${db.tables.reduce((n, t) => n + t.rows, 0).toLocaleString('en-US')} rows in ${db.tables.length} tables. Fetched in pages, so no single-request limit.` }))
  const backupFiles = backup ? [...backup.local.files] : []
  const desktop = desk?.backupStatus || desk?.dataUsage ? { dbBytes: dbFile?.dbBytes ?? null, dbFile: dbFile?.dbFile ?? null, backupsBytes: backupFiles.reduce((n, f) => n + (f.size ?? 0), 0), backupFiles: backupFiles.length, backupDir: backup?.local.dir ?? null } : null
  if (desktop?.dbBytes != null) meters.push(meter({ id: 'dbfile', label: 'Database file on this PC', where: desktop.dbFile ?? 'This PC', used: desktop.dbBytes, limit: null, warnAt: null, redAt: null }))
  if (desktop && backup) meters.push(meter({ id: 'backups', label: 'Backup folder on this PC', where: desktop.backupDir ?? 'This PC', used: desktop.backupsBytes, limit: null, warnAt: null, redAt: null, note: `${desktop.backupFiles} files (14 daily, 8 weekly, 12 monthly and 30 "before" copies are kept; older ones go by themselves).` }))
  const cloudBackups = cloudDays.reduce((n, c) => n + (c.sizeBytes || 0), 0)
  const cloud = db ? { backupsBytes: cloudBackups, days: cloudDays.length, newestAt: cloudDays[0]?.exportedAt ?? null } : null
  if (db) {
    const used = lifeBytes + db.settings.reduce((n, s) => n + s.bytes, 0) + cloudBackups
    meters.push(meter({ id: 'cloud', label: 'Cloud database', where: 'Turso: your data and the last 30 daily backups', used, limit: CLOUD_BYTES, warnAt: CLOUD_BYTES * 0.6, redAt: CLOUD_BYTES * 0.8, note: 'An estimate from this device\'s copy plus the cloud backups; the limit assumes Turso\'s free plan (5 GB). Row reads are not measured here.' }))
  }

  // Today's sample (once a day): the synced sizes go to a small synced setting, this device's to its own storage.
  const sizes: Record<string, number> = {}
  for (const m of meters) if (m.id.startsWith('sync:') || m.id === 'settings' || m.id === 'life' || m.id === 'cloud') sizes[m.id] = Math.round(m.used)
  let synced: Sample[] = []
  if (db && life.data.sizeSamples) synced = await life.data.sizeSamples(sample ? { day: today, sizes } : undefined).catch(() => [])
  const mine = sample ? saveLocalSample({ day: today, sizes: { local: local.chars } }) : localSamples()

  // This device in the list of devices (once a day), for the deletion marks.
  let devices = seen
  const s = store()
  if (sample && life.data.devicesSeen && db && s?.getItem('life_data_seen_day') !== today) {
    const apps: Record<string, number | null> = {}
    for (const a of DATA_APPS) apps[a.setting] = parse<{ okAt?: number | null }>(s?.getItem(`life_sync_${a.setting}_status`))?.okAt ?? null
    devices = await life.data.devicesSeen({ id: deviceId(), name: deviceName(), at: now, apps }).catch(() => seen)
    try {
      s?.setItem('life_data_seen_day', today)
    } catch {
      /* asked again next time */
    }
  }

  // Growth: Money from its records' own dates (most of what grows), everything from the daily samples.
  const money = parse<Record<string, unknown>>(s?.getItem('finance-helper.state'))
  const recs = money ? moneyRecords(money) : []
  const r90 = recs.length ? recordRate(recs, now, 90) : null
  const r365 = recs.length ? recordRate(recs, now, 365) : null
  const k = ratio(settingOf(db, 'app_sync_finance'))
  const forecasts: Forecast[] = []
  for (const m of meters) {
    if (m.limit == null || m.id === 'history' || m.id === 'browser') continue
    const fromSamples = { perDay: sampleRate(m.id === 'local' ? mine : synced, m.id, today), from: 'The daily size samples this page has taken (up to the last 180 days).' }
    const rates: { perDay: number | null; from: string }[] = [fromSamples]
    if (m.id === 'sync:app_sync_finance' || m.id === 'settings' || m.id === 'cloud') {
      rates.push({ perDay: r90 == null ? null : r90 * k, from: 'The size of the Money records you added in the last 90 days.' }, { perDay: r365 == null ? null : r365 * k, from: 'The size of the Money records you added in the last 12 months.' })
    }
    // This device keeps Money twice (your records and the last synced copy), so it fills twice as fast.
    if (m.id === 'local' && s?.getItem('life_sync_app_sync_finance') != null) rates.push({ perDay: r90 == null ? null : r90 * 2, from: 'Twice the Money records of the last 90 days: this device keeps Money and its last synced copy.' }, { perDay: r365 == null ? null : r365 * 2, from: 'Twice the Money records of the last 12 months: this device keeps Money and its last synced copy.' })
    forecasts.push(forecast(m, rates, now))
  }

  const beforeRestore: BeforeRestore[] = [...local.keys, ...inIdb.map((k) => ({ key: k.key, chars: k.key.length + k.chars }))]
    .filter((x) => x.key.endsWith('_before_restore'))
    .map((x) => ({ key: x.key, label: DATA_APPS.find((a) => x.key === `life_sync_${a.setting}_before_restore`)?.label ?? x.key, chars: x.chars, at: parse<{ at?: string }>((bigStore ?? s)?.getItem(x.key))?.at ?? null }))

  const deleted = (money?.deleted ?? null) as Record<string, number> | null
  const seenList: DeviceSeen[] = devices.map((d) => ({ id: d.id, name: d.name, syncedAt: d.apps?.app_sync_finance ?? null }))
  const plan = prunableTombstones(deleted, seenList, now)
  const all = Object.entries(deleted ?? {})
  const tombstones = { count: all.length, old: all.filter(([, ts]) => Number(ts) < now - 90 * 86_400_000).length, bytes: deleted ? utf8Bytes(JSON.stringify(deleted)) : 0, plan }

  return { at: now, meters, warnings: dataWarnings(meters), forecasts, local, db, history, caches: cacheInfo, desktop, cloud, beforeRestore, tombstones, devices }
}
