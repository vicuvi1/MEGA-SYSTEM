// "Am I improving?": your last 7 days against the 7 before and your usual
// week, for every area at once (focus, sleep, sport, clean days, Todoist,
// spending), plus the last weeks for a trend. Pure: the app, the bot and the
// coach all read it.
import { addDays } from './dates'
import { hm } from './focus'

export interface ProgressInput {
  today: string
  focus: { day: string; minutes: number }[]
  wakes: { day: string; onTime: boolean }[]
  workouts: { day: string }[]
  /** discipline_events: 'start' and 'reset' matter. */
  discipline: { kind: string; day: string }[]
  /** One entry per Todoist task paid (ledger rule tasks.todoist_done). */
  todoist: { day: string }[]
  /** Everyday spending in bani (Finance Helper expenses); null when not on this device. */
  spending: { day: string; bani: number }[] | null
  /** One entry per must-do ticked (day plans). */
  mustdos?: { day: string; done: boolean }[]
}

export type MetricId = 'focus' | 'wake' | 'sport' | 'clean' | 'todoist' | 'spend' | 'mustdo'

export interface Metric {
  id: MetricId
  label: string
  /** Last 7 days. */
  now: number
  /** The 7 days before. */
  prev: number
  /** Average of the 4 weeks before this one (a fairer "usual"). */
  usual: number
  /** Shown value, e.g. "6h 20m", "5/7". */
  text: string
  prevText: string
  /** Higher is better (spending: lower). */
  higherBetter: boolean
  trend: 'better' | 'worse' | 'same'
  /** One week per bar, oldest first (the last is the running 7 days). */
  weeks: number[]
  /** The last 7 days one by one, oldest first. */
  days: { day: string; value: number }[]
  /** A good week (null: no target, e.g. spending). */
  target: number | null
  targetText: string | null
  /** now − prev, shown as "+2 vs last week". */
  deltaText: string
  /** How a single day's value reads ("50m", "✓"). */
  dayText: (v: number) => string
  /** How any week total reads (for counting up on screen). */
  fmt: (v: number) => string
  /** Yes/no per day (wake-up, workout, clean day) rather than an amount. */
  daily: boolean
}

export interface ProgressReport {
  from: string
  to: string
  metrics: Metric[]
  better: MetricId[]
  worse: MetricId[]
  /** One honest line. */
  verdict: string
  /** 0–100: how close the last 7 days came to a good week in every area with a target. */
  score: number
  prevScore: number
  /** RL6: finished days in a row under your daily budget (live logs only), and the next bonus. */
  savingStreak?: { days: number; next: { days: number; points: number } | null }
}

const WEEKS = 6

/** Sum of `value` for days in [from, to]. */
function sum<T extends { day: string }>(rows: T[], from: string, to: string, value: (r: T) => number): number {
  let t = 0
  for (const r of rows) if (r.day >= from && r.day <= to) t += value(r)
  return t
}

/** Clean days in [from, to], counted like the Discipline streak (after the current start, not on reset days). */
function cleanDays(ev: { kind: string; day: string }[], from: string, to: string, today: string): number {
  const starts = ev.filter((e) => e.kind === 'start').map((e) => e.day)
  if (!starts.length) return 0
  const start = starts[starts.length - 1]
  const resets = new Set(ev.filter((e) => e.kind === 'reset' && e.day > start).map((e) => e.day))
  let n = 0
  for (let d = from; d <= to && d <= today; d = addDays(d, 1)) if (d > start && !resets.has(d)) n++
  return n
}

