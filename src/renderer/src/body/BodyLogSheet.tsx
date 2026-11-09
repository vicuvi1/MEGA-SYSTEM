// "Log body": one weigh-in from the scale (or typed). Weight is the only
// field you need; body fat, muscle, water, visceral fat and waist are folded
// under "More". The time is now unless you change it. Saved with Undo, no
// points. Data: life.coach.bodyComp (web/bodyCompBridge.ts → main/bodyComp.ts).
import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { calendarDay } from '@core/dates'
import { life } from '../bridge'
import { useToast } from '../ui'
import './body-log.css'

const pad = (n: number) => String(n).padStart(2, '0')
/** A Date as the value of an <input type="datetime-local"> (local time). */
export const localInput = (d: Date) => `${calendarDay(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`

const MORE: { key: 'body_fat_pct' | 'muscle_kg' | 'water_pct' | 'visceral_fat' | 'waist_cm'; label: string; unit: string; step: string; hint: string }[] = [
  { key: 'body_fat_pct', label: 'Body fat', unit: '%', step: '0.1', hint: 'e.g. 15.2' },
  { key: 'muscle_kg', label: 'Muscle', unit: 'kg', step: '0.1', hint: 'e.g. 57.8' },
  { key: 'water_pct', label: 'Water', unit: '%', step: '0.1', hint: 'e.g. 58.4' },
  { key: 'visceral_fat', label: 'Visceral fat', unit: '', step: '1', hint: 'e.g. 4' },
  { key: 'waist_cm', label: 'Waist', unit: 'cm', step: '0.5', hint: 'e.g. 80.5' }
]

export function BodyLogSheet({ lastWeight, onClose, onSaved }: { lastWeight?: number | null; onClose: () => void; onSaved?: () => void }) {
  const toast = useToast()
  const [weight, setWeight] = useState('')
  const [more, setMore] = useState<Record<string, string>>({})
  const [when, setWhen] = useState(() => localInput(new Date()))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const api = life.coach?.bodyComp
  const save = async () => {
    if (!api || busy) return
    setBusy(true)
    setError(null)
    try {
      const input: Record<string, unknown> = { weight_kg: weight, at: new Date(when).toISOString() }
      for (const f of MORE) if (more[f.key]) input[f.key] = more[f.key]
      const r = await api.add(input as any, 'manual')
      onSaved?.()
      onClose()
      const extra = r.row.body_fat_pct != null ? ` · ${r.row.body_fat_pct}% fat` : ''
      toast(`Saved ${r.row.weight_kg} kg${extra}`, 'good', {
        label: 'Undo',
        run: () =>
          void api
            .undo(r.row.id, r.prev)
            .then(() => toast('Weigh-in taken back', 'info'))
            .catch((e) => toast((e as Error).message, 'bad'))
      })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // On document.body: a page or tab panel with a transform would trap a fixed sheet under the bars.
  return createPortal(
    <div className="sheet blog-sheet" role="dialog" aria-modal="true" aria-label="Log body" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet-card blog-card">
        <h3 className="blog-title">Log body</h3>
        <p className="blog-hint">Best: morning, after the toilet, before eating or drinking.</p>
        <label className="blog-weight">
          <span>Weight</span>
          <span className="blog-weight-row">
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              min="30"
              max="250"
              autoFocus
              value={weight}
              placeholder={lastWeight ? String(lastWeight) : '70.0'}
              aria-label="Weight in kg"
              onChange={(e) => setWeight(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && weight && void save()}
            />
            <b>kg</b>
          </span>
        </label>
        <details className="blog-more">
          <summary>More: body fat, muscle, water, visceral fat, waist</summary>
          <div className="blog-grid">
            {MORE.map((f) => (
              <label key={f.key}>
                <span>
                  {f.label}
                  {f.unit ? ` (${f.unit})` : ''}
                </span>
                <input type="number" inputMode="decimal" step={f.step} value={more[f.key] ?? ''} placeholder={f.hint} data-field={f.key} onChange={(e) => setMore((m) => ({ ...m, [f.key]: e.target.value }))} />
              </label>
            ))}
          </div>
          <p className="blog-note">Fat and muscle from a home scale are estimates: watch the trend, not one number.</p>
        </details>
        <label className="blog-when">
          <span>Time</span>
          <input type="datetime-local" value={when} max={localInput(new Date(Date.now() + 5 * 60_000))} onChange={(e) => setWhen(e.target.value)} />
        </label>
        {error && (
          <p className="blog-error" role="alert">
            {error}
          </p>
        )}
        <div className="sheet-actions">
          <button type="button" className="btn sub" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary blog-save" disabled={!weight || busy || !api} onClick={() => void save()}>
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

/**
 * The sheet as a hook, so a card opens it with one line. Without the
 * weigh-in log (an old bridge), `fallback` (the old weight & waist sheet) runs.
 */
export function useBodyLogSheet(fallback?: () => void, lastWeight?: number | null): { open: () => void; sheet: ReactNode } {
  const [on, setOn] = useState(false)
  return {
    open: () => (life.coach?.bodyComp ? setOn(true) : fallback?.()),
    sheet: on ? <BodyLogSheet lastWeight={lastWeight} onClose={() => setOn(false)} /> : null
  }
}
