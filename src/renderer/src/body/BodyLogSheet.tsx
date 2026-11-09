// "Log body": one weigh-in from the scale (or typed). Weight is the only
// field you need; body fat, muscle, water, visceral fat and waist are folded
// under "More". The time is now unless you change it. Saved with Undo, no
// points. Data: life.coach.bodyComp (web/bodyCompBridge.ts → main/bodyComp.ts).
//
// "Import a scale screenshot" (upload, paste or drop): the picture is made
// small in the browser (foodPhotoPrep.ts) and read by /api/ai {op:'foodPhoto',
// kind:'scale'} (the same 50-a-day counter and budget as food photos). The
// answer is checked by core/scaleRead.ts, then every number is shown here to
// check and edit (the ones read from the screenshot are marked). Save stores
// it with source 'screenshot' and the checked numbers as raw JSON. The
// picture is never stored.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { calendarDay } from '@core/dates'
import { SCALE_FIELDS, validateScale, type ScaleKey, type ScaleRead } from '@core/scaleRead'
import { life } from '../bridge'
import { useToast } from '../ui'
import { askScaleShot, imageFrom, prepFoodPhoto } from './foodPhotoPrep'
import './body-log.css'

const pad = (n: number) => String(n).padStart(2, '0')
/** A Date as the value of an <input type="datetime-local"> (local time). */
export const localInput = (d: Date) => `${calendarDay(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`

type Field = { key: string; label: string; unit: string; step: string; hint: string }
const MORE: Field[] = [
  { key: 'body_fat_pct', label: 'Body fat', unit: '%', step: '0.1', hint: 'e.g. 15.2' },
  { key: 'muscle_kg', label: 'Muscle', unit: 'kg', step: '0.1', hint: 'e.g. 57.8' },
  { key: 'water_pct', label: 'Water', unit: '%', step: '0.1', hint: 'e.g. 58.4' },
  { key: 'visceral_fat', label: 'Visceral fat', unit: '', step: '1', hint: 'e.g. 4' },
  { key: 'waist_cm', label: 'Waist', unit: 'cm', step: '0.5', hint: 'e.g. 80.5' }
]
/** With a screenshot every number the scale shows can be checked (and the waist, typed). */
const ALL: Field[] = [...SCALE_FIELDS.filter((f) => f.col !== 'weight_kg').map((f) => ({ key: f.col, label: f.label, unit: f.unit, step: f.step, hint: '' })), MORE[4]]

type Shot = { s: 'reading'; url: string } | { s: 'review'; url: string; read: ScaleRead; found: ScaleKey[]; dropped: { key: ScaleKey; why: string }[] } | { s: 'failed'; error: string }

