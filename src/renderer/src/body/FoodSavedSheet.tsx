// The "Edit saved foods" sheet: your saved foods, saved meals and the
// standard day. Everything is edited in a copy and saved at once (cleaned and
// capped by core/foodSaved.ts cleanSaved). Add, change, remove, move up/down.
import { useEffect, useRef, useState } from 'react'
import { FOODS_MAX, ITEMS_MAX, MEALS_MAX, SLOTS_MAX, cleanQty, moveIn, newId, removeFood, stepQty, totalsOf, type DaySlot, type FoodSaved, type SavedFood, type SavedItem, type SavedMeal } from '@core/foodSaved'
import { MEAL_TYPES, type MealType } from '@core/food'
import { life } from '../bridge'
import { useAction } from '../ui'
import { Select } from '../Select'
import type { FoodView } from '../../../main/food'

type Tab = 'meals' | 'day' | 'foods'
const TYPE_LABEL: Record<MealType, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' }
const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s))

export function FoodSavedSheet({ v, onView, onClose }: { v: FoodView; onView: (v: FoodView) => void; onClose: () => void }) {
  const api = life.coach!.food!
  const act = useAction()
  const [s, setS] = useState<FoodSaved>(() => JSON.parse(JSON.stringify(v.saved)))
  const [tab, setTab] = useState<Tab>('meals')
  const card = useRef<HTMLDivElement>(null)
  useEffect(() => {
    card.current?.focus()
  }, [])

  const save = async () => {
    const next = await act(() => api.saved(s), 'Saved foods updated')
    if (next) {
      onView(next)
      onClose()
    }
  }

  // ---- foods ----
  const setFood = (id: string, p: Partial<SavedFood>) => setS({ ...s, foods: s.foods.map((f) => (f.id === id ? { ...f, ...p } : f)) })
  const addFood = () => {
    if (s.foods.length >= FOODS_MAX) return
    const id = newId('sf', `food ${s.foods.length + 1}`, s.foods.map((f) => f.id))
    setS({ ...s, foods: [...s.foods, { id, name: 'New food', portionLabel: '1 portion', grams: 100, kcal: 100, protein: 5, carbs: null, fat: null }] })
  }
  // ---- meals ----
  const setMeal = (id: string, p: Partial<SavedMeal>) => setS({ ...s, meals: s.meals.map((m) => (m.id === id ? { ...m, ...p } : m)) })
  const addMeal = () => {
    if (s.meals.length >= MEALS_MAX || !s.foods.length) return
    const id = newId('sm', `meal ${s.meals.length + 1}`, s.meals.map((m) => m.id))
    setS({ ...s, meals: [...s.meals, { id, name: 'New meal', slot: 'snack', items: [{ foodId: s.foods[0].id, qty: 1 }] }] })
  }
  // ---- day ----
  const setSlot = (id: string, p: Partial<DaySlot>) => setS({ ...s, day: { slots: s.day.slots.map((x) => (x.id === id ? { ...x, ...p } : x)) } })
  const addSlot = () => {
    if (s.day.slots.length >= SLOTS_MAX || !s.foods.length) return
    const id = newId('ds', `slot ${s.day.slots.length + 1}`, s.day.slots.map((x) => x.id))
    setS({ ...s, day: { slots: [...s.day.slots, { id, slot: 'snack', label: 'Snack', items: [{ foodId: s.foods[0].id, qty: 1 }], alternative: null }] } })
  }

  return (
    <div className="sheet fdf-sheet" role="dialog" aria-modal="true" aria-label="Edit saved foods" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="sheet-card fdf-sheet-card" tabIndex={-1} ref={card}>
        <div className="fdf-sheet-head">
          <b>Saved foods and meals</b>
          <div className="bdy-seg" role="radiogroup" aria-label="What to edit">
            {(['meals', 'day', 'foods'] as Tab[]).map((t) => (
              <button key={t} type="button" role="radio" aria-checked={tab === t} onClick={() => setTab(t)} data-tab={t}>
                {t === 'meals' ? 'Meals' : t === 'day' ? 'Standard day' : 'Foods'}
              </button>
            ))}
          </div>
        </div>

        <div className="fdf-sheet-body">
          {tab === 'foods' && (
            <ul className="fdf-edit-list">
              {s.foods.map((f, i) => (
                <li key={f.id} className="fdf-edit-food">
                  <input className="fdf-in-name" value={f.name} maxLength={40} aria-label="Food name" onChange={(e) => setFood(f.id, { name: e.target.value })} />
                  <label>
                    <span>One portion</span>
                    <input value={f.portionLabel} maxLength={30} onChange={(e) => setFood(f.id, { portionLabel: e.target.value })} />
                  </label>
                  <label>
                    <span>Grams</span>
                    <input type="number" inputMode="decimal" value={f.grams ?? ''} onChange={(e) => setFood(f.id, { grams: numOrNull(e.target.value) })} />
                  </label>
                  <label>
                    <span>kcal</span>
                    <input type="number" inputMode="decimal" value={f.kcal} onChange={(e) => setFood(f.id, { kcal: Number(e.target.value) || 0 })} />
                  </label>
                  <label>
                    <span>Protein g</span>
                    <input type="number" inputMode="decimal" value={f.protein} onChange={(e) => setFood(f.id, { protein: Number(e.target.value) || 0 })} />
                  </label>
                  <label>
                    <span>Carbs g</span>
                    <input type="number" inputMode="decimal" value={f.carbs ?? ''} onChange={(e) => setFood(f.id, { carbs: numOrNull(e.target.value) })} />
                  </label>
                  <label>
                    <span>Fat g</span>
                    <input type="number" inputMode="decimal" value={f.fat ?? ''} onChange={(e) => setFood(f.id, { fat: numOrNull(e.target.value) })} />
                  </label>
                  <Order i={i} n={s.foods.length} name={f.name} onMove={(d) => setS({ ...s, foods: moveIn(s.foods, i, d) })} onRemove={() => setS(removeFood(s, f.id))} />
                </li>
              ))}
              <li>
                <button type="button" className="bdy-btn fdf-add" disabled={s.foods.length >= FOODS_MAX} onClick={addFood}>
                  + Add a food
                </button>
              </li>
            </ul>
          )}

          {tab === 'meals' && (
            <ul className="fdf-edit-list">
              {s.meals.map((m, i) => (
                <li key={m.id} className="fdf-edit-meal">
                  <div className="fdf-edit-row">
                    <input className="fdf-in-name" value={m.name} maxLength={60} aria-label="Meal name" onChange={(e) => setMeal(m.id, { name: e.target.value })} />
                    <Select value={m.slot} aria-label="Meal type" onChange={(e) => setMeal(m.id, { slot: e.target.value as MealType })}>
                      {MEAL_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {TYPE_LABEL[t]}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <Items s={s} items={m.items} onChange={(items) => setMeal(m.id, { items })} />
                  <Order i={i} n={s.meals.length} name={m.name} onMove={(d) => setS({ ...s, meals: moveIn(s.meals, i, d) })} onRemove={() => setS({ ...s, meals: s.meals.filter((x) => x.id !== m.id) })} />
                </li>
              ))}
              <li>
                <button type="button" className="bdy-btn fdf-add" disabled={s.meals.length >= MEALS_MAX || !s.foods.length} onClick={addMeal}>
                  + Add a meal
                </button>
              </li>
            </ul>
          )}

          {tab === 'day' && (
            <ul className="fdf-edit-list">
              <li className="bdy-note">Your normal day, slot by slot. "Log my standard day" logs all of it at once. An alternative is the swap you sometimes make.</li>
              {s.day.slots.map((x, i) => (
                <li key={x.id} className="fdf-edit-meal">
                  <div className="fdf-edit-row">
                    <input className="fdf-in-name" value={x.label} maxLength={24} aria-label="Slot name" onChange={(e) => setSlot(x.id, { label: e.target.value })} />
                    <Select value={x.slot} aria-label="Meal type" onChange={(e) => setSlot(x.id, { slot: e.target.value as MealType })}>
                      {MEAL_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {TYPE_LABEL[t]}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <Items s={s} items={x.items} onChange={(items) => setSlot(x.id, { items })} />
                  {x.alternative ? (
                    <div className="fdf-alt">
                      <span className="bdy-eyebrow">Or instead</span>
                      <Items s={s} items={x.alternative} onChange={(alternative) => setSlot(x.id, { alternative: alternative.length ? alternative : null })} />
                    </div>
                  ) : (
                    <button type="button" className="bdy-btn quiet" onClick={() => setSlot(x.id, { alternative: [{ foodId: s.foods[0].id, qty: 1 }] })}>
                      + Add an alternative
                    </button>
                  )}
                  <Order i={i} n={s.day.slots.length} name={x.label} onMove={(d) => setS({ ...s, day: { slots: moveIn(s.day.slots, i, d) } })} onRemove={() => setS({ ...s, day: { slots: s.day.slots.filter((y) => y.id !== x.id) } })} />
                </li>
              ))}
              <li>
                <button type="button" className="bdy-btn fdf-add" disabled={s.day.slots.length >= SLOTS_MAX || !s.foods.length} onClick={addSlot}>
                  + Add a slot
                </button>
              </li>
              <li className="bdy-note num">
                The whole day: {totalsOf(s, s.day.slots.flatMap((x) => x.items)).kcal.toLocaleString('en-US')} kcal · {totalsOf(s, s.day.slots.flatMap((x) => x.items)).protein} g protein
              </li>
            </ul>
          )}
        </div>

        <div className="sheet-actions">
          <button type="button" className="bdy-btn quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="bdy-btn primary fdf-sheet-save" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

/** Move up / down and remove, for one entry of a list. */
function Order({ i, n, name, onMove, onRemove }: { i: number; n: number; name: string; onMove: (d: -1 | 1) => void; onRemove: () => void }) {
  return (
    <span className="fdf-order">
      <button type="button" className="fdf-step-btn" aria-label={`Move ${name} up`} disabled={i === 0} onClick={() => onMove(-1)}>
        ↑
      </button>
      <button type="button" className="fdf-step-btn" aria-label={`Move ${name} down`} disabled={i === n - 1} onClick={() => onMove(1)}>
        ↓
      </button>
      <button type="button" className="bdy-btn quiet fdf-del" onClick={onRemove}>
        Remove
      </button>
    </span>
  )
}

/** The foods of a meal or slot: pick a food, −/+ its portions, remove, add one. */
function Items({ s, items, onChange }: { s: FoodSaved; items: SavedItem[]; onChange: (items: SavedItem[]) => void }) {
  const set = (i: number, p: Partial<SavedItem>) => onChange(items.map((x, j) => (j === i ? { ...x, ...p } : x)))
  const t = totalsOf(s, items)
  return (
    <div className="fdf-items">
      {items.map((x, i) => (
        <div key={i} className="fdf-item-row">
          <Select value={x.foodId} aria-label="Food" onChange={(e) => set(i, { foodId: e.target.value })}>
            {s.foods.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} ({f.portionLabel})
              </option>
            ))}
          </Select>
          <span className="fdf-step small">
            <button type="button" className="fdf-step-btn" aria-label="Fewer" disabled={x.qty <= 0.5} onClick={() => set(i, { qty: stepQty(x.qty, -1) })}>
              −
            </button>
            <b className="num">×{cleanQty(x.qty)}</b>
            <button type="button" className="fdf-step-btn" aria-label="More" onClick={() => set(i, { qty: stepQty(x.qty, 1) })}>
              +
            </button>
          </span>
          <button type="button" className="fdf-x" aria-label="Remove this food" onClick={() => onChange(items.filter((_, j) => j !== i))}>
            ×
          </button>
        </div>
      ))}
      <div className="fdf-items-foot">
        {items.length < ITEMS_MAX && s.foods.length > 0 && (
          <button type="button" className="bdy-btn quiet" onClick={() => onChange([...items, { foodId: s.foods[0].id, qty: 1 }])}>
            + Add a food
          </button>
        )}
        <small className="num bdy-note">
          {t.kcal.toLocaleString('en-US')} kcal · {t.protein} g protein
        </small>
      </div>
    </div>
  )
}
