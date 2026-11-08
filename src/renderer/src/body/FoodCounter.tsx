// The food counter (Body → Food). No image AI in the app: "Copy prompt", paste
// it with a meal photo into any free AI app, paste the reply back; plain code
// reads it (core/foodParse.ts), you fix grams and names, Save adds the meal.
// Day totals, the lean goals (Goals sheet), what to eat next, same as
// yesterday and starred meals. Protein is ONE number with the protein ring:
// each meal is one protein row in the body log. No points.
import { useEffect, useMemo, useState } from 'react'
import { FOOD_PROMPT } from '@core/foodPrompt'
import { parseFoodReply } from '@core/foodParse'
import { MEAL_TYPES, mealName, mealTypeAt, scaleItem, stepGrams, sumItems, type FoodItem, type MealType } from '@core/food'
import { ACTIVITY, GOAL_LABEL, type Activity, type FoodGoals } from '@core/foodGoals'
import { addDays } from '@core/dates'
import { life } from '../bridge'
import { useAction, useToast } from '../ui'
import { Select } from '../Select'
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

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}

export function FoodCounter() {
  const api = life.coach?.food
  const act = useAction()
  const toast = useToast()
  const [v, setV] = useState<FoodView | null>(null)
  const [day, setDay] = useState<string | undefined>(undefined)
  const [reply, setReply] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [question, setQuestion] = useState<string | null>(null)
  const [type, setType] = useState<MealType>(() => mealTypeAt(new Date().toTimeString().slice(0, 5)))
  const [goalsOpen, setGoalsOpen] = useState(false)
  const [copied, setCopied] = useState(false)

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
  const proteinWith = t.protein + (rows ? draftTotals.protein : 0)
  const kcalWith = t.kcal + (rows ? draftTotals.kcal : 0)

  const copyPrompt = async () => {
    const ok = await copyText(FOOD_PROMPT)
    setCopied(ok)
    toast(ok ? 'Prompt copied. Paste it with your meal photo into any AI app.' : 'Could not copy. Select the prompt below and copy it.', ok ? 'good' : 'bad')
  }
  const read = (text = reply) => {
    const r = parseFoodReply(text)
    if (!r.ok) {
      setErr(r.why)
      setRows(null)
      return
    }
    setErr(null)
    setRows(toRows(r.items))
    setQuestion(r.question)
  }
  const load = (items: FoodItem[]) => {
    setRows(toRows(items))
    setQuestion(null)
    setErr(null)
  }
  const patch = (key: number, p: Partial<Row>) => setRows((list) => (list ? list.map((r) => (r.key === key ? { ...r, ...p } : r)) : list))
  const save = async () => {
    if (!draft.length) return
    const next = await act(() => api.add({ items: draft, name: mealName(draft), day: v.day, type }, v.day), `Meal saved: +${draftTotals.protein} g protein, ${fmt(draftTotals.kcal)} kcal`)
    if (next) {
      setV(next)
      setRows(null)
      setReply('')
      setQuestion(null)
    }
  }
  const dayOptions = Array.from({ length: 8 }, (_, i) => addDays(v.today, -i))

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

      <p className="fd-line" aria-live="polite">
        Protein <b>{fmt(proteinWith)}</b> / {fmt(t.targets.protein)} g · <b>{fmt(kcalWith)}</b> / {fmt(t.targets.kcal)} kcal {pastDay ? `on ${v.day}` : 'today'}
      </p>
      <div className="fd-bars" aria-hidden="true">
        <span className="fd-bar p" style={{ ['--w' as any]: Math.min(1, proteinWith / Math.max(1, t.targets.protein)) }} />
        <span className="fd-bar k" style={{ ['--w' as any]: Math.min(1, kcalWith / Math.max(1, t.targets.kcal)) }} />
      </div>
      <small className="muted fd-why">
        {GOAL_LABEL} · {t.targets.training ? 'training day' : 'rest day'} · carbs {fmt(v.carbs)} g · fat {fmt(v.fat)} g
      </small>
      {pastDay && <p className="fd-past">Editing {v.day}: meals you add are marked "added later".</p>}

      {goalsOpen && <GoalsSheet v={v} onView={setV} day={day} />}

      {!pastDay && (
        <p className="fd-next" role="status">
          <b>Next:</b> {v.next.line}
        </p>
      )}

      <div className="fd-step">
        <div className="fd-step-head">
          <b>1. Photo to AI</b>
          <small className="muted">Copy the prompt, paste it with a photo of your meal into any free AI app (ChatGPT, Gemini, Claude), then paste its reply below.</small>
        </div>
        <div className="fd-row">
          <button type="button" className="btn primary small fd-copy" onClick={copyPrompt}>
            {copied ? 'Copied' : 'Copy prompt'}
          </button>
          <details className="fd-prompt">
            <summary>See the prompt</summary>
            <pre>{FOOD_PROMPT}</pre>
          </details>
        </div>
      </div>

      <div className="fd-step">
        <b>2. Paste the reply</b>
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

      {rows && (
        <div className="fd-draft" aria-label="Your meal before saving">
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
              Save meal
            </button>
            <button type="button" className="btn ghost small" onClick={() => setRows(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

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

      {v.meals.length > 0 && (
        <ul className="fd-meals" aria-label={pastDay ? `Meals on ${v.day}` : "Today's meals"}>
          {v.meals.map((m) => (
            <li key={m.id} className={m.removed ? 'removed' : ''}>
              <span className="fd-time">{atHm(m.at)}</span>
              <span className="fd-meal-name">
                <b>{m.name}</b>
                <small className="muted">
                  {TYPE_LABEL[m.type]} · {m.totals.protein} g protein · {fmt(m.totals.kcal)} kcal{m.late ? ' · added later' : ''}
                </small>
              </span>
              <button type="button" className={`icon-btn fd-star${m.fav ? ' on' : ''}`} aria-pressed={m.fav} aria-label={m.fav ? `Unstar ${m.name}` : `Star ${m.name}`} onClick={async () => setV((await act(() => api.fav({ name: m.name, items: m.items }, day), m.fav ? 'Unstarred' : 'Starred: one tap adds it again')) ?? v)}>
                {m.fav ? '★' : '☆'}
              </button>
              <button type="button" className="btn ghost small" onClick={async () => setV((await act(() => api.toggle(m.id, day))) ?? v)}>
                {m.removed ? 'Undo' : 'Remove'}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="pr-note">The AI app's numbers are estimates; fix the grams if they look wrong. Nothing is sent from here. Logging food pays no points.</p>
    </section>
  )
}

function GoalsSheet({ v, onView, day }: { v: FoodView; onView: (v: FoodView) => void; day?: string }) {
  const api = life.coach!.food!
  const act = useAction()
  const [g, setG] = useState<FoodGoals>(v.goals)
  const [gpk, setGpk] = useState(v.totals.targets.gPerKg)
  const num = (s: string) => (s.trim() === '' ? null : Number(s))
  const save = async () => {
    if (Math.abs(gpk - v.totals.targets.gPerKg) > 0.01) await life.coach?.bodyPlus?.prefs({ gPerKg: gpk }).catch(() => null)
    const next = await act(() => api.goals(g, day), 'Goals saved')
    if (next) onView(next)
  }
  return (
    <div className="fd-goals" aria-label="Goals">
      <b>{GOAL_LABEL}</b>
      <small className="muted">{v.totals.targets.why}</small>
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
          <input type="number" inputMode="numeric" value={g.heightCm} onChange={(e) => setG({ ...g, heightCm: Number(e.target.value) })} />
        </label>
        <label className="fd-field">
          <span>Age</span>
          <input type="number" inputMode="numeric" value={g.age} onChange={(e) => setG({ ...g, age: Number(e.target.value) })} />
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
          <span>Extra kcal on a training day</span>
          <input type="number" inputMode="numeric" value={g.trainSurplus} onChange={(e) => setG({ ...g, trainSurplus: Number(e.target.value) })} />
        </label>
        <label className="fd-field">
          <span>Extra kcal on a rest day</span>
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
      <small className="muted">Maintenance is about {fmt(v.totals.targets.maintenance)} kcal. Lean muscle: about +150 kcal on days you train, none on rest days, so the gain is muscle, not fat.</small>
      <div className="fd-row">
        <button type="button" className="btn primary small fd-goals-save" onClick={save}>
          Save goals
        </button>
      </div>
    </div>
  )
}
