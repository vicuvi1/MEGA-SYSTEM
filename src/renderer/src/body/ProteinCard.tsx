// BD1 + BD9: the protein counter. A ring against today's goal (1.6–2.2 g per
// kg of your body weight), one-tap quick picks, a quick log ("protein 30",
// "2 eggs", "chicken 150g"), saved meals, every food in a short list, today's
// entries with Remove / Undo, and the pre-shift fuel card. Each log is a row
// in the one body log, so the island, Telegram and Ben see the same number.
// No points: food is information, not a habit reward.
import { useEffect, useMemo, useState } from 'react'
import { FOODS, SOURCE_NOTE, fuelCard, logOf, mealGrams, mealText, parseProtein, type Food, type MealItem } from '@core/protein'
import { workToday, type LifeFit } from '@core/lifeFit'
import { mealOfRow } from '@core/food'
import { dayKey } from '@core/dates'
import { life } from '../bridge'
import { useAction } from '../ui'
import { celebrate } from '../fx'
import { ProteinRing } from './ProteinRing'
import { useBodyPlus } from './useBodyPlus'
import type { BodyPlusView } from '../../../main/bodyPlus'

const hmNow = () => new Date().toTimeString().slice(0, 5)
const atHm = (iso: string) => {
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? d.toTimeString().slice(0, 5) : ''
}

/** My life's work window (for the pre-shift fuel card). */
function useShift(): { from: string | null; today: boolean } {
  const [s, setS] = useState<{ from: string | null; today: boolean }>({ from: null, today: false })
  useEffect(() => {
    life.coach
      ?.lifeFit?.()
      .then((fit) => {
        const w = workToday(fit as unknown as LifeFit, dayKey(new Date()))
        setS({ from: w?.from ?? null, today: !!w && w.mode !== 'off' })
      })
      .catch(() => {})
  }, [])
  return s
}

