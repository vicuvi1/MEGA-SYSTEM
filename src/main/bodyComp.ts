// Body composition on any database with the better-sqlite3 API (the web
// app's copy, the desktop app's, the bot server's). One row per weigh-in in
// body_comp; every write also keeps body_metrics (weight, waist) filled for
// that day, so the weight trend, protein goal, food goals and Telegram keep
// working unchanged. Pure rules: src/core/bodyComp.ts. Pays no points.
import type { DB } from './db'
import { readSetting, writeSetting } from './settings'
import { addDays } from '../core/dates'
import { sportToday } from '../core/sportShared'
import { kcalOfDay } from '../core/food'
import { REMINDERS, type Reminder } from '../core/coachKit'
import { bodyEvents } from './bodyLog'
import { COMP_FIELDS, WAIST_REMINDER_TEXT, cleanMeasurement, compView, firstMorning, latestWaist, metricsFor, monthComp, waistReminder, type CompInput, type CompRow, type CompSource, type CompView, type MonthComp } from '../core/bodyComp'

const COLS = ['id', 'at', 'day', 'weight_kg', ...COMP_FIELDS, 'source', 'raw', 'dedupe', 'updated_at'] as const

type MetricRow = { weight: number | null; waist: number | null; note: string | null } | null

function toRow(r: any): CompRow {
  const out: any = { id: String(r.id), at: String(r.at), day: String(r.day), weight_kg: Number(r.weight_kg), source: String(r.source ?? 'manual'), raw: r.raw == null ? null : String(r.raw), dedupe: String(r.dedupe), updated_at: String(r.updated_at) }
  for (const k of COMP_FIELDS) out[k] = r[k] == null ? null : Number(r[k])
  return out as CompRow
}

/** Weigh-ins from a day to a day (inclusive), oldest first. */
export function listBodyComp(db: DB, from = '0000-00-00', to = '9999-99-99'): CompRow[] {
  try {
    return (db.prepare(`SELECT ${COLS.join(', ')} FROM body_comp WHERE day >= ? AND day <= ? ORDER BY at, id`).all(from, to) as any[]).map(toRow)
  } catch {
    return []
  }
}

/** The newest weigh-in (null when none). */
export function latestBodyComp(db: DB): CompRow | null {
  try {
    const r = db.prepare(`SELECT ${COLS.join(', ')} FROM body_comp ORDER BY at DESC, id DESC LIMIT 1`).get()
    return r ? toRow(r) : null
  } catch {
    return null
  }
}

const metricOf = (db: DB, day: string): MetricRow => (db.prepare('SELECT weight, waist, note FROM body_metrics WHERE day = ?').get(day) as any) ?? null

/** Puts body_metrics for a day to these values (deletes an empty row it would leave). */
function setMetric(db: DB, day: string, v: { weight: number | null; waist: number | null }, had: MetricRow, now: Date): void {
  if (had && had.weight === v.weight && had.waist === v.waist) return
  if (v.weight == null && v.waist == null && !had?.note) {
    db.prepare('DELETE FROM body_metrics WHERE day = ?').run(day)
    return
  }
  db.prepare(
    `INSERT INTO body_metrics (day, weight, waist, note, updated_at) VALUES (?, ?, ?, NULL, ?)
     ON CONFLICT(day) DO UPDATE SET weight = excluded.weight, waist = excluded.waist, updated_at = excluded.updated_at`
  ).run(day, v.weight, v.waist, now.toISOString())
}

export interface AddResult {
  row: CompRow
  /** False when this weigh-in was already saved (same dedupe key, not newer). */
  added: boolean
  /** body_metrics for that day before the write, for Undo. */
  prev: { weight: number | null; waist: number | null } | null
}

/**
 * Saves one weigh-in. The same weigh-in again (same dedupe key) is one row:
 * the later updated_at wins. Then body_metrics for that day is kept in step.
 */
export function addBodyMeasurement(db: DB, input: CompInput, source: CompSource, now = new Date()): AddResult {
  const c = cleanMeasurement(input, source, now)
  if (!c.ok) throw new Error(c.error)
  const row = c.row
  const had = metricOf(db, row.day)
  const prev = had ? { weight: had.weight, waist: had.waist } : null
  const cols = COLS.filter((k) => k !== 'id' && k !== 'dedupe')
  const r = db
    .prepare(
      `INSERT INTO body_comp (${COLS.join(', ')}) VALUES (${COLS.map(() => '?').join(', ')})
       ON CONFLICT(dedupe) DO UPDATE SET ${cols.map((k) => `${k} = excluded.${k}`).join(', ')}
       WHERE excluded.updated_at > body_comp.updated_at`
    )
    .run(...COLS.map((k) => (row as any)[k] ?? null)) as any
  const added = r?.changes == null ? true : Number(r.changes) > 0
  const dayRows = listBodyComp(db, row.day, row.day)
  setMetric(db, row.day, metricsFor(dayRows, row.day, prev), had, now)
  if (row.waist_cm != null) settleWaistReminder(db, row.day, now)
  else planWaistReminder(db, now)
  return { row, added, prev }
}

