// Food photo logging (Body → Food): take or drop a meal photo, the AI lists the
// foods, you check them here, then Save. NOTHING is saved before you tap Save.
// - The photo is made small in the browser (foodPhotoPrep.ts) and read by
//   /api/ai {op:'foodPhoto'}; it is never stored, only the foods you save.
// - The AI's answer is checked by core/foodVision.ts (numbers clamped, totals
//   added up again, your saved foods use your own numbers).
// - Save goes through the food counter's own add (addFoodMeal), so the meal is
//   in the same food log and body_log totals as every other meal. No points.
// - "No AI? Copy the prompt instead" keeps the old copy-prompt way one tap away.
// Mount: <FoodPhotoLog view={v} /> inside the food counter.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FOOD_PROMPT } from '@core/foodPrompt'
import { MEAL_TYPES, type MealType } from '@core/food'
import { fromSaved, photoReplyLine, savedRefs, scaleVisionItem, slotNow, stepQty, toFoodItems, validateVision, visionTotals, type SavedFoodRef, type VisionItem } from '@core/foodVision'
import { life } from '../bridge'
import { useToast } from '../ui'
import { Select } from '../Select'
import { copyText } from './FoodPlan'
import { askFoodPhoto, imageFrom, prepFoodPhoto, type PreparedPhoto } from './foodPhotoPrep'
import type { FoodView } from '../../../main/food'
import './food-photo.css'

const TYPE_LABEL: Record<MealType, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' }
const CONF_LABEL: Record<VisionItem['confidence'], string> = { high: 'Sure', medium: 'Roughly', low: 'Not sure' }
const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
const q1 = (n: number) => String(Math.round(n * 10) / 10)

