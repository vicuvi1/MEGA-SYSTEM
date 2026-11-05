// Strength on the Body page: type "bench 3x8x60", see your records and the
// estimated max climb (one line per lift). Records show up by themselves.
import { useState } from 'react'
import type { BodyState } from '@shared/api'
import { MUSCLES, parseSets, volumeZone, weeklyMuscleSets, type LiftSummary } from '@core/strength'
import { dayKey } from '@core/dates'
import { life } from './bridge'
import { useAction } from './ui'

function Spark({ l }: { l: LiftSummary }) {
  const pts = l.points.slice(-12)
  if (pts.length < 2) return null
  const min = Math.min(...pts.map((p) => p.e1rm))
  const max = Math.max(...pts.map((p) => p.e1rm))
  const W = 120
  const H = 32
  const x = (i: number) => (i / (pts.length - 1)) * W
  const y = (v: number) => H - 3 - ((v - min) / Math.max(1, max - min)) * (H - 6)
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.e1rm).toFixed(1)}`).join(' ')
  return (
    <svg className="st-spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Estimated max for ${l.name}: from ${pts[0].e1rm} to ${pts[pts.length - 1].e1rm} kg`}>
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1].e1rm)} r="3" fill="var(--accent)" />
    </svg>
  )
}

export function StrengthCard({ state, onChange }: { state: BodyState; onChange: (s: BodyState) => void }) {
  const act = useAction()
  const [text, setText] = useState('')
  const parsed = parseSets(text)
  const lifts = state.strength ?? []
  // Hard sets per muscle this week, against the 10–20 that build muscle (H3).
  const vol = weeklyMuscleSets(state.recentWorkouts, dayKey(new Date()))
  const log = async () => {
    if (!parsed) return
    const reps = parsed.sets.reduce((t, s) => t + s.reps, 0)
    // The amount is reps (the weight lives in each set), so the unit is reps, never kg (P6).
    const kg = parsed.sets[0].weight
    const r = await act(
      () => life.body.logWorkout({ title: parsed.name, items: [{ exerciseId: parsed.name.toLowerCase().replace(/[^a-z0-9]/g, ''), name: parsed.name, unit: 'reps', amount: reps, sets: parsed.sets }], note: 'Strength' }),
      `${parsed.name}: ${parsed.sets.length}×${parsed.sets[0].reps}${kg ? ` × ${kg} kg` : ''}`
    )
    if (r) {
      onChange(r.state)
      setText('')
      window.dispatchEvent(new CustomEvent('life-body-changed'))
    }
  }
  return (
    <section className="card st-card">
      <header className="card-head">
        <h2>Strength</h2>
        <span className="hint small">sets × reps × kg · records find themselves</span>
      </header>
      <form
        className="st-add"
        onSubmit={(e) => {
          e.preventDefault()
          void log()
        }}
      >
        <label className="sr-only" htmlFor="st-in">
          Log sets, for example bench 3x8x60
        </label>
        <input id="st-in" className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="bench 3x8x60 · squat 5x5 @100 · pull-ups 4x8" />
        <button className="btn primary small" disabled={!parsed}>
          Log
        </button>
      </form>
      <div className="st-vol" role="list" aria-label="Hard sets per muscle this week (aim 10 to 20)">
        {MUSCLES.map((m) => (
          <div key={m} role="listitem" className={`st-vol-cell z-${volumeZone(vol[m])}`} title={`${m}: ${vol[m]} hard sets in 7 days (aim 10–20)`}>
            <b>{vol[m]}</b>
            <small>{m}</small>
          </div>
        ))}
      </div>
      <p className="hint small st-vol-note">Hard sets per muscle, last 7 days · 10–20 builds muscle</p>
      {text.trim() && !parsed && <p className="hint small">Write it like: exercise sets x reps x kg (bench 3x8x60).</p>}
      {lifts.length === 0 ? (
        <p className="hint">Log a lift with a weight and your best sets and estimated max show here.</p>
      ) : (
        <ul className="st-list">
          {lifts.slice(0, 8).map((l) => (
            <li key={l.name}>
              <div>
                <b>{l.name}</b> {l.newPr && <span className="chip ok">🏆 New record</span>}
                <small>
                  best {l.bestWeight} kg · est. max {l.bestE1rm} kg
                </small>
              </div>
              <Spark l={l} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
