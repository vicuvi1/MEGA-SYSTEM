// "When will I get there?": forecasts from your recent pace, goals with a date,
// the Sunday progress story and the personal-records wall. Pure and tested.
// Nothing here pays points.
import { moveOf } from './sportLadders'
import { mondayOf, shiftDay } from './sportSets'
import { placeAll, placeFamily, seriesOf, type HistoryInput } from './sportLevels'
import { sessionsFor } from './sportCoach'

const dayNum = (d: string) => Math.round(Date.parse(d + 'T12:00:00Z') / 86400000)

/** Least-squares slope (per day) and the fitted value at `at`; null with fewer than 3 points or under a week of spread. */
export function trendLine(points: { day: string; v: number }[], at: string): { slope: number; now: number } | null {
  if (points.length < 3) return null
  const xs = points.map((p) => dayNum(p.day))
  if (Math.max(...xs) - Math.min(...xs) < 7) return null
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length
  const my = points.reduce((a, p) => a + p.v, 0) / points.length
  let num = 0
  let den = 0
  points.forEach((p, i) => { num += (xs[i] - mx) * (p.v - my); den += (xs[i] - mx) ** 2 })
  if (!den) return null
  const slope = num / den
  return { slope, now: my + slope * (dayNum(at) - mx) }
}

export interface Forecast {
  family: string
  name: string
  level: number
  /** The next levels, with days to reach each (null: no pace yet). */
  steps: { level: number; name: string; req: string; days: number | null }[]
  /** "Level 6 in about 12 days" */
  text: string
}

/** Days until the next levels at your recent pace (last 28 days), per family. */
export function forecasts(input: HistoryInput): Forecast[] {
  const out: Forecast[] = []
  for (const p of placeAll(input)) {
    if (!p.next) continue
    const from = shiftDay(input.today, -28)
    const pts = seriesOf(input, p.family).filter((s) => s.day >= from).map((s) => ({ day: s.day, v: s.value }))
    const t = trendLine(pts, input.today)
    const steps = [p.next, p.track.levels[p.level + 1]].filter(Boolean).map((lv) => {
      let days: number | null = null
      if (t && t.slope > 0.004) {
        const cur = Math.max(t.now, p.level + p.frac)
        days = Math.max(1, Math.round((lv!.n - cur) / t.slope))
        if (days > 365) days = null
      }
      return { level: lv!.n, name: lv!.name, req: lv!.req, days }
    })
    const s0 = steps[0]
    const text = s0.days == null
      ? `${p.track.name}: keep logging. A few more sessions and I can forecast Level ${s0.level}.`
      : s0.days <= 2
        ? `${p.track.name}: Level ${s0.level} is any day now.`
        : s0.days > 120
          ? `${p.track.name}: Level ${s0.level} in a few months at this pace.`
          : `${p.track.name}: Level ${s0.level} in about ${s0.days} days.`
    out.push({ family: p.family, name: p.track.name, level: p.level, steps, text })
  }
  return out
}

// ---------------------------------------------------------------- goals

export interface Goal {
  id: string
  exId: string
  /** Reps (or seconds) in one set. */
  reps: number
  /** YYYY-MM-DD */
  by: string
  created?: string
}

export interface GoalPace {
  goal: Goal
  name: string
  best: number
  status: 'done' | 'ahead' | 'on' | 'behind' | 'late' | 'start'
  daysLeft: number
  /** Reps per week the goal needs, and your pace. */
  needPerWeek: number
  pacePerWeek: number
  /** The day you would get there at your pace (null: no pace yet). */
  eta: string | null
  /** What to do today. */
  today: string
  text: string
}

