// BD3: this week per muscle. Hard sets done (Sport Track's sets) against what
// the week's 20–45 min plan gives each muscle and the 10–20 zone that grows
// it, a tip when the plan is outside it, and the next step for each move in
// your plan: one more rep, a slower 3-second lowering, a 2-second pause, or
// the next ladder step. Nothing here pays points.
import { useEffect, useState } from 'react'
import { WEEKLY_SETS } from '@core/sportSets'
import { weekPlan, type ProgramPrefs } from '@core/sportProgram'
import { moveOf, type SportEx } from '@core/sportLadders'
import { muscleWeek, nextStepFor, type MuscleWeek, type NextStep } from '@core/sportWeekly'
import { dayKey } from '@core/dates'
import { readSport, SPORT_KEY } from '../sportTrack'

interface Row {
  id: string
  name: string
  step: NextStep
}

function compute(hold: boolean): { muscles: MuscleWeek[]; moves: Row[]; minutes: number } | null {
  const st = readSport()
  if (!st || !Array.isArray(st.exercises)) return null
  const ss = st.sportySettings ?? {}
  const prefs: ProgramPrefs = { minutes: [20, 30, 45].includes(ss.planMinutes) ? ss.planMinutes : 30, perWeek: ss.planPerWeek === 4 ? 4 : 3, coolDown: !!ss.planCool }
  const today = dayKey(new Date())
  const exercises: SportEx[] = st.exercises
  const week = weekPlan(exercises, prefs, today)
  const muscles = muscleWeek({ log: st.sets ?? {}, exercises, week, today })
  const seen = new Set<string>()
  const moves: Row[] = []
  for (const d of week) {
    for (const it of d.session?.items ?? []) {
      if (seen.has(it.move.id)) continue
      seen.add(it.move.id)
      const ex = exercises.find((e) => String(e.id) === it.exId) ?? exercises.find((e) => moveOf(e)?.id === it.move.id)
      moves.push({ id: it.move.id, name: it.move.name, step: nextStepFor({ log: st.sets ?? {}, exId: ex ? String(ex.id) : '', move: it.move, today, hold }) })
    }
  }
  return { muscles, moves, minutes: prefs.minutes }
}

export function MuscleWeekCard({ hold = false }: { hold?: boolean }) {
  const [data, setData] = useState(() => compute(hold))
  useEffect(() => {
    const re = () => setData(compute(hold))
    re()
    const onStorage = (e: StorageEvent) => (e.key == null || e.key === SPORT_KEY) && re()
    window.addEventListener('storage', onStorage)
    window.addEventListener('life-sport-changed', re)
    window.addEventListener('life-body-changed', re)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('life-sport-changed', re)
      window.removeEventListener('life-body-changed', re)
    }
  }, [hold])
  if (!data) return null
  const top = WEEKLY_SETS.hi + 4
  return (
    <section className="card mw-card" aria-label="Hard sets per muscle this week">
      <header className="card-head">
        <h2>This week per muscle</h2>
        <span className="hint small">hard sets done · planned ({data.minutes} min plan) · aim 10–20</span>
      </header>
      <div className="mw-rows">
        {data.muscles.map((m) => {
          const pct = (n: number) => `${Math.min(100, (n / top) * 100)}%`
          return (
            <div key={m.id} className={`mw-row ${m.status}`}>
              <span className="mw-name" title={m.name}>
                {m.short}
              </span>
              <span className="mw-bar" role="img" aria-label={`${m.short}: ${m.done} hard sets done, ${m.planned} planned this week`}>
                <i className="mw-zone" style={{ left: pct(WEEKLY_SETS.lo), width: `${((WEEKLY_SETS.hi - WEEKLY_SETS.lo) / top) * 100}%` }} />
                <i className="mw-plan" style={{ transform: `scaleX(${Math.min(1, m.planned / top)})` }} />
                <i className="mw-done" style={{ transform: `scaleX(${Math.min(1, m.done / top)})` }} />
              </span>
              <span className="mw-num">
                <b>{m.done}</b>/{m.planned}
              </span>
              {m.tip && <small className="mw-tip">{m.tip}</small>}
            </div>
          )
        })}
      </div>
      {data.moves.length > 0 && (
        <>
          <h3 className="mw-sub">Next step for each move</h3>
          <ul className="mw-moves">
            {data.moves.map((r) => (
              <li key={r.id}>
                <span className={`mw-chip ${r.step.kind}`}>{r.step.label}</span>
                <span>
                  <b>{r.name}</b> <small className="muted">{r.step.text}</small>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
