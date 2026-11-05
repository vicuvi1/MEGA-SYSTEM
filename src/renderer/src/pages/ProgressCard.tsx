// The week score ring and the short Insights card on Today. Kept apart from
// the Insights page so Today doesn't pull the whole page in with it.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProgressReport } from '@core/progress'
import { life } from '../bridge'
import { Icon } from '../Icon'
import { useCountUp as useCountUpShared } from '../motionKit'
import { shouldPlan, useWeekPlan } from '../WeekPlanner'

export function useProgress(): ProgressReport | null | undefined {
  const [r, setR] = useState<ProgressReport | null | undefined>(undefined)
  const load = useCallback(() => {
    if (!life.progress) return setR(null)
    life.progress.report().then(setR).catch(() => setR(null))
  }, [])
  useEffect(() => {
    load()
    const evs = ['life-wallet-changed', 'life-focus-changed', 'life-discipline-changed', 'life-body-changed']
    for (const n of evs) window.addEventListener(n, load)
    return () => {
      for (const n of evs) window.removeEventListener(n, load)
    }
  }, [load])
  return r
}

/**
 * A number that glides to its new value when it changes (the shared AF7
 * count). The first value shows as it is: the page is final on its first draw.
 */
export const useCountUp = (to: number) => useCountUpShared(to, 400)

/** True one frame after mount: CSS transitions then run from their start state. */
export function useShown(): boolean {
  const [on, setOn] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setOn(true))
    return () => cancelAnimationFrame(id)
  }, [])
  return on
}

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const weekday = (day: string) => WD[new Date(`${day}T12:00:00Z`).getUTCDay()]

export function ScoreRing({ score, size = 132 }: { score: number; size?: number }) {
  const shown = useShown()
  const n = useCountUp(score)
  const r = size / 2 - 9
  const c = 2 * Math.PI * r
  return (
    <div className="pg-ring" style={{ width: size, height: size }} role="img" aria-label={`Week score ${score} out of 100`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} className="pg-ring-bg" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          className="pg-ring-fg"
          strokeDasharray={c}
          strokeDashoffset={shown ? c * (1 - score / 100) : c}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="pg-ring-num">
        <b>{Math.round(n)}</b>
        <span>of 100</span>
      </div>
    </div>
  )
}

/** The short version on Today: the score, the verdict and one chip per area. */
export function ProgressCard({ onOpen }: { onOpen: () => void }) {
  const r = useProgress()
  const [plan] = useWeekPlan()
  if (!r) return null
  const sunday = new Date(`${r.to}T12:00:00Z`).getUTCDay() === 0
  return (
    <section className="panel pg-mini">
      <ScoreRing score={r.score} size={76} />
      <div className="pg-mini-body">
        <header className="pg-mini-head">
          <h3>
            <Icon name="chart" size={16} /> This week
          </h3>
          {sunday && plan !== undefined && shouldPlan(plan, r.to) ? (
            <button className="btn small primary" onClick={onOpen}>
              Plan your week
            </button>
          ) : (
            <button className="btn small ghost" onClick={onOpen}>
              See all
            </button>
          )}
        </header>
        <p className="pg-verdict">{r.verdict}</p>
        <div className="pg-chips">
          {r.metrics.map((m) => (
            <span key={m.id} className={`pg-chip ${m.trend}`} title={`${m.label}: ${m.text} (last week: ${m.prevText})`}>
              {m.trend === 'better' ? '▲' : m.trend === 'worse' ? '▼' : '•'} {m.label} <b>{m.text}</b>
            </span>
          ))}
          {r.savingStreak && r.savingStreak.days > 0 && (
            <span className="pg-chip better" title={r.savingStreak.next ? `${r.savingStreak.next.days} days in a row pays +${r.savingStreak.next.points}` : 'Days in a row under your daily budget'}>
              Under budget <b>{r.savingStreak.days} day{r.savingStreak.days === 1 ? '' : 's'} in a row</b>
            </span>
          )}
        </div>
      </div>
    </section>
  )
}
