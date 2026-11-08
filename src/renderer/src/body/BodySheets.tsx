// The Body page's sheets: log a workout by hand, log weight & waist, add an
// exercise. Shared by the Body tabs (moved out of pages/Body.tsx unchanged).
import { useState } from 'react'
import type { BodyMetricInput, Exercise, WorkoutExerciseItem, WorkoutInput } from '@shared/api'
import { Select } from '../Select'

export function WorkoutModal({
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

export function MetricModal({
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

export function ExerciseModal({
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
