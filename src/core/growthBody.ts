// Body → Growth: "how much am I growing" over the long run. Pure numbers from
// what you logged: weekly average weight against the slow-gain corridor
// (+0.25 to +0.5 kg a week from the start of the period), waist, strength
// score per muscle group, sessions against the plan, protein and kcal against
// the goals, sleep, fat % and muscle (estimates), a calm "lean gain check" per
// month, what is missing for an accurate trend, and one row per month (CSV).
// Display only: nothing here pays points. Growth levels: growthLevels.ts.
//
// Honesty: every source row carries `onTime` (logged on its day or the day
// after). The display uses everything you logged; growth levels use only the
// rows logged at the time (see growthLevels.ts).
import { addDays, dayKey, daysBetween } from './dates'
import { dailyPoints, mondayOf, TARGET_BAND, type CompRow, type DayPoint } from './bodyComp'
import { familySeries, type StrengthPoint } from './sportStrength'
import { moveOf, type SportEx } from './sportLadders'
import { FAMILIES, moveById } from './sportMoves'
import { muscleOf, setsOn, type Muscle, type SetLog } from './sportSets'
import { isImported } from './sportLevels'
import { trainOf } from './trainLog'
import { proteinGoal } from './protein'

export const GROWTH_MUSCLES: Muscle[] = ['push', 'pull', 'legs', 'core']

// ---------------------------------------------------------------- input

export interface FoodDay {
  day: string
  kcal: number
  protein: number
  /** Protein from rows logged on the day or the day after (undo rows always count). */
  proteinOnTime: number
}
export interface SleepNight {
  day: string
  minutes: number | null
  onTime: boolean
}
export interface GrowthInput {
  today: string
  /** One point per day (weight, waist, fat, muscle) from everything logged. */
  points: DayPoint[]
  /** The same from rows logged at the time only (levels read these). */
  honestPoints: DayPoint[]
  food: FoodDay[]
  /** Days with reps in the shared log (Sport Track quick adds), on time or not. */
  reps: { day: string; onTime: boolean }[]
  sleep: SleepNight[]
  /** Protein grams per kg (the protein goal follows your weight on each day). */
  gPerKg: number
  /** Today's kcal goal (a guide line only). */
  kcalGoal: number | null
  /** Sport Track's state on this device (sets, exercises, imported, train*). */
  sport: any
  /** The newest progress photo's day on this device (null: none). */
  lastPhotoDay?: string | null
}

/** Logged on its day or the day after (the app's day turns at 04:00). */
export function loggedOnTime(day: string, savedAt: string | number | null | undefined): boolean {
  if (savedAt == null || savedAt === '') return false
  const t = new Date(savedAt)
  if (!Number.isFinite(t.getTime())) return false
  return dayKey(t) <= addDays(day, 1)
}

/** Daily points from weigh-ins and body_metrics, and the same from rows logged at the time. */
export function growthPoints(rows: CompRow[], metrics: { day: string; weight?: number | null; waist?: number | null; updated_at?: string | null }[]): { points: DayPoint[]; honest: DayPoint[] } {
  const points = dailyPoints(rows, metrics)
  const honest = dailyPoints(
    rows.filter((r) => loggedOnTime(r.day, r.updated_at)),
    metrics.filter((m) => loggedOnTime(m.day, m.updated_at))
  )
  return { points, honest }
}

// ---------------------------------------------------------------- periods

export type Period = '4w' | '3m' | '6m' | '1y' | 'all'
export const PERIODS: { id: Period; label: string; days: number | null }[] = [
  { id: '4w', label: '4 weeks', days: 28 },
  { id: '3m', label: '3 months', days: 91 },
  { id: '6m', label: '6 months', days: 182 },
  { id: '1y', label: '1 year', days: 365 },
  { id: 'all', label: 'All time', days: null }
]

const r1 = (n: number) => Math.round(n * 10) / 10
const r2 = (n: number) => Math.round(n * 100) / 100
const avg = (l: number[]) => (l.length ? l.reduce((t, v) => t + v, 0) / l.length : null)

/** The first day anything was logged (today when nothing). */
export function firstDay(input: GrowthInput): string {
  const days = [input.points[0]?.day, input.food[0]?.day, input.sleep[0]?.day, input.reps[0]?.day, ...trainingDays(input).slice(0, 1).map((d) => d.day)].filter(Boolean) as string[]
  return days.length ? days.sort()[0] : input.today
}

