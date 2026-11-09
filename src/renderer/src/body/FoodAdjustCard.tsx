// The ONE calorie suggestion card (core/foodAdjust.ts via main/food.ts
// adjustNow). The same component and the same data on Body → Food and on
// Body → Progress, so food and body never disagree. Calm: no red, plain words,
// labeled as an estimate from weekly averages. Accept changes the kcal goal
// (bounded) and records the change in the history shown in Goals. No points.
import { useEffect, useState } from 'react'
import { adjLogLine } from '@core/foodAdjust'
import { life } from '../bridge'
import { useAction } from '../ui'
import type { FoodView } from '../../../main/food'
import './food-fast.css'

const EVENTS = ['life-body-changed', 'life-external-changed']
const fmt = (n: number) => Math.round(n).toLocaleString('en-US')

/**
 * `view` and `onView` when the parent already has the food view (the food
 * counter); without them the card loads its own (Progress).
 */
export function FoodAdjustCard({ view, onView, day, where }: { view?: FoodView | null; onView?: (v: FoodView) => void; day?: string; where: 'food' | 'progress' }) {
  const api = life.coach?.food
  const act = useAction()
  const [own, setOwn] = useState<FoodView | null>(null)
  const controlled = view !== undefined
  useEffect(() => {
    if (controlled || !api) return
    const load = () => api.view().then(setOwn).catch(() => {})
    load()
    for (const e of EVENTS) window.addEventListener(e, load)
    return () => {
      for (const e of EVENTS) window.removeEventListener(e, load)
    }
  }, [api, controlled])
  const v = controlled ? view : own
  if (!api || !v?.adjust) return null
  const set = (next: FoodView | null | undefined) => {
    if (!next) return
    if (onView) onView(next)
    if (!controlled) setOwn(next)
  }
  const a = v.adjust
  const last = v.goals.adjLog?.[0]
  const sug = a.state === 'suggest' ? a.suggestion : null
  const goal = sug ? v.totals.targets.kcal + sug.delta : 0
  return (
    <section className={`fd-week-check fd-adjust-card${sug ? ' suggest' : ''}`} data-where={where} data-kind={a.state === 'suggest' ? 'suggest' : a.kind} role="status" aria-label="Weekly calorie check">
      <span className="fd-adjust-head">
        <small className="fd-adjust-label">Weekly calorie check</small>
        <b className="fd-adjust-title">{a.title}</b>
      </span>
      <small className="fd-adjust-why">{a.why}</small>
      {sug && (
        <>
          <small>
            <b>Idea:</b> {sug.tip}
          </small>
          <div className="fd-row">
            <button type="button" className="bdy-btn primary fd-adjust-apply" onClick={async () => set(await act(() => api.adjust(true, day), `Goal changed to ${fmt(goal)} kcal`))}>
              Accept ({sug.delta > 0 ? '+' : '−'}
              {Math.abs(sug.delta)} kcal)
            </button>
            <button type="button" className="bdy-btn quiet fd-adjust-later" onClick={async () => set(await act(() => api.adjust(false, day), 'Okay, I will check again next week'))}>
              Not now
            </button>
          </div>
        </>
      )}
      {last && <small className="fd-adjust-last">Last change: {adjLogLine(last)}</small>}
      <small className="fd-adjust-note">Estimate from weekly average weight (3+ morning weigh-ins a week). Target +0.25–0.5 kg a week.</small>
    </section>
  )
}
