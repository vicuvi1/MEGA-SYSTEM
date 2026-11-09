// Body composition (a smart scale such as the Xiaomi S400, or typed by hand).
// Pure logic, no database: check a measurement, its dedupe key, the day's
// first morning weight, weekly averages, 7-day smoothing, the week-over-week
// change against the target band, and the monthly numbers.
//
// The rules, in plain words:
// - One weigh-in is one row. The same weigh-in from two sources (typed and
//   synced) has the same dedupe key: its time to the minute (UTC) + the weight
//   to 0.1 kg. The row id is made from that key, so two devices merge it.
// - A 0 in an optional field means "not measured" (scales send 0 when the
//   feet were not bare), so it is stored as empty.
// - The day's weight is the FIRST MORNING weigh-in (04:00–11:59 local), else
//   the day's first one. Daily numbers swing ±1 kg with water and food, so
//   the headline is always a weekly average.
// - A week (Monday–Sunday) needs 3 weigh-ins for its average to count.
// - Body fat % and muscle kg from a home scale are estimates: shown smoothed
//   (7-day average) and labeled "estimate, watch the trend".
import { addDays, calendarDay, dayKey, daysBetween } from './dates'

export type CompSource = 'manual' | 'screenshot' | 'sync'
export const COMP_SOURCES: CompSource[] = ['manual', 'screenshot', 'sync']

/** The optional numbers a scale can give (all but weight). */
export const COMP_FIELDS = ['body_fat_pct', 'muscle_kg', 'water_pct', 'protein_pct', 'bone_kg', 'visceral_fat', 'bmr', 'bmi', 'heart_rate', 'body_score', 'waist_cm'] as const
export type CompField = (typeof COMP_FIELDS)[number]

/** Allowed ranges; outside them the measurement is refused with a plain message. */
export const COMP_RANGES: Record<'weight_kg' | CompField, [number, number, string]> = {
  weight_kg: [30, 250, 'Weight'],
  body_fat_pct: [0, 100, 'Body fat'],
  muscle_kg: [5, 200, 'Muscle'],
  water_pct: [0, 100, 'Water'],
  protein_pct: [0, 100, 'Protein'],
  bone_kg: [0.5, 15, 'Bone mass'],
  visceral_fat: [1, 60, 'Visceral fat'],
  bmr: [500, 6000, 'BMR'],
  bmi: [10, 80, 'BMI'],
  heart_rate: [30, 230, 'Heart rate'],
  body_score: [0, 100, 'Body score'],
  waist_cm: [40, 200, 'Waist']
}

const UNIT: Record<'weight_kg' | CompField, string> = {
  weight_kg: 'kg',
  body_fat_pct: '%',
  muscle_kg: 'kg',
  water_pct: '%',
  protein_pct: '%',
  bone_kg: 'kg',
  visceral_fat: '',
  bmr: 'kcal',
  bmi: '',
  heart_rate: 'bpm',
  body_score: '',
  waist_cm: 'cm'
}

export type CompInput = { at?: string | null; weight_kg: number | string | null | undefined; raw?: unknown } & Partial<Record<CompField, number | string | null>>

export type CompRow = {
  id: string
  at: string
  day: string
  weight_kg: number
  source: CompSource
  raw: string | null
  dedupe: string
  updated_at: string
} & Record<CompField, number | null>

/** Healthy muscle gain for a 19-year-old in a small surplus: +0.25 to +0.5 kg a week. */
export const TARGET_BAND = { lo: 0.25, hi: 0.5 }
/** A week's average counts from this many weigh-ins. */
export const MIN_WEEK = 3
/** Days in the moving average. */
export const SMOOTH_DAYS = 7

const r1 = (n: number) => Math.round(n * 10) / 10
const r2 = (n: number) => Math.round(n * 100) / 100

/** Time to the minute (UTC) + weight to 0.1 kg: the same weigh-in from any source. */
export function dedupeKey(at: string, weightKg: number): string {
  const t = new Date(at)
  const minute = Number.isFinite(t.getTime()) ? t.toISOString().slice(0, 16) : String(at).slice(0, 16)
  return `${minute}|${r1(weightKg).toFixed(1)}`
}

