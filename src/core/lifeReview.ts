// The weekly life review (pure): training, sleep, money, focus and urges
// together. The 3 biggest changes of the last 7 days against your usual
// (the 4 weeks before) become findings, plus one experiment to try.
import { pickExperiment, type ExpMetric, type Experiment, type Series } from './experiment'

export interface Finding { area: string; text: string; good: boolean; size: number }
export interface LifeReview { findings: Finding[]; experiment: Experiment }

const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`)
  x.setUTCDate(x.getUTCDate() + n)
  return x.toISOString().slice(0, 10)
}
const sum = (s: Series, today: string, from: number, to: number, counted: boolean) => {
  const vals: number[] = []
  for (let k = from; k <= to; k++) {
    const v = s[addDays(today, -k)]
    if (v != null || counted) vals.push(v ?? 0)
  }
  return { total: vals.reduce((a, b) => a + b, 0), n: vals.length }
}
const hm = (m: number) => `${Math.floor(m / 60)}h${String(Math.round(m % 60)).padStart(2, '0')}`

export function lifeReview(series: Record<ExpMetric, Series>, urges: { crushed: number; slips: number; prevCrushed: number }, today: string): LifeReview {
  const out: Finding[] = []
  const gaps: Partial<Record<ExpMetric, number>> = {}
  const area = (m: ExpMetric, label: string, fmt: (weekVal: number, usualVal: number) => string, perDay: boolean, better: 'up' | 'down') => {
    const counted = m !== 'sleep'
    const w = sum(series[m], today, 0, 6, counted)
    const u = sum(series[m], today, 7, 34, counted)
    if (!w.n || !u.n) return
    const week = perDay ? w.total / w.n : w.total
    const usual = perDay ? u.total / u.n : (u.total / u.n) * 7
    if (!usual && !week) return
    const ch = usual ? (week - usual) / usual : 1
    const good = better === 'up' ? ch >= 0 : ch <= 0
    gaps[m] = good ? 0 : Math.abs(ch)
    out.push({ area: label, good, size: Math.abs(ch), text: fmt(week, usual) })
  }
  area('sleep', 'Sleep', (w, u) => `${hm(w)} a night, ${Math.abs(Math.round(w - u))} min ${w >= u ? 'more' : 'less'} than usual`, true, 'up')
  area('workouts', 'Training', (w, u) => `${Math.round(w)} workout${Math.round(w) === 1 ? '' : 's'} (usual ${u.toFixed(1)})`, false, 'up')
  area('focus', 'Focus', (w, u) => `${hm(w)} of focus (usual ${hm(u)})`, false, 'up')
  area('spend', 'Money', (w, u) => `${Math.round(w).toLocaleString('en-US')} lei spent, ${Math.abs(Math.round(((w - u) / Math.max(1, u)) * 100))}% ${w <= u ? 'under' : 'over'} usual`, false, 'down')
  if (urges.crushed || urges.slips || urges.prevCrushed) {
    const good = urges.slips === 0
    out.push({ area: 'Urges', good, size: urges.slips ? 1 : Math.min(1, urges.crushed / 5), text: `${urges.crushed} crushed${urges.slips ? `, ${urges.slips} slip${urges.slips === 1 ? '' : 's'}` : ', no slips'}` })
  }
  // The 3 biggest changes; at least one thing that went well when there is one.
  const sorted = [...out].sort((a, b) => b.size - a.size)
  let top = sorted.slice(0, 3)
  const bestGood = sorted.find((f) => f.good)
  if (bestGood && !top.some((f) => f.good)) top = [...top.slice(0, 2), bestGood]
  return { findings: top, experiment: pickExperiment(gaps) }
}
