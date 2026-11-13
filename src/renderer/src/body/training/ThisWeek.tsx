// "This week": what the Training tab showed before the program builder, kept
// here. Sets per muscle and the next steps stay open; strength, skill paths,
// recent workouts and exercise targets fold away so the tab stays short.
import type { BodyState } from '@shared/api'
import { askConfirm } from '../../confirmSheet'
import { life } from '../../bridge'
import { Icon } from '../../Icon'
import { usePoints } from '../../usePoints'
import { useShowCoins } from '../../useSimple'
import { useAction } from '../../ui'
import { StrengthCard } from '../../StrengthCard'
import { SkillPaths } from '../../SkillPaths'
import { MuscleWeekCard } from '../MuscleWeekCard'

export function ThisWeek({ state, onState, onWallet, hold }: { state: BodyState; onState: (s: BodyState) => void; onWallet: () => void; hold: boolean }) {
  const act = useAction()
  const pts = usePoints()
  const coins = useShowCoins()
  const handleDelete = async (id: number) => {
    if (!(await askConfirm('Delete this workout record? Any points earned from it will be taken back.'))) return
    const next = await act(() => life.body.deleteWorkout(id), 'Workout removed')
    if (next) {
      onState(next)
      onWallet()
    }
  }
  return (
    <section className="bt-week" aria-label="This week">
      <h2 className="bt-section-title">This week</h2>
      {/* BD3: hard sets per muscle against the plan and 10–20, the next step for each move */}
      <MuscleWeekCard hold={hold} />
      <details className="bt-more">
        <summary>Strength, skill paths, recent workouts and targets</summary>
        <div className="bt-more-body">
          {/* STRENGTH: sets × reps × kg, records, estimated max (H2) */}
          <StrengthCard state={state} onChange={(s2) => (onState(s2), onWallet())} />
          <SkillPaths state={state} />
          <div className="cols">
            <section className="panel">
              <header className="panel-head">
                <h2>Recent workouts</h2>
                <span className="hint">{coins ? `Logs feed into your streaks and earn ${pts('body.workout_done', 10)} points.` : 'Logs feed into your streaks.'}</span>
              </header>
              {state.recentWorkouts.length === 0 ? (
                <div className="empty">
                  No workouts logged yet. Tap <b>Log workout</b> above to record today's session!
                </div>
              ) : (
                <div className="bt-workouts">
                  {state.recentWorkouts.map((w) => (
                    <div key={w.id} className="workout-card">
                      <div className="workout-card-head">
                        <div className="workout-card-title">
                          <Icon name="bolt" size={16} />
                          {w.title}
                        </div>
                        <div className="bt-workout-side">
                          <small className="muted">{w.day}</small>
                          <button className="btn small ghost body-undo" title="Undo / delete this workout record" onClick={() => handleDelete(w.id)}>
                            <Icon name="undo" size={12} />
                            Undo
                          </button>
                        </div>
                      </div>
                      <div className="workout-items-chips">
                        {w.items.map((it, idx) => (
                          <span key={idx} className="workout-chip">
                            {it.amount} {it.unit} {it.name}
                          </span>
                        ))}
                      </div>
                      {w.note && <div className="workout-note">"{w.note}"</div>}
                    </div>
                  ))}
                </div>
              )}
            </section>
            <section className="panel">
              <header className="panel-head">
                <h2>Exercise targets</h2>
              </header>
              <div className="bt-targets">
                {state.exercises.map((ex) => (
                  <div key={ex.id} className="weight-row">
                    <span className="bt-target-name">{ex.name ? ex.name[0].toUpperCase() + ex.name.slice(1) : ex.name}</span>
                    <span className="chip-text muted">
                      {ex.target} {ex.unit} a day
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </details>
    </section>
  )
}
