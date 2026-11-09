// One-tap food logging (Body → Food, top of the card). The big bars show the
// day at a glance; "Your meals" logs a saved meal with one tap (Undo in the
// toast, amounts changeable before or right after); "Log my standard day"
// logs every slot and then shows the day as a checklist to fix; saved foods
// are quick chips (+1 egg). Every tap is a normal food-counter meal (no
// second store) and pays no points. Pure parts: core/foodSaved.ts,
// core/foodProgress.ts.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { itemsOf, itemsText, setQty, slotItems, stepQty, totalsOf, type SavedItem } from '@core/foodSaved'
import type { FoodItem, MealType } from '@core/food'
import type { DayProgress, ProteinBehind } from '@core/foodProgress'
import { life } from '../bridge'
import { useAction, useToast } from '../ui'
import type { FoodView } from '../../../main/food'
import './food-fast.css'

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
const qtyText = (q: number) => (q === 0.5 ? '½' : Number.isInteger(q) ? String(q) : `${Math.floor(q)}½`)

/** A small picture for each meal type (drawn here, no icon font). */
export function SlotIcon({ slot }: { slot: MealType }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  return (
    <svg className="fdf-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      {slot === 'breakfast' && (
        <>
          <path {...p} d="M4 17h16M7 17a5 5 0 0 1 10 0M12 6v3M5.6 9.6l1.6 1.6M18.4 9.6l-1.6 1.6" />
        </>
      )}
      {slot === 'lunch' && (
        <>
          <circle {...p} cx="12" cy="12" r="4" />
          <path {...p} d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
        </>
      )}
      {slot === 'dinner' && <path {...p} d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5Z" />}
      {slot === 'snack' && (
        <>
          <path {...p} d="M12 8c-3-2-7 0-7 4.5S8 21 12 19c4 2 7-2 7-6.5S15 6 12 8Z" />
          <path {...p} d="M12 8c0-2 1-3.5 3-4" />
        </>
      )}
    </svg>
  )
}

// ---------------------------------------------------------------- the big bars

/** "1,900 / 2,700 kcal" and "90 / 130 g protein", "800 kcal · 40 g left", and the protein hint. */
export function FoodBars({ progress, behind, compact = false }: { progress: DayProgress; behind?: ProteinBehind | null; compact?: boolean }) {
  const p = progress
  return (
    <span className={`fdf-bars${compact ? ' compact' : ''}`}>
      <span className="fdf-bar-row fdf-kcal">
        <span className="fdf-bar-label">
          <b className="num">{p.kcalLine.replace(' kcal', '')}</b> <span>kcal</span>
        </span>
        <span className="bdy-bar" role="progressbar" aria-label="kcal today" aria-valuemin={0} aria-valuemax={p.kcal.goal} aria-valuenow={p.kcal.eaten}>
          <i style={{ ['--p' as string]: p.kcal.frac }} />
        </span>
      </span>
      <span className={`fdf-bar-row fdf-protein${behind?.behind ? ' behind' : ''}`}>
        <span className="fdf-bar-label">
          <b className="num">{p.proteinLine.replace(' g protein', '')}</b> <span>g protein</span>
        </span>
        <span className="bdy-bar" role="progressbar" aria-label="Protein today" aria-valuemin={0} aria-valuemax={p.protein.goal} aria-valuenow={p.protein.eaten}>
          <i style={{ ['--p' as string]: p.protein.frac }} />
        </span>
      </span>
      <span className="fdf-left" aria-live="polite">
        {p.leftLine}
      </span>
      {behind?.behind && (
        <span className="fdf-behind" role="status">
          {behind.hint}
        </span>
      )}
    </span>
  )
}

// ---------------------------------------------------------------- the amounts panel

interface QtyRow {
  key: string
  name: string
  unit: string
  qty: number
  /** kcal and protein of ONE portion. */
  kcal: number
  protein: number
}

