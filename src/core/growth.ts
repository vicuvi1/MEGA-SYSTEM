// Growth: are your numbers climbing? Weekly and monthly series per area
// (focus, on-time wake-ups, workouts, clean days, tasks, spending), you
// against your past (last week, your 4-week average, your best week),
// personal records and milestones. Pure: the Insights page reads it.
import { addDays } from './dates'
import { cleanSet, bestStreak } from './insights'
import type { ProgressInput } from './progress'

export type GrowthId = 'focus' | 'wake' | 'sport' | 'clean' | 'tasks' | 'spend'

export interface Point {
  /** First day of the week (YYYY-MM-DD) or the month (YYYY-MM). */
  label: string
  value: number
}

export interface GrowthMetric {
  id: GrowthId
  label: string
  higherBetter: boolean
  /** How one value reads ("6h 20m", "5", "320 lei"). */
  unit: 'min' | 'count' | 'bani'
  weeks: Point[]
  months: Point[]
  thisWeek: number
  lastWeek: number
  avg4: number
  /** Best full week ever (highest, or lowest spending with any data). */
  best: Point | null
  /** % change of this week vs last week / vs the 4-week average (null: nothing to compare). */
  vsLast: number | null
  vsAvg: number | null
  /** This week is your best week ever. */
  record: boolean
}

export interface Milestone {
  id: string
  label: string
  /** Day it was reached, if it was. */
  at: string | null
  /** 0–1 toward it. */
  progress: number
}

export interface Records {
  bestFocusDay: { day: string; minutes: number } | null
  bestFocusWeek: Point | null
  longestCleanStreak: number
  longestWakeStreak: number
  longestFocusStreak: number
  mostTasksDay: { day: string; count: number } | null
}

export interface Growth {
  metrics: GrowthMetric[]
  records: Records
  milestones: Milestone[]
}

const pct = (now: number, then: number) => (then > 0 ? Math.round(((now - then) / then) * 100) : now > 0 ? null : 0)

const MILESTONES: { id: string; label: (n: number) => string; of: 'focusH' | 'workouts' | 'clean' | 'tasks' | 'wakes'; steps: number[] }[] = [
  { id: 'focus', label: (n) => `${n} hours of focus`, of: 'focusH', steps: [10, 25, 50, 100, 250, 500, 1000] },
  { id: 'workouts', label: (n) => `${n} workouts`, of: 'workouts', steps: [10, 25, 50, 100, 200, 365] },
  { id: 'clean', label: (n) => `${n} clean days`, of: 'clean', steps: [7, 30, 90, 180, 365] },
  { id: 'tasks', label: (n) => `${n} tasks done`, of: 'tasks', steps: [50, 100, 250, 500, 1000, 2500] },
  { id: 'wakes', label: (n) => `${n} on-time wake-ups`, of: 'wakes', steps: [10, 30, 100, 200, 365] }
]

