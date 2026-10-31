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
}

export interface ProgressReport {
  from: string
  to: string
  metrics: Metric[]
  better: MetricId[]
  worse: MetricId[]
  /** One honest line. */
  verdict: string
}

const WEEKS = 6

/** Sum of `value` for days in [from, to]. */
function sum<T extends { day: string }>(rows: T[], from: string, to: string, value: (r: T) => number): number {
  let t = 0
  for (const r of rows) if (r.day >= from && r.day <= to) t += value(r)
  return t
}

/** Days in [from, to] after your streak started with no reset that day. */
function cleanDays(ev: { kind: string; day: string }[], from: string, to: string, today: string): number {
  const starts = ev.filter((e) => e.kind === 'start').map((e) => e.day).sort()
  if (!starts.length) return 0
  const resets = new Set(ev.filter((e) => e.kind === 'reset').map((e) => e.day))
  let n = 0
  for (let d = from; d <= to && d <= today; d = addDays(d, 1)) if (d >= starts[0] && !resets.has(d)) n++
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
  const defs: { id: MetricId; label: string; higherBetter: boolean; f: (a: string, b: string) => number; text: (v: number) => string; skip?: boolean }[] = [
    { id: 'focus', label: 'Focus time', higherBetter: true, f: (a, b) => sum(i.focus, a, b, (r) => r.minutes), text: hm },
    { id: 'wake', label: 'On-time wake-ups', higherBetter: true, f: (a, b) => sum(i.wakes, a, b, (r) => (r.onTime ? 1 : 0)), text: (v) => `${v}/7` },
    { id: 'sport', label: 'Workouts', higherBetter: true, f: (a, b) => new Set(i.workouts.filter((r) => r.day >= a && r.day <= b).map((r) => r.day)).size, text: (v) => `${v} day${v === 1 ? '' : 's'}` },
    { id: 'clean', label: 'Clean days', higherBetter: true, f: (a, b) => cleanDays(i.discipline, a, b, to), text: (v) => `${v}/7` },
    { id: 'todoist', label: 'Todoist tasks done', higherBetter: true, f: (a, b) => sum(i.todoist, a, b, () => 1), text: (v) => String(v) },
    { id: 'mustdo', label: 'Must-dos done', higherBetter: true, f: (a, b) => sum(i.mustdos ?? [], a, b, (r) => (r.done ? 1 : 0)), text: (v) => String(v), skip: !i.mustdos },
    { id: 'spend', label: 'Spent', higherBetter: false, f: (a, b) => sum(i.spending ?? [], a, b, (r) => r.bani), text: (v) => `${Math.round(v / 100).toLocaleString('en-US')} lei`, skip: !i.spending }
  ]
  const metrics: Metric[] = defs
    .filter((d) => !d.skip)
    .map((d) => {
      const weeks = series(d.f)
      const now = weeks[WEEKS - 1]
      const prev = weeks[WEEKS - 2]
      const before = weeks.slice(WEEKS - 5, WEEKS - 1)
      const usual = before.reduce((t, v) => t + v, 0) / before.length
      // "Same" within 10% (or one unit) of the usual week: small wobbles aren't news.
      const base = Math.max(usual, prev)
      const margin = Math.max(d.id === 'focus' ? 30 : d.id === 'spend' ? 10_000 : 1, base * 0.1)
      const diff = now - (usual || prev)
      const up = diff > margin
      const down = diff < -margin
      const trend: Metric['trend'] = !up && !down ? 'same' : up === d.higherBetter ? 'better' : 'worse'
      return { id: d.id, label: d.label, now, prev, usual, text: d.text(now), prevText: d.text(prev), higherBetter: d.higherBetter, trend, weeks }
    })
  const better = metrics.filter((m) => m.trend === 'better').map((m) => m.id)
  const worse = metrics.filter((m) => m.trend === 'worse').map((m) => m.id)
  const name = (id: MetricId) => metrics.find((m) => m.id === id)!.label.toLowerCase()
  const nothing = metrics.every((m) => m.now === 0 && m.usual === 0)
  const verdict = nothing
    ? 'Not enough logged yet: a week of focus, wake-ups and workouts gives the first comparison.'
    : better.length > worse.length
      ? `You're improving: ${better.map(name).join(', ')} up on your usual week.${worse.length ? ` Watch ${worse.map(name).join(', ')}.` : ''}`
      : worse.length > better.length
        ? `Slipping a bit: ${worse.map(name).join(', ')} below your usual week. Pick one to fix this week.`
        : better.length
          ? `Mixed week: ${better.map(name).join(', ')} better, ${worse.map(name).join(', ')} worse.`
          : 'Steady: about the same as your usual week. Push one area a little.'
  return { from: win(0).from, to, metrics, better, worse, verdict }
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