/**
 * Undo: removes a weigh-in and puts that day's body_metrics back (to the
 * day's other weigh-ins, else to what it held before the save).
 */
export function removeBodyMeasurement(db: DB, id: string, prev: { weight: number | null; waist: number | null } | null = null, now = new Date()): boolean {
  const gone = db.prepare(`SELECT ${COLS.join(', ')} FROM body_comp WHERE id = ?`).get(id) as any
  if (!gone) return false
  const row = toRow(gone)
  db.prepare('DELETE FROM body_comp WHERE id = ?').run(id)
  const rest = listBodyComp(db, row.day, row.day)
  const had = metricOf(db, row.day)
  const weight = had?.weight === row.weight_kg ? (firstMorning(rest, row.day)?.weight_kg ?? prev?.weight ?? null) : (had?.weight ?? null)
  const waist = row.waist_cm != null && had?.waist === row.waist_cm ? (latestWaist(rest, row.day) ?? prev?.waist ?? null) : (had?.waist ?? null)
  setMetric(db, row.day, { weight, waist }, had, now)
  return true
}

/** kcal a day from the food log (body_log kcal rows), days with none left out. */
export function kcalByDay(db: DB, from: string, to: string): Record<string, number> {
  const events = bodyEvents(db, from, to)
  const out: Record<string, number> = {}
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const k = kcalOfDay(events, d)
    if (k > 0) out[d] = k
  }
  return out
}

export interface BodyCompView extends CompView {
  latest: CompRow | null
  /** This month so far, or last month in its first 7 days (same as the monthly report). */
  month: MonthComp & { from: string; to: string }
}

/** Everything the Progress tab's body composition section and the monthly summary need. */
export function bodyCompView(db: DB, now = new Date()): BodyCompView {
  const today = sportToday(now)
  const from = addDays(today, -120)
  const rows = listBodyComp(db, from, today)
  let metrics: { day: string; weight: number | null; waist: number | null }[] = []
  try {
    metrics = (db.prepare('SELECT day, weight, waist FROM body_metrics WHERE day >= ? AND day <= ? ORDER BY day').all(from, today) as any[]).map((m) => ({ day: String(m.day), weight: m.weight == null ? null : Number(m.weight), waist: m.waist == null ? null : Number(m.waist) }))
  } catch {
    metrics = []
  }
  const kcal = kcalByDay(db, addDays(today, -62), today)
  const thisFirst = `${today.slice(0, 8)}01`
  const useLast = Number(today.slice(8, 10)) < 8
  const mFrom = useLast ? `${addDays(thisFirst, -1).slice(0, 8)}01` : thisFirst
  const mTo = useLast ? addDays(thisFirst, -1) : today
  return { ...compView(rows, metrics, kcal, today), latest: latestBodyComp(db), month: { ...monthComp(rows, kcal, mFrom, mTo), from: mFrom, to: mTo } }
}

// ---------------------------------------------------------------- waist reminder

function readReminders(db: DB): Reminder[] {
  try {
    const l = readSetting(db, REMINDERS)
    return Array.isArray(l) ? (l as Reminder[]) : []
  } catch {
    return []
  }
}

/** The day of the newest waist (body_comp or body_metrics). */
function lastWaistDay(db: DB): string | null {
  try {
    const a = (db.prepare('SELECT MAX(day) AS d FROM body_comp WHERE waist_cm IS NOT NULL').get() as any)?.d ?? null
    const b = (db.prepare('SELECT MAX(day) AS d FROM body_metrics WHERE waist IS NOT NULL').get() as any)?.d ?? null
    return [a, b].filter(Boolean).sort().pop() ?? null
  } catch {
    return null
  }
}

/**
 * Adds the coming Sunday's waist reminder to your reminders (the list Ben's ⏰
 * and the island use), once: never twice for one Sunday, never for a week
 * that already has a waist.
 */
export function planWaistReminder(db: DB, now = new Date()): Reminder | null {
  const next = waistReminder(now, lastWaistDay(db))
  const list = readReminders(db)
  if (list.some((r) => r.id === next.id)) return null
  const item: Reminder = { id: next.id, at: next.at, text: WAIST_REMINDER_TEXT, kind: 'remind', createdAt: now.toISOString() }
  writeSetting(db, REMINDERS, [...list.filter((r) => !r.done || Date.parse(r.at) > now.getTime() - 8 * 86400000), item].slice(-60))
  return item
}

/** A waist was logged: that week's waist reminder is done (and the next one is planned). */
export function settleWaistReminder(db: DB, day: string, now = new Date()): void {
  const list = readReminders(db)
  const mon = addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7))
  const sun = addDays(mon, 6)
  let changed = false
  const next = list.map((r) => {
    if (!r.done && r.id.startsWith('waist:') && r.id.slice(6) >= mon && r.id.slice(6) <= sun) {
      changed = true
      return { ...r, done: true }
    }
    return r
  })
  if (changed) writeSetting(db, REMINDERS, next)
  planWaistReminder(db, now)
}