/** The row id for a dedupe key (the same on every device). */
export const compId = (dedupe: string) => `bc_${dedupe.replace(/[^0-9A-Za-z.]/g, '')}`

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.').trim())
  return Number.isFinite(n) ? n : NaN
}

/**
 * Checks and cleans one measurement. Returns the row to save, or a plain
 * error ("Body fat must be between 0 and 100 %").
 */
export function cleanMeasurement(input: CompInput, source: CompSource, now = new Date()): { ok: true; row: CompRow } | { ok: false; error: string } {
  const at = input.at ? new Date(input.at) : now
  if (!Number.isFinite(at.getTime())) return { ok: false, error: 'That time is not a real time' }
  if (at.getTime() > now.getTime() + 10 * 60_000) return { ok: false, error: 'That time is in the future' }
  const w = num(input.weight_kg)
  if (w == null) return { ok: false, error: 'Enter your weight' }
  const bad = (k: 'weight_kg' | CompField) => {
    const [lo, hi, name] = COMP_RANGES[k]
    return `${name} must be between ${lo} and ${hi}${UNIT[k] ? ` ${UNIT[k]}` : ''}`
  }
  if (Number.isNaN(w) || w < COMP_RANGES.weight_kg[0] || w > COMP_RANGES.weight_kg[1]) return { ok: false, error: bad('weight_kg') }
  const out: Partial<Record<CompField, number | null>> = {}
  for (const k of COMP_FIELDS) {
    const v = num(input[k])
    // 0 = not measured (a scale sends 0 when it could not read it).
    if (v == null || v === 0) {
      out[k] = null
      continue
    }
    const [lo, hi] = COMP_RANGES[k]
    if (Number.isNaN(v) || v < lo || v > hi) return { ok: false, error: bad(k) }
    out[k] = r2(v)
  }
  if (out.muscle_kg != null && out.muscle_kg >= w) return { ok: false, error: 'Muscle must be less than your weight' }
  const weight = r2(w)
  const iso = at.toISOString()
  const dedupe = dedupeKey(iso, weight)
  let raw: string | null = null
  if (input.raw != null) {
    try {
      raw = (typeof input.raw === 'string' ? input.raw : JSON.stringify(input.raw)).slice(0, 4000)
    } catch {
      raw = null
    }
  }
  return {
    ok: true,
    row: {
      id: compId(dedupe),
      at: iso,
      day: dayKey(at),
      weight_kg: weight,
      ...(out as Record<CompField, number | null>),
      source: COMP_SOURCES.includes(source) ? source : 'manual',
      raw,
      dedupe,
      updated_at: now.toISOString()
    }
  }
}

const localHour = (iso: string) => new Date(iso).getHours()
const byAt = <T extends { at: string }>(a: T, b: T) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)

/** The day's first morning weigh-in (04:00–11:59 local), else its first one. */
export function firstMorning<T extends { at: string; day: string }>(rows: T[], day: string): T | null {
  const mine = rows.filter((r) => r.day === day).sort(byAt)
  return mine.find((r) => localHour(r.at) >= 4 && localHour(r.at) < 12) ?? mine[0] ?? null
}

/** The day's last waist (null when none). */
export function latestWaist(rows: CompRow[], day: string): number | null {
  const w = rows.filter((r) => r.day === day && r.waist_cm != null).sort(byAt)
  return w.length ? w[w.length - 1].waist_cm : null
}

/**
 * What body_metrics should hold for a day after a write, so everything that
 * reads it keeps working. Weight: the first morning weigh-in, but a weight
 * that came from somewhere else (Telegram, the old sheet) is kept. Waist: the
 * newest one given, else what was there.
 */
