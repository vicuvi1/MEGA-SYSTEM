import { useState } from 'react'
import type { BodyMetricInput, BodyState, Exercise, WorkoutExerciseItem, WorkoutInput } from '@shared/api'
import { life } from '../bridge'
import { Icon } from '../Icon'
import { soundCoin } from '../sound'
import { useAction } from '../ui'
import '../body.css'

export function Body({
  state,
  onState,
  onWallet,
  onOpenSportApp
}: {
  state: BodyState
  onState: (s: BodyState) => void
  onWallet: () => void
  onOpenSportApp?: () => void
}) {
  const act = useAction()
  const [workoutOpen, setWorkoutOpen] = useState(false)
  const [metricOpen, setMetricOpen] = useState(false)
  const [exerciseOpen, setExerciseOpen] = useState(false)

  const diffWeight =
    state.latestWeight != null && state.previousWeight != null
      ? Math.round((state.latestWeight - state.previousWeight) * 10) / 10
      : null

  const latestAvg =
    state.weeklyAverages.length > 0
      ? state.weeklyAverages[state.weeklyAverages.length - 1].avg
      : null

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this workout record? Any coins earned from it will be returned.')) return
    const next = await act(() => life.body.deleteWorkout(id), 'Workout removed')
    if (next) {
      onState(next)
      onWallet()
    }
  }

  return (
    <div className="body-page">
      <section className="stats four">
        <div className="stat hero pink">
          <span className="label">Workout streak</span>
          <div className="big">{state.streak} {state.streak === 1 ? 'day' : 'days'}</div>
          <span className="sub">
            {state.workoutDoneToday
              ? 'Completed today (+10 coins paid)'
              : `Best streak: ${state.bestStreak} days · Ready for today`}
          </span>
        </div>

        <div className="stat">
          <span className="label">This week</span>
          <div className="big">{state.workoutsThisWeek}</div>
          <span className="sub">{state.totalWorkouts} total workouts logged</span>
        </div>

        <div className="stat">
          <span className="label">Latest weight</span>
          <div className="big small-big">
            {state.latestWeight ? `${state.latestWeight} kg` : '–'}
          </div>
          <span className="sub">
            {latestAvg ? `Weekly avg: ${latestAvg} kg` : 'Daily swings smoothed'}
            {diffWeight != null && (
              <b style={{ marginLeft: 6, color: diffWeight <= 0 ? 'var(--lime)' : 'var(--orange)' }}>
                {diffWeight > 0 ? `+${diffWeight}` : diffWeight} kg
              </b>
            )}
          </span>
        </div>

        <div className="stat">
          <span className="label">Waist</span>
          <div className="big small-big">
            {state.latestWaist ? `${state.latestWaist} cm` : '–'}
          </div>
          <span className="sub">Morning measurement</span>
        </div>
      </section>

      <div className="body-actions">
        {onOpenSportApp && (
          <button
            className="btn"
            style={{
              background: 'linear-gradient(135deg, rgba(0, 242, 254, 0.2), rgba(79, 172, 254, 0.15))',
              borderColor: 'rgba(0, 242, 254, 0.6)',
              color: '#00f2fe',
              fontWeight: 700
            }}
            onClick={onOpenSportApp}
            title="Switch to embedded Sport Track app"
          >
            <Icon name="bolt" size={15} />
            ⚡ Launch Sport Track App
          </button>
        )}
        <button
          className="btn"
          style={{ background: '#ff6b8b', borderColor: '#ff6b8b', color: '#fff' }}
          onClick={() => setWorkoutOpen(true)}
        >
          <Icon name="plus" size={15} />
          Log workout
        </button>
        <button className="btn" onClick={() => setMetricOpen(true)}>
          <Icon name="sliders" size={15} />
          Log weight & waist
        </button>
        <button className="btn sub" onClick={() => setExerciseOpen(true)}>
          <Icon name="tasks" size={15} />
          Add exercise
        </button>
      </div>

      <div className="cols">
        <section className="panel">
          <header className="panel-head">
            <h2>Recent workouts</h2>
            <span className="hint">Logs feed into your streaks and earn 10 coins.</span>
          </header>

          {state.recentWorkouts.length === 0 ? (
            <div className="empty">
              No workouts logged yet. Tap <b>Log workout</b> above to record today's session!
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
              {state.recentWorkouts.map((w) => (
                <div key={w.id} className="workout-card">
                  <div className="workout-card-head">
                    <div className="workout-card-title">
                      <Icon name="bolt" size={16} />
                      {w.title}
                    </div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <small style={{ color: 'var(--muted)' }}>{w.day}</small>
                      <button
                        className="icon-btn"
                        title="Delete workout"
                        onClick={() => handleDelete(w.id)}
                      >
                        <Icon name="undo" size={13} />
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

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <section className="panel">
            <header className="panel-head">
              <h2>Weekly weight trend</h2>
              <span className="hint">Smooths daily water swings.</span>
            </header>

            {state.weeklyAverages.length === 0 ? (
              <div className="empty">Log your weight to see weekly averages.</div>
            ) : (
              <div style={{ marginTop: 8 }}>
                {state.weeklyAverages.slice(-8).map((wa) => (
                  <div key={wa.week} className="weight-row">
                    <span style={{ color: 'var(--muted)' }}>Week of {wa.week}</span>
                    <span style={{ fontWeight: 700 }}>
                      {wa.avg} kg <small style={{ color: 'var(--muted)', fontWeight: 400 }}>({wa.count}x)</small>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="panel">
            <header className="panel-head">
              <h2>Exercise targets</h2>
            </header>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
              {state.exercises.map((ex) => (
                <div key={ex.id} className="weight-row">
                  <span>{ex.name}</span>
                  <span className="chip-text" style={{ color: '#ff8fa5', fontWeight: 600 }}>
                    Target: {ex.target} {ex.unit}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      {workoutOpen && (
        <WorkoutModal
          exercises={state.exercises}
          onClose={() => setWorkoutOpen(false)}
          onSave={async (w) => {
            const res = await act(() => life.body.logWorkout(w), 'Workout logged!')
            if (res) {
              if (res.awarded) soundCoin()
              onState(res.state)
              onWallet()
              setWorkoutOpen(false)
            }
          }}
        />
      )}

      {metricOpen && (
        <MetricModal
          currentWeight={state.latestWeight}
          currentWaist={state.latestWaist}
          onClose={() => setMetricOpen(false)}
          onSave={async (m) => {
            const next = await act(() => life.body.logMetric(m), 'Metrics updated!')
            if (next) {
              onState(next)
              setMetricOpen(false)
            }
          }}
        />
      )}

      {exerciseOpen && (
        <ExerciseModal
          onClose={() => setExerciseOpen(false)}
          onSave={async (ex) => {
            const next = await act(() => life.body.saveExercise(ex), 'Exercise added!')
            if (next) {
              onState(next)
              setExerciseOpen(false)
            }
          }}
        />
      )}
    </div>
  )
}

function WorkoutModal({
  exercises,
  onClose,
  onSave
}: {
  exercises: Exercise[]
  onClose: () => void
  onSave: (w: WorkoutInput) => Promise<void>
}) {
  const [title, setTitle] = useState('Workout Session')
  const [items, setItems] = useState<WorkoutExerciseItem[]>([])
  const [note, setNote] = useState('')

  const addExercise = (ex: Exercise) => {
    const existing = items.find((it) => it.exerciseId === ex.id)
    if (existing) {
      setItems(
        items.map((it) => (it.exerciseId === ex.id ? { ...it, amount: it.amount + ex.target } : it))
      )
    } else {
      setItems([...items, { exerciseId: ex.id, name: ex.name, unit: ex.unit, amount: ex.target }])
    }
  }

  const updateAmount = (exerciseId: string, amount: number) => {
    setItems(items.map((it) => (it.exerciseId === exerciseId ? { ...it, amount } : it)))
  }

  const removeItem = (exerciseId: string) => {
    setItems(items.filter((it) => it.exerciseId !== exerciseId))
  }

  return (
    <div className="sheet" role="dialog" aria-label="Log workout">
      <div className="sheet-card" style={{ ['--c' as string]: '#ff6b8b', maxWidth: 480 }}>
        <h3>Log today's workout</h3>

        <label>
          Title
          <input
            autoFocus
            value={title}
            placeholder="e.g. Upper Body, Calisthenics, Running"
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>

        <div>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>Tap exercises to add:</span>
          <div className="chip-selector">
            {exercises.map((ex) => (
              <button
                key={ex.id}
                type="button"
                className="chip-btn"
                onClick={() => addExercise(ex)}
              >
                + {ex.name}
              </button>
            ))}
          </div>
        </div>

        {items.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>Included in this session:</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
              {items.map((it) => (
                <div key={it.exerciseId} className="exercise-row">
                  <span>{it.name}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="number"
                      min={1}
                      value={it.amount}
                      style={{ width: 80 }}
                      onChange={(e) => updateAmount(it.exerciseId, Number(e.target.value))}
                    />
                    <small style={{ color: 'var(--muted)' }}>{it.unit}</small>
                  </div>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => removeItem(it.exerciseId)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <label style={{ marginTop: 8 }}>
          Note (optional)
          <input
            value={note}
            placeholder="e.g. Felt strong, did extra set"
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        <div className="sheet-actions" style={{ marginTop: 16 }}>
          <button type="button" className="btn sub" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            style={{ background: '#ff6b8b', borderColor: '#ff6b8b', color: '#fff' }}
            disabled={!title.trim() || items.length === 0}
            onClick={() => onSave({ title, items, note: note || undefined })}
          >
            Finish & Earn +10 Coins
          </button>
        </div>
      </div>
    </div>
  )
}

function MetricModal({
  currentWeight,
  currentWaist,
  onClose,
  onSave
}: {
  currentWeight: number | null
  currentWaist: number | null
  onClose: () => void
  onSave: (m: BodyMetricInput) => Promise<void>
}) {
  const [weight, setWeight] = useState(currentWeight != null ? String(currentWeight) : '')
  const [waist, setWaist] = useState(currentWaist != null ? String(currentWaist) : '')
  const [note, setNote] = useState('')

  return (
    <div className="sheet" role="dialog" aria-label="Log body metrics">
      <div className="sheet-card" style={{ ['--c' as string]: '#ff6b8b', maxWidth: 420 }}>
        <h3>Log weight & waist</h3>

        <div className="metric-grid">
          <label>
            Weight (kg)
            <input
              type="number"
              step="0.1"
              autoFocus
              value={weight}
              placeholder="e.g. 78.5"
              onChange={(e) => setWeight(e.target.value)}
            />
          </label>

          <label>
            Waist (cm)
            <input
              type="number"
              step="0.5"
              value={waist}
              placeholder="e.g. 82.0"
              onChange={(e) => setWaist(e.target.value)}
            />
          </label>
        </div>

        <label style={{ marginTop: 10 }}>
          Note (optional)
          <input
            value={note}
            placeholder="e.g. Fasted morning weigh-in"
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        <div className="sheet-actions" style={{ marginTop: 16 }}>
          <button type="button" className="btn sub" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            style={{ background: '#ff6b8b', borderColor: '#ff6b8b', color: '#fff' }}
            disabled={!weight && !waist}
            onClick={() =>
              onSave({
                weight: weight ? Number(weight) : null,
                waist: waist ? Number(waist) : null,
                note: note || undefined
              })
            }
          >
            Save Metrics
          </button>
        </div>
      </div>
    </div>
  )
}

function ExerciseModal({
  onClose,
  onSave
}: {
  onClose: () => void
  onSave: (ex: { name: string; unit: string; target: number; category: any }) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [unit, setUnit] = useState('reps')
  const [target, setTarget] = useState(15)
  const [category, setCategory] = useState<'calisthenics' | 'cardio' | 'gym' | 'other'>('calisthenics')

  return (
    <div className="sheet" role="dialog" aria-label="Add custom exercise">
      <div className="sheet-card" style={{ ['--c' as string]: '#ff6b8b', maxWidth: 420 }}>
        <h3>Add custom exercise</h3>

        <label>
          Exercise name
          <input
            autoFocus
            value={name}
            placeholder="e.g. Chin-ups, Dumbbell Curls, Kettlebell Swings"
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <div className="metric-grid">
          <label>
            Target amount
            <input
              type="number"
              min={1}
              value={target}
              onChange={(e) => setTarget(Number(e.target.value))}
            />
          </label>

          <label>
            Unit
            <select value={unit} onChange={(e) => setUnit(e.target.value)}>
              <option value="reps">reps</option>
              <option value="sec">sec</option>
              <option value="min">min</option>
              <option value="km">km</option>
            </select>
          </label>
        </div>

        <label style={{ marginTop: 10 }}>
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value as any)}>
            <option value="calisthenics">Calisthenics</option>
            <option value="cardio">Cardio</option>
            <option value="gym">Gym / Weights</option>
            <option value="other">Other</option>
          </select>
        </label>

        <div className="sheet-actions" style={{ marginTop: 16 }}>
          <button type="button" className="btn sub" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            style={{ background: '#ff6b8b', borderColor: '#ff6b8b', color: '#fff' }}
            disabled={!name.trim()}
            onClick={() => onSave({ name, unit, target, category })}
          >
            Add Exercise
          </button>
        </div>
      </div>
    </div>
  )
}
