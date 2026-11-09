// The coach's settings sheet (synced setting coach_config): goal, ramp-up,
// training rules, morning routine, sleep, language and the AI line. The food
// goal and the standard day stay in Food; the split stays in Training.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { life } from '../bridge'
import { useAction } from '../ui'
import type { CoachConfig, MorningStep } from '@core/coachConfig'
import type { NudgePrefs } from '@core/coachTalk'
import './coach.css'

const n = (v: string, d: number) => (Number.isFinite(Number(v)) && v !== '' ? Number(v) : d)

export function CoachSettings({ onClose }: { onClose: () => void }) {
  const act = useAction()
  const [c, setC] = useState<CoachConfig | null>(null)
  const [np, setNp] = useState<NudgePrefs | null>(null)
  useEffect(() => {
    void life.coach?.today?.config().then(setC)
    void life.coach?.today?.nudgePrefs?.().then(setNp).catch(() => {})
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  if (!c) return null
  const api = life.coach!.today!
  const put = (patch: Partial<CoachConfig>) => setC({ ...c, ...patch })
  const step = (i: number, patch: Partial<MorningStep>) => put({ morning: c.morning.map((s, k) => (k === i ? { ...s, ...patch } : s)) })
  const save = async () => {
    const ok = await act(async () => {
      const out = await api.saveConfig(c)
      if (np) await api.setNudgePrefs(np)
      return out
    }, 'Coach settings saved')
    if (ok) onClose()
  }
  const ramp = async () => {
    const out = await act(() => api.startRamp(c.ramp.baseline), (x) => `Ramp-up starts today from about ${x.ramp.baseline?.toLocaleString('en-US')} kcal.`)
    if (out) setC(out)
  }
  return createPortal(
    <div className="sheet ct-sheet" role="dialog" aria-modal="true" aria-label="Coach settings" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet-card ct-settings">
        <header>
          <span className="ct-kicker">Coach</span>
          <h3>Coach settings</h3>
          <p className="hint">Your food goal and standard day are in Body → Food; your weekly split is in Body → Training.</p>
        </header>
        <fieldset>
          <legend>Goal: slow gain</legend>
          <label>
            From <input type="number" step="0.05" min="0.1" max="1" value={c.gain.lo} onChange={(e) => put({ gain: { ...c.gain, lo: n(e.target.value, c.gain.lo) } })} />
          </label>
          <label>
            to <input type="number" step="0.05" min="0.1" max="1" value={c.gain.hi} onChange={(e) => put({ gain: { ...c.gain, hi: n(e.target.value, c.gain.hi) } })} /> kg a week
          </label>
        </fieldset>
        <fieldset>
          <legend>Food ramp-up (first 2 weeks)</legend>
          <p className="hint">Week 1: halfway from what you used to eat to your goal (never under 2,200 kcal). Week 2: your goal.</p>
          <label>
            What you used to eat <input type="number" step="50" min="500" max="5000" value={c.ramp.baseline ?? ''} placeholder="from your logs" onChange={(e) => put({ ramp: { ...c.ramp, baseline: e.target.value === '' ? null : n(e.target.value, 1500) } })} /> kcal
          </label>
          <p className="ct-row">
            <span>{c.ramp.start ? `Started ${c.ramp.start}` : 'Not started'}</span>
            <button type="button" className="btn small" onClick={() => void ramp()}>
              {c.ramp.start ? 'Start again today' : 'Start ramp-up today'}
            </button>
          </p>
          <label>
            Meals a day (without a standard day) <input type="number" min="3" max="6" value={c.meals} onChange={(e) => put({ meals: n(e.target.value, c.meals) })} />
          </label>
        </fieldset>
        <fieldset>
          <legend>Training at home</legend>
          <label>
            At most <input type="number" min="10" max="90" value={c.train.maxMin} onChange={(e) => put({ train: { ...c.train, maxMin: n(e.target.value, c.train.maxMin) } })} /> min
          </label>
          <label>
            When
            <select value={c.train.when} onChange={(e) => put({ train: { ...c.train, when: e.target.value as CoachConfig['train']['when'] } })}>
              <option value="morning">Morning, before the shower</option>
              <option value="afternoon">Afternoon</option>
              <option value="evening">Evening</option>
            </select>
          </label>
          <label>
            Reps <input type="number" min="1" max="30" value={c.train.reps[0]} onChange={(e) => put({ train: { ...c.train, reps: [n(e.target.value, 6), c.train.reps[1]] } })} />–
            <input type="number" min="1" max="30" value={c.train.reps[1]} onChange={(e) => put({ train: { ...c.train, reps: [c.train.reps[0], n(e.target.value, 12)] } })} />, stop with
            <input type="number" min="0" max="5" value={c.train.rir[0]} onChange={(e) => put({ train: { ...c.train, rir: [n(e.target.value, 1), c.train.rir[1]] } })} />–
            <input type="number" min="0" max="5" value={c.train.rir[1]} onChange={(e) => put({ train: { ...c.train, rir: [c.train.rir[0], n(e.target.value, 3)] } })} /> reps left
          </label>
        </fieldset>
        <fieldset>
          <legend>Morning routine</legend>
          <ol className="ct-steps">
            {c.morning.map((s, i) => (
              <li key={s.id}>
                <input aria-label="Step" value={s.label} maxLength={60} onChange={(e) => step(i, { label: e.target.value })} />
                <input aria-label="Minutes" type="number" min="0" max="120" value={s.min ?? ''} placeholder="min" onChange={(e) => step(i, { min: e.target.value === '' ? null : n(e.target.value, 0) })} />
                <button type="button" className="ct-icon" aria-label={`Remove ${s.label}`} onClick={() => put({ morning: c.morning.filter((_, k) => k !== i) })}>
                  ×
                </button>
              </li>
            ))}
          </ol>
          {c.morning.length < 10 && (
            <button type="button" className="btn small ghost" onClick={() => put({ morning: [...c.morning, { id: `s${Date.now().toString(36)}`, label: 'New step', min: null }] })}>
              Add a step
            </button>
          )}
        </fieldset>
        <fieldset>
          <legend>Sleep</legend>
          <label>
            In bed by <input type="time" value={c.sleep.bed} onChange={(e) => put({ sleep: { ...c.sleep, bed: e.target.value || c.sleep.bed } })} />
          </label>
          <label>
            Sleep <input type="number" step="0.5" min="5" max="11" value={c.sleep.hours[0]} onChange={(e) => put({ sleep: { ...c.sleep, hours: [n(e.target.value, 7.5), c.sleep.hours[1]] } })} />–
            <input type="number" step="0.5" min="5" max="11" value={c.sleep.hours[1]} onChange={(e) => put({ sleep: { ...c.sleep, hours: [c.sleep.hours[0], n(e.target.value, 8)] } })} /> h
          </label>
        </fieldset>
        <fieldset>
          <legend>Words</legend>
          <label>
            Language
            <select value={c.lang} onChange={(e) => put({ lang: e.target.value === 'ro' ? 'ro' : 'en' })}>
              <option value="en">English</option>
              <option value="ro">Română</option>
            </select>
          </label>
          <label className="ct-row">
            <input type="checkbox" checked={c.ai} onChange={(e) => put({ ai: e.target.checked })} /> Let the AI write the day's line (once a morning; a template otherwise)
          </label>
        </fieldset>
        {np && (
          <fieldset>
            <legend>Nudges (at most 3 a day with meal reminders)</legend>
            <label className="ct-row">
              <input type="checkbox" checked={np.morning} onChange={(e) => setNp({ ...np, morning: e.target.checked })} /> Morning: today's training and the snack before it
            </label>
            <label className="ct-row">
              <input type="checkbox" checked={np.protein} onChange={(e) => setNp({ ...np, protein: e.target.checked })} /> Midday protein (under 40% by 14:00)
            </label>
            <label className="ct-row">
              <input type="checkbox" checked={np.checkin} onChange={(e) => setNp({ ...np, checkin: e.target.checked })} /> Evening check-in (about 21:00)
            </label>
            <p className="hint">The same switches are in Settings → Ben → Pushes.</p>
          </fieldset>
        )}
        <p className="hint">Supplements: an optional protein shake, optional creatine 3–5 g a day. Never fat burners.</p>
        <div className="sheet-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={() => void save()}>
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
