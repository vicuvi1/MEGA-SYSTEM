// Body boost on any database (the web app's copy, the bot server's): protein
// and supplement rows in the one body log (body_log), your protein prefs and
// saved meals (synced setting body_plus), tape measurements (body_tape), the
// weight trend from body_metrics, training readiness and Ben's weekly body
// report. Pure logic lives in src/core (protein, supplements, weightTrend,
// trainReadiness, sportWeekly, bodyReport). Nothing here pays points.
import type { DB } from './db'
import { getSetting, readSetting, writeSetting } from './settings'
import { addDays } from '../core/dates'
import { sportToday } from '../core/sportShared'
import { bodyEvents, sportBlob } from './bodyLog'
import { cleanMeals, mealGrams, proteinEntries, proteinGoal, proteinKind, proteinOfDay, proteinWeek, quickPicks, type Meal, type ProteinEntry, type ProteinGoal, type ProteinLog, type ProteinWeek } from '../core/protein'
import { SUPPS, suppKind, suppStreak, suppsFor, takenDays, todaysTick, type Supp } from '../core/supplements'
import { weightTrend, type WeightTrend } from '../core/weightTrend'
import { nightMinutes } from '../core/readiness'
import { doseMinutes, trainReadiness, type DoseMode, type TrainReady } from '../core/trainReadiness'
import { hardSetsByMuscle, mondayOf, shiftDay, type SetLog } from '../core/sportSets'
import { bodyWeek, sleepWeek, stalledMoves, type BodyWeek, type SleepWeek } from '../core/bodyReport'
import { cleanCare } from '../core/sleepCare'
import { stallInsight, stallsOf, type Insight } from '../core/sportInsight'

const rid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

export interface BodyPrefs {
  /** Protein goal in g per kg (1.6–2.2). */
  gPerKg: number
  meals: Meal[]
  /** Favourite food ids (quick picks first). */
  favs: string[]
  /** Supplements you track (ids); empty = the tile is off. */
  supps: string[]
  /** Your training dose for a day (wins over the readiness numbers). */
  ready: { day: string; mode: DoseMode } | null
  /** Minutes before the shift the fuel card shows (30–180). */
  fuelLead: number
  /** Days between photo check-ins. */
  photoEvery: number
}

export const DEFAULT_PREFS: BodyPrefs = { gPerKg: 1.8, meals: [], favs: [], supps: [], ready: null, fuelLead: 60, photoEvery: 14 }

export function cleanPrefs(raw: any): BodyPrefs {
  const o = raw && typeof raw === 'object' ? raw : {}
  const g = Number(o.gPerKg)
  const ready = o.ready && /^\d{4}-\d{2}-\d{2}$/.test(String(o.ready.day)) && ['full', 'light', 'short'].includes(o.ready.mode) ? { day: String(o.ready.day), mode: o.ready.mode as DoseMode } : null
  return {
    gPerKg: Number.isFinite(g) ? Math.max(1.6, Math.min(2.2, Math.round(g * 10) / 10)) : DEFAULT_PREFS.gPerKg,
    meals: cleanMeals(o.meals),
    favs: Array.isArray(o.favs) ? [...new Set<string>(o.favs.map(String))].slice(0, 12) : [],
    supps: Array.isArray(o.supps) ? o.supps.map(String).filter((id: string) => SUPPS.some((s) => s.id === id)) : [],
    ready,
    fuelLead: Math.max(30, Math.min(180, Number(o.fuelLead) || DEFAULT_PREFS.fuelLead)),
    photoEvery: [7, 14, 28].includes(Number(o.photoEvery)) ? Number(o.photoEvery) : DEFAULT_PREFS.photoEvery
  }
}

export const readPrefs = (db: DB): BodyPrefs => cleanPrefs(readSetting(db, 'body_plus'))

export function savePrefs(db: DB, patch: Partial<BodyPrefs>): BodyPrefs {
  const next = cleanPrefs({ ...readPrefs(db), ...patch })
  writeSetting(db, 'body_plus', next as any)
  return next
}

// ---- tape measurements ----

export interface Tape {
  day: string
  arm?: number
  chest?: number
  shoulders?: number
  thigh?: number
}
export const TAPE_PARTS: { id: keyof Omit<Tape, 'day'>; name: string; tip: string }[] = [
  { id: 'arm', name: 'Arm', tip: 'Flexed, around the biggest part' },
  { id: 'chest', name: 'Chest', tip: 'Around the nipples, arms down, breathe out' },
  { id: 'shoulders', name: 'Shoulders', tip: 'Around the widest part' },
  { id: 'thigh', name: 'Thigh', tip: 'Around the biggest part, standing' }
]

export function cleanTape(raw: unknown): Tape[] {
  const byDay = new Map<string, Tape>()
  for (const t of Array.isArray(raw) ? raw : []) {
    if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(String((t as any).day))) continue
    const row: Tape = { day: String((t as any).day) }
    for (const p of TAPE_PARTS) {
      const v = Number((t as any)[p.id])
      if (Number.isFinite(v) && v >= 10 && v <= 250) row[p.id] = Math.round(v * 10) / 10
    }
    if (Object.keys(row).length > 1) byDay.set(row.day, { ...(byDay.get(row.day) ?? {}), ...row })
  }
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1)).slice(-200)
}

