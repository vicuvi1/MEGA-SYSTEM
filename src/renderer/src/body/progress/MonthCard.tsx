// Progress → monthly body report: strength change, weight and waist change,
// workout days, protein days on goal (last 7 days of the food counter), one
// next goal, and the text to copy. Every number comes from the data.
import { useEffect, useState } from 'react'
import { monthReport } from '@core/bodyProgress'
import type { SportEx } from '@core/sportLadders'
import type { SetLog } from '@core/sportSets'
import { life } from '../../bridge'

export function MonthCard({ log, exercises, metrics, workoutDays, today }: { log: SetLog | null | undefined; exercises: SportEx[]; metrics: { day: string; weight?: number | null; waist?: number | null }[]; workoutDays: string[]; today: string }) {
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
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(m.text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard blocked: the text is on screen */
    }
  }
  return (
    <section className="card bpg-card" aria-label="Monthly body report">
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
        <div>
          <dt>Protein goal</dt>
          <dd>{m.protein ? `${m.protein.hit} of ${m.protein.days} days` : 'no food log'}</dd>
        </div>
      </dl>
      <p className="bpg-goal">
        <b>Next goal</b> {m.goal}
      </p>
      <button type="button" className="btn ghost small" onClick={() => void copy()}>
        {copied ? 'Copied' : 'Copy report'}
      </button>
    </section>
  )
}