export function BodyLogSheet({ lastWeight, onClose, onSaved }: { lastWeight?: number | null; onClose: () => void; onSaved?: () => void }) {
  const toast = useToast()
  const [weight, setWeight] = useState('')
  const [more, setMore] = useState<Record<string, string>>({})
  const [when, setWhen] = useState(() => localInput(new Date()))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [shot, setShot] = useState<Shot | null>(null)
  const [drag, setDrag] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const readShot = useCallback(async (file: File | null) => {
    if (!file) return
    setError(null)
    let p
    try {
      p = await prepFoodPhoto(file)
    } catch (e) {
      setShot({ s: 'failed', error: (e as Error).message })
      return
    }
    setShot({ s: 'reading', url: p.url })
    const ans = await askScaleShot({ mime: p.mime, data: p.data })
    if (!ans.ok) {
      setShot({ s: 'failed', error: ans.error })
      return
    }
    const chk = validateScale(ans.result)
    if (!chk.ok) {
      setShot({ s: 'failed', error: chk.error })
      return
    }
    // Fill the form from what was read; you check and edit every field before Save.
    const r = chk.read
    setWeight(String(r.weightKg))
    const next: Record<string, string> = {}
    for (const f of SCALE_FIELDS) if (f.col !== 'weight_kg' && r[f.key] != null) next[f.col] = String(r[f.key])
    setMore((m) => ({ waist_cm: m.waist_cm ?? '', ...next }))
    if (r.measuredAt) setWhen(localInput(new Date(r.measuredAt)))
    setShot({ s: 'review', url: p.url, read: r, found: chk.found, dropped: chk.dropped })
  }, [])

  // Paste a screenshot while the sheet is open.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = imageFrom(e.clipboardData?.items)
      if (f) {
        e.preventDefault()
        void readShot(f)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [readShot])

  const api = life.coach?.bodyComp
  const review = shot?.s === 'review' ? shot : null
  const readCols = new Set(review ? SCALE_FIELDS.filter((f) => review.found.includes(f.key)).map((f) => f.col as string) : [])
  const fields = review ? ALL : MORE
  const save = async () => {
    if (!api || busy) return
    setBusy(true)
    setError(null)
    try {
      const input: Record<string, unknown> = { weight_kg: weight, at: new Date(when).toISOString() }
      for (const f of fields) if (more[f.key]) input[f.key] = more[f.key]
      // The checked numbers the AI read, kept as raw JSON (never the picture).
      if (review) input.raw = { from: 'screenshot', read: review.read, found: review.found }
      const r = await api.add(input as any, review ? 'screenshot' : 'manual')
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

  const grid = (
    <div className="blog-grid">
      {fields.map((f) => (
        <label key={f.key} className={readCols.has(f.key) ? 'read' : undefined}>
          <span>
            {f.label}
            {f.unit ? ` (${f.unit})` : ''}
            {readCols.has(f.key) && <em className="blog-read-tag">read</em>}
          </span>
          <input type="number" inputMode="decimal" step={f.step} value={more[f.key] ?? ''} placeholder={f.hint} data-field={f.key} onChange={(e) => setMore((m) => ({ ...m, [f.key]: e.target.value }))} />
        </label>
      ))}
    </div>
  )

  // On document.body: a page or tab panel with a transform would trap a fixed sheet under the bars.
  return createPortal(
    <div className="sheet blog-sheet" role="dialog" aria-modal="true" aria-label="Log body" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`sheet-card blog-card${drag ? ' drag' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          void readShot(imageFrom(e.dataTransfer?.files))
        }}
      >
        <h3 className="blog-title">Log body</h3>
        <input ref={fileRef} className="blog-shot-file" type="file" accept="image/*" hidden onChange={(e) => (void readShot(e.target.files?.[0] ?? null), (e.target.value = ''))} />
        {!shot && (
          <div className="blog-shot-start">
            <button type="button" className="btn sub blog-shot-btn" onClick={() => fileRef.current?.click()}>
              Import a scale screenshot
            </button>
            <small>From Xiaomi Home or Mi Fitness: upload, paste or drop the result screen. You check every number before it is saved.</small>
          </div>
        )}
        {shot?.s === 'reading' && (
          <div className="blog-shot-reading" role="status">
            <img src={shot.url} alt="Your scale screenshot" width={44} height={64} />
            <span>Reading your screenshot…</span>
          </div>
        )}
        {shot?.s === 'failed' && (
          <div className="blog-shot-fail" role="alert">
            <p>{shot.error}</p>
            <button type="button" className="btn sub blog-shot-btn" onClick={() => fileRef.current?.click()}>
              Try another screenshot
            </button>
          </div>
        )}
        {review && (
          <div className="blog-shot-review" role="status">
            <img src={review.url} alt="Your scale screenshot" width={44} height={64} />
            <div>
              <b>
                Read {review.found.length} number{review.found.length === 1 ? '' : 's'} from your screenshot
              </b>
              <small>Check each one (marked "read") and fix any that look wrong. Fat and muscle are scale estimates.</small>
              {review.dropped.map((d) => (
                <small key={d.key} className="blog-shot-dropped">
                  {d.why}
                </small>
              ))}
            </div>
          </div>
        )}
        {!review && <p className="blog-hint">Best: morning, after the toilet, before eating or drinking.</p>}
        <label className={`blog-weight${review?.found.includes('weightKg') ? ' read' : ''}`}>
          <span>
            Weight{review?.found.includes('weightKg') && <em className="blog-read-tag">read</em>}
          </span>
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
        {review ? (
          grid
        ) : (
          <details className="blog-more">
            <summary>More: body fat, muscle, water, visceral fat, waist</summary>
            {grid}
            <p className="blog-note">Fat and muscle from a home scale are estimates: watch the trend, not one number.</p>
          </details>
        )}
        <label className="blog-when">
          <span>Time{review?.read.measuredAt ? ' (from the screenshot)' : ''}</span>
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
          <button type="button" className="btn primary blog-save" disabled={!weight || busy || !api || shot?.s === 'reading'} onClick={() => void save()}>
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
