// The food counter (Body → Food), one calm screen:
// 1. Today's numbers (kcal big, protein second, ONE line: what is left or the hint).
// 2. ONE "Log food" button. It opens a sheet with three big choices: Photo (opens
//    the photo picker at once, up to 6 photos: FoodPhotoReview.tsx), My meals
//    (saved meals, the standard day, saved foods, same as yesterday, starred:
//    FoodFast.tsx) and Type it ("2 eggs, 200 g chicken"); quick water and
//    supplement chips sit at the bottom. Every draft is checked and saved there.
// 3. Today's meals, one row each (edit, remove; star and "Save as meal" under ⋯).
// 4. More (folded): carbs and fat rings, what to eat next, the weekly calorie
//    check, the week chart, cheap protein/shopping/prep, the copy-prompt way.
// The header, the macros and "Next" all use SAVED meals; an unsaved draft is shown
// apart ("+59 g if you save"). No points.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FOOD_PROMPT, LABEL_PROMPT } from '@core/foodPrompt'
import { parseFoodWords } from '@core/foodWords'
import { dayRings, foodHeader } from '@core/foodDisplay'
import { SUPP_PRESETS, WATER_BUTTONS } from '@core/foodSupps'
import { parseFoodReply } from '@core/foodParse'
import { MEAL_TYPES, mealName, mealSource, mealTypeAt, scaleItem, stepGrams, sumItems, type FoodItem, type MealType } from '@core/food'
import { ACTIVITY, FIXED_KCAL, GAIN_TEXT, GOAL_LABEL, type Activity, type FoodGoals } from '@core/foodGoals'
import { addDays } from '@core/dates'
import { life } from '../bridge'
import { useAction, useToast } from '../ui'
import { Select } from '../Select'
import { Rings, WeekChartView } from './FoodViz'
import { FoodPlan, copyText } from './FoodPlan'
import { FoodBars, QuickLog } from './FoodFast'
import { FoodSavedSheet } from './FoodSavedSheet'
import { FoodPhotoLog, type PhotoPicker } from './FoodPhotoReview'
import { FoodPaste } from './FoodPaste'
import { FoodAdjustCard } from './FoodAdjustCard'
import { ConfidenceDot, MealItems, MealPhotoThumb } from './MealPhoto'
import { adjLogLine } from '@core/foodAdjust'
import { mealScore } from '@core/foodScore'
import { dayLabel } from '@core/foodInsights'
import type { FoodView } from '../../../main/food'
import type { FoodExtras } from '../web/foodBridge'
import { FoodGallery } from './FoodGallery'
import { FoodCharts } from './FoodCharts'
import { imagesFrom } from './foodPhotoPrep'
import './food.css'
import './food-simple.css'
import './food-gallery.css'

const EVENTS = ['life-body-changed', 'life-sport-changed', 'life-external-changed']
const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
const atHm = (iso: string) => {
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? d.toTimeString().slice(0, 5) : ''
}
const TYPE_LABEL: Record<MealType, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' }
const CONF_LABEL: Record<FoodItem['confidence'], string> = { sure: 'sure', roughly: 'roughly', guess: 'a guess' }

/** A draft row: the item as the AI app gave it (macros scale from it) and the grams now. */
interface Row {
  key: number
  base: FoodItem
  name: string
  grams: number
}
let rowKey = 0
const toRows = (items: FoodItem[]): Row[] => items.map((it) => ({ key: ++rowKey, base: it, name: it.name, grams: it.grams }))
const rowItem = (r: Row): FoodItem => ({ ...scaleItem(r.base, r.grams), name: r.name.trim() || r.base.name })

type Sub = 'today' | 'week' | 'plan' | 'photos' | 'charts'
type Sheet = null | 'root' | 'meals' | 'type' | 'paste'
const itemsText = (items: FoodItem[]) => items.map((i) => `${i.grams} g ${i.name}`).join(', ')

