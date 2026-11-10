// Body → Food → Log food → Paste from AI: he reads his meal photos in his own
// AI app with ONE fixed prompt ("Copy AI prompt"), pastes the LIFE-FOOD answer
// here, checks the live preview (every meal and food with its numbers, the date
// and time, the meal type; grams editable, foods removable), and "Log all"
// saves each meal as a normal food-counter meal (source 'paste'), so the bars,
// charts, protein left, Ben and the weekly check all see it. Undo takes them
// all back; each logged meal can be kept as a repeat meal in one tap. Read by
// core/foodPaste.ts; nothing is dropped silently (warnings are listed). No points.
import { useMemo, useState } from 'react'
import { MEAL_TYPES, mealTypeAt, type MealType } from '@core/food'
import { FOOD_PASTE_PROMPT, parseFoodPaste, pasteId, pasteToLog, type PasteItem, type PasteMeal } from '@core/foodPaste'
import { life } from '../bridge'
import { useToast } from '../ui'
import { Select } from '../Select'
import { copyText } from './FoodPlan'
import type { FoodView } from '../../../main/food'
import './food-paste.css'

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
const r1 = (n: number) => Math.round(n * 10) / 10
const TYPE: Record<MealType, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' }
const localNow = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/** A food in the preview: the pasted one (numbers scale from it) and the grams now. */
interface Row {
  base: PasteItem
  grams: number
  gone?: boolean
}
interface EditMeal {
  src: PasteMeal
  name: string
  type: MealType
  at: string
  rows: Row[]
}
/** The food at its grams now (macros scale from the pasted grams; a food pasted without grams keeps its numbers). */
const rowItem = (r: Row): PasteItem => {
  const f = r.base.grams > 0 ? r.grams / r.base.grams : 1
  return { ...r.base, grams: r.grams, noGrams: !(r.grams >= 1), protein: r1(r.base.protein * f), carbs: r1(r.base.carbs * f), fat: r1(r.base.fat * f), kcal: Math.round(r.base.kcal * f), ...(r.base.fiber != null ? { fiber: r1(r.base.fiber * f) } : {}) }
}
const sum = (items: PasteItem[]) => items.reduce((a, i) => ({ kcal: a.kcal + i.kcal, protein: a.protein + i.protein, carbs: a.carbs + i.carbs, fat: a.fat + i.fat }), { kcal: 0, protein: 0, carbs: 0, fat: 0 })