/** The first day of a period (the start of your data for "All time", never before it). */
export function periodFrom(input: GrowthInput, period: Period): string {
  const first = firstDay(input)
  const p = PERIODS.find((x) => x.id === period)!
  if (p.days == null) return first
  const from = addDays(input.today, -(p.days - 1))
  return from < first ? first : from
}

// ---------------------------------------------------------------- training days

export interface TrainingDay {
  day: string
  /** Some set or rep row that day was logged on the day or the day after. */
  onTime: boolean
}

const exercisesOf = (st: any): SportEx[] => (Array.isArray(st?.exercises) ? st.exercises : [])

/** Days you trained: sets in the set log, reps in the shared log, Sport Track day totals (Telegram imports left out). */
export function trainingDays(input: Pick<GrowthInput, 'sport' | 'reps'>): TrainingDay[] {
  const out = new Map<string, boolean>()
  const mark = (day: string, onTime: boolean) => out.set(day, (out.get(day) ?? false) || onTime)
  const st = input.sport
  const log: SetLog = st?.sets ?? {}
  for (const day of Object.keys(log)) {
    for (const exId of Object.keys(log[day] ?? {})) {
      const sets = setsOn(log, day, exId)
      if (!sets.length) continue
      mark(day, sets.some((s) => s.at != null && loggedOnTime(day, s.at)))
    }
  }
  const days = st?.days ?? {}
  for (const day of Object.keys(days)) {
    const any = Object.entries<any>(days[day] ?? {}).some(([exId, v]) => Number(v) > 0 && !isImported(st?.imported, day, exId))
    if (any) mark(day, false)
  }
  for (const r of input.reps) mark(r.day, r.onTime)
  return [...out.entries()].map(([day, onTime]) => ({ day, onTime })).sort((a, b) => (a.day < b.day ? -1 : 1))
}

/** Sessions a week the plan asks for (training days in the weekly split). */
export const planPerWeek = (st: any) => trainOf(st).week.days.filter((d) => d !== 'rest').length

// ---------------------------------------------------------------- strength

/** Only sets logged at the time (a set saved days later for an earlier day is left out). */
export function honestSets(log: SetLog | null | undefined): SetLog {
  const out: SetLog = {}
  for (const [day, byEx] of Object.entries(log ?? {})) {
    for (const [exId, sets] of Object.entries(byEx ?? {})) {
      const keep = (Array.isArray(sets) ? sets : []).filter((s) => s && s.at != null && loggedOnTime(day, s.at))
      if (keep.length) (out[day] ??= {})[exId] = keep
    }
  }
  return out
}

export interface StrengthIndex {
  /** Per family, the best set per session day. */
  series: Map<string, StrengthPoint[]>
}

/** The strength history once (per ladder family), so a long period stays quick. */
export function strengthIndex(log: SetLog | null | undefined, exercises: SportEx[]): StrengthIndex {
  const fams = new Set<string>()
  for (const ex of exercises) {
    const m = moveOf(ex)
    if (m) fams.add(m.family)
  }
  const series = new Map<string, StrengthPoint[]>()
  for (const f of fams) {
    const s = familySeries(log, exercises, f)
    if (s.length) series.set(f, s)
  }
  return { series }
}

/** Strength score per muscle group on a day: the best family's best set in the 4 weeks up to it (0: none). */
export function strengthOn(idx: StrengthIndex, day: string): Record<Muscle, number> {
  const by: Record<Muscle, number> = { push: 0, pull: 0, core: 0, legs: 0 }
  const from = addDays(day, -27)
  for (const pts of idx.series.values()) {
    let best: StrengthPoint | null = null
    for (const p of pts) if (p.day >= from && p.day <= day && (!best || p.score > best.score)) best = p
    const mu = best && muscleOf(moveById(best.move)?.group)
    if (best && mu) by[mu] = Math.max(by[mu], best.score)
  }
  return by
}

/** Average % change over the groups that have a score at both ends (null: none do). */
export function strengthPct(then: Record<Muscle, number>, now: Record<Muscle, number>): number | null {
  const l = GROWTH_MUSCLES.filter((m) => then[m] > 0 && now[m] > 0).map((m) => now[m] / then[m] - 1)
  return l.length ? Math.round((avg(l) as number) * 100) : null
}