export function metricsFor(dayRows: CompRow[], day: string, existing: { weight: number | null; waist: number | null } | null): { weight: number | null; waist: number | null } {
  const fm = firstMorning(dayRows, day)?.weight_kg ?? null
  const had = existing?.weight ?? null
  const ours = had == null || dayRows.some((r) => r.day === day && r.weight_kg === had)
  return { weight: ours ? (fm ?? had) : had, waist: latestWaist(dayRows, day) ?? existing?.waist ?? null }
}

export interface DayPoint {
  day: string
  weight: number | null
  fat: number | null
  muscle: number | null
  waist: number | null
}

/**
 * One point per day: the first morning weight (and fat/muscle from the same
 * weigh-in, else the day's first that has them), the day's last waist. Days
 * only in body_metrics (old logs, Telegram) are points too.
 */
export function dailyPoints(rows: CompRow[], metrics: { day: string; weight?: number | null; waist?: number | null }[] = []): DayPoint[] {
  const days = new Map<string, DayPoint>()
  const byDay = new Map<string, CompRow[]>()
  for (const r of rows) byDay.set(r.day, [...(byDay.get(r.day) ?? []), r])
  for (const [day, list] of byDay) {
    const fm = firstMorning(list, day)!
    const sorted = [...list].sort(byAt)
    const pick = (k: 'body_fat_pct' | 'muscle_kg') => fm[k] ?? sorted.find((r) => r[k] != null)?.[k] ?? null
    days.set(day, { day, weight: fm.weight_kg, fat: pick('body_fat_pct'), muscle: pick('muscle_kg'), waist: latestWaist(list, day) })
  }
  for (const m of metrics) {
    const w = m.weight != null && Number.isFinite(Number(m.weight)) ? Number(m.weight) : null
    const ws = m.waist != null && Number.isFinite(Number(m.waist)) ? Number(m.waist) : null
    const have = days.get(m.day)
    if (!have) {
      if (w != null || ws != null) days.set(m.day, { day: m.day, weight: w, fat: null, muscle: null, waist: ws })
    } else if (have.waist == null && ws != null) have.waist = ws
  }
  return [...days.values()].sort((a, b) => (a.day < b.day ? -1 : 1))
}

/** Monday of the week a day is in. */
export function mondayOf(day: string): string {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay()
  return addDays(day, -((dow + 6) % 7))
}

type Key = 'weight' | 'fat' | 'muscle' | 'waist'

export interface WeekRow {
  /** Monday. */
  week: string
  avg: number | null
  /** Weigh-ins that week. */
  n: number
  /** n ≥ 3: the average counts. */
  enough: boolean
  /** Average kcal a day from the food log (days with a log), null when none. */
  kcal: number | null
  kcalDays: number
}

/** Weekly averages (Monday–Sunday), oldest first, the week of `today` last. */
export function weeklyAverages(points: DayPoint[], today: string, weeks = 8, key: Key = 'weight', kcalByDay: Record<string, number> = {}): WeekRow[] {
  const out: WeekRow[] = []
  const last = mondayOf(today)
  for (let i = weeks - 1; i >= 0; i--) {
    const week = addDays(last, -7 * i)
    const end = addDays(week, 6)
    const vals = points.filter((p) => p.day >= week && p.day <= end && p[key] != null).map((p) => p[key] as number)
    const k = Object.entries(kcalByDay).filter(([d, v]) => d >= week && d <= end && v > 0)
    out.push({
      week,
      avg: vals.length ? r2(vals.reduce((t, v) => t + v, 0) / vals.length) : null,
      n: vals.length,
      enough: vals.length >= MIN_WEEK,
      kcal: k.length ? Math.round(k.reduce((t, [, v]) => t + v, 0) / k.length) : null,
      kcalDays: k.length
    })
  }
  return out
}

/** The 7-day moving average on each day that has a value (the days before it that have one). */
export function smoothed(points: DayPoint[], key: Key = 'weight', days = SMOOTH_DAYS): { day: string; value: number }[] {
  const have = points.filter((p) => p[key] != null)
  return have.map((p) => {
    const win = have.filter((q) => q.day <= p.day && daysBetween(q.day, p.day) < days)
    return { day: p.day, value: r2(win.reduce((t, q) => t + (q[key] as number), 0) / win.length) }
  })
}

