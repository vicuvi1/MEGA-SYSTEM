// BD2: the lean-bulk weight trend. Daily weigh-ins swing with water and food,
// so each day gets a 7-day average (the trend). The trend's pace over the
// last 4 weeks is compared with a lean-bulk pace of +0.25–0.5 % of body
// weight a month, and Ben says "add about 200 kcal", "hold steady" or "ease
// off a little". No calorie tracker: one rough daily-need guess at most.
// Pure and tested.
import { addDays, daysBetween } from './dates'

export interface WeighIn {
  day: string
  weight: number
}

export interface TrendPoint {
  day: string
  /** That day's weigh-in (null on days without one). */
  weight: number | null
  /** The average of the weigh-ins in the 7 days up to this day. */
  trend: number
}

export type Nudge = 'wait' | 'add' | 'hold' | 'ease'

export interface WeightTrend {
  points: TrendPoint[]
  /** The latest trend value. */
  now: number | null
  /** Change of the trend per 30 days, in kg and in % of body weight (null without enough data). */
  perMonthKg: number | null
  perMonthPct: number | null
  /** The lean-bulk pace for you, kg a month. */
  targetKg: { lo: number; hi: number } | null
  nudge: Nudge
  /** One line for the card and Ben. */
  line: string
  /** About how many kcal a day to change (+200, −150, 0). */
  kcal: number
}

/** The lean-bulk pace: % of body weight a month. */
export const BULK_PACE = { lo: 0.25, hi: 0.5 }

const r1 = (n: number) => Math.round(n * 10) / 10
const r2 = (n: number) => Math.round(n * 100) / 100

/** Clean weigh-ins: one per day (the last one), sane numbers, oldest first. */
export function cleanWeighIns(list: { day: string; weight: number | null | undefined }[]): WeighIn[] {
  const byDay = new Map<string, number>()
  for (const w of list ?? []) {
    const v = Number(w?.weight)
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(w?.day)) && Number.isFinite(v) && v >= 30 && v <= 250) byDay.set(w.day, v)
  }
  return [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([day, weight]) => ({ day, weight }))
}

/** Every day from the first weigh-in to `today` with its 7-day average (days with no weigh-in in the window are skipped). */
export function trendPoints(list: WeighIn[], today: string, days = 56): TrendPoint[] {
  const w = cleanWeighIns(list)
  if (!w.length) return []
  const from = w[0].day > addDays(today, -days + 1) ? w[0].day : addDays(today, -days + 1)
  const byDay = new Map(w.map((x) => [x.day, x.weight]))
  const out: TrendPoint[] = []
  for (let d = from; d <= today; d = addDays(d, 1)) {
    const win = w.filter((x) => x.day > addDays(d, -7) && x.day <= d)
    if (!win.length) continue
    out.push({ day: d, weight: byDay.get(d) ?? null, trend: r2(win.reduce((t, x) => t + x.weight, 0) / win.length) })
  }
  return out
}

/** The least-squares slope of the trend (kg per day) over the points given. */
function slope(points: TrendPoint[]): number {
  const n = points.length
  if (n < 2) return 0
  const x0 = points[0].day
  const xs = points.map((p) => daysBetween(x0, p.day))
  const mx = xs.reduce((t, x) => t + x, 0) / n
  const my = points.reduce((t, p) => t + p.trend, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (points[i].trend - my)
    den += (xs[i] - mx) ** 2
  }
  return den ? num / den : 0
}

/**
 * The trend and the nudge. It needs at least 14 days between the first and
 * the last weigh-in in the last 4 weeks and 5 weigh-ins; until then it says
 * how many more.
 */
export function weightTrend(list: { day: string; weight: number | null | undefined }[], today: string): WeightTrend {
  const w = cleanWeighIns(list)
  const points = trendPoints(w, today)
  const now = points.length ? points[points.length - 1].trend : null
  const recent = points.filter((p) => p.day > addDays(today, -28))
  const recentIns = w.filter((x) => x.day > addDays(today, -28))
  const span = recentIns.length ? daysBetween(recentIns[0].day, recentIns[recentIns.length - 1].day) : 0
  const targetKg = now ? { lo: r2((now * BULK_PACE.lo) / 100), hi: r2((now * BULK_PACE.hi) / 100) } : null
  if (!now || recentIns.length < 5 || span < 14) {
    const need = Math.max(5 - recentIns.length, 0)
    const line = !w.length ? 'Weigh yourself in the morning, after the toilet, a few times a week: the trend shows up after 2 weeks.' : need ? `${need} more morning weigh-in${need === 1 ? '' : 's'} and about 2 weeks, then the trend can say if you are eating enough to grow.` : `About ${Math.max(1, 14 - span)} more day${14 - span === 1 ? '' : 's'} of weigh-ins, then the trend can say if you are eating enough to grow.`
    return { points, now, perMonthKg: null, perMonthPct: null, targetKg, nudge: 'wait', line, kcal: 0 }
  }
  const perMonthKg = r2(slope(recent) * 30)
  const perMonthPct = r2((perMonthKg / now) * 100)
  const tgt = targetKg!
  const pace = `${perMonthKg >= 0 ? '+' : '−'}${Math.abs(r1(perMonthKg))} kg a month`
  if (perMonthPct < BULK_PACE.lo) {
    const kcal = perMonthPct < 0 ? 300 : 200
    return { points, now, perMonthKg, perMonthPct, targetKg, nudge: 'add', kcal, line: `Trend ${pace}, under the lean-bulk pace (+${r1(tgt.lo)}–${r1(tgt.hi)} kg). Add about ${kcal} kcal a day: a glass of milk and a banana, or a peanut butter sandwich.` }
  }
  if (perMonthPct > BULK_PACE.hi * 1.5) {
    return { points, now, perMonthKg, perMonthPct, targetKg, nudge: 'ease', kcal: -150, line: `Trend ${pace}, faster than a lean bulk (+${r1(tgt.lo)}–${r1(tgt.hi)} kg). Ease off about 150 kcal a day so it stays mostly muscle.` }
  }
  return { points, now, perMonthKg, perMonthPct, targetKg, nudge: 'hold', kcal: 0, line: `Trend ${pace}: right on a lean-bulk pace (+${r1(tgt.lo)}–${r1(tgt.hi)} kg). Hold steady.` }
}

/** A rough daily need (kcal) from body weight only: a guess, the trend is the real test. */
export const roughKcal = (weightKg: number | null | undefined) => (weightKg && weightKg >= 35 && weightKg <= 200 ? Math.round((weightKg * 33) / 50) * 50 : null)