export const readTape = (db: DB): Tape[] => cleanTape(readSetting(db, 'body_tape'))

export function saveTape(db: DB, row: Omit<Tape, 'day'> & { day?: string }, now = new Date()): Tape[] {
  const day = row.day && /^\d{4}-\d{2}-\d{2}$/.test(row.day) ? row.day : sportToday(now)
  const list = cleanTape([...readTape(db), { ...row, day }])
  writeSetting(db, 'body_tape', list)
  return list
}

// ---- rows in the one log ----

function insertRow(db: DB, kind: string, amount: number, source: string, now: Date, id?: string): string {
  const rowId = id ? String(id).slice(0, 60) : rid()
  db.prepare('INSERT OR IGNORE INTO body_log (id, at, day, kind, amount, source, undoes) VALUES (?, ?, ?, ?, ?, ?, NULL)').run(rowId, now.toISOString(), sportToday(now), kind, Math.round(amount), String(source || 'app').slice(0, 20))
  return rowId
}

/** Logs protein (a food, a saved meal or plain grams). Returns the row id. */
export function logProtein(db: DB, log: Pick<ProteinLog, 'food' | 'g'>, source: string, opts: { id?: string; now?: Date } = {}): string {
  const g = Math.round(Number(log.g) || 0)
  if (g < 1 || g > 400) throw new Error('Protein: 1–400 g at a time')
  return insertRow(db, proteinKind(log.food), g, source, opts.now ?? new Date(), opts.id)
}

/** Logs a saved meal as one row (its protein total). */
export function logMeal(db: DB, mealId: string, source: string, now = new Date()): { id: string; g: number; name: string } | null {
  const m = readPrefs(db).meals.find((x) => x.id === mealId)
  if (!m) return null
  const g = mealGrams(m)
  return { id: logProtein(db, { food: m.id, g }, source, { now }), g, name: m.name }
}

/** Ticks a supplement for today (once a day: a second tick does nothing). */
export function tickSupp(db: DB, id: string, source: string, now = new Date()): boolean {
  if (!SUPPS.some((s) => s.id === id)) return false
  const day = sportToday(now)
  if (todaysTick(bodyEvents(db, day), id, day)) return false
  insertRow(db, suppKind(id), 1, source, now, `supp-${id}-${day}-${rid().slice(-4)}`)
  return true
}

// ---- views ----

/** Latest weight (kg) and the list for the trend (body_metrics). */
export function weighIns(db: DB, days = 120): { day: string; weight: number }[] {
  try {
    return (db.prepare('SELECT day, weight FROM body_metrics WHERE weight IS NOT NULL ORDER BY day DESC LIMIT ?').all(days) as any[]).map((r) => ({ day: String(r.day), weight: Number(r.weight) })).reverse()
  } catch {
    return []
  }
}

export interface SuppView extends Supp {
  taken: boolean
  tickId: string | null
  streak: number
}

export interface BodyPlusView {
  day: string
  prefs: BodyPrefs
  weight: number | null
  goal: ProteinGoal
  today: number
  entries: ProteinEntry[]
  week: ProteinWeek
  picks: { id: string; name: string; emoji: string; portion: string; g: number }[]
  supps: SuppView[]
  tape: Tape[]
  trend: WeightTrend
}

export function bodyPlusView(db: DB, now = new Date()): BodyPlusView {
  const day = sportToday(now)
  const prefs = readPrefs(db)
  const events = bodyEvents(db, addDays(day, -60), day)
  const ins = weighIns(db)
  const weight = ins.length ? ins[ins.length - 1].weight : null
  const goal = proteinGoal(weight, prefs.gPerKg)
  const supps = suppsFor(day, prefs.supps).map((s) => {
    const days = takenDays(events, s.id)
    const tickId = todaysTick(events, s.id, day)
    return { ...s, taken: !!tickId, tickId, streak: suppStreak(days, day) }
  })
  return {
    day,
    prefs,
    weight,
    goal,
    today: proteinOfDay(events, day),
    entries: proteinEntries(events, day, prefs.meals),
    week: proteinWeek(events, day, goal.g),
    picks: quickPicks(events, prefs.favs, day, 8).map((f) => ({ id: f.id, name: f.name, emoji: f.emoji, portion: f.portion, g: f.g })),
    supps,
    tape: readTape(db),
    trend: weightTrend(ins, day)
  }
}

/** Last nights' sleep in minutes (Waky's sleep_logs: the morning's row holds the night before). */
export function nights(db: DB, today: string, n = 7): { day: string; minutes: number | null }[] {
  try {
    return (db.prepare('SELECT day, bed_time, wake_time FROM sleep_logs WHERE day >= ? AND day <= ? ORDER BY day').all(addDays(today, -(n - 1)), today) as any[]).map((r) => ({ day: String(r.day), minutes: nightMinutes({ bedTime: r.bed_time, wakeTime: r.wake_time }) }))
  } catch {
    return []
  }
}

