// Food photo logging (Body → Food): take or drop a meal photo, the AI lists the
// foods, you check them here, then Save. NOTHING is saved before you tap Save.
// - Up to 6 photos of one meal at once (a plate, a packaged snack, a drink):
//   picked, dropped or pasted together, they go in ONE request so the AI sees
//   the whole meal and lists each food once. One combined list, one meal saved.
// - Each photo is made small in the browser (foodPhotoPrep.ts) and read by
//   /api/ai {op:'foodPhoto'}; it is never stored, only the foods you save.
// - The AI's answer is checked by core/foodVision.ts (numbers clamped, totals
//   added up again, your saved foods use your own numbers).
// - Save goes through the food counter's own add (addFoodMeal), so the meal is
//   in the same food log and body_log totals as every other meal. No points.
// - "No AI? Copy the prompt instead" keeps the old copy-prompt way one tap away.
// Mount: <FoodPhotoLog view={v} /> inside the food counter. With `bare`, the start
// buttons are hidden (the counter's "Log food" sheet opens the picker through
// `pickRef`) and only the reading, review, saved and failed states show.
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { FOOD_PROMPT } from '@core/foodPrompt'
import { MEAL_TYPES, type FoodItem, type MealType } from '@core/food'
import { eatenFrom, isAfterNote, leftLine, recentPhotoMeal } from '@core/foodLeftovers'
import { missLine, type ProductMiss } from '@core/foodBarcode'
import { mealScore } from '@core/foodScore'
import { fromSaved, photoReplyLine, savedRefs, scaleVisionItem, slotNow, stepQty, toFoodItems, validateVision, visionTotals, type SavedFoodRef, type VisionItem } from '@core/foodVision'
import { life } from '../bridge'
import { useToast } from '../ui'
import { Select } from '../Select'
import { copyText } from './FoodPlan'
import { MAX_PHOTOS, askFoodPhoto, imagesFrom, prepFoodPhoto, type PreparedPhoto } from './foodPhotoPrep'
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

/** Opens the photo picker from outside (it must run inside the tap, so phones allow it), or reads dropped photos. */
export interface PhotoPicker {
  pick: () => void
  /** Photos dropped anywhere on Body → Food: read them the same way. */
  read: (files: File[]) => void
}
const SRC_TAG: Record<string, string> = { label: '🏷 Label', barcode: '🔖 Barcode' }
const hmOf = (iso: string) => {
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : ''
}