/** Pace to a goal "50 push-ups in one set by Dec 31": on pace, ahead or behind, and what to do today. */
export function goalPace(input: HistoryInput, goal: Goal): GoalPace | null {
  const ex = input.exercises.find((e) => String(e.id) === String(goal.exId))
  if (!ex) return null
  const name = ex.name
  const sessions = sessionsFor(input, ex, input.today)
  const tops = sessions.map((s) => ({ day: s.day, top: Math.max(...s.reps) }))
  const best = Math.max(0, ...tops.map((t) => t.top))
  const daysLeft = dayNum(goal.by) - dayNum(input.today)
  const unit = moveOf(ex)?.unit === 'sec' || ex.unit === 'sec' ? ' s' : ''
  const base = { goal, name, best, daysLeft }
  if (best >= goal.reps) return { ...base, status: 'done', needPerWeek: 0, pacePerWeek: 0, eta: null, today: 'Goal reached. Set a bigger one!', text: `Done! ${best}${unit} in one set. Goal was ${goal.reps}${unit}.` }
  const from = shiftDay(input.today, -28)
  const t = trendLine(tops.filter((x) => x.day >= from).map((x) => ({ day: x.day, v: x.top })), input.today)
  const rate = t ? Math.max(0, t.slope) : 0
  const left = goal.reps - best
  const need = daysLeft > 0 ? left / daysLeft : left
  const eta = rate > 0.01 ? shiftDay(input.today, Math.ceil(left / rate)) : null
  const aim = Math.min(goal.reps, best + Math.max(1, Math.ceil(need * 3)))
  const todayTxt = `Push one set to ${aim}${unit} today (your best is ${best}${unit}).`
  const needW = Math.round(need * 7 * 10) / 10
  const paceW = Math.round(rate * 7 * 10) / 10
  let status: GoalPace['status']
  if (daysLeft < 0) status = 'late'
  else if (!t) status = 'start'
  else if (rate >= need * 1.15) status = 'ahead'
  else if (rate >= need * 0.85) status = 'on'
  else status = 'behind'
  const text =
    status === 'late' ? `The date passed and you are at ${best}${unit}. Move the date, or keep going.`
    : status === 'start' ? `You need about +${needW}${unit} a week. Log a few sessions and I will check your pace.`
    : status === 'ahead' ? `Ahead of pace: +${paceW}${unit} a week, you need +${needW}${unit}.`
    : status === 'on' ? `On pace: +${paceW}${unit} a week, you need +${needW}${unit}.`
    : `A bit behind: +${paceW}${unit} a week, you need +${needW}${unit}. Add a session or a set.`
  return { ...base, status, needPerWeek: needW, pacePerWeek: paceW, eta, today: todayTxt, text }
}

// ---------------------------------------------------------------- the weekly story

export interface Story {
  from: string
  to: string
  sessions: number
  totalReps: number
  /** vs the week before, in percent (null: nothing before). */
  vsBefore: number | null
  gains: { name: string; from: number; to: number; unit: 'reps' | 'sec' }[]
  levelUps: { name: string; from: number; to: number; levelName: string }[]
  /** "This week: +6 reps on push-ups, Level up on squats, 4 sessions" */
  headline: string
  /** One focus for next week. */
  focus: string
  /** There was any training. */
  any: boolean
}

/** The week to tell about: on Sunday, this week; otherwise the last full week (Mon–Sun). */
export function storyWeek(today: string): { from: string; to: string; label: string } {
  const sunday = new Date(today + 'T12:00:00Z').getUTCDay() === 0
  const mon = sunday ? mondayOf(today) : shiftDay(mondayOf(today), -7)
  return { from: mon, to: shiftDay(mon, 6), label: sunday ? 'This week' : 'Last week' }
}

