import { askConfirm } from '../confirmSheet'
import { RestDayCard } from '../RestDay'
import { usePoints } from '../usePoints'
import { dayKey } from '@core/dates'
import { useEffect, useState } from 'react'
import type { BodyMetricInput, BodyState, Exercise, WorkoutExerciseItem, WorkoutInput } from '@shared/api'
import { life } from '../bridge'
import { Icon } from '../Icon'
import { soundCoin } from '../soundKit'
import { useWater } from '../water'
import { WaterHistory } from '../WaterHistory'
import { StrengthCard } from '../StrengthCard'
import { ReadinessCard } from '../ReadinessCard'
import { SkillPaths } from '../SkillPaths'
import { useAction } from '../ui'
import '../body.css'
import { WATER_TARGET_ML } from '@core/defaults'
import { celebrate } from '../fx'
import { Select } from '../Select'
import { PageTabs, TabPanel, usePageTab } from '../PageTabs'
import { ProteinCard } from '../body/ProteinCard'
import { WeightTrendCard } from '../body/WeightTrendCard'
import { MuscleWeekCard } from '../body/MuscleWeekCard'
import { SuppCard } from '../body/SuppCard'
import { TapeCard } from '../body/TapeCard'
import { PhotoCheckin } from '../body/PhotoCheckin'
import { BodyWeekCard } from '../body/BodyWeekCard'
import { readSoreness, useBodyPlus } from '../body/useBodyPlus'
import '../body/body-plus.css'