/** A review row: the AI's item (amounts scale from it) and the item now. */
interface Row {
  key: number
  base: VisionItem
  item: VisionItem
  /** Added by hand: kcal and protein are typed in. */
  manual?: boolean
}
let rowKey = 0
const newRow = (it: VisionItem, manual = false): Row => ({ key: ++rowKey, base: it, item: it, manual })
const blankItem = (): VisionItem => ({ name: '', matchedSavedFoodId: null, qty: 1, unit: 'serving', grams: 100, kcal: 0, protein: 0, carbs: 0, fat: 0, confidence: 'medium' })
/** A meal id like the counter's ("fd-…"), made once per review so a double tap saves once. */
const mealId = () => `fd-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

type Stage = { s: 'idle' } | { s: 'reading' } | { s: 'review' } | { s: 'failed'; error: string; limit?: string } | { s: 'saved'; line: string }

export function FoodPhotoLog({ view, saved: savedProp, onSaved }: { view: FoodView; saved?: SavedFoodRef[]; onSaved?: (v: FoodView) => void }) {
  const api = life.coach?.food
  const toast = useToast()
  const [stage, setStage] = useState<Stage>({ s: 'idle' })
  const [photo, setPhoto] = useState<PreparedPhoto | null>(null)
  const [note, setNote] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [message, setMessage] = useState('')
  const [type, setType] = useState<MealType>(() => slotNow())
  const [saving, setSaving] = useState(false)
  const [drag, setDrag] = useState(false)
  const idRef = useRef(mealId())
  const camRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Your real saved foods and saved meals (food_saved), then starred meals: the AI gets them and the swap list shows them.
  const saved = useMemo(() => savedProp ?? savedRefs(view.saved, view.favs), [savedProp, view.saved, view.favs])
  const items = rows.map((r) => r.item)
  const totals = visionTotals(items)

  const read = useCallback(
    async (file: File | null) => {
      if (!file) return
      setStage({ s: 'reading' })
      let p: PreparedPhoto
      try {
        p = await prepFoodPhoto(file)
      } catch (e: any) {
        setStage({ s: 'failed', error: e?.message || 'That photo could not be opened.' })
        return
      }
      setPhoto(p)
      const t = view.totals
      const todayItems = view.day === view.today ? view.meals.filter((m) => !m.removed).map((m) => m.name) : []
      const ans = await askFoodPhoto({ image: { mime: p.mime, data: p.data }, note, saved, today: { kcal: t.kcal, protein: t.protein, items: todayItems }, targets: { kcal: t.targets.kcal, protein: t.targets.protein } })
      if (!ans.ok) {
        setStage({ s: 'failed', error: ans.error, limit: ans.limit })
        return
      }
      const check = validateVision(ans.result, saved)
      if (!check.ok) {
        setStage({ s: 'failed', error: check.error })
        return
      }
      idRef.current = mealId()
      setRows(check.result.items.map((it) => newRow(it)))
      setMessage(check.result.message)
      setType(slotNow())
      setStage({ s: 'review' })
    },
    [note, saved, view]
  )

  // Paste a photo anywhere on the page while nothing else is open.
  useEffect(() => {
    if (stage.s !== 'idle' && stage.s !== 'saved' && stage.s !== 'failed') return
    const onPaste = (e: ClipboardEvent) => {
      const f = imageFrom(e.clipboardData?.items)
      if (f) {
        e.preventDefault()
        void read(f)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [stage.s, read])

  if (!api) return null

  const reset = () => {
    setStage({ s: 'idle' })
    setRows([])
    setPhoto(null)
    setMessage('')
  }
  const copyPrompt = async () => {
    const ok = await copyText(FOOD_PROMPT)
    toast(ok ? 'Prompt copied. Paste it with your photo into any AI app, then paste its reply under "More ways to log".' : 'Could not copy. Open "More ways to log" below to see the prompt.', ok ? 'good' : 'bad')
  }
  const setRow = (key: number, f: (r: Row) => Row) => setRows((list) => list.map((r) => (r.key === key ? f(r) : r)))
  const stepRow = (r: Row, dir: 1 | -1) => {
    const qty = stepQty(r.item.qty, dir)
    setRow(r.key, (x) => ({ ...x, item: { ...scaleVisionItem(x.base, qty / (x.base.qty || 1), saved), name: x.item.name } }))
  }
  const gramsRow = (r: Row, g: number) => {
    const grams = Math.max(0, Math.min(3000, Math.round(g || 0)))
    setRow(r.key, (x) => (x.manual || !x.base.grams ? { ...x, item: { ...x.item, grams } } : { ...x, item: { ...scaleVisionItem(x.base, grams / x.base.grams, saved), name: x.item.name } }))
  }
  const swap = (r: Row, id: string) => {
    const s = saved.find((x) => x.id === id)
    if (!s) return
    const it = fromSaved(s, 1, r.item.grams)
    setRow(r.key, () => ({ key: r.key, base: it, item: it }))
  }
  const save = async () => {
    const list = toFoodItems(items.filter((i) => i.name.trim()))
    if (!list.length || saving) return
    setSaving(true)
    try {
      // `source: 'photo'` marks the meal as logged from a photo (the food log keeps it).
      const meal = { items: list, type, id: idRef.current, source: 'photo' as const }
      const v = await api.add(meal)
      const t = v.totals
      const line = photoReplyLine({ items: items.filter((i) => i.name.trim()), meal: totals, day: { kcal: t.kcal, protein: t.protein, kcalGoal: t.targets.kcal, proteinGoal: t.targets.protein }, idea: v.next.ideas[0]?.text })
      setStage({ s: 'saved', line })
      setRows([])
      setPhoto(null)
      setNote('')
      onSaved?.(v)
    } catch (e: any) {
      toast(e?.message || 'Could not save the meal. Try again.', 'bad')
    } finally {
      setSaving(false)
    }
  }

  const pickers = (
    <>
      <input ref={camRef} className="fph-cam" type="file" accept="image/*" capture="environment" hidden onChange={(e) => (void read(e.target.files?.[0] ?? null), (e.target.value = ''))} />
      <input ref={fileRef} className="fph-file" type="file" accept="image/*" hidden onChange={(e) => (void read(e.target.files?.[0] ?? null), (e.target.value = ''))} />
    </>
  )

  if (stage.s === 'review') {
    return (
      <section className="fph fph-review" aria-label="Check the foods before saving">
        <div className="fph-review-head">
          {photo && <img className="fph-thumb" src={photo.url} alt="Your meal photo" width={88} height={88} />}
          <div className="fph-review-sum">
            <b className="fph-total" aria-live="polite">
              {fmt(totals.kcal)} kcal · {fmt(totals.protein)} g protein
            </b>
            <small className="muted">
              Carbs {fmt(totals.carbs)} g · Fat {fmt(totals.fat)} g
            </small>
            {message && <p className="fph-msg">{message}</p>}
          </div>
        </div>

        <ul className="fph-items">
          {rows.map((r) => {
            const it = r.item
            return (
              <li key={r.key} className={`fph-item${it.confidence === 'low' ? ' low' : ''}`}>
                <div className="fph-item-top">
                  <input className="fph-name" value={it.name} placeholder="Food name" aria-label="Food name" onChange={(e) => setRow(r.key, (x) => ({ ...x, item: { ...x.item, name: e.target.value } }))} />
                  {!r.manual && <span className={`fph-conf ${it.confidence}`}>{CONF_LABEL[it.confidence]}</span>}
                  <button type="button" className="fph-del" aria-label={`Remove ${it.name || 'this food'}`} onClick={() => setRows((list) => list.filter((x) => x.key !== r.key))}>
                    ×
                  </button>
                </div>
                {it.confidence === 'low' && !r.manual && <p className="fph-warn">Not sure about the portion: check it.</p>}
                <div className="fph-item-ctl">
                  {!r.manual && (
                    <span className="fph-qty" role="group" aria-label="How many">
                      <button type="button" className="fph-minus" aria-label="One less" onClick={() => stepRow(r, -1)}>
                        −
                      </button>
                      <b className="fph-qty-n">
                        {q1(it.qty)} {it.unit}
                      </b>
                      <button type="button" className="fph-plus" aria-label="One more" onClick={() => stepRow(r, 1)}>
                        +
                      </button>
                    </span>
                  )}
                  <label className="fph-grams">
                    <input type="number" inputMode="numeric" min={0} max={3000} value={it.grams || ''} aria-label="Grams" onChange={(e) => gramsRow(r, Number(e.target.value))} />
                    <span>g</span>
                  </label>
                  {r.manual ? (
                    <>
                      <label className="fph-grams">
                        <input type="number" inputMode="numeric" min={0} max={8000} value={it.kcal || ''} aria-label="kcal" onChange={(e) => setRow(r.key, (x) => ({ ...x, item: { ...x.item, kcal: Math.max(0, Math.min(8000, Math.round(Number(e.target.value) || 0))) } }))} />
                        <span>kcal</span>
                      </label>
                      <label className="fph-grams">
                        <input type="number" inputMode="numeric" min={0} max={400} value={it.protein || ''} aria-label="Protein grams" onChange={(e) => setRow(r.key, (x) => ({ ...x, item: { ...x.item, protein: Math.max(0, Math.min(400, Number(e.target.value) || 0)) } }))} />
                        <span>g protein</span>
                      </label>
                    </>
                  ) : (
                    <span className="fph-macros">
                      {fmt(it.kcal)} kcal · {q1(it.protein)} g protein
                    </span>
                  )}
                </div>
                {saved.length > 0 && (
                  <label className="fph-swap">
                    <span className="muted">{it.matchedSavedFoodId ? 'Your saved food' : 'Swap for a saved food'}</span>
                    <Select className="fph-swap-sel" value={it.matchedSavedFoodId ?? ''} onChange={(e) => swap(r, e.target.value)} title="Swap for a saved food">
                      <option value="">{it.matchedSavedFoodId ? 'Keep as is' : 'Pick one…'}</option>
                      {saved.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({fmt(s.kcal)} kcal, {q1(s.protein)} g)
                        </option>
                      ))}
                    </Select>
                  </label>
                )}
              </li>
            )
          })}
        </ul>
        <button type="button" className="bdy-btn quiet fph-add" onClick={() => setRows((list) => [...list, newRow(blankItem(), true)])}>
          + Add a food
        </button>

        <div className="fph-slot bdy-seg" role="radiogroup" aria-label="Which meal">
          {MEAL_TYPES.map((m) => (
            <button key={m} type="button" role="radio" aria-checked={type === m} onClick={() => setType(m)}>
              {TYPE_LABEL[m]}
            </button>
          ))}
        </div>
        <div className="fph-actions">
          <button type="button" className="bdy-btn quiet fph-cancel" onClick={reset} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="bdy-btn primary big fph-save" onClick={save} disabled={saving || !items.some((i) => i.name.trim())}>
            {saving ? 'Saving…' : `Save meal · ${fmt(totals.kcal)} kcal`}
          </button>
        </div>
      </section>
    )
  }

  return (
    <section
      className={`fph fph-start${drag ? ' drag' : ''}`}
      aria-label="Log a meal from a photo"
      onDragOver={(e) => {
        e.preventDefault()
        setDrag(true)
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDrag(false)
        void read(imageFrom(e.dataTransfer?.files))
      }}
    >
      {pickers}
      {stage.s === 'saved' && (
        <p className="fph-done" role="status">
          {stage.line}
        </p>
      )}
      {stage.s === 'reading' ? (
        <div className="fph-reading" role="status">
          {photo && <img className="fph-thumb" src={photo.url} alt="Your meal photo" width={64} height={64} />}
          <span className="fph-spin" aria-hidden="true" />
          <span>Reading your photo…</span>
        </div>
      ) : (
        <>
          <div className="fph-start-row">
            <button type="button" className="bdy-btn primary big fph-snap" onClick={() => camRef.current?.click()}>
              Snap a meal
            </button>
            <button type="button" className="bdy-btn fph-upload" onClick={() => fileRef.current?.click()}>
              Upload photo
            </button>
          </div>
          <input className="fph-note" value={note} maxLength={300} placeholder='Note (optional): "2 containers, one was buckwheat"' aria-label="A note for the photo" onChange={(e) => setNote(e.target.value)} />
          <small className="muted fph-hint">Or drop or paste a photo here. You check every food before it is saved.</small>
        </>
      )}
      {stage.s === 'failed' && (
        <div className="fph-fail" role="alert">
          <p>{stage.error}</p>
          <div className="fph-start-row">
            {stage.limit !== 'day' && stage.limit !== 'budget' && (
              <button type="button" className="bdy-btn fph-retry" onClick={() => fileRef.current?.click()}>
                Try another photo
              </button>
            )}
            <button type="button" className="bdy-btn fph-fallback" onClick={copyPrompt}>
              Copy the prompt instead
            </button>
          </div>
        </div>
      )}
      {stage.s !== 'failed' && (
        <button type="button" className="fph-noai" onClick={copyPrompt}>
          No AI? Copy the prompt instead
        </button>
      )}
    </section>
  )
}
