// Progress → monthly body report: strength change, weight and waist change,
// workout days, protein days on goal (last 7 days of the food counter), one
// next goal, and the text to copy. Every number comes from the data.
import { useEffect, useState } from 'react'
import { monthReport } from '@core/bodyProgress'
import type { SportEx } from '@core/sportLadders'
import type { SetLog } from '@core/sportSets'
import { life } from '../../bridge'
import type { BodyCompView } from '../../../../main/bodyComp'

export function MonthCard({ log, exercises, metrics, workoutDays, today, comp = null, now = false }: { log: SetLog | null | undefined; exercises: SportEx[]; metrics: { day: string; weight?: number | null; waist?: number | null }[]; workoutDays: string[]; today: string; comp?: BodyCompView['month'] | null; now?: boolean }) {
  const [protein, setProtein] = useState<{ hit: number; days: number } | null>(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    const load = () =>
      void life.coach?.food
        ?.view()
        .then((v) => setProtein(v.week.days > 0 ? { hit: v.week.proteinHit, days: 7 } : null))
        .catch(() => {})
    load()
    window.addEventListener('life-body-changed', load)
    return () => window.removeEventListener('life-body-changed', load)
  }, [])
  const m = monthReport({ today, log, exercises, metrics, workoutDays, protein })
  const signed = (n: number | null, unit: string) => (n == null ? 'log more' : `${n >= 0 ? '+' : '−'}${Math.abs(n)} ${unit}`)
  // Body composition lines (smoothed estimates) and average calories, when there is data.
  const extra = comp && comp.from === m.from ? [comp.muscleKg != null ? `muscle ${signed(comp.muscleKg, 'kg')} (estimate)` : '', comp.fatPct != null ? `body fat ${signed(comp.fatPct, '%')} (estimate)` : '', comp.kcalAvg != null ? `about ${comp.kcalAvg.toLocaleString('en-US')} kcal a day` : ''].filter(Boolean) : []
  const text = extra.length ? `${m.text}\n${extra.join('\n')}` : m.text
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard blocked: the text is on screen */
    }
  }
  return (
    <section id="bpg-month" className={`card bpg-card${now ? ' bpg-month-now' : ''}`} aria-label="Monthly body report" tabIndex={-1}>
      <header className="bpg-head">
        <h2>{m.label}</h2>
        <span className="bpg-lock">monthly report</span>
      </header>
      <dl className="bpg-tiles">
        <div>
          <dt>Strength</dt>
          <dd>{m.strengthPct == null ? 'not yet' : `${m.strengthPct >= 0 ? '+' : ''}${m.strengthPct}%`}</dd>
        </div>
        <div>
          <dt>Weight</dt>
          <dd>{signed(m.weightKg, 'kg')}</dd>
        </div>
        <div>
          <dt>Waist</dt>
          <dd>{signed(m.waistCm, 'cm')}</dd>
        </div>
        <div>
          <dt>Workout days</dt>
          <dd>{m.workouts}</dd>
        </div>
        {comp && comp.from === m.from && comp.muscleKg != null && (
          <div>
            <dt>Muscle (estimate)</dt>
            <dd>{signed(comp.muscleKg, 'kg')}</dd>
          </div>
        )}
        {comp && comp.from === m.from && comp.fatPct != null && (
          <div>
            <dt>Body fat (estimate)</dt>
            <dd>{signed(comp.fatPct, '%')}</dd>
          </div>
        )}
        {comp && comp.from === m.from && comp.kcalAvg != null && (
          <div>
            <dt>Calories a day</dt>
            <dd>{comp.kcalAvg.toLocaleString('en-US')}</dd>
          </div>
        )}
        <div>
          <dt>Protein goal</dt>
          <dd>{m.protein ? `${m.protein.hit} of ${m.protein.days} days` : 'no food log'}</dd>
        </div>
      </dl>
      <a className="bpg-photo-link" href="#bpg-photos" onClick={(e) => (e.preventDefault(), document.getElementById('bpg-photos')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }))}>
        Take this month's progress photo and compare
      </a>
      <p className="bpg-goal">
        <b>Next goal</b> {m.goal}
      </p>
      <button type="button" className="btn ghost small" onClick={() => void copy()}>
        {copied ? 'Copied' : 'Copy report'}
      </button>
    </section>
  )
}
