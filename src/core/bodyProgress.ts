// The Body → Progress tab: pure, tested logic. Strength per move family,
// weight and waist trend with a plain verdict, personal records, the monthly
// body report. Every number comes from the data given; nothing here pays
// points. Reads sets (sportSets), strength scores (sportStrength) and the
// weight trend (weightTrend); it never writes anything.
import { addDays, daysBetween } from './dates'
import { FAMILIES, moveById } from './sportMoves'
import { moveOf, type SportEx, type DayLog } from './sportLadders'
import { sessionsOf, type SetLog } from './sportSets'
import { familySeries, type StrengthPoint } from './sportStrength'
import { cleanWeighIns, trendPoints, type TrendPoint } from './weightTrend'
import { TARGET_BAND } from './bodyComp'

const r1 = (n: number) => Math.round(n * 10) / 10
const sign = (n: number) => (n >= 0 ? '+' : '−')
const fmt = (n: number) => `${sign(n)}${Math.abs(r1(n))}`

/** The four move families the chart can show. */
export const STRENGTH_PICKS: { id: string; label: string }[] = [
  { id: 'pushup', label: 'Push-ups' },
  { id: 'row', label: 'Rows' },
  { id: 'squat', label: 'Squats' },
  { id: 'core', label: 'Core' }
]

// ---------- 1. Strength per move ----------

export interface StrengthBand {
  move: string
  name: string
  /** 0 = the easiest step of the ladder. */
  step: number
  from: string
  to: string
}

export interface StrengthView {
  family: string
  name: string
  points: (StrengthPoint & { name: string; step: number })[]
  /** One band per stretch of days where the same variation was your best set. */
  bands: StrengthBand[]
  /** % stronger than about 4 weeks ago (null: not enough data yet). */
  pct: number | null
  line: string
}

const stepOf = (id: string) => Math.max(0, (FAMILIES[moveById(id)?.family ?? '']?.steps ?? []).indexOf(id))

/** Best set per day for one family, the variation bands and "+X% stronger than 4 weeks ago". */
export function strengthView(log: SetLog | null | undefined, exercises: SportEx[], family: string, today: string, weeks = 4): StrengthView {
  const name = FAMILIES[family]?.name ?? family
  const raw = familySeries(log, exercises, family, today)
  const points = raw.map((p) => ({ ...p, name: moveById(p.move)?.name ?? p.move, step: stepOf(p.move) }))
  const bands: StrengthBand[] = []
  for (const p of points) {
    const last = bands[bands.length - 1]
    if (last && last.move === p.move) last.to = p.day
    else bands.push({ move: p.move, name: p.name, step: p.step, from: p.day, to: p.day })
  }
  // Best score in the last 14 days against the best in the 14 days around 4 weeks ago (or the first week, if newer).
  const best = (from: string, to: string) => points.filter((p) => p.day >= from && p.day <= to).reduce<number>((b, p) => Math.max(b, p.score), 0)
  const now = best(addDays(today, -13), today)
  let then = best(addDays(today, -7 * weeks - 7), addDays(today, -7 * weeks + 7))
  let thenLabel = `${weeks} weeks ago`
  if (!then && points.length && points[0].day <= addDays(today, -7)) {
    then = best(points[0].day, addDays(points[0].day, 6))
    thenLabel = `your first week (${points[0].day.slice(5)})`
  }
  let pct: number | null = null
  let line = points.length ? 'Log a few more weeks of sets to see the change.' : `No ${name.toLowerCase()} sets yet. Log a set in Sport Track and it shows here.`
  if (now && then && points.find((p) => p.score === now && p.day >= addDays(today, -13))!.day > points[0].day) {
    pct = Math.round((now / then - 1) * 100)
    line = pct === 0 ? `Same strength as ${thenLabel}.` : pct > 0 ? `+${pct}% stronger than ${thenLabel}.` : `${pct}% under ${thenLabel}: a rest week or a short night can do that.`
  }
  return { family, name, points, bands, pct, line }
}

/** Average % across the picks that have data (the hero number). */
export function strengthHero(log: SetLog | null | undefined, exercises: SportEx[], today: string): { pct: number | null; used: number } {
  const v = STRENGTH_PICKS.map((p) => strengthView(log, exercises, p.id, today).pct).filter((x): x is number => x != null)
  return { pct: v.length ? Math.round(v.reduce((t, x) => t + x, 0) / v.length) : null, used: v.length }
}