/** −/+ for each food, then one button. Esc closes. */
function QtyPanel({ title, rows, confirm, onConfirm, onCancel }: { title: string; rows: QtyRow[]; confirm: string; onConfirm: (qty: number[]) => void; onCancel: () => void }) {
  const [qty, setQtyList] = useState(rows.map((r) => r.qty))
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>('button')?.focus()
  }, [])
  const total = rows.reduce((a, r, i) => ({ kcal: a.kcal + r.kcal * qty[i], protein: a.protein + r.protein * qty[i] }), { kcal: 0, protein: 0 })
  const key = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
  return (
    <div className="fdf-qty" role="group" aria-label={title} ref={box} onKeyDown={key}>
      <b className="fdf-qty-title">{title}</b>
      <ul>
        {rows.map((r, i) => (
          <li key={r.key}>
            <span className="fdf-qty-name">
              {r.name}
              <small>{r.unit}</small>
            </span>
            <span className="fdf-step">
              <button type="button" className="fdf-step-btn fdf-less" aria-label={`Less ${r.name}`} disabled={qty[i] <= 0.5} onClick={() => setQtyList(qty.map((q, j) => (j === i ? stepQty(q, -1) : q)))}>
                −
              </button>
              <b className="num" aria-live="polite">
                ×{qtyText(qty[i])}
              </b>
              <button type="button" className="fdf-step-btn fdf-more-btn" aria-label={`More ${r.name}`} onClick={() => setQtyList(qty.map((q, j) => (j === i ? stepQty(q, 1) : q)))}>
                +
              </button>
            </span>
          </li>
        ))}
      </ul>
      <div className="fdf-qty-foot">
        <span className="num">
          {fmt(total.kcal)} kcal · {Math.round(total.protein)} g protein
        </span>
        <button type="button" className="bdy-btn quiet" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="bdy-btn primary fdf-qty-go" onClick={() => onConfirm(qty)}>
          {confirm}
        </button>
      </div>
    </div>
  )
}

const rowsOfItems = (items: FoodItem[]): QtyRow[] =>
  items.map((it, i) => {
    const q = it.qty && it.qty > 0 ? it.qty : 1
    return { key: `${i}-${it.name}`, name: it.name, unit: it.unit ?? `${Math.round(it.grams / q)} g`, qty: q, kcal: it.kcal / q, protein: it.protein / q }
  })

// ---------------------------------------------------------------- quick log

type Panel = { kind: 'before'; mealId: string } | { kind: 'after'; loggedId: string } | null