export type Band = 'under' | 'in' | 'over'

/** A weekly change against the target band (+0.25 to +0.5 kg a week). */
export function bandOf(deltaKg: number): Band {
  if (deltaKg < TARGET_BAND.lo) return 'under'
  if (deltaKg > TARGET_BAND.hi) return 'over'
  return 'in'
}

export const BAND_LABEL: Record<Band, string> = {
  under: 'Under the target band',
  in: 'In the target band',
  over: 'Over the target band'
}

export interface Headline {
  /** The weekly average shown big. */
  avg: number
  /** Whose average: this week, or last week while this one has under 3 weigh-ins. */
  which: 'this week' | 'last week'
  n: number
  /** Change against the week before (null: that week had under 3 weigh-ins). */
  delta: number | null
  band: Band | null
}

/** This week's average (or last week's while this one is short) and its change. */
export function headline(weeks: WeekRow[]): Headline | null {
  const cur = weeks[weeks.length - 1]
  const prev = weeks[weeks.length - 2]
  const prev2 = weeks[weeks.length - 3]
  const pick = cur?.enough ? { w: cur, before: prev, which: 'this week' as const } : prev?.enough ? { w: prev, before: prev2, which: 'last week' as const } : null
  if (!pick || pick.w.avg == null) return null
  const delta = pick.before?.enough && pick.before.avg != null ? r2(pick.w.avg - pick.before.avg) : null
  return { avg: r1(pick.w.avg), which: pick.which, n: pick.w.n, delta, band: delta == null ? null : bandOf(delta) }
}

