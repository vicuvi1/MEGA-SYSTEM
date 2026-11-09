// The food counter (Body → Food). No image AI in the app: "Copy prompt", paste
// it with a meal photo into any free AI app, paste the reply back; plain code
// reads it (core/foodParse.ts), you fix grams and names, Save adds the meal.
// Also: quick add in words, a label prompt for packaged food, water and
// supplement buttons, day rings, meal cards (edit / remove), the weekly weight
// check, the week chart and the plan (cheap protein, shopping, Sunday prep),
// folded into Today · Week · Plan. Day totals, the lean goals (Goals sheet),
// what to eat next, same as yesterday and starred meals. Protein is ONE number
// with the protein ring: each meal is one protein row in the body log. The
// header, the macros and "Next" all use SAVED meals; an unsaved draft is shown
// apart ("+59 g if you save"). No points.
import { useEffect, useMemo, useState } from 'react'
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
import type { FoodView } from '../../../main/food'
import './food.css'

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

type Sub = 'today' | 'week' | 'plan'
const SUBS: { id: Sub; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Week' },
  { id: 'plan', label: 'Plan' }
]
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
  const [moreOpen, setMoreOpen] = useState(false)

  useEffect(() => {
    if (!api) return
    const load = () => api.view(day).then(setV).catch(() => {})
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
  }
  const load = (items: FoodItem[]) => {
    setEditing(null)
    setRows(toRows(items))
    setQuestion(null)
    setErr(null)
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
  const edit = (m: FoodView['meals'][number]) => {
    setRows(m.items.map((it) => ({ key: ++rowKey, base: it, name: it.name, grams: it.grams })))
    setEditing(m.id)
    setType(m.type)
    setQuestion(null)
    setErr(null)
    setSub('today')
  }
  const patch = (key: number, p: Partial<Row>) => setRows((list) => (list ? list.map((r) => (r.key === key ? { ...r, ...p } : r)) : list))
  const clearDraft = () => {
    setRows(null)
    setEditing(null)
    setReply('')
    setQuestion(null)
  }
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
    }
  }
  const sug = v.adjust.state === 'suggest' ? v.adjust.suggestion : null
  const dayOptions = Array.from({ length: 8 }, (_, i) => addDays(v.today, -i))

  // Meal cards by meal type; supplements in their own card.
  const foodMeals = v.meals.filter((m) => !m.supp)
  const suppMeals = v.meals.filter((m) => m.supp)
  const groups = [...MEAL_TYPES.map((ty) => ({ id: ty as string, label: TYPE_LABEL[ty], list: foodMeals.filter((m) => m.type === ty) })), { id: 'supp', label: 'Supplements', list: suppMeals }].filter((g) => g.list.length)

  return (
    <section className="card fd-card" aria-label="Food counter">
      <div className="card-head">
        <h2>Food counter</h2>
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

      <div className="fd-tabs" role="tablist" aria-label="Food counter views">
        {SUBS.map((s) => (
          <button key={s.id} type="button" role="tab" className={`fd-tab${sub === s.id ? ' on' : ''}`} aria-selected={sub === s.id} data-sub={s.id} onClick={() => setSub(s.id)}>
            {s.label}
          </button>
        ))}
      </div>

      {sub === 'today' && (
        <>
          <FoodBars progress={v.progress} behind={pastDay ? null : v.behind} />
          <p className="fd-line sr-only" aria-live="polite">
            {head.line}
          </p>
          {head.preview && (
            <p className="fd-preview" aria-live="polite">
              {head.preview}
            </p>
          )}
        </>
      )}
      {pastDay && <p className="fd-past">Editing {v.day}: meals you add are marked "added later".</p>}

      {goalsOpen && <GoalsSheet v={v} onView={setV} day={day} />}

      {sub === 'today' && !pastDay && sug && <WeekCheck v={v} onView={setV} day={day} />}

      {sub === 'today' && (
        <>
          <QuickLog v={v} onView={setV} onManage={() => setManage(true)} />
          {!pastDay && (
            <div className="fd-quick-add" aria-label="Water and supplements">
              <div className="fd-row fd-water">
                <span>
                  Water <b className="num">{fmt(v.water?.ml ?? 0)}</b> / {fmt(v.water?.target ?? 0)} ml
                </span>
                {WATER_BUTTONS.map((w) => (
                  <button key={w.id} type="button" className={`chip-btn fd-water-${w.id}`} onClick={async () => setV((await act(() => api.water(w.ml, day), `+${w.ml} ml water`)) ?? v)}>
                    + {w.label} <small>{w.ml} ml</small>
                  </button>
                ))}
              </div>
              <div className="fd-row fd-supps">
                <span>Supplements</span>
                {SUPP_PRESETS.map((p) => (
                  <button key={p.id} type="button" className={`chip-btn fd-supp-${p.id}`} onClick={async () => setV((await act(() => api.supp(p.id, day), `${p.label} logged`)) ?? v)}>
                    + {p.label}
                    {p.items[0].protein ? <small> +{p.items[0].protein} g</small> : null}
                  </button>
                ))}
              </div>
            </div>
          )}
          {rows && (
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
                        <button type="button" className="icon-btn fd-minus" aria-label={`Less ${it.name}`} onClick={() => patch(r.key, { grams: stepGrams(r.grams, -1) })}>
                          −
                        </button>
                        <b className="num">{r.grams} g</b>
                        <button type="button" className="icon-btn fd-plus" aria-label={`More ${it.name}`} onClick={() => patch(r.key, { grams: stepGrams(r.grams, 1) })}>
                          +
                        </button>
                      </span>
                      <small className="fd-macros">
                        {Math.round(it.protein)} g protein · {fmt(it.kcal)} kcal <span className={`fd-conf ${it.confidence}`}>{CONF_LABEL[it.confidence]}</span>
                      </small>
                      <button type="button" className="icon-btn fd-del" aria-label={`Remove ${it.name}`} onClick={() => setRows((list) => (list ? list.filter((x) => x.key !== r.key) : list))}>
                        ×
                      </button>
                    </li>
                  )
                })}
              </ul>
              <div className="fd-row fd-save-row">
                <span className="fd-draft-total">
                  This meal: <b>{draftTotals.protein} g protein</b> · {fmt(draftTotals.kcal)} kcal · carbs {draftTotals.carbs} g · fat {draftTotals.fat} g
                </span>
                <Select className="fd-type" value={type} onChange={(e) => setType(e.target.value as MealType)} title="Which meal">
                  {MEAL_TYPES.map((m) => (
                    <option key={m} value={m}>
                      {TYPE_LABEL[m]}
                    </option>
                  ))}
                </Select>
                <button type="button" className="btn primary small fd-save" disabled={!draft.length} onClick={save}>
                  {editing ? 'Save changes' : 'Save meal'}
                </button>
                <button type="button" className="btn ghost small fd-cancel" onClick={clearDraft}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          <details className="fd-more" open={moreOpen || pastDay} onToggle={(e) => setMoreOpen((e.currentTarget as HTMLDetailsElement).open)}>
            <summary>More ways to log: in words, a photo with any AI app, same as yesterday</summary>
            <div className="fd-more-body">
              <div className="fd-step fd-words-step">
                <b>Say what you ate</b>
                <div className="fd-row">
                  <input
                    className="fd-words"
                    value={words}
                    placeholder="200g chicken, 150g rice, 2 eggs, 1 banana"
                    aria-label="What you ate, in words"
                    onChange={(e) => setWords(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && words.trim() && addWords()}
                  />
                  <button type="button" className="btn small fd-words-go" disabled={!words.trim()} onClick={addWords}>
                    Add
                  </button>
                </div>
                {say && (
                  <p className="fd-words-say" role="status">
                    {say}
                  </p>
                )}
              </div>
              <div className="fd-step">
                <div className="fd-step-head">
                  <b>Or send a photo to an AI app</b>
                  <small className="muted">Copy the prompt, paste it with a photo of your meal (or of the nutrition label on packaged food) into any free AI app (ChatGPT, Gemini, Claude), then paste its reply below.</small>
                </div>
                <div className="fd-row">
                  <button type="button" className="btn primary small fd-copy" onClick={copyPrompt}>
                    {copied ? 'Copied' : 'Copy prompt'}
                  </button>
                  <button type="button" className="btn small fd-copy-label" onClick={copyLabel}>
                    {copiedLabel ? 'Copied' : 'Copy label prompt'}
                  </button>
                  <details className="fd-prompt">
                    <summary>See the prompts</summary>
                    <pre>{FOOD_PROMPT}</pre>
                    <pre>{LABEL_PROMPT}</pre>
                  </details>
                </div>
              </div>
              <div className="fd-step">
                <b>Paste the reply</b>
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
                  <button type="button" className="btn small fd-read" disabled={!reply.trim()} onClick={() => read()}>
                    Read reply
                  </button>
                  {err && (
                    <button type="button" className="btn ghost small" onClick={copyPrompt}>
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
              {(v.yesterday.length > 0 || v.favs.length > 0) && !rows && (
                <div className="fd-quick">
                  {v.yesterday.length > 0 && (
                    <div className="fd-again">
                      <b>Same as yesterday</b>
                      <div className="pr-chips">
                        {v.yesterday.map((m) => (
                          <button key={m.id} type="button" className="chip-btn fd-yday" onClick={() => load(m.items)} title="Opens it with the grams to fix, then Save">
                            {m.name} <small>+{m.totals.protein} g</small>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {v.favs.length > 0 && (
                    <div className="fd-again">
                      <b>Starred</b>
                      <div className="pr-chips">
                        {v.favs.map((f) => (
                          <button key={f.id} type="button" className="chip-btn fd-favchip" onClick={() => load(f.items)}>
                            ★ {f.name} <small>+{sumItems(f.items).protein} g</small>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </details>

          {groups.length > 0 && (
            <div className="fd-meals" aria-label={pastDay ? `Meals on ${v.day}` : "Today's meals"}>
              {groups.map((g) => {
                const live = g.list.filter((m) => !m.removed)
                const sum = sumItems(live.flatMap((m) => m.items))
                return (
                  <section key={g.id} className="fd-mcard" data-type={g.id}>
                    <header>
                      <b>{g.label}</b>
                      <small className="muted">
                        {sum.protein} g protein · {fmt(sum.kcal)} kcal
                        {g.id === 'supp' ? '' : ` · carbs ${sum.carbs} g · fat ${sum.fat} g`}
                      </small>
                    </header>
                    <ul className="fd-mlist">
                      {g.list.map((m) => (
                        <li key={m.id} className={m.removed ? 'removed' : ''}>
                          <span className="fd-time">{atHm(m.at)}</span>
                          <span className="fd-meal-name">
                            <b>{m.name}</b>
                            <small className="muted fd-meal-items">{itemsText(m.items)}</small>
                            <small className="muted">
                              {m.totals.protein} g protein · {fmt(m.totals.kcal)} kcal · carbs {m.totals.carbs} g · fat {m.totals.fat} g{m.late ? ' · added later' : ''}
                            </small>
                          </span>
                          <span className="fd-meal-actions">
                            {!m.supp && (
                              <button type="button" className={`icon-btn fd-star${m.fav ? ' on' : ''}`} aria-pressed={m.fav} aria-label={m.fav ? `Unstar ${m.name}` : `Star ${m.name}`} onClick={async () => setV((await act(() => api.fav({ name: m.name, items: m.items }, day), m.fav ? 'Unstarred' : 'Starred: one tap adds it again')) ?? v)}>
                                {m.fav ? '★' : '☆'}
                              </button>
                            )}
                            {!m.removed && !m.supp && mealSource(m) !== 'saved' && (
                              <button type="button" className="btn ghost small fd-save-meal" onClick={async () => setV((await act(() => api.saveAsMeal(m.id), 'Saved to your meals: one tap logs it next time')) ?? v)}>
                                Save as meal
                              </button>
                            )}
                            {!m.removed && (
                              <button type="button" className="btn ghost small fd-edit" onClick={() => edit(m)}>
                                Edit
                              </button>
                            )}
                            <button type="button" className="btn ghost small fd-remove" onClick={async () => setV((await act(() => api.toggle(m.id, day))) ?? v)}>
                              {m.removed ? 'Undo' : 'Remove'}
                            </button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )
              })}
            </div>
          )}
          <p className="fd-macros-line">{head.macros}</p>
          <Rings rings={dayRings(saved, goals)} />
          <small className="muted fd-why">
            {GOAL_LABEL} · {GAIN_TEXT}
          </small>
          {!pastDay && (
            <p className="fd-next" role="status">
              <b>Next:</b> {v.next.line}
            </p>
          )}
          {!pastDay && !sug && <WeekCheck v={v} onView={setV} day={day} />}
          <p className="pr-note">Saved foods use common table values; an AI app's numbers are estimates. Fix any amount that looks wrong. Logging food pays no points.</p>
        </>
      )}

      {sub === 'week' && (
        <div className="fd-week">
          <p className="fd-line">{v.week.line}</p>
          <WeekChartView chart={v.chart} />
          {v.adjust.state === 'none' && <small className="muted fd-adjust-note">{v.adjust.why}</small>}
          {sug && <small className="muted fd-adjust-note">There is a weight check waiting on Today: {sug.title.toLowerCase()}.</small>}
        </div>
      )}

      {sub === 'plan' && <FoodPlan v={v} onView={setV} day={day} />}
      {manage && <FoodSavedSheet v={v} onView={setV} onClose={() => setManage(false)} />}
    </section>
  )
}

/** The weekly weight and waist check: a suggestion (Apply / Not now) or one quiet line. */
function WeekCheck({ v, onView, day }: { v: FoodView; onView: (v: FoodView) => void; day?: string }) {
  const api = life.coach!.food!
  const act = useAction()
  const a = v.adjust
  if (a.state !== 'suggest')
    return (
      <div className="fd-week-check" aria-label="Weekly weight check">
        <small>
          <b>Weekly check:</b> {a.why}
        </small>
      </div>
    )
  const sug = a.suggestion
  const goal = v.totals.targets.kcal + sug.delta
  return (
    <div className="fd-week-check suggest fd-adjust" role="status" aria-label="Weekly weight check">
      <b>{sug.title}</b>
      <small>{sug.why}</small>
      <small>
        <b>Idea:</b> {sug.tip}
      </small>
      <div className="fd-row">
        <button type="button" className="bdy-btn primary fd-adjust-apply" onClick={async () => onView((await act(() => api.adjust(true, day), `Goal changed to ${fmt(goal)} kcal`)) ?? v)}>
          Apply ({sug.delta > 0 ? '+' : '−'}
          {Math.abs(sug.delta)} kcal)
        </button>
        <button type="button" className="bdy-btn quiet fd-adjust-later" onClick={async () => onView((await act(() => api.adjust(false, day), 'Okay, I will check again next week')) ?? v)}>
          Not now
        </button>
      </div>
    </div>
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
        Slow muscle gain: about +350 kcal a day over maintenance and 1.8 g protein per kg. The weekly check adjusts it from your weight and waist.
      </small>
      <div className="fd-row">
        <button type="button" className="btn primary small fd-goals-save" onClick={save}>
          Save goals
        </button>
      </div>
    </div>
  )
}