// ---------- 2. Weight and waist ----------

export interface TrendView {
  points: TrendPoint[]
  waist: { day: string; waist: number }[]
  /** The target band from the trend 28 days ago: +0.25 to +0.5 kg a week (TARGET_BAND, the same band everywhere). */
  zone: { from: string; to: string; lo0: number; hi0: number; lo1: number; hi1: number } | null
  verdict: Verdict
}

export interface Verdict {
  tone: 'good' | 'warn' | 'none'
  text: string
  dKg: number | null
  dWaist: number | null
  days: number
}

/** The one target band (+0.25 to +0.5 kg a week): Progress, the food goals and the calorie suggestion all use it. */
export const LEAN_ZONE = TARGET_BAND
/** Under this (kg a week) the weight is flat; over FAST it is faster than the band (core/foodAdjust.ts uses the same numbers). */
const FLAT = 0.1
const FAST = 0.6

export function cleanWaists(list: { day: string; waist?: number | null }[]): { day: string; waist: number }[] {
  const by = new Map<string, number>()
  for (const m of list ?? []) {
    const v = Number(m?.waist)
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(m?.day)) && Number.isFinite(v) && v >= 40 && v <= 200) by.set(m.day, v)
  }
  return [...by.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([day, waist]) => ({ day, waist }))
}

/**
 * The plain verdict over about 4 weeks. Needs weigh-ins at least 14 days
 * apart. Waist up 1 cm or more beats everything: slow the surplus. Weight up
 * with the waist within half a cm: likely muscle.
 */
export function bodyVerdict(weights: { day: string; weight: number | null | undefined }[], waists: { day: string; waist?: number | null }[], today: string): Verdict {
  const pts = trendPoints(cleanWeighIns(weights), today, 120)
  const empty: Verdict = { tone: 'none', text: 'Log weight and waist weekly. After about two weeks Ben can say if the gain is muscle.', dKg: null, dWaist: null, days: 0 }
  if (!pts.length) return empty
  const nowP = pts[pts.length - 1]
  const thenDay = addDays(today, -28)
  const thenP = pts.find((p) => p.day >= thenDay) ?? pts[0]
  const days = daysBetween(thenP.day, nowP.day)
  if (days < 14) return empty
  const dKg = r1(nowP.trend - thenP.trend)
  const wk = cleanWaists(waists)
  const wNow = wk[wk.length - 1]
  // The last waist reading near the start (up to 3 days after it, at most 14 before), older than the latest one.
  const wThen = wNow ? [...wk].reverse().find((w) => w.day <= addDays(thenP.day, 3) && w.day >= addDays(thenP.day, -14) && w.day < wNow.day) : undefined
  const dWaist = wNow && wThen ? r1(wNow.waist - wThen.waist) : null
  const span = days >= 25 ? '4 weeks' : `${Math.round(days / 7)} weeks`
  const perWeek = dKg / (days / 7)
  const kg = `${fmt(dKg)} kg in ${span}`
  if (dWaist == null) return { tone: 'none', text: `${kg}. Log your waist too, so we can tell muscle from fat.`, dKg, dWaist, days }
  if (dWaist >= 1) return { tone: 'warn', text: `${kg}, waist up ${r1(dWaist)} cm: slow the surplus.`, dKg, dWaist, days }
  const waistWord = Math.abs(dWaist) < 0.5 ? 'the same' : dWaist > 0 ? `up ${r1(dWaist)} cm` : `down ${r1(-dWaist)} cm`
  if (dKg <= -0.3) return { tone: 'warn', text: `${kg}, waist ${waistWord}: you are losing weight. Eat a little more to build.`, dKg, dWaist, days }
  if (perWeek < FLAT) return { tone: 'none', text: `${kg}, waist ${waistWord}: weight is flat. Add a little food if you want to grow.`, dKg, dWaist, days }
  if (perWeek > FAST) return { tone: 'warn', text: `${kg}, waist ${waistWord}: faster than the target band (+0.25–0.5 kg a week). Watch the waist.`, dKg, dWaist, days }
  if (perWeek < LEAN_ZONE.lo) return { tone: 'good', text: `${kg}, waist ${waistWord}: likely muscle, a little under the target band.`, dKg, dWaist, days }
  return { tone: 'good', text: `${kg}, waist ${waistWord}: ${dWaist < 0.5 ? 'likely muscle' : 'mostly fine, keep an eye on the waist'}.`, dKg, dWaist, days }
}