export function FoodPaste({ v, onView, onDone }: { v: FoodView; onView: (v: FoodView) => void; onDone: () => void }) {
  const api = life.coach!.food!
  const toast = useToast()
  const [text, setText] = useState('')
  const [edits, setEdits] = useState<Record<number, Partial<Pick<EditMeal, 'name' | 'type' | 'at'>> & { rows?: Row[] }>>({})
  const [busy, setBusy] = useState(false)
  const [logged, setLogged] = useState<{ ids: string[]; names: string[]; kept: string[] } | null>(null)
  const parsed = useMemo(() => parseFoodPaste(text, v.today), [text, v.today])
  const meals: EditMeal[] = parsed.meals.map((m, k) => {
    const at = edits[k]?.at ?? m.at ?? localNow()
    return { src: m, name: edits[k]?.name ?? m.name, type: edits[k]?.type ?? m.type ?? mealTypeAt(at.slice(11, 16)), at, rows: edits[k]?.rows ?? m.items.map((it) => ({ base: it, grams: it.grams })) }
  })
  const live = meals.map((m) => ({ ...m, items: m.rows.filter((r) => !r.gone).map(rowItem) })).filter((m) => m.items.length)
  const missing = live.flatMap((m) => m.items.filter((i) => i.noGrams))
  const all = sum(live.flatMap((m) => m.items))
  const patch = (k: number, p: Partial<Pick<EditMeal, 'name' | 'type' | 'at'>> & { rows?: Row[] }) => setEdits((e) => ({ ...e, [k]: { ...e[k], ...p } }))
  const setRow = (k: number, j: number, p: Partial<Row>) => patch(k, { rows: meals[k].rows.map((r, i) => (i === j ? { ...r, ...p } : r)) })

  const copyPrompt = async () => {
    const ok = await copyText(FOOD_PASTE_PROMPT)
    toast(ok ? 'AI prompt copied. Paste it with your meal photos into ChatGPT, Grok or Gemini, then paste the answer here.' : 'Could not copy. Select the prompt under "See the prompt" and copy it.', ok ? 'good' : 'bad')
  }
  const logAll = async () => {
    if (busy || !live.length || missing.length) return
    setBusy(true)
    try {
      const now = new Date()
      const warns: string[] = []
      const list = meals
        .map((m, k) => ({ k, log: pasteToLog({ ...m.src, name: m.name, type: m.type, at: m.at, items: m.rows.filter((r) => !r.gone).map(rowItem) }, now, v.today, (w) => warns.push(w)) }))
        .filter((x) => !!x.log)
      const r = await api.pasteLog(
        list.map((x) => x.log!),
        list.map((x) => pasteId(text, x.k))
      )
      onView(r.view)
      setLogged({ ids: r.ids, names: list.map((x) => x.log!.name), kept: [] })
      for (const w of warns) toast(w, 'bad')
    } catch (e: any) {
      toast(e?.message || 'Could not log the meals. Try again.', 'bad')
    } finally {
      setBusy(false)
    }
  }
  const undo = async () => {
    if (!logged) return
    onView(await api.undo(logged.ids))
    toast('Taken back: nothing counts from those meals.', 'good')
    setLogged(null)
  }
  const keep = async (id: string) => {
    if (!logged || logged.kept.includes(id)) return
    onView(await api.saveAsMeal(id))
    setLogged({ ...logged, kept: [...logged.kept, id] })
  }

  if (logged) {
    return (
      <div className="fpa fpa-done" role="status">
        <p className="fpa-done-line">
          <b>
            Logged {logged.ids.length} {logged.ids.length === 1 ? 'meal' : 'meals'}
          </b>{' '}
          · {fmt(all.kcal)} kcal · {fmt(all.protein)} g protein. Today: {fmt(v.totals.kcal)} / {fmt(v.totals.targets.kcal)} kcal, {fmt(v.totals.protein)} / {fmt(v.totals.targets.protein)} g.
        </p>
        <ul className="fpa-kept">
          {logged.ids.map((id, i) => (
            <li key={id}>
              <span>{logged.names[i]}</span>
              <button type="button" className="bdy-chip fpa-keep" disabled={logged.kept.includes(id)} onClick={() => void keep(id)}>
                {logged.kept.includes(id) ? '⭐ Kept as repeat meal' : '⭐ Save as repeat meal'}
              </button>
            </li>
          ))}
        </ul>
        <div className="fd-row">
          <button type="button" className="bdy-btn quiet fpa-undo" onClick={() => void undo()}>
            ↩ Undo all
          </button>
          <button type="button" className="bdy-btn primary fpa-close" onClick={onDone}>
            Done
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fpa" aria-label="Paste from AI">
      <div className="fpa-top">
        <small className="bdy-note">Read your photos in ChatGPT, Grok or Gemini with the AI prompt, then paste the whole answer here. Several meals at once are fine.</small>
        <button type="button" className="bdy-btn fpa-copy" onClick={copyPrompt}>
          Copy AI prompt
        </button>
      </div>
      <details className="fd-prompt fpa-prompt">
        <summary>See the prompt</summary>
        <pre>{FOOD_PASTE_PROMPT}</pre>
      </details>
      <textarea
        className="fpa-text"
        value={text}
        rows={8}
        autoFocus
        spellCheck={false}
        placeholder={'LIFE-FOOD v1\nMEAL | Lunch | now | Rice and chicken\n- rice | 200 g | P 5 | C 56 | F 0.6 | FIB 0.8 | KCAL 250 | CONF medium | -\nEND'}
        aria-label="The AI's answer"
        onChange={(e) => (setText(e.target.value), setEdits({}))}
      />
      {text.trim() && !parsed.meals.length && <p className="fd-err">No meals found in that text. Paste the block that starts with LIFE-FOOD.</p>}
      {parsed.warnings.length > 0 && (
        <ul className="fpa-warn" aria-label="Lines to check">
          {parsed.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      {meals.map((m, k) => {
        const items = m.rows.filter((r) => !r.gone).map(rowItem)
        const t = sum(items)
        return (
          <section key={k} className="fpa-meal" aria-label={`Meal ${k + 1}`}>
            <header className="fpa-meal-head">
              <input className="fpa-name" value={m.name} placeholder={items.map((i) => i.name).slice(0, 3).join(' + ')} aria-label="Meal name" onChange={(e) => patch(k, { name: e.target.value })} />
              <Select className="fpa-type" value={m.type} onChange={(e) => patch(k, { type: e.target.value as MealType })} title="Which meal">
                {MEAL_TYPES.map((x) => (
                  <option key={x} value={x}>
                    {TYPE[x]}
                  </option>
                ))}
              </Select>
              <input className="fpa-at" type="datetime-local" value={m.at} aria-label="Date and time" onChange={(e) => patch(k, { at: e.target.value })} />
            </header>
            <ul className="fpa-items">
              {m.rows.map((r, j) => {
                if (r.gone) return null
                const it = rowItem(r)
                return (
                  <li key={j} className={`fpa-item${it.noGrams ? ' need' : ''}`}>
                    <span className="fpa-iname">
                      {it.name}
                      {it.confidence === 'low' && <small className="fpa-low"> · not sure</small>}
                      {it.note && <small className="fpa-note"> · {it.note}</small>}
                    </span>
                    <label className="fpa-grams">
                      <input type="number" inputMode="numeric" min={0} max={3000} value={r.grams || ''} placeholder="g?" aria-label={`Grams of ${it.name}`} onChange={(e) => setRow(k, j, { grams: Math.max(0, Math.min(3000, Math.round(Number(e.target.value) || 0))) })} />
                      <span>g</span>
                    </label>
                    <span className="num fpa-nums">
                      {fmt(it.kcal)} kcal · P {it.protein} · C {it.carbs} · F {it.fat}
                      {it.fiber != null ? ` · fibre ${it.fiber}` : ''}
                    </span>
                    <button type="button" className="fdf-x fpa-del" aria-label={`Remove ${it.name}`} onClick={() => setRow(k, j, { gone: true })}>
                      ×
                    </button>
                  </li>
                )
              })}
            </ul>
            <p className="fpa-total num">
              {fmt(t.kcal)} kcal · {fmt(t.protein)} g protein · C {fmt(t.carbs)} · F {fmt(t.fat)}
            </p>
          </section>
        )
      })}
      {live.length > 0 && (
        <div className="fpa-foot">
          {missing.length > 0 && <p className="fd-err">Add the grams for {missing.map((i) => i.name).join(', ')} first.</p>}
          <button type="button" className="bdy-btn primary big fpa-log" disabled={busy || missing.length > 0} onClick={() => void logAll()}>
            {busy ? 'Logging…' : `Log all · ${live.length} ${live.length === 1 ? 'meal' : 'meals'} · ${fmt(all.kcal)} kcal`}
          </button>
        </div>
      )}
    </div>
  )
}
