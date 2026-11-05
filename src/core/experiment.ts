// The weekly experiment (pure): Ben proposes one change for 7 days, picked
// for your weakest area, and measures it against the 14 days before it.
export type ExpMetric = 'focus' | 'sleep' | 'workouts' | 'spend'
export interface Experiment { id: string; title: string; how: string; metric: ExpMetric; better: 'up' | 'down'; unit: string }

export const EXPERIMENTS: Experiment[] = [
  { id: 'phone-out', title: 'Phone out of the bedroom at night', how: 'Charge it in another room from bedtime until you are up.', metric: 'sleep', better: 'up', unit: 'min slept' },
  { id: 'focus-first', title: '50 minutes of focus before any social media', how: 'The first thing after breakfast is one focus block; feeds stay closed until it is done.', metric: 'focus', better: 'up', unit: 'min focus' },
  { id: 'train-before-noon', title: 'Train before noon', how: 'Put the workout in the morning, before the day gets busy.', metric: 'workouts', better: 'up', unit: 'workouts' },
  { id: 'cash-only', title: 'Pay only with what you planned', how: 'Write the day’s budget in the morning; anything else waits 24 hours.', metric: 'spend', better: 'down', unit: 'lei spent' }
]

export interface ExpState { id: string; start: string }
export type Series = Record<string, number>

const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`)
  x.setUTCDate(x.getUTCDate() + n)
  return x.toISOString().slice(0, 10)
}
const avg = (s: Series, from: string, to: string, countEmpty: boolean) => {
  const days: number[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) if (countEmpty || s[d] != null) days.push(s[d] ?? 0)
  return days.length ? days.reduce((a, b) => a + b, 0) / days.length : null
}

/** The experiment for your weakest area: how far each area is below its usual level (0 = fine, 1 = far off). */
export function pickExperiment(gaps: Partial<Record<ExpMetric, number>>, skip: string[] = []): Experiment {
  const options = EXPERIMENTS.filter((e) => !skip.includes(e.id))
  const list = options.length ? options : EXPERIMENTS
  return [...list].sort((a, b) => (gaps[b.metric] ?? 0) - (gaps[a.metric] ?? 0))[0]
}

export interface ExpResult { exp: Experiment; day: number; done: boolean; before: number | null; during: number | null; changePct: number | null; verdict: string }

/** How it is going: day x of 7, before vs during, and after 7 days a verdict. */
export function measureExperiment(state: ExpState, series: Series, today: string): ExpResult | null {
  const exp = EXPERIMENTS.find((e) => e.id === state.id)
  if (!exp) return null
  const day = Math.min(7, Math.max(1, Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${state.start}T12:00:00Z`)) / 86400000) + 1))
  const counted = exp.metric === 'workouts' || exp.metric === 'spend' || exp.metric === 'focus'
  const before = avg(series, addDays(state.start, -14), addDays(state.start, -1), counted)
  const end = addDays(state.start, 6) < today ? addDays(state.start, 6) : today
  const during = avg(series, state.start, end, counted)
  const changePct = before && during != null ? Math.round(((during - before) / before) * 100) : null
  const done = addDays(state.start, 6) < today
  const good = changePct != null && (exp.better === 'up' ? changePct >= 5 : changePct <= -5)
  const bad = changePct != null && (exp.better === 'up' ? changePct <= -5 : changePct >= 5)
  const verdict = changePct == null ? 'Not enough data yet to compare.' : good ? `It works: ${Math.abs(changePct)}% ${exp.better === 'up' ? 'more' : 'less'} ${exp.unit} than before. Keep it.` : bad ? `It didn't help (${changePct > 0 ? '+' : ''}${changePct}%). Drop it and try another.` : `About the same (${changePct > 0 ? '+' : ''}${changePct}%). Keep it if it felt good.`
  return { exp, day, done, before, during, changePct, verdict: done ? verdict : `Day ${day} of 7 · so far: ${verdict}` }
}
