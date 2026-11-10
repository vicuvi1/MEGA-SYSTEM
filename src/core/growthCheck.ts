// "Am I really growing?" (Sport Track → Growth, docs/design/sport-track/Growth.dc.html):
// one honest verdict from six signs, each good / improve / fix with a bar:
//   Strength  how much stronger than the start of the window (growthBody strength index)
//   Weight    kg a month against the lean-gain zone (+0.4 to +0.8, you can change it)
//   Waist     the change in cm (flat while weight rises means the gain is muscle)
//   Training  hard sets per muscle a week (10–20 grows muscle)
//   Protein   days at your protein goal in the last 7
//   Sleep     the average night (7 h or more)
// A sign with too little data says exactly what to log; with fewer than three signs
// (or neither weight nor strength) there is NO verdict, only what to log. The score is
// the mean of the signs that have data; nothing is invented and nothing pays points.
// Pure, tested (growthCheck.test.ts, clock pinned by passing `today`).
import { addDays, daysBetween } from './dates'
import { mondayOf } from './bodyComp'
import { proteinGoalOn, strengthIndex, strengthOn, strengthPct, trainingDays, weeklySeries, type GrowthInput, type WeekPoint } from './growthBody'
import { hardSetsWeeks } from './trainStreak'
import { SLEEP_GOOD_MIN } from './growthLevels'
import type { SportEx } from './sportLadders'

export const GROWTH_WEEKS = 8
export const DEFAULT_ZONE = { lo: 0.4, hi: 0.8 }
export const SETS_BAND = { lo: 10, hi: 20 }
export const STRENGTH_GOAL = 10
export const PROTEIN_GOAL_DAYS = 6

export type SignState = 'good' | 'improve' | 'fix' | 'none'
export type SignId = 'strength' | 'weight' | 'waist' | 'training' | 'protein' | 'sleep'
export interface Sign {
  id: SignId
  label: string
  state: SignState
  /** The big number ("+18%", "5 of 7 days"), or "—" with no data. */
  value: string
  /** One plain sentence. */
  meaning: string
  /** 0–100, how full the bar is. */
  bar: number
  low: string
  goal: string
  /** With no data: exactly what to log. */
  log?: string
  /** What to do when it is not good (for "To grow faster"). */
  fix?: { title: string; text: string }
}

export type Verdict = 'yes' | 'maybe' | 'no' | 'toolittle'
export interface GrowthCheck {
  weeks: number
  from: string
  verdict: Verdict
  /** The score ring (0–100); null with no verdict. */
  score: number | null
  headline: string
  line: string
  /** "4 of 6 signs are green · 2 to improve · based on 23 workouts, 18 weigh-ins and 52 food days" */
  basis: string
  signs: Sign[]
  /** The top fixes (at most 2). */
  faster: { title: string; text: string }[]
  /** Exactly what to log (always set when a sign has no data). */
  missing: string[]
  counts: { workouts: number; weighIns: number; foodDays: number; nights: number }
  zone: { lo: number; hi: number }
}