export function weeklyStory(input: HistoryInput, missing: string[] = []): Story {
  const w = storyWeek(input.today)
  const prevFrom = shiftDay(w.from, -7)
  const sumDay = (a: string, b: string) => {
    let t = 0
    const active = new Set<string>()
    for (const [d, m] of Object.entries(input.days ?? {})) {
      if (d < a || d > b) continue
      for (const [id, v] of Object.entries(m ?? {})) {
        const ex = input.exercises.find((e) => String(e.id) === id)
        if ((Number(v) || 0) > 0) active.add(d)
        if (ex && (moveOf(ex)?.unit ?? ex.unit) === 'sec') continue
        t += Number(v) || 0
      }
    }
    return { t, active }
  }
  const cur = sumDay(w.from, w.to)
  const before = sumDay(prevFrom, shiftDay(w.from, -1))
  const gains: Story['gains'] = []
  for (const ex of input.exercises) {
    const ss = sessionsFor(input, ex, w.to)
    const inWeek = ss.filter((s) => s.day >= w.from)
    if (!inWeek.length) continue
    const earlier = ss.filter((s) => s.day < w.from)
    // Against your best before the week; with nothing before, against your first session in it.
    const prevBest = earlier.length ? Math.max(...earlier.map((s) => Math.max(...s.reps))) : Math.max(...inWeek[0].reps)
    const nowBest = Math.max(...inWeek.map((s) => Math.max(...s.reps)))
    if (prevBest && nowBest > prevBest) gains.push({ name: ex.name, from: prevBest, to: nowBest, unit: moveOf(ex)?.unit ?? 'reps' })
  }
  const levelUps: Story['levelUps'] = []
  for (const p of placeAll({ ...input, today: w.to }, w.to)) {
    const old = placeFamily(input, p.family, shiftDay(w.from, -1))
    if (old && old.level > 0 && p.level > old.level) levelUps.push({ name: p.track.name, from: old.level, to: p.level, levelName: p.lv!.name })
  }
  const parts = [
    ...gains.slice(0, 2).map((g) => `+${g.to - g.from} ${g.unit === 'sec' ? 's' : 'reps'} on ${g.name.toLowerCase()}`),
    ...levelUps.slice(0, 2).map((l) => `Level up on ${l.name.toLowerCase()}`),
    `${cur.active.size} ${cur.active.size === 1 ? 'session' : 'sessions'}`
  ]
  const any = cur.active.size > 0
  const focus = missing.length ? `Next week: ${missing[0].replace(/\?$/, '')}.` : !any ? 'Next week: start small. One short session on a day you choose.' : cur.active.size < 3 ? 'Next week: aim for one more session than this week.' : gains.length ? 'Next week: keep the same rhythm and beat last week by 1 rep per set.' : 'Next week: pick one exercise and add 1 rep to every set.'
  return {
    from: w.from,
    to: w.to,
    sessions: cur.active.size,
    totalReps: cur.t,
    vsBefore: before.t > 0 ? Math.round((cur.t / before.t - 1) * 100) : null,
    gains,
    levelUps,
    headline: `${w.label}: ${parts.join(', ')}`,
    focus,
    any
  }
}

// ---------------------------------------------------------------- the records wall

export interface RecordRow {
  exId: string
  name: string
  moveId: string
  /** Best single set (reps or seconds) and its day (from logged sets, or estimated from totals). */
  bestSet: number
  bestSetDay: string
  est: boolean
  /** Best day total and its day. */
  bestDay: number
  bestDayDay: string
  unit: 'reps' | 'sec'
  /** Set in the last 7 days. */
  fresh: boolean
}

/** All your bests with their dates: the best set and the best day of every exercise you have logged. */
export function recordsWall(input: HistoryInput): RecordRow[] {
  const out: RecordRow[] = []
  for (const ex of input.exercises) {
    const mv = moveOf(ex)
    const ss = sessionsFor(input, ex, input.today)
    if (!ss.length) continue
    let bs = { v: 0, d: '', est: false }
    let bd = { v: 0, d: '' }
    for (const s of ss) {
      const top = Math.max(...s.reps)
      const tot = s.reps.reduce((a, b) => a + b, 0)
      // A real set beats an estimate of the same size.
      if (top > bs.v || (top === bs.v && bs.est && !s.est)) bs = { v: top, d: s.day, est: s.est }
      if (tot > bd.v) bd = { v: tot, d: s.day }
    }
    out.push({ exId: String(ex.id), name: ex.name, moveId: mv?.id ?? '', bestSet: bs.v, bestSetDay: bs.d, est: bs.est, bestDay: bd.v, bestDayDay: bd.d, unit: mv?.unit ?? (ex.unit === 'sec' ? 'sec' : 'reps'), fresh: bs.d >= shiftDay(input.today, -6) || bd.d >= shiftDay(input.today, -6) })
  }
  return out.sort((a, b) => (b.bestSetDay > a.bestSetDay ? 1 : -1))
}