export function trendView(weights: { day: string; weight: number | null | undefined }[], waists: { day: string; waist?: number | null }[], today: string, days = 56): TrendView {
  const all = trendPoints(cleanWeighIns(weights), today, 120)
  const points = all.filter((p) => p.day > addDays(today, -days))
  const anchor = all.find((p) => p.day >= addDays(today, -28)) ?? all[0]
  let zone: TrendView['zone'] = null
  if (anchor && points.length) {
    const wks = daysBetween(anchor.day, today) / 7
    zone = { from: anchor.day, to: today, lo0: anchor.trend, hi0: anchor.trend, lo1: anchor.trend + LEAN_ZONE.lo * wks, hi1: anchor.trend + LEAN_ZONE.hi * wks }
  }
  return { points, waist: cleanWaists(waists).filter((w) => w.day > addDays(today, -days)), zone, verdict: bodyVerdict(weights, waists, today) }
}

// ---------- 4. Personal records ----------

export interface RecordCard {
  id: string
  kind: 'reps' | 'hold' | 'day' | 'first'
  title: string
  value: string
  day: string
  /** Set in the last 7 days. */
  isNew: boolean
}

/** Max reps in one set per move, longest hold, best day total, first time on each harder variation. */
export function personalRecords(log: SetLog | null | undefined, exercises: SportEx[], days: DayLog | null | undefined, today: string): RecordCard[] {
  const out: RecordCard[] = []
  const fresh = (d: string) => d >= addDays(today, -6) && d <= today
  const byMove = new Map<string, { name: string; unit: string; family: string; reps: number; day: string; first: string }>()
  for (const ex of exercises) {
    const mv = moveOf(ex)
    if (!mv) continue
    for (const s of sessionsOf(log, String(ex.id), today)) {
      const top = Math.max(...s.reps)
      const cur = byMove.get(mv.id)
      if (!cur) byMove.set(mv.id, { name: mv.name, unit: mv.unit, family: mv.family, reps: top, day: s.day, first: s.day })
      else {
        if (top > cur.reps) (cur.reps = top), (cur.day = s.day)
        if (s.day < cur.first) cur.first = s.day
      }
    }
  }
  for (const [id, m] of byMove) {
    if (m.unit === 'sec') out.push({ id: `hold-${id}`, kind: 'hold', title: `${m.name} hold`, value: `${m.reps} s`, day: m.day, isNew: fresh(m.day) })
    else out.push({ id: `reps-${id}`, kind: 'reps', title: m.name, value: `${m.reps} reps`, day: m.day, isNew: fresh(m.day) })
  }
  // Best day: the most reps (not holds) in one day, from the day log.
  const holdIds = new Set(exercises.filter((e) => moveOf(e)?.unit === 'sec').map((e) => String(e.id)))
  let bestDay: { day: string; total: number } | null = null
  for (const [d, row] of Object.entries(days ?? {})) {
    if (d > today) continue
    const total = Object.entries(row ?? {}).reduce((t, [id, n]) => t + (holdIds.has(id) ? 0 : Math.max(0, Number(n) || 0)), 0)
    if (total > 0 && (!bestDay || total > bestDay.total)) bestDay = { day: d, total }
  }
  if (bestDay) out.push({ id: 'best-day', kind: 'day', title: 'Best day', value: `${bestDay.total} reps`, day: bestDay.day, isNew: fresh(bestDay.day) })
  // First time on each harder variation: every move above the first one you used in its family.
  const fams = new Map<string, { id: string; step: number; first: string }[]>()
  for (const [id, m] of byMove) {
    const l = fams.get(m.family) ?? []
    l.push({ id, step: stepOf(id), first: m.first })
    fams.set(m.family, l)
  }
  for (const list of fams.values()) {
    if (list.length < 2) continue
    const base = list.reduce((a, b) => (b.first < a.first || (b.first === a.first && b.step < a.step) ? b : a))
    for (const m of list) {
      if (m.id === base.id || m.step <= base.step) continue
      out.push({ id: `first-${m.id}`, kind: 'first', title: `First ${moveById(m.id)?.name ?? m.id}`, value: 'harder step', day: m.first, isNew: fresh(m.first) })
    }
  }
  return out.sort((a, b) => (a.isNew === b.isNew ? (a.day < b.day ? 1 : -1) : a.isNew ? -1 : 1))
}

