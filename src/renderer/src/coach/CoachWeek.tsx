// The weekly review's body and training step, the first step of the ONE
// Sunday review (the goal ladder's actions and top 3 follow it). It shows the
// week (weekly average weight, waist, food, workouts, level-ups, check-ins)
// and the decisions, each confirmed with one tap through the existing
// mechanisms: the calorie check, the roadmap's level-up, the lighter week.
import { useCallback, useEffect, useState } from 'react'
import { life } from '../bridge'
import { useAction, useToast } from '../ui'
import { setLevel } from '@core/trainLog'
import { setLighter } from '@core/trainWarnings'
import type { LadderId } from '@core/trainLadders'
import type { Decision } from '@core/coachWeek'
import { saveTraining } from '../body/training/trainingStore'
import { sportDay } from '../sportTrack'
import { sportNow } from './useCoach'
import type { CoachWeekView } from './coachApi'
import './coach.css'

const fmtWeek = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const kg = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n).toFixed(1)} kg`

export function CoachWeekStep() {
  const act = useAction()
  const toast = useToast()
  const [v, setV] = useState<CoachWeekView | null>(null)
  const load = useCallback(() => {
    life.coach?.today
      ?.week(sportNow())
      .then(setV)
      .catch(() => setV(null))
  }, [])
  useEffect(load, [load])
  if (!life.coach?.today) return null
  if (!v) return <p className="hint ct-week">Reading your week…</p>
  const r = v.review
  const s = r.stats
  const api = life.coach.today
  const answer = async (d: Decision, apply: boolean) => {
    const today = sportDay()
    // The week as it was when you decided (a level-up changes the roadmap, and the decision must still be found).
    const before = sportNow()
    if (apply && d.kind === 'level' && d.ladder != null && d.index != null) saveTraining((st) => setLevel(st, d.ladder as LadderId, d.index!, today, Date.now()))
    if (apply && d.kind === 'lighter') {
      saveTraining((st) => setLighter(st, today, Date.now()))
      void life.coach?.bodyPlus?.setDose('light', null).catch(() => {})
    }
    const out = await act(() => api.decide(d.id, apply, before), apply ? (d.kind === 'kcal' ? `Food goal changed: ${d.delta! > 0 ? '+' : ''}${d.delta} kcal a day.` : d.kind === 'level' ? `${d.title.replace(/^Move up to /, '')} is your level now.` : 'Lighter week: 70% of your usual reps for 7 days.') : undefined)
    if (out) {
      setV(out)
      window.dispatchEvent(new CustomEvent('life-body-changed'))
    } else if (!apply) toast('Skipped for this week.', 'info')
  }
  return (
    <div className="ct-week" data-coach="week">
      <p className="ct-week-sum">{r.summary}</p>
      <dl className="ct-stats">
        <div>
          <dt>Weekly average</dt>
          <dd>{s.avg != null ? `${s.avg.toFixed(1)} kg${s.change != null ? ` (${kg(s.change)})` : ''}` : 'Weigh in 3+ mornings'}</dd>
        </div>
        <div>
          <dt>Waist</dt>
          <dd>{s.waist != null ? `${s.waist > 0 ? '+' : ''}${s.waist} cm in 2 weeks` : 'Not measured'}</dd>
        </div>
        <div>
          <dt>Food a day</dt>
          <dd>{s.kcal != null ? `${s.kcal.toLocaleString('en-US')} kcal · ${s.protein} g protein` : 'No food logged'}</dd>
        </div>
        <div>
          <dt>Workouts</dt>
          <dd>
            {s.sessions.done}/{s.sessions.planned}
            {s.levelUps.length ? ` · ${s.levelUps.join(', ')} unlocked` : ''}
          </dd>
        </div>
        {s.energy != null && (
          <div>
            <dt>Check-ins</dt>
            <dd>
              energy {s.energy}/5 · soreness {s.soreness}/5{s.sleep != null ? ` · sleep ${s.sleep} h` : ''}
            </dd>
          </div>
        )}
      </dl>
      <p className="hint">Weight is an estimate from the weekly average; one day means little.</p>
      {r.notes.map((n) => (
        <p key={n} className="ct-note">
          {n}
        </p>
      ))}
      {r.decisions.length > 0 && (
        <ul className="ct-decisions" aria-label="Decisions">
          {r.decisions.map((d) => {
            const applied = v.applied.includes(d.id)
            const open = v.open.some((x) => x.id === d.id)
            return (
              <li key={d.id} data-decision={d.id} className={applied ? 'on' : ''}>
                <b>{d.title}</b>
                <small>{d.why}</small>
                {open ? (
                  <span className="ct-dec-act">
                    <button type="button" className="btn small ghost" onClick={() => void answer(d, false)}>
                      Not now
                    </button>
                    <button type="button" className="btn small primary" onClick={() => void answer(d, true)}>
                      {d.kind === 'kcal' ? 'Apply' : d.kind === 'level' ? 'Move up' : 'Start lighter week'}
                    </button>
                  </span>
                ) : (
                  <span className="ct-done">{applied ? '✓ Applied' : 'Skipped'}</span>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {!r.decisions.length && <p className="hint">No changes needed this week.</p>}
      <small className="hint">Week of {fmtWeek(r.week)} · no points for the review.</small>
    </div>
  )
}
