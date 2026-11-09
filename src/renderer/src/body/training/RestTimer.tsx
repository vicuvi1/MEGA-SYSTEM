// The rest timer between sets: big, 60 or 90 seconds, +15 and Skip. At zero it
// plays the app's "focus end" sound (Life's sound kit, your sound settings)
// and buzzes a phone that allows it. Ends by itself; nothing is saved.
import { useEffect, useRef, useState } from 'react'
import { buzz, play } from '../../soundKit'

export function RestTimer({ endsAt, total, rest, onRest, onAdd, onSkip }: { endsAt: number; total: number; rest: 60 | 90; onRest: (s: 60 | 90) => void; onAdd: () => void; onSkip: () => void }) {
  const [now, setNow] = useState(() => Date.now())
  const rang = useRef(false)
  useEffect(() => {
    rang.current = false
    const t = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(t)
  }, [endsAt])
  const left = Math.max(0, Math.ceil((endsAt - now) / 1000))
  useEffect(() => {
    if (left > 0 || rang.current) return
    rang.current = true
    try {
      play('focusEnd')
      buzz([180, 90, 180])
    } catch {
      /* sound is a nicety */
    }
    const t = window.setTimeout(onSkip, 2500)
    return () => window.clearTimeout(t)
  }, [left, onSkip])
  const pct = total ? left / total : 0
  const r = 34
  const c = 2 * Math.PI * r
  return (
    <div className={`tr-rest${left === 0 ? ' over' : ''}`} role="timer" aria-live="polite" aria-label={left ? `Rest: ${left} seconds left` : 'Rest over: next set'} data-tr="rest">
      <svg width="84" height="84" viewBox="0 0 84 84" aria-hidden>
        <circle cx="42" cy="42" r={r} className="tr-rest-bg" />
        <circle cx="42" cy="42" r={r} className="tr-rest-fg" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} transform="rotate(-90 42 42)" />
      </svg>
      <div className="tr-rest-text">
        <small>{left ? 'Rest' : 'Go'}</small>
        <b data-tr="rest-left">{left ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'Next set'}</b>
      </div>
      <div className="tr-rest-actions">
        <div className="bdy-seg" role="radiogroup" aria-label="Rest length">
          {([60, 90] as const).map((s) => (
            <button key={s} type="button" role="radio" aria-checked={rest === s} onClick={() => onRest(s)}>
              {s} s
            </button>
          ))}
        </div>
        <button type="button" className="bdy-btn quiet" onClick={onAdd}>
          +15 s
        </button>
        <button type="button" className="bdy-btn" onClick={onSkip} data-tr="rest-skip">
          Skip
        </button>
      </div>
    </div>
  )
}