export function FoodPhotoLog({ view, saved: savedProp, onSaved, bare = false, pickRef }: { view: FoodView; saved?: SavedFoodRef[]; onSaved?: (v: FoodView) => void; bare?: boolean; pickRef?: MutableRefObject<PhotoPicker | null> }) {
  const api = life.coach?.food
  const toast = useToast()
  const [stage, setStage] = useState<Stage>({ s: 'idle' })
  const [photos, setPhotos] = useState<PreparedPhoto[]>([])
  const [note, setNote] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [message, setMessage] = useState('')
  const [type, setType] = useState<MealType>(() => slotNow())
  const [saving, setSaving] = useState(false)
  const [drag, setDrag] = useState(false)
  const [miss, setMiss] = useState<{ code: string; why: ProductMiss } | null>(null)
  // An after photo: what is left of a photo meal from the last 90 minutes (only what was eaten is logged).
  const [afterOn, setAfterOn] = useState(false)
  const idRef = useRef(mealId())
  const camRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const readRef = useRef<(files: File[]) => void>(() => {})
  if (pickRef) pickRef.current = { pick: () => fileRef.current?.click(), read: (files) => readRef.current(files) }

  // Your real saved foods and saved meals (food_saved), then starred meals: the AI gets them and the swap list shows them.
  const saved = useMemo(() => savedProp ?? savedRefs(view.saved, view.favs), [savedProp, view.saved, view.favs])
  const items = rows.map((r) => r.item)
  const totals = visionTotals(items)
  // The photo meal an after photo can belong to (live, logged in the last 90 minutes).
  const recent = view.day === view.today ? recentPhotoMeal(view.meals, Date.now()) : null
  const after = afterOn && recent ? eatenFrom(recent.items, items.filter((i) => i.name.trim()).map((i) => ({ name: i.name, grams: i.grams }))) : null
  const afterTotals = after ? after.eaten.reduce((a, i) => ({ kcal: a.kcal + i.kcal, protein: a.protein + i.protein }), { kcal: 0, protein: 0 }) : null

  // All the photos picked, dropped or pasted together are one meal: one request, one list.
  const read = useCallback(
    async (files: File[]) => {
      if (!files.length) return
      if (files.length > MAX_PHOTOS) toast(`Only the first ${MAX_PHOTOS} photos are read.`, 'bad')
      setStage({ s: 'reading' })
      const ps: PreparedPhoto[] = []
      try {
        for (const f of files.slice(0, MAX_PHOTOS)) ps.push(await prepFoodPhoto(f))
      } catch (e: any) {
        setStage({ s: 'failed', error: e?.message || 'That photo could not be opened.' })
        return
      }
      setPhotos(ps)
      const t = view.totals
      const todayItems = view.day === view.today ? view.meals.filter((m) => !m.removed).map((m) => m.name) : []
      const ans = await askFoodPhoto({ images: ps.map((p) => ({ mime: p.mime, data: p.data })), note, saved, today: { kcal: t.kcal, protein: t.protein, items: todayItems }, targets: { kcal: t.targets.kcal, protein: t.targets.protein } })
      if (!ans.ok) {
        setStage({ s: 'failed', error: ans.error, limit: ans.limit })
        return
      }
      const check = validateVision(ans.result, saved, ps.length)
      if (!check.ok) {
        setStage({ s: 'failed', error: check.error })
        return
      }
      const isAfter = !!(check.result.leftovers || isAfterNote(note)) && !!(view.day === view.today && recentPhotoMeal(view.meals, Date.now()))
      if (!check.result.items.length && !isAfter) {
        setStage({ s: 'failed', error: 'That looks like a clean plate, but there is no photo meal from the last 90 minutes to take it from.' })
        return
      }
      idRef.current = mealId()
      setRows(check.result.items.map((it) => newRow(it)))
      setMessage(check.result.message)
      setMiss(check.result.barcode?.miss ? { code: check.result.barcode.code, why: check.result.barcode.miss } : null)
      setAfterOn(isAfter)
      setType(slotNow())
      setStage({ s: 'review' })
    },
    [note, saved, view, toast]
  )
  readRef.current = (files) => void read(files)

  // Paste a photo anywhere on the page while nothing else is open.
  useEffect(() => {
    if (stage.s !== 'idle' && stage.s !== 'saved' && stage.s !== 'failed') return
    const onPaste = (e: ClipboardEvent) => {
      const fs = imagesFrom(e.clipboardData?.items, MAX_PHOTOS + 1)
      if (fs.length) {
        e.preventDefault()
        void read(fs)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [stage.s, read])

  if (!api) return null

  const reset = () => {
    setStage({ s: 'idle' })
    setRows([])
    setPhotos([])
    setMessage('')
    setMiss(null)
    setAfterOn(false)
  }
  /** The photos go into Photo Locker (and Drive) with the meal; ids like the Telegram ones. Best effort: the meal saves anyway. */
  const keepPhotos = async (id: string, t: MealType, name: string): Promise<string[]> => {
    if (!photos.length) return []
    const ids = photos.map((_, i) => `fa${id.slice(3)}n${i + 1}`)
    try {
      const m = await import('../vault/driveSync')
      return await m.addFoodPhotos(photos, ids, Date.now(), t, name)
    } catch {
      return []
    }
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
    const it = { ...fromSaved(s, 1, r.item.grams), ...(r.item.photo ? { photo: r.item.photo } : {}) }
    setRow(r.key, () => ({ key: r.key, base: it, item: it }))
  }
  const saveAfter = async () => {
    if (!after || !recent || saving) return
    setSaving(true)
    try {
      const ids = await keepPhotos(idRef.current, recent.type, recent.name)
      const v = after.eaten.length ? await api.edit(recent.id, { items: after.eaten, photos: [...(recent.photos ?? []), ...ids].slice(0, 6) }) : await api.toggle(recent.id)
      const t = v.totals
      setStage({ s: 'saved', line: `${after.eaten.length ? `${TYPE_LABEL[recent.type]} changed to what you ate: ~${fmt(afterTotals!.kcal)} kcal, ${fmt(afterTotals!.protein)} g protein.` : `${TYPE_LABEL[recent.type]} removed: all of it was left.`} ${leftLine(after)} Today: ${fmt(t.kcal)} / ${fmt(t.targets.kcal)} kcal, ${fmt(t.protein)} / ${fmt(t.targets.protein)} g.` })
      setRows([])
      setPhotos([])
      setNote('')
      setAfterOn(false)
      onSaved?.(v)
    } catch (e: any) {
      toast(e?.message || 'Could not change the meal. Try again.', 'bad')
    } finally {
      setSaving(false)
    }
  }
  const save = async () => {
    if (after) return saveAfter()
    const list = toFoodItems(items.filter((i) => i.name.trim()))
    if (!list.length || saving) return
    setSaving(true)
    try {
      // `source: 'photo'` marks the meal as logged from a photo (the food log keeps it); its photos go to Photo Locker.
      const ids = await keepPhotos(idRef.current, type, list.map((i) => i.name).slice(0, 3).join(', '))
      const meal = { items: list, type, id: idRef.current, source: 'photo' as const, ...(ids.length ? { photos: ids } : {}) }
      const v = await api.add(meal)
      // A food read from a label or a barcode becomes a saved food (one tap next time).
      const added = await api.labelFoods(items.filter((i) => i.name.trim())).catch(() => [] as string[])
      if (added.length) toast(`Saved as a food: ${added.join(', ')}. One tap next time in My meals.`, 'good')
      const t = v.totals
      const line = photoReplyLine({ items: items.filter((i) => i.name.trim()), meal: totals, day: { kcal: t.kcal, protein: t.protein, kcalGoal: t.targets.kcal, proteinGoal: t.targets.protein }, idea: v.next.ideas[0]?.text })
      setStage({ s: 'saved', line })
      setRows([])
      setPhotos([])
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
      <input ref={camRef} className="fph-cam" type="file" accept="image/*" capture="environment" hidden onChange={(e) => (void read(imagesFrom(e.target.files, 1)), (e.target.value = ''))} />
      <input ref={fileRef} className="fph-file" type="file" accept="image/*" multiple hidden onChange={(e) => (void read(imagesFrom(e.target.files, MAX_PHOTOS + 1)), (e.target.value = ''))} />
    </>
  )

  if (stage.s === 'review') {
    return (
      <section className="fph fph-review" aria-label="Check the foods before saving">
        <div className="fph-review-head">
          {photos.length === 1 && <img className="fph-thumb" src={photos[0].url} alt="Your meal photo" width={88} height={88} />}
          <div className="fph-review-sum">
            <b className="fph-total" aria-live="polite">
              {fmt(totals.kcal)} kcal · {fmt(totals.protein)} g protein
            </b>
            <small className="muted">
              Carbs {fmt(totals.carbs)} g · Fat {fmt(totals.fat)} g
            </small>
            {message && <p className="fph-msg">{message}</p>}
            {miss && <p className="fph-miss">{missLine(miss.code, miss.why)}</p>}
          </div>
        </div>
        {recent && (
          <label className={`fph-after${afterOn ? ' on' : ''}`}>
            <input type="checkbox" className="fph-after-on" checked={afterOn} onChange={(e) => setAfterOn(e.target.checked)} />
            <span>
              <b>After photo: this is what was left</b> of {TYPE_LABEL[recent.type].toLowerCase()} at {hmOf(recent.at)} ({recent.name}). Only what you ate is logged.
            </span>
          </label>
        )}
        {photos.length > 1 && (
          <div className="fph-strip" aria-label={`${photos.length} photos of this meal, read together`}>
            {photos.map((p, i) => (
              <figure key={i} className="fph-strip-pic">
                <img src={p.url} alt={`Meal photo ${i + 1}`} width={72} height={72} />
                <figcaption>{i + 1}</figcaption>
              </figure>
            ))}
            <small className="muted fph-strip-note">{photos.length} photos read together: each food is listed once.</small>
          </div>
        )}

        <ul className="fph-items">
          {rows.map((r) => {
            const it = r.item
            return (
              <li key={r.key} className={`fph-item${it.confidence === 'low' ? ' low' : ''}`}>
                <div className="fph-item-top">
                  <input className="fph-name" value={it.name} placeholder="Food name" aria-label="Food name" onChange={(e) => setRow(r.key, (x) => ({ ...x, item: { ...x.item, name: e.target.value } }))} />
                  {photos.length > 1 && it.photo ? <span className="fph-pic-tag" title={`Seen in photo ${it.photo}`}>Photo {it.photo}</span> : null}
                  {it.src && SRC_TAG[it.src] ? <span className={`fph-src ${it.src}`} title={it.src === 'barcode' ? 'Numbers from Open Food Facts (the barcode)' : 'Numbers from the label'}>{SRC_TAG[it.src]}</span> : null}
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
                      {fmt(it.kcal)} kcal · {q1(it.protein)} g protein · C {q1(it.carbs)} · F {q1(it.fat)}
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
          {after ? '+ Add a leftover' : '+ Add a food'}
        </button>

        {after && recent && (
          <div className="fph-eaten" aria-label="What was eaten">
            <p className="fph-left">{leftLine(after)}</p>
            <b>Eaten (this is what counts)</b>
            <ul>
              {after.eaten.map((it: FoodItem, k: number) => (
                <li key={k}>
                  <span>{it.name}</span>
                  <span className="num">{fmt(it.grams)} g</span>
                  <span className="num">{fmt(it.kcal)} kcal</span>
                  <span className="num">P {fmt(it.protein)} · C {fmt(it.carbs)} · F {fmt(it.fat)}</span>
                </li>
              ))}
              {!after.eaten.length && <li>Nothing: all of it was left.</li>}
            </ul>
          </div>
        )}

        {!after && <MealScoreLine items={toFoodItems(items.filter((i) => i.name.trim()))} />}

        {!after && <div className="fph-slot bdy-seg" role="radiogroup" aria-label="Which meal">
          {MEAL_TYPES.map((m) => (
            <button key={m} type="button" role="radio" aria-checked={type === m} onClick={() => setType(m)}>
              {TYPE_LABEL[m]}
            </button>
          ))}
        </div>}
        <div className="fph-actions">
          <button type="button" className="bdy-btn quiet fph-cancel" onClick={reset} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="bdy-btn primary big fph-save" onClick={save} disabled={saving || (!after && !items.some((i) => i.name.trim()))}>
            {saving ? 'Saving…' : after && recent ? `Update ${TYPE_LABEL[recent.type].toLowerCase()} · ${fmt(afterTotals!.kcal)} kcal eaten` : `Save meal · ${fmt(totals.kcal)} kcal`}
          </button>
        </div>
      </section>
    )
  }

  // Bare: nothing to show until a photo is picked (the inputs stay, so the sheet can open them).
  if (bare && stage.s === 'idle') return pickers

  return (
    <section
      className={`fph fph-start${bare ? ' bare' : ''}${drag ? ' drag' : ''}`}
      aria-label="Log a meal from a photo"
      onDragOver={(e) => {
        e.preventDefault()
        setDrag(true)
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDrag(false)
        void read(imagesFrom(e.dataTransfer?.files, MAX_PHOTOS + 1))
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
          {photos.slice(0, 3).map((p, i) => (
            <img key={i} className="fph-thumb" src={p.url} alt={`Meal photo ${i + 1}`} width={64} height={64} />
          ))}
          <span className="fph-spin" aria-hidden="true" />
          <span>{photos.length > 1 ? `Reading your ${photos.length} photos…` : 'Reading your photo…'}</span>
        </div>
      ) : bare ? null : (
        <>
          <div className="fph-start-row">
            <button type="button" className="bdy-btn primary big fph-snap" onClick={() => camRef.current?.click()}>
              Snap a meal
            </button>
            <button type="button" className="bdy-btn fph-upload" onClick={() => fileRef.current?.click()}>
              Upload photos
            </button>
          </div>
          <input className="fph-note" value={note} maxLength={300} placeholder='Note (optional): "2 containers, one was buckwheat"' aria-label="A note for the photo" onChange={(e) => setNote(e.target.value)} />
          <small className="muted fph-hint">Or drop or paste photos here. Up to {MAX_PHOTOS} photos of one meal at once (plate, snack, drink). You check every food before it is saved.</small>
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
      {stage.s === 'saved' && bare && (
        <button type="button" className="bdy-btn quiet fph-dismiss" onClick={reset}>
          OK
        </button>
      )}
      {stage.s !== 'failed' && !bare && (
        <button type="button" className="fph-noai" onClick={copyPrompt}>
          No AI? Copy the prompt instead
        </button>
      )}
    </section>
  )
}

/** The meal's score before saving: "B · Add fibre: …". */
function MealScoreLine({ items }: { items: FoodItem[] }) {
  const sc = mealScore(items)
  if (!sc) return null
  return (
    <p className="fph-score" aria-label={`Meal score ${sc.grade}`}>
      <span className={`fd-grade g${sc.grade}`}>{sc.grade}</span>
      <span>{sc.tip}</span>
    </p>
  )
}