/** The first day each harder variation was done (a move harder than any before it in its family). */
export function harderFirsts(idx: StrengthIndex): { day: string; move: string; name: string }[] {
  const out: { day: string; move: string; name: string }[] = []
  for (const [fam, pts] of idx.series) {
    const steps = FAMILIES[fam]?.steps ?? []
    let top = -1
    for (const p of pts) {
      const i = steps.indexOf(p.move)
      if (top >= 0 && i > top) out.push({ day: p.day, move: p.move, name: moveById(p.move)?.name ?? p.move })
      if (i > top) top = i
    }
  }
  return out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.move < b.move ? -1 : 1))
}

// ---------------------------------------------------------------- weekly series

export interface WeekPoint {
  /** Monday. */
  week: string
  weight: number | null
  weightN: number
  waist: number | null
  fat: number | null
  muscle: number | null
  /** Average a day over days with food logged. */
  protein: number | null
  kcal: number | null
  foodDays: number
  /** Average hours a night over logged nights. */
  sleepH: number | null
  sessions: number
  strength: Record<Muscle, number>
}

/** One point per week (Monday–Sunday) from the Monday of `from` to this week. */
export function weeklySeries(input: GrowthInput, from: string, idx = strengthIndex(input.sport?.sets, exercisesOf(input.sport))): WeekPoint[] {
  const out: WeekPoint[] = []
  const tdays = trainingDays(input)
  const last = mondayOf(input.today)
  for (let w = mondayOf(from); w <= last; w = addDays(w, 7)) {
    const end = addDays(w, 6)
    const inWeek = <T extends { day: string }>(l: T[]) => l.filter((p) => p.day >= w && p.day <= end)
    const pts = inWeek(input.points)
    const vals = (k: 'weight' | 'waist' | 'fat' | 'muscle') => pts.map((p) => p[k]).filter((v): v is number => v != null)
    const food = inWeek(input.food).filter((f) => f.kcal > 0 || f.protein > 0)
    const nights = inWeek(input.sleep).map((s) => s.minutes).filter((m): m is number => m != null)
    const a = (l: number[], f = r1) => (l.length ? f(avg(l) as number) : null)
    out.push({
      week: w,
      weight: a(vals('weight'), r2),
      weightN: vals('weight').length,
      waist: a(vals('waist')),
      fat: a(vals('fat')),
      muscle: a(vals('muscle')),
      protein: a(food.map((f) => f.protein), Math.round),
      kcal: a(food.map((f) => f.kcal), Math.round),
      foodDays: food.length,
      sleepH: a(nights.map((m) => m / 60)),
      sessions: inWeek(tdays).length,
      strength: strengthOn(idx, end < input.today ? end : input.today)
    })
  }
  return out
}

/** The slow-gain corridor from the first weekly average in the series: +0.25 to +0.5 kg a week. */
export function corridor(weeks: WeekPoint[]): { start: { week: string; value: number } | null; lo: (number | null)[]; hi: (number | null)[] } {
  const first = weeks.find((w) => w.weight != null && w.weightN >= 3) ?? weeks.find((w) => w.weight != null) ?? null
  if (!first) return { start: null, lo: weeks.map(() => null), hi: weeks.map(() => null) }
  const at = (w: WeekPoint, k: number) => (w.week < first.week ? null : r2(first.weight! + k * (daysBetween(first.week, w.week) / 7)))
  return { start: { week: first.week, value: first.weight! }, lo: weeks.map((w) => at(w, TARGET_BAND.lo)), hi: weeks.map((w) => at(w, TARGET_BAND.hi)) }
}

// ---------------------------------------------------------------- the hero

export interface PeriodStats {
  from: string
  weeks: number
  /** Smoothed weight, start → now (kg change), null without weigh-ins at both ends. */
  weight: { from: number; to: number; change: number } | null
  waist: { from: number; to: number; change: number } | null
  /** Lean mass change (estimate): weight × (100 − fat %) or the scale's muscle; null without readings. */
  lean: { change: number; how: 'fat' | 'muscle' } | null
  strengthPct: number | null
  unlocked: number
  sessions: number
  proteinDays: number
  foodDays: number
}