export function FoodCounter() {
  const api = life.coach?.food
  const act = useAction()
  const toast = useToast()
  const [v, setV] = useState<FoodView | null>(null)
  const [day, setDay] = useState<string | undefined>(undefined)
  const [sub, setSub] = useState<Sub>('today')
  const [reply, setReply] = useState('')
  const [words, setWords] = useState('')
  const [say, setSay] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [question, setQuestion] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [type, setType] = useState<MealType>(() => mealTypeAt(new Date().toTimeString().slice(0, 5)))
  const [goalsOpen, setGoalsOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copiedLabel, setCopiedLabel] = useState(false)
  const [manage, setManage] = useState(false)
  // "More" stays open or closed as you left it (this device).
  const [moreOpen, setMoreOpenState] = useState(() => {
    try {
      return localStorage.getItem('ls.foodMore') === '1'
    } catch {
      return false
    }
  })
  const setMoreOpen = (open: boolean) => {
    setMoreOpenState(open)
    try {
      localStorage.setItem('ls.foodMore', open ? '1' : '0')
    } catch {
      /* private window */
    }
  }
  // The Log food sheet: its first page (Photo / My meals / Type it), or one of the two pages.
  // Sport Track's Dashboard "Paste from AI ›" opens this page straight away (a one-shot flag, set just before the tab opens).
  const [sheet, setSheet] = useState<Sheet>(() => {
    try {
      if (localStorage.getItem('life_food_open') === 'paste') {
        localStorage.removeItem('life_food_open')
        return 'paste'
      }
    } catch {
      /* private window */
    }
    return null
  })
  const [openMeal, setOpenMeal] = useState<string | null>(null)
  const [justRemoved, setJustRemoved] = useState<string[]>([])
  const photoRef = useRef<PhotoPicker | null>(null)
  const [extras, setExtras] = useState<FoodExtras | null>(null)
  const [dropping, setDropping] = useState(false)

  useEffect(() => {
    if (!api) return
    const load = () => {
      api.view(day).then(setV).catch(() => {})
      api.extras?.().then(setExtras).catch(() => {})
    }
    load()
    for (const e of EVENTS) window.addEventListener(e, load)
    return () => {
      for (const e of EVENTS) window.removeEventListener(e, load)
    }
  }, [api, day])

  const draft = useMemo(() => (rows ? rows.map(rowItem) : []), [rows])
  const draftTotals = useMemo(() => sumItems(draft), [draft])
  if (!api || !v) return null

  const t = v.totals
  const pastDay = v.day !== v.today
  const goals = { protein: t.targets.protein, kcal: t.targets.kcal, carbs: t.targets.carbs, fat: t.targets.fat }
  // One basis: saved meals. The draft is shown apart.
  const saved = { protein: t.protein, kcal: t.kcal, carbs: v.carbs, fat: v.fat }
  const head = foodHeader(saved, goals, rows ? draftTotals : null, pastDay ? `on ${v.day}` : 'today')

  const copyPrompt = async () => {
    const ok = await copyText(FOOD_PROMPT)
    setCopied(ok)
    toast(ok ? 'Prompt copied. Paste it with your meal photo into any AI app.' : 'Could not copy. Select the prompt below and copy it.', ok ? 'good' : 'bad')
  }
  const copyLabel = async () => {
    const ok = await copyText(LABEL_PROMPT)
    setCopiedLabel(ok)
    toast(ok ? 'Label prompt copied. Paste it with a photo of the nutrition label.' : 'Could not copy. Select the label prompt below and copy it.', ok ? 'good' : 'bad')
  }
  const read = (text = reply) => {
    const r = parseFoodReply(text)
    if (!r.ok) {
      setErr(r.why)
      setRows(null)
      return
    }
    setErr(null)
    setEditing(null)
    setRows(toRows(r.items))
    setQuestion(r.question)
    setSheet('type')
  }
  const load = (items: FoodItem[]) => {
    setEditing(null)
    setRows(toRows(items))
    setQuestion(null)
    setErr(null)
    setSheet('type')
  }
  const addWords = () => {
    const r = parseFoodWords(words, v.own)
    setSay(r.say)
    if (r.items.length) {
      setEditing(null)
      setErr(null)
      setQuestion(null)
      setRows((list) => [...(list ?? []), ...toRows(r.items)])
      setWords(r.say ? words : '')
    }
  }
  const edit = (m: Pick<FoodView['meals'][number], 'id' | 'items' | 'type'>) => {
    setRows(m.items.map((it) => ({ key: ++rowKey, base: it, name: it.name, grams: it.grams })))
    setEditing(m.id)
    setType(m.type)
    setQuestion(null)
    setErr(null)
    setSub('today')
    setSheet('type')
  }
  const patch = (key: number, p: Partial<Row>) => setRows((list) => (list ? list.map((r) => (r.key === key ? { ...r, ...p } : r)) : list))
  const clearDraft = () => {
    setRows(null)
    setEditing(null)
    setReply('')
    setQuestion(null)
  }
  /** Cancel drops the draft and closes the sheet. */
  const cancelDraft = () => {
    clearDraft()
    setSay('')
    setSheet(null)
  }
  /** Remove (or put back) a meal. A removed one shows as a grey "Removed · Undo" line for 6 s, then leaves the list. */
  const toggleMeal = async (id: string, removing: boolean) => {
    const next = await act(() => api.toggle(id, day))
    if (!next) return
    setV(next)
    if (removing) {
      setJustRemoved((l) => [...l, id])
      window.setTimeout(() => setJustRemoved((l) => l.filter((x) => x !== id)), 6000)
    } else setJustRemoved((l) => l.filter((x) => x !== id))
  }
  /** Closing keeps an unsaved draft: "Finish your meal" opens it again. */
  const closeSheet = () => setSheet(null)
  const save = async () => {
    if (!draft.length) return
    const before = new Set(v.meals.map((m) => m.id))
    const next = editing
      ? await act(() => api.edit(editing, { items: draft, name: mealName(draft), type }, v.day), 'Meal changed')
      : await act(() => api.add({ items: draft, name: mealName(draft), day: v.day, type, source: 'manual' }, v.day))
    if (next && !editing) {
      // One tap to keep it as a saved meal for next time.
      const made = next.meals.find((m) => !before.has(m.id))
      toast(`Meal saved: +${draftTotals.protein} g protein, ${fmt(draftTotals.kcal)} kcal`, 'good', made ? { label: 'Save as meal', run: () => void act(() => api.saveAsMeal(made.id), 'Saved to your meals').then((x) => x && setV(x)) } : undefined)
    }
    if (next) {
      setV(next)
      clearDraft()
      setWords('')
      setSay('')
      setSheet(null)
    }
  }
  const sug = v.adjust.state === 'suggest' ? v.adjust.suggestion : null
  const dayOptions = Array.from({ length: 8 }, (_, i) => addDays(v.today, -i))

  // Meal cards by meal type; supplements in their own card.
  // A removed meal leaves the list; only one you just removed shows for a few seconds as a grey line with Undo.
  const shown = v.meals.filter((m) => !m.removed || justRemoved.includes(m.id))
  const foodMeals = shown.filter((m) => !m.supp)
  const suppMeals = shown.filter((m) => m.supp)
  const liveCount = v.meals.filter((m) => !m.removed).length
  const groups = [...MEAL_TYPES.map((ty) => ({ id: ty as string, label: TYPE_LABEL[ty], list: foodMeals.filter((m) => m.type === ty) })), { id: 'supp', label: 'Supplements', list: suppMeals }].filter((g) => g.list.length)

  // The draft (a typed meal, a pasted reply, "Same as yesterday", Edit): checked and saved in the Log food sheet.
  const draftEl = rows && (
    <div className="fd-draft" aria-label="Your meal before saving">
      {editing && <p className="fd-q">Changing a saved meal. Save replaces it.</p>}
      {question && (
        <p className="fd-q">
          <b>The AI asks:</b> {question} <small className="muted">Fix the grams below if it changes anything.</small>
        </p>
      )}
      <ul className="fd-items">
        {rows.map((r) => {
          const it = rowItem(r)
          return (
            <li key={r.key} className="fd-item">
              <input className="fd-name" value={r.name} maxLength={60} aria-label="Food name" onChange={(e) => patch(r.key, { name: e.target.value })} />
              <span className="fd-grams">
                <button type="button" className="fdf-step-btn fd-minus" aria-label={`Less ${it.name}`} onClick={() => patch(r.key, { grams: stepGrams(r.grams, -1) })}>
                  −
                </button>
                <b className="num">{r.grams} g</b>
                <button type="button" className="fdf-step-btn fd-plus" aria-label={`More ${it.name}`} onClick={() => patch(r.key, { grams: stepGrams(r.grams, 1) })}>
                  +
                </button>
              </span>
              <small className="fd-macros">
                {Math.round(it.protein)} g protein · {fmt(it.kcal)} kcal <span className={`fd-conf ${it.confidence}`}>{CONF_LABEL[it.confidence]}</span>
              </small>
              <button type="button" className="fdf-x fd-del" aria-label={`Remove ${it.name}`} onClick={() => setRows((list) => (list ? list.filter((x) => x.key !== r.key) : list))}>
                ×
              </button>
            </li>
          )
        })}
      </ul>
      <p className="fd-draft-total">
        This meal: <b>{draftTotals.protein} g protein</b> · {fmt(draftTotals.kcal)} kcal · carbs {draftTotals.carbs} g · fat {draftTotals.fat} g
      </p>
      <div className="fd-save-row">
        <Select className="fd-type" value={type} onChange={(e) => setType(e.target.value as MealType)} title="Which meal">
          {MEAL_TYPES.map((m) => (
            <option key={m} value={m}>
              {TYPE_LABEL[m]}
            </option>
          ))}
        </Select>
        <button type="button" className="bdy-btn quiet fd-cancel" onClick={cancelDraft}>
          Cancel
        </button>
        <button type="button" className="bdy-btn primary big fd-save" disabled={!draft.length} onClick={save}>
          {editing ? 'Save changes' : 'Save meal'}
        </button>
      </div>
    </div>
  )

  const quickAdd = !pastDay && (
    <div className="fd-quick-add" aria-label="Water and supplements">
      <span className="bdy-eyebrow">Quick add</span>
      <div className="fd-row fd-water">
        <span className="fd-qa-label">
          Water <b className="num">{fmt(v.water?.ml ?? 0)}</b> / {fmt(v.water?.target ?? 0)} ml
        </span>
        {WATER_BUTTONS.map((w) => (
          <button key={w.id} type="button" className={`bdy-chip fd-water-${w.id}`} onClick={async () => setV((await act(() => api.water(w.ml, day), `+${w.ml} ml water`)) ?? v)}>
            + {w.label} <small>{w.ml} ml</small>
          </button>
        ))}
      </div>
      <div className="fd-row fd-supps">
        <span className="fd-qa-label">Supplements</span>
        {SUPP_PRESETS.map((p) => (
          <button key={p.id} type="button" className={`bdy-chip fd-supp-${p.id}`} onClick={async () => setV((await act(() => api.supp(p.id, day), `${p.label} logged`)) ?? v)}>
            + {p.label}
            {p.items[0].protein ? <small> +{p.items[0].protein} g</small> : null}
          </button>
        ))}
      </div>
    </div>
  )

  const sheetTitle = sheet === 'paste' ? 'Paste from AI' : sheet === 'meals' ? 'My meals' : sheet === 'type' ? (rows ? (editing ? 'Change the meal' : 'Check and save') : 'Type what you ate') : pastDay ? `Log food on ${v.day}` : 'Log food'
  const sheetEl = sheet && (
    <div className="sheet fdl-sheet" role="dialog" aria-modal="true" aria-label={sheetTitle} onKeyDown={(e) => e.key === 'Escape' && closeSheet()} onClick={(e) => e.target === e.currentTarget && closeSheet()}>
      <div className="sheet-card fdl-card" data-page={sheet}>
        <header className="fdl-head">
          {sheet !== 'root' ? (
            <button type="button" className="fdl-icon fdl-back" aria-label="Back" onClick={() => setSheet('root')}>
              ‹
            </button>
          ) : (
            <span className="fdl-icon-gap" aria-hidden="true" />
          )}
          <b className="fdl-title">{sheetTitle}</b>
          <button type="button" className="fdl-icon fdl-close" aria-label="Close" onClick={closeSheet}>
            ×
          </button>
        </header>
        <div className="fdl-body">
          {sheet === 'root' && (
            <>
              <div className="fdl-choices">
                {!pastDay && (
                  <button
                    type="button"
                    className="fdl-choice fdl-photo"
                    autoFocus
                    onClick={() => {
                      photoRef.current?.pick()
                      setSheet(null)
                    }}
                  >
                    <span className="fdl-choice-icon">
                      <LogIcon kind="photo" />
                    </span>
                    <span className="fdl-choice-text">
                      <b>Photo</b>
                      <small>Take or pick photos of your meal. The AI lists the food, you check it.</small>
                    </span>
                  </button>
                )}
                <button type="button" className="fdl-choice fdl-meals" autoFocus={pastDay} onClick={() => setSheet('meals')}>
                  <span className="fdl-choice-icon">
                    <LogIcon kind="star" />
                  </span>
                  <span className="fdl-choice-text">
                    <b>My meals</b>
                    <small>Your saved meals and your standard day. One tap logs one.</small>
                  </span>
                </button>
                <button type="button" className="fdl-choice fdl-type" onClick={() => setSheet('type')}>
                  <span className="fdl-choice-icon">
                    <LogIcon kind="pen" />
                  </span>
                  <span className="fdl-choice-text">
                    <b>Type it</b>
                    <small>"2 eggs, 200 g chicken, 1 banana"</small>
                  </span>
                </button>
                <button type="button" className="fdl-choice fdl-paste" onClick={() => setSheet('paste')}>
                  <span className="fdl-choice-icon">
                    <LogIcon kind="plate" />
                  </span>
                  <span className="fdl-choice-text">
                    <b>Paste from AI</b>
                    <small>Read your photos in ChatGPT, Grok or Gemini with the AI prompt, paste the answer: every meal at once.</small>
                  </span>
                </button>
              </div>
              {quickAdd}
            </>
          )}
          {sheet === 'meals' && (
            <>
              {pastDay ? <p className="bdy-note">Saved meals log for today only. For {v.day}, use "Type it".</p> : <QuickLog v={v} onView={setV} onManage={() => setManage(true)} />}
              {(v.yesterday.length > 0 || v.favs.length > 0) && (
                <div className="fd-quick">
                  {v.yesterday.length > 0 && (
                    <div className="fd-again">
                      <span className="bdy-eyebrow">Same as yesterday</span>
                      <div className="fdf-chips">
                        {v.yesterday.map((m) => (
                          <button key={m.id} type="button" className="bdy-chip fd-yday" onClick={() => load(m.items)} title="Opens it with the grams to fix, then Save">
                            {m.name} <small>+{m.totals.protein} g</small>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {v.favs.length > 0 && (
                    <div className="fd-again">
                      <span className="bdy-eyebrow">Starred</span>
                      <div className="fdf-chips">
                        {v.favs.map((f) => (
                          <button key={f.id} type="button" className="bdy-chip fd-favchip" onClick={() => load(f.items)}>
                            ★ {f.name} <small>+{sumItems(f.items).protein} g</small>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
          {sheet === 'paste' && <FoodPaste v={v} onView={setV} onDone={closeSheet} />}
          {sheet === 'type' && (
            <>
              <div className="fd-words-step">
                <div className="fd-words-row">
                  <input
                    className="fd-words"
                    value={words}
                    autoFocus={!rows}
                    placeholder="2 eggs, 200 g chicken, 1 banana"
                    aria-label="What you ate, in words"
                    onChange={(e) => setWords(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && words.trim() && addWords()}
                  />
                  <button type="button" className="bdy-btn fd-words-go" disabled={!words.trim()} onClick={addWords}>
                    Add
                  </button>
                </div>
                {say ? (
                  <p className="fd-words-say" role="status">
                    {say}
                  </p>
                ) : (
                  !rows && <small className="bdy-note">Write grams or pieces. Known foods are filled in; you check them before saving.</small>
                )}
              </div>
              {draftEl}
            </>
          )}
        </div>
        {sheet === 'meals' && (
          <footer className="fdl-foot">
            <button type="button" className="bdy-btn big fdl-done" onClick={closeSheet}>
              Done
            </button>
          </footer>
        )}
      </div>
    </div>
  )

  const moreEl = (
          <details className="fd-more" open={moreOpen || pastDay} onToggle={(e) => setMoreOpen((e.currentTarget as HTMLDetailsElement).open)}>
            <summary>
              <span>More</span>
              <small>Carbs and fat, what to eat next, weekly check, week chart, shopping</small>
            </summary>
            <div className="fd-more-body">
              <div className="fd-more-sec">
                <p className="fd-macros-line">{head.macros}</p>
                <Rings rings={dayRings(saved, goals)} />
                <small className="muted fd-why">
                  {GOAL_LABEL} · {GAIN_TEXT}
                </small>
              </div>
              {!pastDay && (
                <p className="fd-next" role="status">
                  <b>Next:</b> {v.next.line}
                </p>
              )}
              {!pastDay && extras && extras.nextMeal.why !== 'done' && <p className="fd-nextmeal">{extras.nextMeal.line}</p>}
              {!pastDay && <FoodAdjustCard view={v} onView={setV} day={day} where="food" />}
              <div className="fd-more-links">
                <button type="button" className="bdy-btn fd-sub-go" data-sub="week" onClick={() => setSub('week')}>
                  Week chart
                </button>
                <button type="button" className="bdy-btn fd-sub-go" data-sub="photos" onClick={() => setSub('photos')}>
                  Photos by day
                </button>
                <button type="button" className="bdy-btn fd-sub-go" data-sub="charts" onClick={() => setSub('charts')}>
                  Charts
                </button>
                <button type="button" className="bdy-btn fd-sub-go" data-sub="plan" onClick={() => setSub('plan')}>
                  Cheap protein, shopping and prep
                </button>
                {!pastDay && (
                  <button type="button" className="bdy-btn fd-manage" onClick={() => setManage(true)}>
                    Edit saved foods
                  </button>
                )}
              </div>
              <div className="fd-more-sec fd-other">
                <span className="bdy-eyebrow">No AI in the app? Use any AI app</span>
                <small className="muted">Copy the prompt, paste it with a photo of your meal (or of the nutrition label) into any free AI app, then paste its reply here.</small>
                <div className="fd-row">
                  <button type="button" className="bdy-btn fd-copy" onClick={copyPrompt}>
                    {copied ? 'Copied' : 'Copy prompt'}
                  </button>
                  <button type="button" className="bdy-btn fd-copy-label" onClick={copyLabel}>
                    {copiedLabel ? 'Copied' : 'Copy label prompt'}
                  </button>
                  <details className="fd-prompt">
                    <summary>See the prompts</summary>
                    <pre>{FOOD_PROMPT}</pre>
                    <pre>{LABEL_PROMPT}</pre>
                  </details>
                </div>
                <textarea
                  className="fd-paste"
                  value={reply}
                  rows={3}
                  placeholder="Paste the AI app's whole reply here"
                  aria-label="The AI app's reply"
                  onChange={(e) => setReply(e.target.value)}
                  onPaste={(e) => {
                    const text = e.clipboardData.getData('text')
                    if (text) setTimeout(() => read(reply ? `${reply}${text}` : text), 0)
                  }}
                />
                <div className="fd-row">
                  <button type="button" className="bdy-btn fd-read" disabled={!reply.trim()} onClick={() => read()}>
                    Read reply
                  </button>
                  {err && (
                    <button type="button" className="bdy-btn quiet" onClick={copyPrompt}>
                      Copy the prompt again
                    </button>
                  )}
                </div>
                {err && (
                  <p className="fd-err" role="alert">
                    {err}
                  </p>
                )}
              </div>
              <p className="pr-note">Saved foods use common table values; an AI app's numbers are estimates. Fix any amount that looks wrong. Logging food pays no points.</p>
            </div>
          </details>
  )

  // Drop a meal photo anywhere on Food: read the same way as the Photo button (up to 6 photos of one meal).
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
  const dropProps = pastDay
    ? {}
    : {
        onDragOver: (e: React.DragEvent) => {
          if (!hasFiles(e)) return
          e.preventDefault()
          if (!dropping) setDropping(true)
        },
        onDragLeave: (e: React.DragEvent) => {
          if (e.currentTarget === e.target || !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDropping(false)
        },
        onDrop: (e: React.DragEvent) => {
          if (!hasFiles(e)) return
          e.preventDefault()
          setDropping(false)
          const files = imagesFrom(e.dataTransfer?.files, 7)
          if (!files.length) return toast('Drop a photo (JPEG, PNG or WebP) of your meal.', 'bad')
          setSub('today')
          setSheet(null)
          photoRef.current?.read(files)
        }
      }

  return (
    <section className="card fd-card" aria-label="Food counter" {...dropProps}>
      {dropping && (
        <div className="fd-drop" role="status">
          Drop the photo to log this meal
        </div>
      )}
      <div className="card-head fd-head">
        <h2>Food</h2>
        <div className="fd-head-actions">
          <Select className="fd-day" value={v.day} onChange={(e) => setDay(e.target.value === v.today ? undefined : e.target.value)} title="Add or fix meals on a past day">
            {dayOptions.map((d, i) => (
              <option key={d} value={d}>
                {i === 0 ? 'Today' : i === 1 ? 'Yesterday' : d}
              </option>
            ))}
          </Select>
          <button type="button" className="btn ghost small" onClick={() => setGoalsOpen(!goalsOpen)} aria-expanded={goalsOpen}>
            Goals
          </button>
        </div>
      </div>

      {goalsOpen && <GoalsSheet v={v} onView={setV} day={day} />}

      {sub === 'today' && (
        <div className="fd-cols">
          <div className="fd-left">
          <div className="fd-hero">
            <FoodBars progress={v.progress} behind={pastDay ? null : v.behind} hero />
            <p className="fd-line sr-only" aria-live="polite">
              {head.line}
            </p>
            {head.preview && (
              <p className="fd-preview" aria-live="polite">
                {head.preview}
              </p>
            )}
            {!pastDay && extras?.workout && <p className="fd-train-note" role="status">{extras.workout}</p>}
          </div>
          {pastDay && <p className="fd-past">Editing {v.day}: meals you add are marked "added later".</p>}

          <button type="button" className="bdy-btn primary big fd-log-btn" onClick={() => setSheet(rows ? 'type' : 'root')}>
            <LogIcon kind="photo" />
            {rows ? 'Finish your meal' : 'Log food'}
          </button>
          {!pastDay && <FoodPhotoLog view={v} bare pickRef={photoRef} />}
          {moreEl}
          </div>

          <div className="fd-meals" aria-label={pastDay ? `Meals on ${v.day}` : "Today's meals"}>
            <div className="fd-meals-head">
              <h3>{pastDay ? `Meals on ${v.day}` : "Today's meals"}</h3>
              {liveCount > 0 && <small className="num">{liveCount} logged</small>}
            </div>
            {groups.length === 0 ? (
              <div className="fd-empty">
                <span className="fd-empty-icon" aria-hidden="true">
                  <LogIcon kind="plate" />
                </span>
                <b>Nothing yet.</b>
                <small>Tap Log food: a photo, a saved meal or a few words.</small>
              </div>
            ) : (
              groups.map((g) => {
                const live = g.list.filter((m) => !m.removed)
                const sum = sumItems(live.flatMap((m) => m.items))
                return (
                  <section key={g.id} className="fd-mcard" data-type={g.id}>
                    <header>
                      <b>{g.label}</b>
                      <small className="num">
                        {fmt(sum.kcal)} kcal · {sum.protein} g
                      </small>
                    </header>
                    <ul className="fd-mlist">
                      {g.list.map((m) => (
                        <li key={m.id} className={`${m.removed ? 'removed' : ''}${openMeal === m.id ? ' open' : ''}`}>
                          <div className="fd-mrow">
                            {!m.removed && <MealPhotoThumb ids={m.photos} name={m.name} sub={`${m.day} · ${atHm(m.at)} · ${fmt(m.totals.kcal)} kcal · ${m.totals.protein} g protein · carbs ${m.totals.carbs} g · fat ${m.totals.fat} g`} />}
                            <span className="fd-meal-name">
                              {m.removed && <small className="fd-removed-tag">Removed</small>}
                              <b>{m.name}</b>
                              <small className="fd-meal-sub">
                                <span className="num fd-when">{dayLabel(m.day)}, {atHm(m.at)}</span> · <span className="num">{fmt(m.totals.kcal)} kcal · {m.totals.protein} g protein</span>
                                {m.late ? ' · added later' : ''}
                                {mealSource(m) === 'photo' && <ConfidenceDot items={m.items} />}
                              </small>
                              {!m.removed && (
                                <span className="fd-mitems" role="list" aria-label={`What is in ${m.name}`}>
                                  {m.items.slice(0, 6).map((it, k) => (
                                    <span className="fd-mitem" role="listitem" key={k}>
                                      <span>
                                        {it.name} <small className="num">{fmt(it.grams)} g</small>
                                      </span>
                                      <span className="num">
                                        {fmt(it.kcal)} kcal · P {fmt(it.protein)} · C {fmt(it.carbs)} · F {fmt(it.fat)}
                                      </span>
                                    </span>
                                  ))}
                                  {m.items.length > 6 && <span className="fd-mitem" role="listitem">+{m.items.length - 6} more under ⋯</span>}
                                </span>
                              )}
                            </span>
                            {!m.removed && !m.supp && (() => {
                              const sc = mealScore(m.items)
                              return sc ? (
                                <span className={`fd-grade g${sc.grade}`} title={`Meal score ${sc.grade}: ${sc.tip}`} aria-label={`Meal score ${sc.grade}`}>
                                  {sc.grade}
                                </span>
                              ) : null
                            })()}
                            <span className="fd-meal-actions">
                              {!m.removed && (
                                <button type="button" className="fdf-x fd-more-btn" aria-expanded={openMeal === m.id} aria-label={`More for ${m.name}`} title="Star, save as meal, see what is in it" onClick={() => setOpenMeal(openMeal === m.id ? null : m.id)}>
                                  ⋯
                                </button>
                              )}
                              {!m.removed && (
                                <button type="button" className="fdf-x fd-edit" aria-label={`Edit ${m.name}`} title="Edit" onClick={() => edit(m)}>
                                  <LogIcon kind="pen" size={18} />
                                </button>
                              )}
                              <button type="button" className={m.removed ? 'bdy-btn quiet fd-remove' : 'fdf-x fd-remove'} aria-label={m.removed ? `Undo removing ${m.name}` : `Remove ${m.name}`} title={m.removed ? 'Undo' : 'Remove'} onClick={() => void toggleMeal(m.id, !m.removed)}>
                                {m.removed ? 'Undo' : '×'}
                              </button>
                            </span>
                          </div>
                          {openMeal === m.id && !m.removed && (
                            <div className="fd-mextra">
                              <MealItems items={m.items} />
                              {!m.supp && mealScore(m.items) && <small className="fd-score-tip">Score {mealScore(m.items)!.grade}: {mealScore(m.items)!.tip}</small>}
                              <small className="num">
                                Carbs {m.totals.carbs} g · Fat {m.totals.fat} g
                              </small>
                              <span className="fd-row">
                                {!m.supp && (
                                  <button type="button" className={`bdy-chip fd-star${m.fav ? ' on' : ''}`} aria-pressed={m.fav} aria-label={m.fav ? `Unstar ${m.name}` : `Star ${m.name}`} onClick={async () => setV((await act(() => api.fav({ name: m.name, items: m.items }, day), m.fav ? 'Unstarred' : 'Starred: one tap adds it again')) ?? v)}>
                                    {m.fav ? '★ Starred' : '☆ Star'}
                                  </button>
                                )}
                                {!m.supp && mealSource(m) !== 'saved' && (
                                  <button type="button" className="bdy-chip fd-save-meal" onClick={async () => setV((await act(() => api.saveAsMeal(m.id), 'Saved to your meals: one tap logs it next time')) ?? v)}>
                                    Save as meal
                                  </button>
                                )}
                              </span>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                )
              })
            )}
          </div>

        </div>
      )}

      {sub !== 'today' && (
        <button type="button" className="bdy-btn quiet fd-back" data-sub="today" onClick={() => setSub('today')}>
          ‹ Back to today
        </button>
      )}
      {sub === 'week' && (
        <div className="fd-week">
          <h3 className="fd-sub-title">This week</h3>
          <p className="fd-line">{v.week.line}</p>
          <WeekChartView chart={v.chart} />
          {v.adjust.state === 'none' && <small className="muted fd-adjust-note">{v.adjust.why}</small>}
          {extras && (
            <div className="fd-accuracy" data-state={extras.accuracy.state} aria-label="Do your logs match your weight?">
              <b>Do your logs match your weight?</b>
              <p>{extras.accuracy.state === 'none' ? extras.accuracy.why : extras.accuracy.line}</p>
              {extras.accuracy.state !== 'none' && extras.accuracy.rough && <small className="muted">Rough: enter your height and age in Goals for a better maintenance number.</small>}
            </div>
          )}
          {sug && <small className="muted fd-adjust-note">There is a calorie suggestion waiting under More on Today: {sug.title.toLowerCase()}.</small>}
        </div>
      )}

      {sub === 'plan' && <FoodPlan v={v} onView={setV} day={day} />}
      {sub === 'photos' && <FoodGallery onFix={(m, d) => (d !== v.day && setDay(d === v.today ? undefined : d), edit(m))} />}
      {sub === 'charts' && <FoodCharts />}
      {/* On top of the whole app (not inside the page's tabs); body-page keeps the Body colours. */}
      {sheetEl && createPortal(<div className="body-page fdl-portal">{sheetEl}</div>, document.body)}
      {manage && <FoodSavedSheet v={v} onView={setV} onClose={() => setManage(false)} />}
    </section>
  )
}

type IconKind = 'photo' | 'star' | 'pen' | 'plate'
/** Plain line icons for the Log food sheet (drawn here, no icon font). */
function LogIcon({ kind, size = 24 }: { kind: IconKind; size?: number }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  return (
    <svg className="fdl-svg" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      {kind === 'photo' && (
        <>
          <path {...p} d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.6l1.4-2h5l1.4 2h1.6A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5Z" />
          <circle {...p} cx="12" cy="12.5" r="3.5" />
        </>
      )}
      {kind === 'star' && <path {...p} d="m12 3.8 2.5 5.1 5.6.8-4 4 .9 5.6-5-2.7-5 2.7.9-5.6-4-4 5.6-.8Z" />}
      {kind === 'pen' && <path {...p} d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4ZM13.5 6.5l4 4" />}
      {kind === 'plate' && (
        <>
          <circle {...p} cx="12" cy="12" r="8" />
          <circle {...p} cx="12" cy="12" r="4.5" />
        </>
      )}
    </svg>
  )
}

function GoalsSheet({ v, onView, day }: { v: FoodView; onView: (v: FoodView) => void; day?: string }) {
  const api = life.coach!.food!
  const act = useAction()
  const [g, setG] = useState<FoodGoals>(v.goals)
  const [gpk, setGpk] = useState(v.totals.targets.gPerKg)
  // Height and age stay empty until you enter them (then kcal = maintenance + surplus).
  const [body, setBody] = useState({ h: v.goals.bodySet ? String(v.goals.heightCm) : '', a: v.goals.bodySet ? String(v.goals.age) : '' })
  const num = (s: string) => (s.trim() === '' ? null : Number(s))
  const save = async () => {
    if (Math.abs(gpk - v.totals.targets.gPerKg) > 0.01) await life.coach?.bodyPlus?.prefs({ gPerKg: gpk }).catch(() => null)
    const h = Number(body.h)
    const a = Number(body.a)
    const both = h > 0 && a > 0
    const patch: Partial<FoodGoals> = { ...g, ...(both ? { heightCm: h, age: a, bodySet: 1 } : { bodySet: 0 }) }
    const next = await act(() => api.goals(patch, day), 'Goals saved')
    if (next) onView(next)
  }
  return (
    <div className="fd-goals" aria-label="Goals">
      <b>{GOAL_LABEL}</b>
      <small className="muted">
        {GAIN_TEXT} {v.totals.targets.why}
      </small>
      <label className="fd-field">
        <span>Protein per kg of body weight</span>
        <span className="pr-gpk-row">
          {[1.6, 1.8, 2, 2.2].map((k) => (
            <button key={k} type="button" className={`chip-btn${Math.abs(gpk - k) < 0.05 ? ' on' : ''}`} aria-pressed={Math.abs(gpk - k) < 0.05} onClick={() => setGpk(k)}>
              {k}
            </button>
          ))}
        </span>
      </label>
      <div className="fd-grid">
        <label className="fd-field">
          <span>Height (cm)</span>
          <input type="number" inputMode="numeric" className="fd-height" placeholder="e.g. 180" value={body.h} onChange={(e) => setBody({ ...body, h: e.target.value })} />
        </label>
        <label className="fd-field">
          <span>Age</span>
          <input type="number" inputMode="numeric" className="fd-age" placeholder="e.g. 20" value={body.a} onChange={(e) => setBody({ ...body, a: e.target.value })} />
        </label>
        <label className="fd-field">
          <span>Sex (for the formula)</span>
          <Select value={g.sex} onChange={(e) => setG({ ...g, sex: e.target.value === 'f' ? 'f' : 'm' })}>
            <option value="m">Male</option>
            <option value="f">Female</option>
          </Select>
        </label>
        <label className="fd-field">
          <span>Activity</span>
          <Select value={g.activity} onChange={(e) => setG({ ...g, activity: e.target.value as Activity })}>
            {(Object.keys(ACTIVITY) as Activity[]).map((a) => (
              <option key={a} value={a}>
                {ACTIVITY[a].label}
              </option>
            ))}
          </Select>
        </label>
        <label className="fd-field">
          <span>Extra kcal to grow, training day</span>
          <input type="number" inputMode="numeric" value={g.trainSurplus} onChange={(e) => setG({ ...g, trainSurplus: Number(e.target.value) })} />
        </label>
        <label className="fd-field">
          <span>Extra kcal to grow, rest day</span>
          <input type="number" inputMode="numeric" value={g.restSurplus} onChange={(e) => setG({ ...g, restSurplus: Number(e.target.value) })} />
        </label>
        <label className="fd-field">
          <span>Your own kcal goal (empty: worked out)</span>
          <input type="number" inputMode="numeric" value={g.kcalOwn ?? ''} onChange={(e) => setG({ ...g, kcalOwn: num(e.target.value) })} />
        </label>
        <label className="fd-field">
          <span>Your own protein goal in g (empty: per kg)</span>
          <input type="number" inputMode="numeric" value={g.proteinOwn ?? ''} onChange={(e) => setG({ ...g, proteinOwn: num(e.target.value) })} />
        </label>
      </div>
      <small className="muted">
        {v.totals.targets.fixed
          ? `For now the goal is a fixed ${fmt(FIXED_KCAL)} kcal. Log your weight and enter your height and age to get one made for you.`
          : `Maintenance is about ${fmt(v.totals.targets.maintenance)} kcal.`}{' '}
        Slow muscle gain: about +350 kcal a day over maintenance and 1.8 g protein per kg. The weekly calorie check suggests changes from your weight and waist.
      </small>
      <div className="fd-adj-history" aria-label="Calorie changes">
        <b>Calorie changes</b>
        {v.goals.adjLog.length ? (
          <ul>
            {v.goals.adjLog.map((e, i) => (
              <li key={`${e.day}-${i}`}>{adjLogLine(e)}</li>
            ))}
          </ul>
        ) : (
          <small className="muted">None yet. When you accept a weekly suggestion it is listed here.</small>
        )}
        {v.goals.kcalAdj !== 0 && <small className="muted">Now {v.goals.kcalAdj > 0 ? '+' : '−'}{Math.abs(v.goals.kcalAdj)} kcal a day from these changes (at most ±600).</small>}
      </div>
      <div className="fd-row">
        <button type="button" className="btn primary small fd-goals-save" onClick={save}>
          Save goals
        </button>
      </div>
    </div>
  )
}