const BODY_TABS = [
  { id: 'today', label: 'Today', title: 'Readiness, protein, supplements and water' },
  { id: 'food', label: 'Food', title: 'Protein: goal, quick log, saved meals' },
  { id: 'training', label: 'Training', title: 'Sets per muscle, next steps, strength, workouts' },
  { id: 'progress', label: 'Progress', title: 'Weight trend, measurements, photos, your week' }
]

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
  const pts = usePoints()
  const [workoutOpen, setWorkoutOpen] = useState(false)
  const [metricOpen, setMetricOpen] = useState(false)
  const [exerciseOpen, setExerciseOpen] = useState(false)
  const [shortOnTime, setShortOnTime] = useState(false)
  const [tab, setTab] = usePageTab('body', BODY_TABS.map((t) => t.id), 'today')
  const [plus, setPlus] = useBodyPlus()
  // BD7: progression holds after a short night (the next steps say "repeat").
  const [hold, setHold] = useState(false)
  useEffect(() => {
    const load = () =>
      void life.coach?.bodyPlus
        ?.ready(readSoreness(dayKey(new Date())))
        .then((r) => setHold(r.hold))
        .catch(() => {})
    load()
    window.addEventListener('life-body-changed', load)
    return () => window.removeEventListener('life-body-changed', load)
  }, [])

  // The app's day (turns at 04:00, like workouts and points: N8).
  const todayKey = dayKey(new Date())
  // The one shared water log (water.ts): Ben, Sporty, Telegram and Today see the same number.
  const water = useWater()
  const waterMl = water.ml
  const waterTarget = water.target || WATER_TARGET_ML
  const saveWater = (newMl: number) => void water.set(Math.max(0, newMl))

  // Calculate today's completed reps per exercise
  const todayWorkouts = state.recentWorkouts.filter((w) => w.day === todayKey)
  const doneMap: Record<string, number> = {}
  // Each item counts once, under its id and (if different) its name.
  const canon = (x: string) => (x || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  for (const w of todayWorkouts) {
    for (const it of w.items) {
      const keys = [...new Set([canon(it.exerciseId), canon(it.name)].filter(Boolean))]
      for (const k of keys) doneMap[k] = (doneMap[k] || 0) + it.amount
    }
  }
  const doneOf = (ex: { id: string; name: string }) => doneMap[canon(ex.id)] || doneMap[canon(ex.name)] || 0
  // The routine is what the card shows.
  const routine = state.exercises.slice(0, 3)

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
      celebrate(null, 'workout')
      soundCoin()
      onState(next.state)
      onWallet()
    }
  }

  const handleCompleteAllRoutine = async () => {
    // Only what's left of the exercises on the card (nothing twice when it's all done).
    const items: WorkoutExerciseItem[] = routine
      .map((ex) => {
        const target = shortOnTime ? Math.max(1, Math.round(ex.target * 0.5)) : ex.target
        return { exerciseId: ex.id, name: ex.name, amount: Math.max(0, target - doneOf(ex)), unit: ex.unit as any }
      })
      .filter((it) => it.amount > 0)
    if (!items.length) return void act(async () => true, 'Already done today 💪')

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
      celebrate(null, 'workout')
      soundCoin()
      onState(next.state)
      onWallet()
    }
  }

  const handleUndoLast = async () => {
    if (state.recentWorkouts.length === 0) return
    const last = state.recentWorkouts[0]
    if (!await askConfirm(`Undo last workout "${last.title}" and give the points back?`)) return
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
    if (!await askConfirm('Delete this workout record? Any points earned from it will be taken back.')) return
    const next = await act(() => life.body.deleteWorkout(id), 'Workout removed')
    if (next) {
      onState(next)
      onWallet()
    }
  }

  return (
    <div className="body-page">
      <PageTabs page="body" label="Body views" tabs={BODY_TABS.map((t) => ({ ...t, count: t.id === 'food' && plus ? `${plus.today}/${plus.goal.g}` : null }))} value={tab} onChange={setTab} />
      <TabPanel page="body" id="today" value={tab} className="body-tab">
        <RestDayCard />
        <section className="stats four">
          <div className="stat hero pink">
            <span className="label">Workout streak</span>
            <div className="big">{state.streak} {state.streak === 1 ? 'day' : 'days'}</div>
            <span className="sub">
              {state.workoutDoneToday
                ? `Completed today (+${pts('body.workout_done', 10)} points paid)`
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
            <button className="btn sub" onClick={onOpenSportApp} title="Today's exercises, water and the rest timer">
              <Icon name="bolt" size={15} />
              Open the tracker
            </button>
          )}
          <button className="btn primary" onClick={() => setWorkoutOpen(true)}>
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
              className="btn ghost body-undo"
              onClick={handleUndoLast}
              title={`Undo last workout: "${state.recentWorkouts[0]?.title}"`}
            >
              <Icon name="undo" size={15} />
              Undo last workout
            </button>
          )}
        </div>

        {/* READINESS (BD7): sleep + soreness + yesterday's sets → Full / Lighter 70% / Short 50% in Sport Track */}
        <ReadinessCard workoutDone={!!state.workoutDoneToday} />
        <div className="bp-grid">
          <ProteinCard compact />
          {plus && <SuppCard v={plus} onView={setPlus} />}
        </div>
        {/* SP6: the daily checklist and water live in Sport Track only (one routine panel, not two). */}
        <section className="card">
          <WaterHistory />
        </section>
      </TabPanel>

      <TabPanel page="body" id="food" value={tab} className="body-tab">
        <ProteinCard />
      </TabPanel>

      <TabPanel page="body" id="training" value={tab} className="body-tab">
        {/* BD3: hard sets per muscle against the plan and 10–20, the next step for each move */}
        <MuscleWeekCard hold={hold} />
        {/* STRENGTH: sets × reps × kg, records, estimated max (H2) */}
        <StrengthCard state={state} onChange={(s2) => (onState(s2), onWallet())} />
        <SkillPaths state={state} />
        <div className="cols">
          <section className="panel">
            <header className="panel-head">
              <h2>Recent workouts</h2>
              <span className="hint">Logs feed into your streaks and earn {pts('body.workout_done', 10)} points.</span>
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

          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <section className="panel">
              <header className="panel-head">
                <h2>Exercise targets</h2>
              </header>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                {state.exercises.map((ex) => (
                  <div key={ex.id} className="weight-row">
                    <span style={{ fontWeight: 600 }}>{ex.name ? ex.name[0].toUpperCase() + ex.name.slice(1) : ex.name}</span>
                    <span className="chip-text" style={{ color: 'var(--muted)', fontWeight: 600 }}>
                      {ex.target} {ex.unit} a day
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </TabPanel>

      <TabPanel page="body" id="progress" value={tab} className="body-tab">
        {plus && <WeightTrendCard trend={plus.trend} today={plus.day} onLog={() => setMetricOpen(true)} />}
        <div className="bp-grid">
          {plus && <TapeCard v={plus} waist={state.latestWaist} onView={setPlus} />}
          <BodyWeekCard />
        </div>
        <PhotoCheckin every={plus?.prefs.photoEvery ?? 14} />
      </TabPanel>

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
      <div className="sheet-card" style={{ maxWidth: 480 }}>
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
                    aria-label={`Remove ${it.name ?? 'exercise'}`}
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
            className="btn primary"
            disabled={!title.trim() || items.length === 0}
            onClick={() => onSave({ title, items, note: note || undefined })}
          >
            Finish & earn +10 points
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
      <div className="sheet-card" style={{ maxWidth: 420 }}>
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
            className="btn primary"
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
      <div className="sheet-card" style={{ maxWidth: 420 }}>
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
            <Select value={unit} onChange={(e) => setUnit(e.target.value)}>
              <option value="reps">reps</option>
              <option value="sec">sec</option>
              <option value="min">min</option>
              <option value="km">km</option>
            </Select>
          </label>
        </div>

        <label style={{ marginTop: 10 }}>
          Category
          <Select value={category} onChange={(e) => setCategory(e.target.value as any)}>
            <option value="calisthenics">Calisthenics</option>
            <option value="cardio">Cardio</option>
            <option value="gym">Gym / Weights</option>
            <option value="other">Other</option>
          </Select>
        </label>

        <div className="sheet-actions" style={{ marginTop: 16 }}>
          <button type="button" className="btn sub" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
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