const r1 = (n: number) => Math.round(n * 10) / 10
const r2 = (n: number) => Math.round(n * 100) / 100
const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n))
const avg = (l: number[]) => (l.length ? l.reduce((t, v) => t + v, 0) / l.length : null)
const exercisesOf = (st: any): SportEx[] => (Array.isArray(st?.exercises) ? st.exercises : [])
const signed = (n: number, unit: string, d = 1) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n).toFixed(d)} ${unit}`
const hm = (min: number) => `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, '0')}`

/** A valid zone from what you typed (lo below hi, kg a month), else the default. */
export function cleanZone(x: unknown): { lo: number; hi: number } {
  const o = (x && typeof x === 'object' ? x : {}) as { lo?: unknown; hi?: unknown }
  const lo = Number(o.lo)
  const hi = Number(o.hi)
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo < 0 || hi > 3 || hi <= lo) return { ...DEFAULT_ZONE }
  return { lo: r2(lo), hi: r2(hi) }
}

const none = (id: SignId, label: string, low: string, goal: string, log: string): Sign => ({ id, label, state: 'none', value: '—', meaning: log, bar: 0, low, goal, log })

/** The weekly-average weight line over the window: first and last weeks with weigh-ins, kg a month. */
function weightRate(weeks: WeekPoint[]): { change: number; perMonth: number; days: number; n: number } | null {
  const have = weeks.filter((w) => w.weight != null)
  if (have.length < 2) return null
  const a = have[0]
  const b = have[have.length - 1]
  const days = daysBetween(a.week, b.week)
  if (days < 14) return null
  const change = r2((b.weight as number) - (a.weight as number))
  return { change, perMonth: r2((change / days) * 30.4), days, n: have.reduce((t, w) => t + w.weightN, 0) }
}

export function growthCheck(input: GrowthInput, opts: { weeks?: number; zone?: { lo: number; hi: number } } = {}): GrowthCheck {
  const weeks = opts.weeks ?? GROWTH_WEEKS
  const zone = cleanZone(opts.zone)
  const t = input.today
  const from = addDays(mondayOf(t), -7 * (weeks - 1))
  const idx = strengthIndex(input.sport?.sets, exercisesOf(input.sport))
  const series = weeklySeries(input, from, idx)
  const inWin = <T extends { day: string }>(l: T[]) => l.filter((p) => p.day >= from && p.day <= t)

  const workouts = trainingDays(input).filter((d) => d.day >= from && d.day <= t).length
  const weighIns = inWin(input.points).filter((p) => p.weight != null).length
  const foodDaysAll = inWin(input.food).filter((f) => f.kcal > 0 || f.protein > 0)
  const nights = inWin(input.sleep).filter((s) => s.minutes != null)
  const counts = { workouts, weighIns, foodDays: foodDaysAll.length, nights: nights.length }

  const signs: Sign[] = []

  // ---- strength
  {
    const firstSet = [...idx.series.values()].map((s) => s[0]?.day).filter(Boolean).sort()[0] as string | undefined
    let thenDay = from
    if (firstSet && firstSet > addDays(from, -27)) thenDay = addDays(firstSet, 6)
    const pct = thenDay < addDays(t, -6) ? strengthPct(strengthOn(idx, thenDay), strengthOn(idx, t)) : null
    const label = 'Strength'
    const low = '0%'
    const goal = `goal +${STRENGTH_GOAL}% / ${weeks} wk`
    if (pct == null) signs.push(none('strength', label, low, goal, 'Log your sets on two different weeks (a few days apart is not enough) to see if you are getting stronger.'))
    else {
      const state: SignState = pct >= STRENGTH_GOAL ? 'good' : pct > 0 ? 'improve' : 'fix'
      signs.push({
        id: 'strength',
        label,
        state,
        value: `${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct)}%`,
        meaning: pct >= STRENGTH_GOAL ? 'Stronger than at the start, on the chains you train.' : pct > 0 ? 'A little stronger. One more rep on your lowest set each session adds up.' : 'Not stronger than at the start. Add a rep or a harder step.',
        bar: clamp((pct / (STRENGTH_GOAL * 1.2)) * 100),
        low,
        goal,
        fix: state === 'good' ? undefined : { title: 'Add one rep.', text: 'Strength is flat: beat your last set by one rep, or take the next step when it unlocks.' }
      })
    }
  }

  // ---- weight
  const rate = weightRate(series)
  {
    const label = 'Weight'
    const low = '0 kg'
    const goal = `+${zone.hi} kg max`
    if (!rate || rate.n < 3) signs.push(none('weight', label, low, goal, `Weigh in on 3 mornings a week for 2 weeks (${weighIns} weigh-in${weighIns === 1 ? '' : 's'} so far).`))
    else {
      const r = rate.perMonth
      const state: SignState = r >= zone.lo && r <= zone.hi ? 'good' : (r >= zone.lo * 0.5 && r < zone.lo) || (r > zone.hi && r <= zone.hi * 1.5) ? 'improve' : 'fix'
      const meaning = state === 'good' ? `${signed(r, 'kg')} a month: inside the lean-gain zone (+${zone.lo} to +${zone.hi} kg).` : r < zone.lo ? `${signed(r, 'kg')} a month: below the zone (+${zone.lo} to +${zone.hi} kg). Too little food to grow.` : `${signed(r, 'kg')} a month: above the zone (+${zone.lo} to +${zone.hi} kg). Faster than that adds fat.`
      signs.push({
        id: 'weight',
        label,
        state,
        value: signed(rate.change, 'kg'),
        meaning,
        bar: clamp((r / (zone.hi * 2)) * 100),
        low,
        goal,
        fix: state === 'good' ? undefined : r < zone.lo ? { title: 'Eat about 200 kcal more.', text: `Weight moves ${signed(r, 'kg')} a month. Add a snack with protein, like skyr at night.` } : { title: 'Slow the surplus a little.', text: `Weight moves ${signed(r, 'kg')} a month, faster than the zone. Take off about 150 kcal a day.` }
      })
    }
  }

  // ---- waist
  {
    const label = 'Waist'
    const low = '+2 cm = fat'
    const goal = 'same'
    const w = inWin(input.points).filter((p) => p.waist != null)
    const a = w[0]
    const b = w[w.length - 1]
    if (!a || !b || daysBetween(a.day, b.day) < 7) signs.push(none('waist', label, low, goal, `Measure your waist once a week (navel, relaxed, before breakfast): ${w.length ? 'you have 1 measurement' : 'none yet'}, it tells muscle from fat.`))
    else {
      const c = r1((b.waist as number) - (a.waist as number))
      const state: SignState = c <= 1 ? 'good' : c <= 2 ? 'improve' : 'fix'
      const up = rate && rate.change > 0.2
      signs.push({
        id: 'waist',
        label,
        state,
        value: Math.abs(c) < 0.05 ? '±0.0 cm' : signed(c, 'cm'),
        meaning: state === 'good' ? (up && c <= 0.5 ? 'Waist the same while weight goes up: the gain is muscle.' : c < -0.5 ? 'Waist is going down: you are leaner.' : 'Waist about the same.') : state === 'improve' ? 'Waist is creeping up. Watch it for two more weeks.' : 'Waist up by more than 2 cm: more of the gain is fat than muscle.',
        bar: clamp(100 - (Math.max(0, c) / 3) * 100),
        low,
        goal,
        fix: state === 'good' ? undefined : { title: 'Slow the surplus.', text: `Your waist is ${signed(c, 'cm')}. Eat a little less and keep the sets: the weight should move slower.` }
      })
    }
  }

  // ---- training: hard sets per muscle a week (the last 4 weeks, this one counts when it is the only one)
  {
    const label = 'Training'
    const low = '0'
    const goal = `${SETS_BAND.lo}–${SETS_BAND.hi}`
    const wk = hardSetsWeeks(input.sport?.sets, exercisesOf(input.sport), t, 4).filter((w) => w.monday >= from)
    const full = wk.slice(0, -1).filter((w) => Object.values(w.sets).some((n) => n > 0))
    const use = full.length ? full : wk.filter((w) => Object.values(w.sets).some((n) => n > 0))
    if (!use.length) signs.push(none('training', label, low, goal, 'Log your sets in a workout (with how hard each felt) for a full week to count the hard sets per muscle.'))
    else {
      const per = (['push', 'pull', 'legs', 'core'] as const).map((m) => avg(use.map((w) => w.sets[m]))).filter((n): n is number => n != null && n > 0)
      const mean = Math.round(avg(per) ?? 0)
      const low1 = Math.min(...per)
      const state: SignState = mean >= SETS_BAND.lo && mean <= SETS_BAND.hi && low1 >= 6 ? 'good' : mean < 6 ? 'fix' : 'improve'
      signs.push({
        id: 'training',
        label,
        state,
        value: `${mean} sets`,
        meaning: state === 'good' ? `Hard sets per muscle a week. ${SETS_BAND.lo}–${SETS_BAND.hi} grows muscle.` : mean > SETS_BAND.hi ? `${mean} hard sets per muscle a week: more than ${SETS_BAND.hi} adds tiredness, not muscle.` : `${mean} hard sets per muscle a week: ${SETS_BAND.lo}–${SETS_BAND.hi} grows muscle.`,
        bar: clamp((mean / SETS_BAND.hi) * 100),
        low,
        goal,
        fix: state === 'good' ? undefined : mean > SETS_BAND.hi ? { title: 'Do a little less.', text: `${mean} hard sets a muscle is more than you can recover from. Aim for ${SETS_BAND.lo}–${SETS_BAND.hi}.` } : { title: `Aim for ${SETS_BAND.lo}+ hard sets per muscle.`, text: `You do about ${mean} a week. Add one set to each move on your training days.` }
      })
    }
  }

  // ---- protein days (the last 7)
  {
    const label = 'Protein'
    const low = '0 days'
    const goal = `${PROTEIN_GOAL_DAYS} of 7`
    const last7 = input.food.filter((f) => f.day >= addDays(t, -6) && f.day <= t && (f.kcal > 0 || f.protein > 0))
    if (last7.length < 3) signs.push(none('protein', label, low, goal, `Log your food on at least 3 of the last 7 days (${last7.length} so far) to count the days at your protein goal.`))
    else {
      const hit = last7.filter((f) => f.protein >= proteinGoalOn(input.points, f.day, input.gPerKg)).length
      const goalG = proteinGoalOn(input.points, t, input.gPerKg)
      const state: SignState = hit >= PROTEIN_GOAL_DAYS ? 'good' : hit >= 4 ? 'improve' : 'fix'
      signs.push({
        id: 'protein',
        label,
        state,
        value: `${hit} of 7 days`,
        meaning: `Days at ${goalG} g or more. Aim for ${PROTEIN_GOAL_DAYS} of 7.${last7.length < 7 ? ` (Food logged on ${last7.length} of the 7 days.)` : ''}`,
        bar: clamp((hit / 7) * 100),
        low,
        goal,
        fix: state === 'good' ? undefined : { title: `Protein on ${PROTEIN_GOAL_DAYS} of 7 days.`, text: `You hit ${goalG} g on ${hit} of 7. Add skyr or eggs at night.` }
      })
    }
  }

  // ---- sleep (the last 14 nights)
  {
    const label = 'Sleep'
    const low = '5 h'
    const goal = '7–9 h'
    const n14 = input.sleep.filter((s) => s.day >= addDays(t, -13) && s.day <= t && s.minutes != null).map((s) => s.minutes as number)
    if (n14.length < 4) signs.push(none('sleep', label, low, goal, `Log your sleep on at least 4 nights (${n14.length} of the last 14 so far).`))
    else {
      const m = avg(n14) as number
      const state: SignState = m >= SLEEP_GOOD_MIN ? 'good' : m >= 360 ? 'improve' : 'fix'
      signs.push({
        id: 'sleep',
        label,
        state,
        value: hm(m),
        meaning: state === 'good' ? 'Average a night. Muscle is built while you sleep.' : 'Average a night. Under 7 h slows recovery.',
        bar: clamp(((m - 300) / (SLEEP_GOOD_MIN - 300)) * 100),
        low,
        goal,
        fix: state === 'good' ? undefined : { title: 'Sleep 7 h+.', text: `You average ${hm(m)}. Muscle is built while you sleep.` }
      })
    }
  }

  // ---- the verdict
  const have = signs.filter((s) => s.state !== 'none')
  const missing = signs.filter((s) => s.log).map((s) => s.log as string)
  const greens = have.filter((s) => s.state === 'good').length
  const improve = have.filter((s) => s.state === 'improve').length
  const fixes = have.filter((s) => s.state === 'fix').length
  const basis = `${greens} of ${have.length} signs are green${improve ? ` · ${improve} to improve` : ''}${fixes ? ` · ${fixes} to fix` : ''} · based on ${workouts} workout${workouts === 1 ? '' : 's'}, ${weighIns} weigh-in${weighIns === 1 ? '' : 's'} and ${foodDaysAll.length} food day${foodDaysAll.length === 1 ? '' : 's'}`
  const get = (id: SignId) => signs.find((s) => s.id === id)!
  const enough = have.length >= 3 && (get('weight').state !== 'none' || get('strength').state !== 'none')
  const order: SignId[] = ['protein', 'sleep', 'weight', 'training', 'strength', 'waist']
  const faster = have
    .filter((s) => s.fix)
    .sort((a, b) => (a.state === b.state ? order.indexOf(a.id) - order.indexOf(b.id) : a.state === 'fix' ? -1 : 1))
    .slice(0, 2)
    .map((s) => s.fix!)

  if (!enough)
    return {
      weeks,
      from,
      verdict: 'toolittle',
      score: null,
      headline: 'Not enough logged yet to say.',
      line: 'A verdict needs real numbers, so here is exactly what to log. It takes about two weeks.',
      basis,
      signs,
      faster: [],
      missing,
      counts: { ...counts, nights: nights.length },
      zone
    }

  const pts = have.reduce((n, s) => n + (s.state === 'good' ? 100 : s.state === 'improve' ? 55 : 15), 0)
  const score = Math.round(pts / have.length)
  const s = get('strength')
  const w = get('weight')
  const wa = get('waist')
  const bits: string[] = []
  if (s.state !== 'none') bits.push(s.state === 'fix' ? 'Not stronger yet' : 'Stronger')
  if (rate && w.state !== 'none') bits.push(rate.change > 0.1 ? 'weight up slowly' : rate.change < -0.1 ? 'weight going down' : 'weight flat')
  if (wa.state !== 'none') bits.push(wa.state === 'good' ? (wa.value.includes('±') ? 'waist the same' : 'waist down') : 'waist up')
  const muscle = s.state !== 'fix' && s.state !== 'none' && rate && rate.change > 0.1 && wa.state === 'good'
  const sentence = `${bits.length ? bits.join(', ').replace(/^./, (c) => c.toUpperCase()) + '.' : ''}${muscle ? ' That pattern is muscle, not fat.' : ''}`.trim()
  let verdict: Verdict
  let headline: string
  let line: string
  if (score >= 70 && s.state !== 'fix' && wa.state !== 'fix') {
    verdict = 'yes'
    headline = 'Yes, you are growing lean muscle.'
    line = sentence || 'Most of your signs are green.'
  } else if (score >= 45) {
    verdict = 'maybe'
    headline = 'Slowly: not every sign agrees yet.'
    line = `${sentence} Fix the ${fixes ? 'red' : 'amber'} sign${fixes + improve > 1 ? 's' : ''} below first.`.trim()
  } else {
    verdict = 'no'
    headline = 'Not yet. Your signs say to change something.'
    line = `${sentence} The red signs below are the fastest fix.`.trim()
  }
  return { weeks, from, verdict, score, headline, line, basis, signs, faster, missing, counts: { ...counts, nights: nights.length }, zone }
}

// ---------------------------------------------------------------- the chart

export interface GrowthChart {
  weeks: { week: string; weight: number | null; waist: number | null }[]
  /** The lean-gain band from the first weigh-in week: kg low and high for each week. */
  lo: (number | null)[]
  hi: (number | null)[]
  /** Last weight and waist. */
  weight: number | null
  waist: number | null
  firstWeight: number | null
}

/** Weekly average weight and waist with the lean-gain band (kg a month from the first week with weight). */
export function growthChart(input: GrowthInput, opts: { weeks?: number; zone?: { lo: number; hi: number } } = {}): GrowthChart {
  const weeks = opts.weeks ?? GROWTH_WEEKS
  const zone = cleanZone(opts.zone)
  const from = addDays(mondayOf(input.today), -7 * (weeks - 1))
  const series = weeklySeries(input, from)
  const first = series.find((w) => w.weight != null) ?? null
  const band = (w: WeekPoint, perMonth: number) => (first && w.week >= first.week ? r2((first.weight as number) + perMonth * (daysBetween(first.week, w.week) / 30.4)) : null)
  const last = [...series].reverse()
  return {
    weeks: series.map((w) => ({ week: w.week, weight: w.weight, waist: w.waist })),
    lo: series.map((w) => band(w, zone.lo)),
    hi: series.map((w) => band(w, zone.hi)),
    weight: last.find((w) => w.weight != null)?.weight ?? null,
    waist: last.find((w) => w.waist != null)?.waist ?? null,
    firstWeight: first?.weight ?? null
  }
}