/** Today's training dose: last night's sleep, soreness (this device), yesterday's hard sets and your pick. */
export function readinessNow(db: DB, soreness: number | null, now = new Date(), quality: number | null = null): TrainReady {
  const day = sportToday(now)
  const prefs = readPrefs(db)
  const last = nights(db, day, 1).find((x) => x.day === day)
  const blob = sportBlob(db)
  const yday = shiftDay(day, -1)
  const sets = hardSetsByMuscle(blob?.sets as SetLog, Array.isArray(blob?.exercises) ? blob.exercises : [], yday, yday)
  return trainReadiness({ sleptMin: last?.minutes ?? null, soreness, quality, ydaySets: sets.push + sets.pull + sets.core + sets.legs, override: prefs.ready?.day === day ? prefs.ready.mode : null })
}

/** BD8: the workout length for today's plan: Sport Track's 20/30/45 min at today's dose (null: no Sport Track yet). */
export function trainSlotInput(db: DB, now = new Date()): { minutes: number; easy: boolean } | null {
  try {
    const blob = sportBlob(db)
    if (!blob) return null
    const ss = blob.sportySettings ?? {}
    const plan = [20, 30, 45].includes(Number(ss.planMinutes)) ? Number(ss.planMinutes) : 30
    const r = readinessNow(db, null, now)
    return { minutes: doseMinutes(plan, r.mode), easy: r.mode !== 'full' }
  } catch {
    return null
  }
}

/** Average steps a day this week from the phone health plugin (null without numbers). */
function stepsWeek(db: DB, today: string): number | null {
  try {
    const d = JSON.parse(getSetting(db, 'plugin_health_data') || 'null')?.days ?? {}
    const list = Array.from({ length: 7 }, (_, i) => Number(d[addDays(today, -i)]?.steps)).filter((x) => Number.isFinite(x) && x > 0)
    return list.length >= 2 ? Math.round(list.reduce((t, x) => t + x, 0) / list.length) : null
  } catch {
    return null
  }
}

/** The week's sleep against YOUR sleep need from Sleep care (core/sleepCare.ts, the sleep builder's setting), else 8 h. */
function sleepOfWeek(db: DB, today: string): SleepWeek {
  let needH = 8
  try {
    needH = cleanCare(readSetting(db, 'sleep_care')).needH
  } catch {
    needH = 8
  }
  return sleepWeek(nights(db, today, 7), today, Math.round(needH * 60))
}

/** BD18: the week for your body (Sunday card, the weekly check on Telegram). */
export function bodyWeekReport(db: DB, now = new Date()): BodyWeek {
  const today = sportToday(now)
  const v = bodyPlusView(db, now)
  const blob = sportBlob(db)
  const exercises = Array.isArray(blob?.exercises) ? blob.exercises : []
  const log = (blob?.sets ?? {}) as SetLog
  const sets = hardSetsByMuscle(log, exercises, addDays(today, -6), today)
  let workouts = 0
  try {
    workouts = Number((db.prepare('SELECT COUNT(DISTINCT day) AS n FROM workouts WHERE day >= ? AND day <= ?').get(addDays(today, -6), today) as any)?.n ?? 0)
  } catch {
    workouts = 0
  }
  const setDays = Object.keys(log).filter((d) => d >= addDays(today, -6) && d <= today && Object.keys(log[d] ?? {}).length).length
  return bodyWeek({
    today,
    protein: { avg: v.week.avg, days: v.week.days, goal: v.goal.g },
    weight: { nudge: v.trend.nudge, perMonthKg: v.trend.perMonthKg, now: v.trend.now != null ? Math.round(v.trend.now * 10) / 10 : null, line: v.trend.line },
    sets,
    sleep: sleepOfWeek(db, today),
    steps: stepsWeek(db, today),
    workouts: Math.max(workouts, setDays),
    stalls: stalledMoves(log, exercises, today)
  })
}

/** PG4: why a move stalled, from your protein, sleep and today's readiness (null: nothing stalled). */
export function sportInsightNow(db: DB, now = new Date()): Insight | null {
  const today = sportToday(now)
  const blob = sportBlob(db)
  const stalled = stallsOf((blob?.sets ?? {}) as SetLog, Array.isArray(blob?.exercises) ? blob.exercises : [], today)
  if (!stalled.length) return null
  const v = bodyPlusView(db, now)
  const sl = sleepOfWeek(db, today)
  let ready: { mode: 'full' | 'light' | 'short'; why: string } | null = null
  try {
    const r = readinessNow(db, null, now)
    ready = { mode: r.mode, why: r.why }
  } catch {
    ready = null
  }
  return stallInsight(stalled, { protein: { avg: v.week.avg, days: v.week.days, goal: v.goal.g }, sleep: { avgMin: sl.avgMin, nights: sl.nights }, readiness: ready })
}

/** The Monday of this week (for the "this week" views). */
export const weekStart = (now = new Date()) => mondayOf(sportToday(now))