export function progressReport(i: ProgressInput): ProgressReport {
  const to = i.today
  // window w: 0 = last 7 days, 1 = the 7 before, ...
  const win = (w: number) => ({ from: addDays(to, -6 - 7 * w), to: addDays(to, -7 * w) })
  const series = (f: (from: string, to: string) => number) =>
    Array.from({ length: WEEKS }, (_, k) => {
      const w = win(WEEKS - 1 - k)
      return f(w.from, w.to)
    })
  const lei = (v: number) => `${Math.round(v / 100).toLocaleString('en-US')} lei`
  const tick = (v: number) => (v ? '✓' : '·')
  const defs: { id: MetricId; label: string; higherBetter: boolean; f: (a: string, b: string) => number; text: (v: number) => string; day: (v: number) => string; target: number | null; unit: number; skip?: boolean }[] = [
    { id: 'focus', label: 'Focus time', higherBetter: true, f: (a, b) => sum(i.focus, a, b, (r) => r.minutes), text: hm, day: (v) => (v ? hm(v) : '·'), target: 600, unit: 30 },
    { id: 'wake', label: 'On-time wake-ups', higherBetter: true, f: (a, b) => sum(i.wakes, a, b, (r) => (r.onTime ? 1 : 0)), text: (v) => `${v}/7`, day: tick, target: 7, unit: 1 },
    { id: 'sport', label: 'Workouts', higherBetter: true, f: (a, b) => new Set(i.workouts.filter((r) => r.day >= a && r.day <= b).map((r) => r.day)).size, text: (v) => `${v} day${v === 1 ? '' : 's'}`, day: tick, target: 4, unit: 1 },
    { id: 'clean', label: 'Clean days', higherBetter: true, f: (a, b) => cleanDays(i.discipline, a, b, to), text: (v) => `${v}/7`, day: tick, target: 7, unit: 1 },
    { id: 'todoist', label: 'Todoist tasks done', higherBetter: true, f: (a, b) => sum(i.todoist, a, b, () => 1), text: (v) => String(v), day: (v) => (v ? String(v) : '·'), target: 15, unit: 1 },
    { id: 'mustdo', label: 'Must-dos done', higherBetter: true, f: (a, b) => sum(i.mustdos ?? [], a, b, (r) => (r.done ? 1 : 0)), text: (v) => String(v), day: (v) => (v ? String(v) : '·'), target: 10, unit: 1, skip: !i.mustdos },
    { id: 'spend', label: 'Spent', higherBetter: false, f: (a, b) => sum(i.spending ?? [], a, b, (r) => r.bani), text: lei, day: (v) => (v ? String(Math.round(v / 100)) : '·'), target: null, unit: 10_000, skip: !i.spending }
  ]
  const metrics: Metric[] = defs
    .filter((d) => !d.skip)
    .map((d) => {
      const weeks = series(d.f)
      const now = weeks[WEEKS - 1]
      const prev = weeks[WEEKS - 2]
      const before = weeks.slice(WEEKS - 5, WEEKS - 1)
      const usual = before.reduce((t, v) => t + v, 0) / before.length
      // Against last week (what "before" shows); within 10% (or one unit) is
      // "same": small wobbles aren't news.
      const margin = Math.max(d.unit, prev * 0.1)
      const diff = now - prev
      const up = diff > margin
      const down = diff < -margin
      const trend: Metric['trend'] = !up && !down ? 'same' : up === d.higherBetter ? 'better' : 'worse'
      const days = Array.from({ length: 7 }, (_, k) => {
        const day = addDays(to, k - 6)
        return { day, value: d.f(day, day) }
      })
      const deltaText = diff === 0 ? 'same as last week' : `${diff > 0 ? '+' : '−'}${d.text(Math.abs(diff)).replace(/\/7$/, '')} vs last week`
      return { id: d.id, label: d.label, now, prev, usual, text: d.text(now), prevText: d.text(prev), higherBetter: d.higherBetter, trend, weeks, days, target: d.target, targetText: d.target === null ? null : d.text(d.target), deltaText, dayText: d.day, fmt: d.text, daily: d.day === tick }
    })
  const better = metrics.filter((m) => m.trend === 'better').map((m) => m.id)
  const worse = metrics.filter((m) => m.trend === 'worse').map((m) => m.id)
  const name = (id: MetricId) => metrics.find((m) => m.id === id)!.label.toLowerCase()
  const nothing = metrics.every((m) => m.now === 0 && m.usual === 0)
  const verdict = nothing
    ? 'Not enough logged yet: a week of focus, wake-ups and workouts gives the first comparison.'
    : better.length > worse.length
      ? `You're improving: ${better.map(name).join(', ')} up on last week.${worse.length ? ` Watch ${worse.map(name).join(', ')}.` : ''}`
      : worse.length > better.length
        ? `Slipping a bit: ${worse.map(name).join(', ')} below last week. Pick one to fix this week.`
        : better.length
          ? `Mixed week: ${better.map(name).join(', ')} better, ${worse.map(name).join(', ')} worse.`
          : 'Steady: about the same as last week. Push one area a little.'
  const scored = metrics.filter((m) => m.target)
  const scoreOf = (pick: (m: Metric) => number) => (scored.length ? Math.round((scored.reduce((t, m) => t + Math.min(1, pick(m) / m.target!), 0) / scored.length) * 100) : 0)
  return { from: win(0).from, to, metrics, better, worse, verdict, score: scoreOf((m) => m.now), prevScore: scoreOf((m) => m.prev) }
}

/** The report as a Telegram message (HTML). */
export function progressText(r: ProgressReport): string {
  const mark = (m: Metric) => (m.trend === 'better' ? '🟢' : m.trend === 'worse' ? '🔴' : '⚪')
  const lines = r.metrics.map((m) => `${mark(m)} ${m.label}: <b>${m.text}</b> (before: ${m.prevText})`)
  return `📈 <b>Am I improving?</b> Last 7 days\n\n${lines.join('\n')}\n\n${r.verdict}`
}

/** Expenses from Finance Helper's saved state (amounts in bani), for `spending`. */
export function financeSpending(state: any): { day: string; bani: number }[] | null {
  if (!state || !Array.isArray(state.tx)) return null
  return state.tx
    .filter((t: any) => t && t.type === 'expense' && typeof t.date === 'string' && !t.deleted)
    .map((t: any) => ({ day: t.date.slice(0, 10), bani: Math.abs(Number(t.base ?? t.amount) || 0) }))
}