export const signed = (n: number, unit = 'kg') => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(r1(n)).toFixed(1)} ${unit}`

export interface CompView {
  today: string
  points: DayPoint[]
  weightAvg: { day: string; value: number }[]
  fatAvg: { day: string; value: number }[]
  muscleAvg: { day: string; value: number }[]
  waist: { day: string; waist: number }[]
  weeks: WeekRow[]
  head: Headline | null
  /** Weigh-ins so far this week. */
  thisWeek: number
  /** 7-day average now minus 4 weeks ago (null: not enough history). */
  fourWeeks: { kg: number; weeks: number } | null
  /** Where the target band starts on the chart (the 7-day average 4 weeks ago, or the first one). */
  bandFrom: { day: string; value: number } | null
  /** Average kcal a day this week (or last week while this one has no log). */
  kcal: { avg: number; days: number; which: 'this week' | 'last week' } | null
  /** One calm line written from the numbers. */
  verdict: string
}

/** Everything the Progress tab shows, from the rows, body_metrics and the food log's kcal per day. */
export function compView(rows: CompRow[], metrics: { day: string; weight?: number | null; waist?: number | null }[], kcalByDay: Record<string, number>, today: string, days = 56): CompView {
  const from = addDays(today, -(days - 1))
  const all = dailyPoints(rows, metrics)
  const weightAll = smoothed(all, 'weight')
  const points = all.filter((p) => p.day >= from && p.day <= today)
  const inRange = <T extends { day: string }>(l: T[]) => l.filter((p) => p.day >= from && p.day <= today)
  const weeks = weeklyAverages(all, today, 8, 'weight', kcalByDay)
  const head = headline(weeks)
  const cur = weeks[weeks.length - 1]
  const lastAvg = weightAll.filter((p) => p.day <= today).slice(-1)[0] ?? null
  const ref = lastAvg ? ([...weightAll].reverse().find((p) => p.day <= addDays(lastAvg.day, -21) && p.day >= addDays(lastAvg.day, -35)) ?? null) : null
  const fourWeeks = lastAvg && ref ? { kg: r2(lastAvg.value - ref.value), weeks: Math.max(1, Math.round(daysBetween(ref.day, lastAvg.day) / 7)) } : null
  const shown = inRange(weightAll)
  const bandStart = shown.find((p) => p.day >= addDays(today, -28)) ?? shown[0] ?? null
  const kw = cur?.kcal != null ? { avg: cur.kcal, days: cur.kcalDays, which: 'this week' as const } : weeks[weeks.length - 2]?.kcal != null ? { avg: weeks[weeks.length - 2].kcal!, days: weeks[weeks.length - 2].kcalDays, which: 'last week' as const } : null
  let verdict: string
  if (!head) verdict = `Not enough data yet: ${cur?.n ?? 0} of ${MIN_WEEK} weigh-ins this week. Weigh in most mornings and the weekly average shows here.`
  else if (head.delta == null) verdict = `Average ${head.avg} kg ${head.which}. One more full week (${MIN_WEEK}+ weigh-ins) and the change shows here.`
  else verdict = `${BAND_LABEL[head.band!]}: ${signed(head.delta)} vs the week before${fourWeeks ? ` (${signed(fourWeeks.kg)} in ${fourWeeks.weeks} week${fourWeeks.weeks === 1 ? '' : 's'})` : ''}. One week can be water: watch 2–3 weeks.`
  return {
    today,
    points,
    weightAvg: shown,
    fatAvg: inRange(smoothed(all, 'fat')),
    muscleAvg: inRange(smoothed(all, 'muscle')),
    waist: points.filter((p) => p.waist != null).map((p) => ({ day: p.day, waist: p.waist as number })),
    weeks,
    head,
    thisWeek: cur?.n ?? 0,
    fourWeeks,
    bandFrom: bandStart,
    kcal: kw,
    verdict
  }
}

export interface MonthComp {
  /** Smoothed body fat % change over the month (estimate). */
  fatPct: number | null
  /** Smoothed muscle kg change over the month (estimate). */
  muscleKg: number | null
  /** Average kcal a day over the days with a food log. */
  kcalAvg: number | null
  kcalDays: number
}

/** The body composition part of the monthly summary (from–to inclusive). */
export function monthComp(rows: CompRow[], kcalByDay: Record<string, number>, from: string, to: string): MonthComp {
  const all = dailyPoints(rows)
  const change = (key: 'fat' | 'muscle') => {
    const s = smoothed(all, key).filter((p) => p.day <= to)
    const inM = s.filter((p) => p.day >= from)
    if (!inM.length) return null
    const start = [...s].reverse().find((p) => p.day < from) ?? inM[0]
    const end = inM[inM.length - 1]
    return end.day === start.day ? null : r1(end.value - start.value)
  }
  const k = Object.entries(kcalByDay).filter(([d, v]) => d >= from && d <= to && v > 0)
  return { fatPct: change('fat'), muscleKg: change('muscle'), kcalAvg: k.length ? Math.round(k.reduce((t, [, v]) => t + v, 0) / k.length) : null, kcalDays: k.length }
}

/** The monthly summary opens by itself on the 1st–3rd of a month. */
export const monthSummaryDay = (today: string) => Number(today.slice(8, 10)) <= 3

/** Sunday morning at this hour: after any quiet hours, before the day gets busy. */
export const WAIST_HOUR = 10

/**
 * The next waist reminder: Sunday 10:00 local, once a week, skipped for a
 * week that already has a waist. Its id names the Sunday, so it is added once.
 */
export function waistReminder(now: Date, lastWaistDay: string | null): { id: string; at: string; day: string } {
  const at = new Date(now)
  at.setHours(WAIST_HOUR, 0, 0, 0)
  at.setDate(at.getDate() + ((7 - at.getDay()) % 7))
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 7)
  const sunday = () => calendarDay(at)
  if (lastWaistDay && lastWaistDay >= mondayOf(sunday())) at.setDate(at.getDate() + 7)
  return { id: `waist:${sunday()}`, at: at.toISOString(), day: sunday() }
}

export const WAIST_REMINDER_TEXT = 'Waist check: measure at the navel, relaxed, before breakfast. Log it in Body.'
