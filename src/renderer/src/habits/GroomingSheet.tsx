// BD15: the grooming habit's checklist (the Grooming tile on Today opens it).
// Morning and night steps (SPF only on a sunny day, from the weather plugin
// when it is on), nails every week and a haircut every 3–5 weeks. The habit
// pays once, when every step of the day is ticked (core/grooming.ts).
import { useCallback, useEffect, useState } from 'react'
import type { GroomView } from '@core/grooming'
import { sunnyDay } from '@core/grooming'
import { life } from '../bridge'
import { useAction } from '../ui'
import { coinsShownNow } from '../useSimple'
import { play } from '../soundKit'
import { weatherToday } from '../widgets/widgetsFeed'
import { SheetFrame } from './HabitBoard'

export const GROOMING_OPEN = 'life-grooming-open'

/** Today's grooming (for the tile's "3 of 7"), live. */
export function useGrooming(): GroomView | null {
  const [v, setV] = useState<GroomView | null>(null)
  const load = useCallback(() => {
    if (!life.care) return
    weatherToday(Date.now())
      .catch(() => null)
      .then((w) => life.care!.groom(sunnyDay(w)))
      .then(setV)
      .catch(() => {})
  }, [])
  useEffect(() => {
    load()
    const evs = ['life-habits-changed', 'life-care-changed', 'life-wallet-changed']
    for (const e of evs) window.addEventListener(e, load)
    return () => {
      for (const e of evs) window.removeEventListener(e, load)
    }
  }, [load])
  return v
}

export function GroomingSheet({ onClose, onChange }: { onClose: () => void; onChange: () => void }) {
  const act = useAction()
  const [v, setV] = useState<GroomView | null>(null)
  const [sunny, setSunny] = useState<boolean | null>(null)
  useEffect(() => {
    weatherToday(Date.now())
      .catch(() => null)
      .then((w) => {
        const s = sunnyDay(w)
        setSunny(s)
        return life.care?.groom(s)
      })
      .then((x) => x && setV(x))
      .catch(() => {})
  }, [])
  const tick = async (id: string, on: boolean) => {
    const r = await act(() => life.care!.groomStep(id, on, sunny), (x) => (x.coins ? `Grooming done today${coinsShownNow() ? ` · +${x.coins}` : ''}` : ''))
    if (!r) return
    setV(r)
    if (r.coins) {
      try {
        play('habit', { step: 3 })
      } catch {
        /* no sound is fine */
      }
    }
    onChange()
  }
  const weekly = async (id: 'nails' | 'haircut', done: boolean) => {
    const r = await act(() => life.care!.groomWeekly(id, done, sunny), done ? `${id === 'nails' ? 'Nails' : 'Haircut'}: done today` : '')
    if (r) setV(r)
  }
  const rhythm = async (weeks: number) => {
    const r = await act(() => life.care!.groomRhythm(weeks, sunny))
    if (r) setV(r)
  }
  const part = (title: string, steps: GroomView['day']['morning']) => (
    <fieldset className="gr-part">
      <legend>{title}</legend>
      {steps.map((s) => (
        <button type="button" key={s.id} role="checkbox" aria-checked={s.done} className={`gr-step ${s.done ? 'on' : ''}`} onClick={() => void tick(s.id, !s.done)}>
          <i aria-hidden>{s.done ? '✓' : ''}</i>
          <span>{s.label}</span>
          {s.optional && <small>if sunny</small>}
          {s.sunny && !s.optional && <small>sunny today</small>}
        </button>
      ))}
    </fieldset>
  )
  return (
    <SheetFrame title="Grooming" label="Grooming checklist" onClose={onClose}>
      {!v ? (
        <p className="hint">Loading…</p>
      ) : (
        <div className="gr">
          <p className={`gr-sum ${v.day.complete ? 'done' : ''}`}>
            {v.day.complete ? `All done today${v.paid ? ` · +${v.paid} paid` : ''}.` : `${v.day.done} of ${v.day.total} steps. The habit pays once every step is ticked.`}
          </p>
          <div className="gr-parts">
            {part('Morning', v.day.morning)}
            {part('Night', v.day.night)}
          </div>
          <fieldset className="gr-part gr-weekly">
            <legend>Weekly</legend>
            {v.weekly.map((w) => (
              <div key={w.id} className={`gr-week s-${w.state}`}>
                <span>
                  <b>{w.label}</b>
                  <small>{w.text}</small>
                </span>
                <button type="button" className="btn small" onClick={() => void weekly(w.id, true)}>
                  ✓ Done today
                </button>
              </div>
            ))}
            <label className="gr-rhythm">
              Haircut every
              <span role="group" aria-label="Weeks between haircuts">
                {[3, 4, 5].map((n) => (
                  <button type="button" key={n} className={v.grooming.haircutWeeks === n ? 'on' : ''} aria-pressed={v.grooming.haircutWeeks === n} onClick={() => void rhythm(n)}>
                    {n} weeks
                  </button>
                ))}
              </span>
            </label>
          </fieldset>
        </div>
      )}
    </SheetFrame>
  )
}