// ---------- 5. Monthly body report ----------

export interface MonthInput {
  today: string
  log: SetLog | null | undefined
  exercises: SportEx[]
  metrics: { day: string; weight?: number | null; waist?: number | null }[]
  /** Days with a logged workout (any source). */
  workoutDays: string[]
  /** Protein goal days in the last 7 (null: no food log). */
  protein: { hit: number; days: number } | null
}

export interface MonthReport {
  month: string
  label: string
  from: string
  to: string
  strengthPct: number | null
  weightKg: number | null
  waistCm: number | null
  workouts: number
  protein: { hit: number; days: number } | null
  goal: string
  text: string
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** The month so far, or the last full month while the new one is under a week old. */
export function monthReport(i: MonthInput): MonthReport {
  const thisFirst = i.today.slice(0, 8) + '01'
  const useLast = Number(i.today.slice(8)) < 8
  const from = useLast ? addDays(thisFirst, -1).slice(0, 8) + '01' : thisFirst
  const to = useLast ? addDays(thisFirst, -1) : i.today
  const label = `${MONTHS[Number(from.slice(5, 7)) - 1]} ${from.slice(0, 4)}`
  // Strength: per family the best score in the month against the best in the 31 days before it.
  const pcts: { name: string; pct: number }[] = []
  for (const p of STRENGTH_PICKS) {
    const pts = familySeries(i.log, i.exercises, p.id, to)
    const inM = pts.filter((x) => x.day >= from).reduce((b, x) => Math.max(b, x.score), 0)
    const before = pts.filter((x) => x.day < from && x.day >= addDays(from, -31)).reduce((b, x) => Math.max(b, x.score), 0)
    if (inM && before) pcts.push({ name: p.label, pct: Math.round((inM / before - 1) * 100) })
  }
  const strengthPct = pcts.length ? Math.round(pcts.reduce((t, x) => t + x.pct, 0) / pcts.length) : null
  const change = (key: 'weight' | 'waist'): number | null => {
    const rows = i.metrics.filter((m) => m[key] != null && Number.isFinite(Number(m[key]))).sort((a, b) => (a.day < b.day ? -1 : 1))
    const inM = rows.filter((m) => m.day >= from && m.day <= to)
    if (!inM.length) return null
    const start = [...rows].reverse().find((m) => m.day < from) ?? inM[0]
    const end = inM[inM.length - 1]
    return end.day === start.day ? null : r1(Number(end[key]) - Number(start[key]))
  }
  const weightKg = change('weight')
  const waistCm = change('waist')
  const setDays = Object.keys(i.log ?? {}).filter((d) => d >= from && d <= to && Object.values(i.log![d] ?? {}).some((l) => Array.isArray(l) && l.length))
  const workouts = new Set([...i.workoutDays.filter((d) => d >= from && d <= to), ...setDays]).size
  // One next goal: beat the best set of the weakest family; or fix the waist; or just log.
  let goal = 'Log your sets for two weeks and the next goal shows here.'
  if (waistCm != null && waistCm >= 1) goal = 'Hold your food steady for two weeks and measure the waist again.'
  else if (pcts.length) {
    const weak = [...pcts].sort((a, b) => a.pct - b.pct)[0]
    const fam = STRENGTH_PICKS.find((p) => p.label === weak.name)!.id
    const top = familySeries(i.log, i.exercises, fam, to).slice(-1)[0]
    goal = top ? `Add 1 rep to your best ${moveById(top.move)?.name ?? weak.name} set (now ${top.reps}).` : goal
  }
  const parts = [
    strengthPct != null ? `Strength ${strengthPct >= 0 ? '+' : ''}${strengthPct}% vs the month before` : 'Strength: not enough sets to compare yet',
    weightKg != null ? `weight ${fmt(weightKg)} kg` : 'weight: log more',
    waistCm != null ? `waist ${fmt(waistCm)} cm` : 'waist: log more',
    `${workouts} workout day${workouts === 1 ? '' : 's'}`,
    ...(i.protein ? [`protein goal ${i.protein.hit} of the last ${i.protein.days} days`] : [])
  ]
  const text = `Body report, ${label}\n${parts.join('\n')}\nNext goal: ${goal}`
  return { month: from.slice(0, 7), label, from, to, strengthPct, weightKg, waistCm, workouts, protein: i.protein, goal, text }
}