export function growth(i: ProgressInput, weeks = 26): Growth {
  const today = i.today
  const first = (rows: { day: string }[]) => rows.reduce((m, r) => (r.day < m ? r.day : m), today)
  const since = [i.focus, i.wakes, i.workouts, i.todoist, i.mustdos ?? [], i.spending ?? []].map(first).reduce((a, b) => (a < b ? a : b), today)
  const clean = cleanSet(i.discipline, since, today)
  const daily: Record<GrowthId, Map<string, number>> = { focus: new Map(), wake: new Map(), sport: new Map(), clean: new Map(), tasks: new Map(), spend: new Map() }
  const add = (m: Map<string, number>, d: string, v: number) => m.set(d, (m.get(d) ?? 0) + v)
  for (const r of i.focus) add(daily.focus, r.day, r.minutes)
  for (const r of i.wakes) if (r.onTime) daily.wake.set(r.day, 1)
  for (const r of i.workouts) daily.sport.set(r.day, 1)
  for (const d of clean) daily.clean.set(d, 1)
  for (const r of i.todoist) add(daily.tasks, r.day, 1)
  for (const r of i.mustdos ?? []) if (r.done) add(daily.tasks, r.day, 1)
  for (const r of i.spending ?? []) add(daily.spend, r.day, r.bani)

  const sum = (m: Map<string, number>, from: string, to: string) => {
    let t = 0
    for (const [d, v] of m) if (d >= from && d <= to) t += v
    return t
  }
  // Rolling 7-day windows ending today, oldest first (the last is "this week").
  const win = (k: number) => ({ from: addDays(today, -6 - 7 * k), to: addDays(today, -7 * k) })
  const monthsBack = Array.from({ length: 12 }, (_, k) => {
    const [y, m] = today.split('-').map(Number)
    const d = new Date(Date.UTC(y, m - 1 - (11 - k), 1))
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  })
  const defs: { id: GrowthId; label: string; higherBetter: boolean; unit: GrowthMetric['unit']; skip?: boolean }[] = [
    { id: 'focus', label: 'Focus', higherBetter: true, unit: 'min' },
    { id: 'wake', label: 'On-time wake-ups', higherBetter: true, unit: 'count' },
    { id: 'sport', label: 'Workouts', higherBetter: true, unit: 'count' },
    { id: 'clean', label: 'Clean days', higherBetter: true, unit: 'count' },
    { id: 'tasks', label: 'Tasks done', higherBetter: true, unit: 'count' },
    { id: 'spend', label: 'Spending', higherBetter: false, unit: 'bani', skip: !i.spending }
  ]
  const metrics: GrowthMetric[] = defs
    .filter((d) => !d.skip)
    .map((d) => {
      const m = daily[d.id]
      const wk: Point[] = Array.from({ length: weeks }, (_, k) => {
        const w = win(weeks - 1 - k)
        return { label: w.from, value: sum(m, w.from, w.to) }
      })
      const months: Point[] = monthsBack.map((mo) => ({ label: mo, value: sum(m, `${mo}-01`, `${mo}-31`) }))
      // Every full week since your data starts, for "best ever".
      const all: Point[] = []
      for (let k = 0; ; k++) {
        const w = win(k)
        if (w.to < since) break
        all.push({ label: w.from, value: sum(m, w.from, w.to) })
        if (k > 520) break
      }
      const thisWeek = wk[wk.length - 1]?.value ?? 0
      const lastWeek = wk[wk.length - 2]?.value ?? 0
      const prev4 = wk.slice(-5, -1)
      const avg4 = prev4.length ? prev4.reduce((t, p) => t + p.value, 0) / prev4.length : 0
      const withData = all.filter((p) => p.value > 0)
      const best = withData.length ? withData.reduce((b, p) => (d.higherBetter ? (p.value > b.value ? p : b) : p.value < b.value ? p : b)) : null
      const earlier = all.slice(1).filter((p) => p.value > 0)
      const record = d.higherBetter ? thisWeek > 0 && earlier.length > 0 && earlier.every((p) => thisWeek > p.value) : false
      return { id: d.id, label: d.label, higherBetter: d.higherBetter, unit: d.unit, weeks: wk, months, thisWeek, lastWeek, avg4, best, vsLast: pct(thisWeek, lastWeek), vsAvg: pct(thisWeek, avg4), record }
    })

  const focusDays = [...daily.focus].sort((a, b) => b[1] - a[1])
  const taskDays = [...daily.tasks].sort((a, b) => b[1] - a[1])
  const focusMetric = metrics.find((x) => x.id === 'focus')
  const records: Records = {
    bestFocusDay: focusDays[0] ? { day: focusDays[0][0], minutes: focusDays[0][1] } : null,
    bestFocusWeek: focusMetric?.best ?? null,
    longestCleanStreak: bestStreak(clean),
    longestWakeStreak: bestStreak(new Set(daily.wake.keys())),
    longestFocusStreak: bestStreak(new Set([...daily.focus].filter(([, v]) => v >= 50).map(([k]) => k))),
    mostTasksDay: taskDays[0] ? { day: taskDays[0][0], count: taskDays[0][1] } : null
  }

  // Milestones: the day each total was first reached.
  const cumulative = (m: Map<string, number>, scale = 1) => {
    const days = [...m].sort((a, b) => (a[0] < b[0] ? -1 : 1))
    let t = 0
    return days.map(([d, v]) => ({ day: d, total: (t += v) / scale }))
  }
  const totals = { focusH: cumulative(daily.focus, 60), workouts: cumulative(daily.sport), clean: cumulative(daily.clean), tasks: cumulative(daily.tasks), wakes: cumulative(daily.wake) }
  const milestones: Milestone[] = []
  for (const ms of MILESTONES) {
    const run = totals[ms.of]
    const total = run.length ? run[run.length - 1].total : 0
    for (const n of ms.steps) {
      const hit = run.find((r) => r.total >= n)
      milestones.push({ id: `${ms.id}-${n}`, label: ms.label(n), at: hit?.day ?? null, progress: Math.min(1, total / n) })
      if (!hit) break // only the next one ahead, not every future step
    }
  }
  return { metrics, records, milestones }
}

/** Milestones reached that you haven't celebrated yet. */
export function newMilestones(ms: Milestone[], seen: string[]): Milestone[] {
  return ms.filter((m) => m.at && !seen.includes(m.id))
}