/** The 7-day average on the first and last days that have a value in [from, today]. */
function ends(points: DayPoint[], from: string, today: string, val: (p: DayPoint) => number | null): { from: number; to: number } | null {
  const have = points.filter((p) => p.day <= today && val(p) != null)
  const win = (day: string, dir: 1 | -1) => {
    const l = have.filter((q) => (dir === 1 ? q.day >= day && daysBetween(day, q.day) < 7 : q.day <= day && daysBetween(q.day, day) < 7)).map((q) => val(q) as number)
    return avg(l)
  }
  const inRange = have.filter((p) => p.day >= from)
  if (inRange.length < 2) return null
  const a = inRange[0].day
  const b = inRange[inRange.length - 1].day
  if (daysBetween(a, b) < 7) return null
  return { from: r2(win(a, 1) as number), to: r2(win(b, -1) as number) }
}

/** Protein goal on a day: your g/kg × the newest weight on or before it. */
export function proteinGoalOn(points: DayPoint[], day: string, gPerKg: number): number {
  let w: number | null = null
  for (const p of points) {
    if (p.day > day) break
    if (p.weight != null) w = p.weight
  }
  return proteinGoal(w, gPerKg).g
}

export function periodStats(input: GrowthInput, period: Period, idx = strengthIndex(input.sport?.sets, exercisesOf(input.sport))): PeriodStats {
  const from = periodFrom(input, period)
  const t = input.today
  const wt = ends(input.points, from, t, (p) => p.weight)
  const ws = ends(input.points, from, t, (p) => p.waist)
  const lf = ends(input.points, from, t, (p) => (p.weight != null && p.fat != null ? p.weight * (1 - p.fat / 100) : null))
  const lm = ends(input.points, from, t, (p) => p.muscle)
  const lean = lf ? { change: r1(lf.to - lf.from), how: 'fat' as const } : lm ? { change: r1(lm.to - lm.from), how: 'muscle' as const } : null
  // Strength: the 4 weeks up to the period's start (or your first week of sets) against the last 4 weeks.
  const firstSet = [...idx.series.values()].map((s) => s[0]?.day).filter(Boolean).sort()[0] as string | undefined
  let thenDay = from
  if (firstSet && firstSet > addDays(from, -27)) thenDay = addDays(firstSet, 6)
  const sp = thenDay < addDays(t, -6) ? strengthPct(strengthOn(idx, thenDay), strengthOn(idx, t)) : null
  const food = input.food.filter((f) => f.day >= from && f.day <= t && (f.kcal > 0 || f.protein > 0))
  return {
    from,
    weeks: Math.max(1, Math.round((daysBetween(from, t) + 1) / 7)),
    weight: wt ? { ...wt, change: r1(wt.to - wt.from) } : null,
    waist: ws ? { ...ws, change: r1(ws.to - ws.from) } : null,
    lean,
    strengthPct: sp,
    unlocked: unlockedIn(input, idx, from, t).length,
    sessions: trainingDays(input).filter((d) => d.day >= from && d.day <= t).length,
    proteinDays: food.filter((f) => f.protein >= proteinGoalOn(input.points, f.day, input.gPerKg)).length,
    foodDays: food.length
  }
}

/** Roadmap levels reached (with a session on the level before it, on or before that day). */
export function roadmapUps(st: any, honest: boolean): { day: string; ladder: string; move: string; name: string }[] {
  const data = trainOf(st)
  const out: { day: string; ladder: string; move: string; name: string }[] = []
  for (const lad of data.ladders) {
    const lv = data.levels[lad.id]
    if (!lv) continue
    for (const [k, day] of Object.entries(lv.reached ?? {})) {
      const i = Number(k)
      if (!(i > 0) || !lad.levels[i] || typeof day !== 'string') continue
      const prev = lad.levels[i - 1].move
      const proof = data.log.some((s) => s.date <= day && s.exercises.some((e) => e.ladder === lad.id && e.move === prev && e.sets.length > 0) && (!honest || loggedOnTime(s.date, s.startedAt)))
      if (!proof) continue
      const mv = moveById(lad.levels[i].move)
      out.push({ day, ladder: lad.id, move: lad.levels[i].move, name: mv?.name ?? lad.levels[i].move.replace(/_/g, ' ') })
    }
  }
  return out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.ladder < b.ladder ? -1 : 1))
}

