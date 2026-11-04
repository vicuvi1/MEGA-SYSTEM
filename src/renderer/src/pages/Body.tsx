import { RestDayCard } from '../RestDay'
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
  const [shortOnTime, setShortOnTime] = useState(false)

  const todayKey = new Date().toISOString().split('T')[0]
  const [waterMl, setWaterMl] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('ls.hydration')
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed.date === todayKey) return parsed.ml || 0
      }
    } catch {}
    return 0
  })

  const saveWater = (newMl: number) => {
    const val = Math.max(0, newMl)
    setWaterMl(val)
    try {
      localStorage.setItem('ls.hydration', JSON.stringify({ date: todayKey, ml: val }))
    } catch {}
  }

  // Calculate today's completed reps per exercise
  const todayWorkouts = state.recentWorkouts.filter((w) => w.day === todayKey)
  const doneMap: Record<string, number> = {}
  for (const w of todayWorkouts) {
    for (const it of w.items) {
      const key = (it.exerciseId || it.name || '').toLowerCase()
      doneMap[key] = (doneMap[key] || 0) + it.amount
      const cleanKey = key.replace(/[^a-z0-9]/g, '')
      if (cleanKey) doneMap[cleanKey] = (doneMap[cleanKey] || 0) + it.amount
    }
  }

  const handleQuickLog = async (ex: Exercise, amount: number) => {
    const next = await act(
      () =>
        life.body.logWorkout({
          title: `${ex.name} (+${amount} ${ex.unit})`,
          items: [{ exerciseId: ex.id, name: ex.name, amount, unit: ex.unit as any }],
          note: 'Quick logged from Sporty Routine'
        }),
      `Logged ${amount} ${ex.unit} ${ex.name}`
    )
    if (next) {
      soundCoin()
      onState(next.state)
      onWallet()
    }
  }

  const handleCompleteAllRoutine = async () => {
    const activeExercises = state.exercises.length > 0 ? state.exercises : [
      { id: 'situps', name: 'Sit-ups', target: 60, unit: 'reps', category: 'calisthenics', sort: 0 },
      { id: 'pushups', name: 'Push-ups', target: 123, unit: 'reps', category: 'calisthenics', sort: 1 },
      { id: 'press', name: 'press', target: 50, unit: 'reps', category: 'calisthenics', sort: 2 }
    ]

    const items: WorkoutExerciseItem[] = activeExercises.map((ex) => {
      const target = shortOnTime ? Math.max(1, Math.round(ex.target * 0.5)) : ex.target
      const done = doneMap[ex.id] || doneMap[ex.name.toLowerCase().replace(/[^a-z0-9]/g, '')] || 0
      const remaining = Math.max(0, target - done)
      return {
        exerciseId: ex.id,
        name: ex.name,
        amount: remaining > 0 ? remaining : target,
        unit: ex.unit as any
      }
    })

    const next = await act(
      () =>
        life.body.logWorkout({
          title: `Sporty Routine Completed (${items.map((i) => `${i.amount} ${i.name}`).join(', ')})`,
          items,
          note: '⚡ Completed full daily routine'
        }),
      'All daily routine exercises completed!'
    )
    if (next) {
      soundCoin()
      onState(next.state)
      onWallet()
    }
  }

  const handleUndoLast = async () => {
    if (state.recentWorkouts.length === 0) return
    const last = state.recentWorkouts[0]
    if (!confirm(`Undo last workout "${last.title}" and refund coins?`)) return
    const next = await act(() => life.body.deleteWorkout(last.id), `Reverted "${last.title}"`)
    if (next) {
      onState(next)
      onWallet()
    }
  }

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
      <RestDayCard />
      <section className="stats four">
        <div className="stat hero pink">
          <span className="label">Workout streak</span>
          <div className="big">{state.streak} {state.streak === 1 ? 'day' : 'days'}</div>
          <span className="sub">
            {state.workoutDoneToday
              ? 'Completed today (+10 coins paid)'
              : state.restToday
                ? `😴 Rest day · streak kept · best ${state.bestStreak}`
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
        {state.recentWorkouts.length > 0 && (
          <button
            className="btn"
            style={{ background: 'rgba(239, 68, 68, 0.12)', borderColor: 'rgba(239, 68, 68, 0.35)', color: '#fca5a5' }}
            onClick={handleUndoLast}
            title={`Undo last workout: "${state.recentWorkouts[0]?.title}"`}
          >
            <Icon name="undo" size={15} />
            Undo last workout
          </button>
        )}
      </div>

      {/* SPORTY ROUTINE & HYDRATION DASHBOARD */}
      <section className="sporty-routine-panel">
        <div className="sporty-routine-header">
          <div className="sporty-routine-title">
            <Icon name="bolt" size={18} />
            Today's Workout Routine (Sporty Bot Mode)
            <span style={{ fontSize: '11px', color: '#ff6b8b', background: 'rgba(255, 107, 139, 0.15)', padding: '2px 8px', borderRadius: '6px', fontWeight: 700 }}>
              BEAST MODE
            </span>
          </div>

          <div className="sporty-routine-controls">
            <button
              className={`chip-btn ${shortOnTime ? 'active' : ''}`}
              onClick={() => setShortOnTime(!shortOnTime)}
              style={shortOnTime ? { background: '#f97316', borderColor: '#f97316', color: '#fff' } : {}}
            >
              ⏱️ Short on time (50%)
            </button>
            <button
              className="btn"
              style={{ background: 'linear-gradient(135deg, #f9d423, #ff4b1f)', color: '#050811', fontWeight: 800, padding: '7px 14px', fontSize: '12px' }}
              onClick={handleCompleteAllRoutine}
            >
              ⚡ Complete all (+15 🪙 / +35 XP)
            </button>
            {state.recentWorkouts.length > 0 && (
              <button
                className="btn small"
                style={{ background: 'rgba(255,255,255,0.06)', color: '#cbd5e1', fontSize: '11px' }}
                onClick={handleUndoLast}
                title="Undo last recorded set"
              >
                <Icon name="undo" size={12} />
                Undo
              </button>
            )}
          </div>
        </div>

        <div className="sporty-routine-grid">
          {state.exercises.slice(0, 3).map((ex) => {
            const target = shortOnTime ? Math.max(1, Math.round(ex.target * 0.5)) : ex.target
            const done = doneMap[ex.id] || doneMap[ex.name.toLowerCase().replace(/[^a-z0-9]/g, '')] || 0
            const actualPct = target > 0 ? Math.round((done / target) * 100) : 0
            const isDone = done >= target
            const isOver = done > target
            const fillPct = Math.min(100, actualPct)
            const unit = (!ex.unit || ex.unit === '1') ? 'reps' : ex.unit

            return (
              <div key={ex.id} className={`sporty-routine-item ${isDone ? 'done' : ''} ${isOver ? 'overachieved' : ''}`}>
                <div className="sporty-item-top">
                  <span className="sporty-item-name">{ex.name}</span>
                  <span className="sporty-item-progress-text">
                    {done} / {target} {unit}{shortOnTime ? ' (50%)' : ''} {isOver ? `🔥 (${actualPct}%)` : isDone ? `✓ (${actualPct}%)` : `(${actualPct}%)`}
                  </span>
                </div>

                <div className="sporty-item-bar-bg">
                  <div
                    className={`sporty-item-bar-fill ${isDone ? 'done' : ''} ${isOver ? 'overachieved' : ''}`}
                    style={{ width: `${fillPct}%` }}
                  />
                </div>

                <div className="sporty-item-buttons">
                  <button className="btn-sporty-rep" onClick={() => handleQuickLog(ex, 10)}>+10</button>
                  <button className="btn-sporty-rep" onClick={() => handleQuickLog(ex, 25)}>+25</button>
                  <button className="btn-sporty-rep done-btn" onClick={() => handleQuickLog(ex, Math.max(1, target - done))}>
                    ⚡ Done ({target})
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* DAILY HYDRATION TRACKER */}
      <section className="sporty-hydration-panel">
        <div className="hydration-top">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '18px' }}>💧</span>
            <span className="hydration-amount">{waterMl.toLocaleString()} / 2,700 ml</span>
          </div>
          <span className="hydration-glasses">
            {(waterMl / 250).toFixed(1)} of 11 glasses ({Math.round((waterMl / 2700) * 100)}%)
          </span>
        </div>

        <div className="hydration-bar-bg">
          <div
            className="hydration-bar-fill"
            style={{ width: `${Math.min(100, Math.round((waterMl / 2700) * 100))}%` }}
          />
        </div>

        <div className="hydration-buttons">
          <button className="btn-hydration" onClick={() => saveWater(waterMl + 250)}>
            💧 +250 ml (1 glass)
          </button>
          <button className="btn-hydration" onClick={() => saveWater(waterMl + 500)}>
            💧 +500 ml (bottle)
          </button>
          <button className="btn-hydration" onClick={() => saveWater(waterMl + 1000)}>
            💧 +1,000 ml
          </button>
          <button className="btn-hydration" onClick={() => saveWater(waterMl - 250)} style={{ opacity: 0.8 }}>
            ↩️ -250 ml (Undo)
          </button>
          <button
            className="btn-hydration"
            onClick={() => { if (confirm('Reset today\'s water intake to 0?')) saveWater(0); }}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#64748b', fontSize: '11px' }}
          >
            Reset
          </button>
        </div>
      </section>

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
                        className="btn small"
                        title="Undo / delete this workout record"
                        onClick={() => handleDelete(w.id)}
                        style={{
                          background: 'rgba(239, 68, 68, 0.12)',
                          borderColor: 'rgba(239, 68, 68, 0.3)',
                          color: '#fca5a5',
                          fontSize: '11px',
                          padding: '3px 8px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                      >
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