/** Your meals, the standard day, the checklist and the saved food chips. */
export function QuickLog({ v, onView, onManage }: { v: FoodView; onView: (v: FoodView) => void; onManage: () => void }) {
  const api = life.coach!.food!
  const act = useAction()
  const toast = useToast()
  const [panel, setPanel] = useState<Panel>(null)
  const [last, setLast] = useState<{ ids: string[]; label: string } | null>(null)
  const [checkOpen, setCheckOpen] = useState(false)
  const s = v.saved

  /** Logs, then an Undo toast that takes back exactly what was logged. */
  const logged = (r: { view: FoodView; ids: string[] } | undefined, label: string) => {
    if (!r) return
    onView(r.view)
    if (!r.ids.length) return
    setLast({ ids: r.ids, label })
    toast(`Logged: ${label}`, 'good', {
      label: 'Undo',
      run: () => {
        void act(() => api.undo(r.ids)).then((view) => view && onView(view))
        setLast(null)
      }
    })
  }
  const logMeal = async (id: string, qty?: Record<string, number>) => {
    const m = s.meals.find((x) => x.id === id)
    setPanel(null)
    logged(await act(() => api.logMeal(id, qty ?? null)), m?.name ?? 'Meal')
  }
  const logFood = async (id: string) => {
    const f = s.foods.find((x) => x.id === id)
    logged(await act(() => api.logFood(id, 1)), f?.name ?? 'Food')
  }
  const logDay = async () => {
    const r = await act(() => api.logDay({}))
    logged(r, 'your standard day')
    if (r?.ids.length) setCheckOpen(true)
  }

  // Today's standard-day meals (each remembers its slot), for the checklist.
  const today = v.day === v.today
  const dayMeals = today ? v.meals.filter((m) => m.slot && !m.removed) : []
  const dayLogged = dayMeals.length > 0
  const lastMeal = last && last.ids.length === 1 ? v.meals.find((m) => m.id === last.ids[0] && !m.removed) : null

  const editItems = async (mealId: string, items: FoodItem[], name?: string) => {
    const m = v.meals.find((x) => x.id === mealId)
    if (!m) return
    const next = items.length ? await act(() => api.edit(mealId, { items, name: name ?? m.name, type: m.type })) : await act(() => api.toggle(mealId))
    if (next) onView(next)
  }

  const beforeMeal = panel?.kind === 'before' ? s.meals.find((m) => m.id === panel.mealId) : null
  const afterMeal = panel?.kind === 'after' ? v.meals.find((m) => m.id === panel.loggedId) : null

  if (!today) return null
  return (
    <div className="fdf-quick">
      {s.day.slots.length > 0 && (
        <div className="fdf-day">
          {!dayLogged ? (
            <button type="button" className="bdy-btn primary big fdf-day-go" onClick={logDay}>
              Log my standard day
              <small className="num">
                {fmt(v.standard.kcal)} kcal · {v.standard.protein} g
              </small>
            </button>
          ) : (
            <div className="fdf-day-done">
              <span>
                <b>Standard day logged.</b> Fix anything you did not eat.
              </span>
              <button type="button" className="bdy-btn fdf-check-toggle" aria-expanded={checkOpen} onClick={() => setCheckOpen(!checkOpen)}>
                {checkOpen ? 'Done' : 'Edit the day'}
              </button>
            </div>
          )}
          {dayLogged && checkOpen && (
            <ul className="fdf-check" aria-label="Today's standard day">
              {dayMeals.map((m) => {
                const slot = s.day.slots.find((x) => x.id === m.slot)
                const alt = slot?.alternative ? slotItems(slot, 'alt') : null
                const onAlt = !!alt && itemsText(s, alt) === m.items.map((it) => (it.qty && it.qty !== 1 ? `${it.qty} × ${it.name}` : it.name)).join(' + ')
                return (
                  <li key={m.id} className="fdf-check-slot" data-slot={m.slot}>
                    <div className="fdf-check-head">
                      <SlotIcon slot={m.type} />
                      <b>{slot?.label ?? m.name}</b>
                      <small className="num">
                        {fmt(m.totals.kcal)} kcal · {m.totals.protein} g
                      </small>
                      {slot && alt && (
                        <button
                          type="button"
                          className="bdy-chip fdf-swap"
                          onClick={() => editItems(m.id, itemsOf(s, onAlt ? slot.items : alt), `${slot.label}: ${itemsText(s, onAlt ? slot.items : alt)}`.slice(0, 60))}
                        >
                          Swap to {itemsText(s, onAlt ? slot.items : alt)}
                        </button>
                      )}
                    </div>
                    <ul className="fdf-check-items">
                      {m.items.map((it, i) => (
                        <li key={`${i}-${it.name}`}>
                          <span className="fdf-check-name">{it.name}</span>
                          <span className="fdf-step small">
                            <button type="button" className="fdf-step-btn" aria-label={`Less ${it.name}`} disabled={(it.qty ?? 1) <= 0.5} onClick={() => editItems(m.id, m.items.map((x, j) => (j === i ? setQty(x, stepQty(x.qty ?? 1, -1)) : x)))}>
                              −
                            </button>
                            <b className="num">×{qtyText(it.qty ?? 1)}</b>
                            <button type="button" className="fdf-step-btn" aria-label={`More ${it.name}`} onClick={() => editItems(m.id, m.items.map((x, j) => (j === i ? setQty(x, stepQty(x.qty ?? 1, 1)) : x)))}>
                              +
                            </button>
                          </span>
                          <small className="num fdf-check-kcal">{fmt(it.kcal)} kcal</small>
                          <button type="button" className="fdf-x" aria-label={`Remove ${it.name}`} onClick={() => editItems(m.id, m.items.filter((_, j) => j !== i))}>
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  </li>
                )
              })}
              <li className="fdf-check-again">
                <button type="button" className="bdy-btn quiet" onClick={logDay}>
                  Log the whole day again
                </button>
              </li>
            </ul>
          )}
        </div>
      )}

      <div className="fdf-sec-head">
        <span className="bdy-eyebrow">Your meals</span>
        <button type="button" className="bdy-btn quiet fdf-manage" onClick={onManage}>
          Edit saved foods
        </button>
      </div>
      {s.meals.length ? (
        <div className="fdf-tiles" role="list" aria-label="Your meals: tap to log">
          {s.meals.map((m) => {
            const t = totalsOf(s, m.items)
            return (
              <div key={m.id} className="fdf-tile-wrap" role="listitem">
                <button type="button" className="fdf-tile" data-meal={m.id} onClick={() => logMeal(m.id)} aria-label={`Log ${m.name}: ${t.kcal} kcal, ${t.protein} g protein`}>
                  <span className="fdf-tile-icon">
                    <SlotIcon slot={m.slot} />
                  </span>
                  <span className="fdf-tile-name">{m.name}</span>
                  <span className="fdf-tile-num num">
                    {fmt(t.kcal)} kcal · {t.protein} g
                  </span>
                </button>
                <button type="button" className="fdf-tile-adj" aria-label={`Change amounts, then log ${m.name}`} title="Change amounts first" onClick={() => setPanel({ kind: 'before', mealId: m.id })}>
                  ±
                </button>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="bdy-note">No saved meals yet. Add one with "Edit saved foods", or log a meal and tap "Save as meal".</p>
      )}

      {beforeMeal && (
        <QtyPanel
          title={`${beforeMeal.name}: change amounts`}
          rows={rowsOfItems(itemsOf(s, beforeMeal.items))}
          confirm="Log it"
          onCancel={() => setPanel(null)}
          onConfirm={(qty) => {
            const over: Record<string, number> = {}
            beforeMeal.items.forEach((x: SavedItem, i) => (over[x.foodId] = qty[i]))
            void logMeal(beforeMeal.id, over)
          }}
        />
      )}

      {lastMeal && !panel && (
        <div className="fdf-last" role="status">
          <span>
            Logged <b>{lastMeal.name}</b> · {fmt(lastMeal.totals.kcal)} kcal · {lastMeal.totals.protein} g
          </span>
          <button type="button" className="bdy-btn quiet fdf-last-adj" onClick={() => setPanel({ kind: 'after', loggedId: lastMeal.id })}>
            Change amounts
          </button>
        </div>
      )}
      {afterMeal && (
        <QtyPanel
          title={`${afterMeal.name}: fix amounts`}
          rows={rowsOfItems(afterMeal.items)}
          confirm="Save"
          onCancel={() => setPanel(null)}
          onConfirm={async (qty) => {
            setPanel(null)
            const items = afterMeal.items.map((it, i) => setQty(it, qty[i]))
            const next = await act(() => api.edit(afterMeal.id, { items, name: afterMeal.name, type: afterMeal.type }), 'Amounts changed')
            if (next) {
              onView(next)
              setLast(null)
            }
          }}
        />
      )}

      {s.foods.length > 0 && (
        <div className="fdf-chips" role="list" aria-label="Add one food">
          {s.foods.map((f) => (
            <span role="listitem" key={f.id}>
              <button type="button" className="bdy-chip fdf-chip" data-food={f.id} onClick={() => logFood(f.id)} aria-label={`Add ${f.portionLabel} ${f.name}: ${f.kcal} kcal`}>
                + {f.name} <small className="num">{f.kcal}</small>
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