/** Harder variations unlocked in [from, to]: roadmap level-ups and harder library moves, each move once. */
export function unlockedIn(input: GrowthInput, idx: StrengthIndex, from: string, to: string): { day: string; move: string; name: string }[] {
  const first = new Map<string, { day: string; move: string; name: string }>()
  for (const u of [...roadmapUps(input.sport, false), ...harderFirsts(idx)]) {
    const was = first.get(u.move)
    if (!was || u.day < was.day) first.set(u.move, { day: u.day, move: u.move, name: u.name })
  }
  return [...first.values()].filter((u) => u.day >= from && u.day <= to).sort((a, b) => (a.day < b.day ? -1 : 1))
}

// ---------------------------------------------------------------- lean gain check

export type LeanKind = 'lean' | 'gain' | 'slow' | 'eat' | 'nowaist' | 'first' | 'nodata'
export interface MonthCheck {
  /** YYYY-MM */
  month: string
  weight: number | null
  waist: number | null
  weightChange: number | null
  waistChange: number | null
  strengthPct: number | null
  kind: LeanKind
  text: string
}

const monthsBetween = (from: string, to: string) => {
  const out: string[] = []
  let y = Number(from.slice(0, 4))
  let m = Number(from.slice(5, 7))
  const end = to.slice(0, 7)
  for (;;) {
    const k = `${y}-${String(m).padStart(2, '0')}`
    if (k > end) break
    out.push(k)
    m++
    if (m > 12) {
      m = 1
      y++
    }
  }
  return out
}
const monthEnd = (ym: string) => {
  const y = Number(ym.slice(0, 4))
  const m = Number(ym.slice(5, 7))
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
  return addDays(next, -1)
}
const sgn = (n: number, unit: string) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(r1(n)).toFixed(1)} ${unit}`

/**
 * One calm verdict per month (the month's average against the month before):
 * weight up, waist about flat, strength up → growing lean; the waist rising
 * faster than the weight (cm against kg) → slow down the surplus; weight flat
 * → eat more. Numbers from your logs; no red.
 */
export function leanChecks(input: GrowthInput, idx = strengthIndex(input.sport?.sets, exercisesOf(input.sport))): MonthCheck[] {
  const months = monthsBetween(firstDay(input), input.today)
  const avgOf = (ym: string, k: 'weight' | 'waist') => {
    const l = input.points.filter((p) => p.day.startsWith(ym) && p[k] != null).map((p) => p[k] as number)
    return { v: l.length ? avg(l) : null, n: l.length }
  }
  const out: MonthCheck[] = []
  let prevW: number | null = null
  let prevWs: number | null = null
  for (const ym of months) {
    const w = avgOf(ym, 'weight')
    const ws = avgOf(ym, 'waist')
    const startD = addDays(`${ym}-01`, -1)
    const endD = monthEnd(ym) < input.today ? monthEnd(ym) : input.today
    const sp = strengthPct(strengthOn(idx, startD), strengthOn(idx, endD))
    const wc = w.v != null && prevW != null ? r1(w.v - prevW) : null
    const wsc = ws.v != null && prevWs != null ? r1(ws.v - prevWs) : null
    let kind: LeanKind
    let text: string
    if (w.v == null || w.n < 3) {
      kind = 'nodata'
      text = `Not enough weigh-ins (${w.n}). Weigh in a few mornings a week.`
    } else if (wc == null) {
      kind = 'first'
      text = `Starting point: ${r1(w.v)} kg${ws.v != null ? `, waist ${r1(ws.v)} cm` : ''}.`
    } else if (wc < 0.3) {
      kind = 'eat'
      text = `Weight ${sgn(wc, 'kg')}: flat. Eat a little more (about 200 kcal a day).`
    } else if (wsc == null) {
      kind = 'nowaist'
      text = `Weight ${sgn(wc, 'kg')}. Log your waist to check the gain is lean.`
    } else if (wsc >= 1 && wsc > wc) {
      kind = 'slow'
      text = `Waist ${sgn(wsc, 'cm')} with weight ${sgn(wc, 'kg')}: slow down the surplus a little.`
    } else if (sp != null && sp > 0) {
      kind = 'lean'
      text = `Growing lean ✅ Weight ${sgn(wc, 'kg')}, waist ${sgn(wsc, 'cm')}, strength +${sp}%.`
    } else {
      kind = 'gain'
      text = `Weight ${sgn(wc, 'kg')}, waist ${sgn(wsc, 'cm')}. ${sp == null ? 'Log sets to see strength.' : 'Strength flat: push the sets.'}`
    }
    out.push({ month: ym, weight: w.v == null ? null : r1(w.v), waist: ws.v == null ? null : r1(ws.v), weightChange: wc, waistChange: wsc, strengthPct: sp, kind, text })
    if (w.v != null && w.n >= 3) prevW = w.v
    if (ws.v != null) prevWs = ws.v
  }
  return out
}

// ---------------------------------------------------------------- monthly snapshots

export interface MonthRow {
  month: string
  weight: number | null
  waist: number | null
  strengthPct: number | null
  sessions: number
  proteinDays: number
  /** The growth level you were on at the month's end (name). */
  level: string
}

export function monthlyRows(input: GrowthInput, levelAt: (day: string) => string, idx = strengthIndex(input.sport?.sets, exercisesOf(input.sport))): MonthRow[] {
  const checks = leanChecks(input, idx)
  const tdays = trainingDays(input)
  return checks.map((c) => {
    const end = monthEnd(c.month) < input.today ? monthEnd(c.month) : input.today
    const food = input.food.filter((f) => f.day.startsWith(c.month))
    return {
      month: c.month,
      weight: c.weight,
      waist: c.waist,
      strengthPct: c.strengthPct,
      sessions: tdays.filter((d) => d.day.startsWith(c.month)).length,
      proteinDays: food.filter((f) => f.protein > 0 && f.protein >= proteinGoalOn(input.points, f.day, input.gPerKg)).length,
      level: levelAt(end)
    }
  })
}

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** The monthly rows as CSV (newest last), for a spreadsheet. */
export function rowsCsv(rows: MonthRow[]): string {
  const head = ['month', 'weight_kg', 'waist_cm', 'strength_pct', 'sessions', 'protein_goal_days', 'growth_level']
  return [head.join(','), ...rows.map((r) => [r.month, r.weight, r.waist, r.strengthPct, r.sessions, r.proteinDays, r.level].map(csvCell).join(','))].join('\n')
}

// ---------------------------------------------------------------- what's missing

export interface Missing {
  id: 'weigh' | 'waist' | 'photo' | 'food' | 'sleep' | 'comp'
  text: string
  action: 'log' | 'photo' | 'food' | 'sleep' | null
}

/** What to log for an accurate trend this week (calm, at most a few lines). */
export function whatsMissing(input: GrowthInput): Missing[] {
  const t = input.today
  const mon = mondayOf(t)
  const out: Missing[] = []
  const weighs = input.points.filter((p) => p.day >= mon && p.day <= t && p.weight != null).length
  if (weighs < 3) {
    const n = 3 - weighs
    out.push({ id: 'weigh', text: `Log weight ${n} more time${n === 1 ? '' : 's'} this week for an accurate trend.`, action: 'log' })
  }
  const lastWaist = [...input.points].reverse().find((p) => p.waist != null)
  if (!lastWaist || daysBetween(lastWaist.day, t) > 7) out.push({ id: 'waist', text: lastWaist ? `Measure your waist (last one ${daysBetween(lastWaist.day, t)} days ago).` : 'Measure your waist once a week: it tells muscle from fat.', action: 'log' })
  const comp = input.points.some((p) => p.day >= addDays(t, -30) && (p.fat != null || p.muscle != null))
  if (!comp && input.points.length) out.push({ id: 'comp', text: 'Add body fat % when you weigh in (an estimate) to see lean mass.', action: 'log' })
  if (!input.lastPhotoDay || daysBetween(input.lastPhotoDay, t) >= 28) out.push({ id: 'photo', text: input.lastPhotoDay ? `Take a progress photo (last one ${daysBetween(input.lastPhotoDay, t)} days ago).` : 'Take a first progress photo: your starting point.', action: 'photo' })
  const fed = input.food.filter((f) => f.day >= addDays(t, -6) && f.day <= t && (f.kcal > 0 || f.protein > 0)).length
  if (fed < 5) out.push({ id: 'food', text: `Food logged on ${fed} of the last 7 days: log meals to see protein and kcal.`, action: 'food' })
  const slept = input.sleep.filter((s) => s.day >= addDays(t, -6) && s.minutes != null).length
  if (slept < 4) out.push({ id: 'sleep', text: `Sleep logged ${slept} of the last 7 nights.`, action: 'sleep' })
  return out
}