export function ProteinCard({ compact = false }: { compact?: boolean }) {
  const [v, setV] = useBodyPlus()
  const act = useAction()
  const shift = useShift()
  const [text, setText] = useState('')
  const [all, setAll] = useState(false)
  const [q, setQ] = useState('')
  const [builder, setBuilder] = useState<MealItem[] | null>(null)
  const [mealName, setMealName] = useState('')
  const parsed = useMemo(() => parseProtein(text), [text])
  if (!v) return null
  const api = life.coach!.bodyPlus!

  const after = (next: BodyPlusView | undefined, el?: HTMLElement | null) => {
    if (!next) return
    if (next.today >= next.goal.g && v.today < v.goal.g) celebrate(el ?? null, 'habit')
    setV(next)
  }
  const logFood = async (f: Food, el?: HTMLElement | null) => {
    if (builder) return setBuilder(addItem(builder, f.id))
    const l = logOf(f)
    after(await act(() => api.protein({ food: f.id, g: l.g }), `${f.emoji} ${l.label}: +${l.g} g protein`), el)
  }
  const logText = async () => {
    if (!parsed) return
    after(await act(() => api.protein({ food: parsed.food, g: parsed.g }), `+${parsed.g} g protein (${parsed.label})`))
    setText('')
  }
  const fuel = fuelCard({ now: hmNow(), shiftFrom: shift.from, workToday: shift.today, logged: v.entries.filter((e) => !e.removed).map((e) => ({ at: atHm(e.at), g: e.g })), leadMin: v.prefs.fuelLead })
  const left = Math.max(0, v.goal.g - v.today)
  const foods = FOODS.filter((f) => !q || `${f.name} ${f.alias.join(' ')}`.toLowerCase().includes(q.toLowerCase()))
  const picks = v.picks.slice(0, compact ? 5 : 8)

  return (
    <section className={`card pr-card${compact ? ' compact' : ''}`} aria-label="Protein today">
      <div className="pr-top">
        <ProteinRing g={v.today} goal={v.goal.g} size={compact ? 64 : 88} />
        <div className="pr-head">
          <h2>Protein</h2>
          <p className="pr-left">{left ? `${left} g to go today` : 'Goal reached today 💪'}</p>
          <small className="muted">
            {v.goal.weight ? `${v.goal.gPerKg} g × ${v.goal.weight} kg` : 'Log your weight for a personal goal'} · range {v.goal.lo}–{v.goal.hi} g
            {v.week.days > 1 ? ` · 7-day average ${v.week.avg} g` : ''}
          </small>
        </div>
        {!compact && (
          <label className="pr-gpk" title="Grams of protein per kg of body weight (1.6–2.2 builds muscle)">
            <small>g per kg</small>
            <span className="pr-gpk-row">
              {[1.6, 1.8, 2, 2.2].map((k) => (
                <button key={k} type="button" className={`chip-btn${Math.abs(v.prefs.gPerKg - k) < 0.05 ? ' on' : ''}`} aria-pressed={Math.abs(v.prefs.gPerKg - k) < 0.05} onClick={async () => after(await act(() => api.prefs({ gPerKg: k })))}>
                  {k}
                </button>
              ))}
            </span>
          </label>
        )}
      </div>

      {fuel && (
        <div className={`pr-fuel ${fuel.kind}`} role="status">
          <b>{fuel.kind === 'before' ? '🍽️ ' : '🌙 '}{fuel.title}</b>
          <p>{fuel.line}</p>
          {fuel.snacks.length > 0 && (
            <div className="pr-chips" aria-label="Snacks for the shift">
              {fuel.snacks.map((f) => (
                <button key={f.id} type="button" className="chip-btn" onClick={(e) => logFood(f, e.currentTarget)} title={`${f.portion}: about ${f.g} g protein`}>
                  {f.emoji} {f.name.replace(/\s*\(.*\)$/, '')} <small>+{f.g} g</small>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="pr-chips" aria-label="Quick picks: one tap logs one portion">
        {picks.map((f) => (
          <button key={f.id} type="button" className="chip-btn pr-pick" onClick={(e) => logFood(FOODS.find((x) => x.id === f.id)!, e.currentTarget)} title={`${f.portion}: about ${f.g} g protein`}>
            {f.emoji} {f.name.replace(/\s*\(.*\)$/, '')} <small>+{f.g} g</small>
          </button>
        ))}
        {v.prefs.meals.map((m) => (
          <button key={m.id} type="button" className="chip-btn pr-meal" onClick={async (e) => after(await act(() => api.meal(m.id), `🍽️ ${m.name}: +${mealGrams(m)} g protein`), e.currentTarget)} title={mealText(m)}>
            🍽️ {m.name} <small>+{mealGrams(m)} g</small>
          </button>
        ))}
      </div>

      <form
        className="pr-quick"
        onSubmit={(e) => {
          e.preventDefault()
          void logText()
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder='Quick log: "protein 30", "2 eggs", "chicken 150g"' aria-label="Quick protein log" />
        <button className="btn primary small" disabled={!parsed}>
          {parsed ? `Log +${parsed.g} g` : 'Log'}
        </button>
      </form>
      {text && !parsed && <small className="muted">Try "protein 30", "3 eggs", "200 g cottage cheese" or a food from the list.</small>}

      {!compact && (
        <>
          <div className="pr-actions">
            <button type="button" className="btn ghost small" onClick={() => setAll(!all)} aria-expanded={all}>
              {all ? 'Hide foods' : `All foods (${FOODS.length})`}
            </button>
            <button type="button" className="btn ghost small" onClick={() => (setBuilder(builder ? null : []), setAll(true), setMealName(''))}>
              {builder ? 'Cancel meal' : '+ Save a meal'}
            </button>
          </div>
          {builder && (
            <div className="pr-builder">
              <b>New meal</b> <small className="muted">Tap foods below to add them; tap again for more.</small>
              <p>{builder.length ? `${mealText({ items: builder })} · ${mealGrams({ items: builder })} g protein` : 'No foods yet.'}</p>
              <div className="pr-quick">
                <input value={mealName} onChange={(e) => setMealName(e.target.value)} placeholder="Name it (e.g. Breakfast)" aria-label="Meal name" maxLength={40} />
                <button
                  type="button"
                  className="btn primary small"
                  disabled={!builder.length || !mealName.trim()}
                  onClick={async () => {
                    const id = `meal-${Date.now().toString(36).slice(-8)}`
                    const next = await act(() => api.prefs({ meals: [...v.prefs.meals, { id, name: mealName.trim(), items: builder }] }), `Saved "${mealName.trim()}": one tap logs it`)
                    if (next) (setV(next), setBuilder(null))
                  }}
                >
                  Save meal
                </button>
              </div>
            </div>
          )}
          {all && (
            <div className="pr-foods">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search foods" aria-label="Search foods" />
              <ul>
                {foods.map((f) => {
                  const fav = v.prefs.favs.includes(f.id)
                  return (
                    <li key={f.id}>
                      <button type="button" className="pr-food" onClick={(e) => logFood(f, e.currentTarget)}>
                        <span>{f.emoji}</span>
                        <span className="pr-food-name">
                          {f.name}
                          <small>{f.portion}</small>
                        </span>
                        <b>{f.g} g</b>
                      </button>
                      <button type="button" className={`icon-btn pr-fav${fav ? ' on' : ''}`} aria-pressed={fav} aria-label={fav ? `Remove ${f.name} from favourites` : `Add ${f.name} to favourites`} onClick={async () => after(await act(() => api.prefs({ favs: fav ? v.prefs.favs.filter((x) => x !== f.id) : [f.id, ...v.prefs.favs] })))}>
                        {fav ? '★' : '☆'}
                      </button>
                    </li>
                  )
                })}
              </ul>
              {v.prefs.meals.length > 0 && (
                <div className="pr-saved">
                  <b>Saved meals</b>
                  {v.prefs.meals.map((m) => (
                    <div key={m.id} className="pr-saved-row">
                      <span>
                        🍽️ {m.name} <small className="muted">{mealText(m)} · {mealGrams(m)} g</small>
                      </span>
                      <button type="button" className="btn ghost small" onClick={async () => after(await act(() => api.prefs({ meals: v.prefs.meals.filter((x) => x.id !== m.id) }), `Removed "${m.name}"`))}>
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {v.entries.length > 0 && (
            <ul className="pr-entries" aria-label="Today's protein">
              {v.entries.map((e) => (
                <li key={e.id} className={e.removed ? 'removed' : ''}>
                  <span>{atHm(e.at)}</span>
                  <span>
                    {e.food === 'food' ? '🍽️ Food counter meal' : `${e.emoji} ${e.name}`}
                  </span>
                  <b>{e.g} g</b>
                  <button
                    type="button"
                    className="btn ghost small"
                    onClick={async () => {
                      // A food counter meal is two rows (protein + kcal): both go, or both come back.
                      const meal = e.food === 'food' ? mealOfRow(e.id) : ''
                      if (meal && life.coach?.food) {
                        await act(() => life.coach!.food!.toggle(meal))
                        return after(await api.view())
                      }
                      after(await act(() => api.toggle(e.id)))
                    }}
                  >
                    {e.removed ? 'Undo' : 'Remove'}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="pr-note">{SOURCE_NOTE} Logging food pays no points.</p>
        </>
      )}
    </section>
  )
}

function addItem(list: MealItem[], food: string): MealItem[] {
  const i = list.findIndex((x) => x.food === food)
  if (i < 0) return [...list, { food, qty: 1 }]
  return list.map((x, j) => (j === i ? { ...x, qty: x.qty + 1 } : x))
}
