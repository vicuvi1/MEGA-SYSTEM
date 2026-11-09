// Earnings graph (RG3): 30 days of points earned (stacked by where they came
// from) above the line and spent below it, the best day, and this week
// against last. Plain SVG; the bars grow in once (scaleY) when first seen.
import { useState } from 'react'
import { dayLabel } from '@core/dates'
import { SOURCES, type Earnings, type SourceId } from '@core/rewardsKit'
import { useSeen } from '../motionKit'

export function EarnChart({ e }: { e: Earnings }) {
  const [ref, seen] = useSeen<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const W = 300
  const H = 84
  const base = 58
  // One scale for both, so a spend looks as big as the same points earned.
  const perPt = (base - 6) / Math.max(10, ...e.days.map((d) => d.total))
  const up = (v: number) => v * perPt
  const down = (v: number) => Math.min(H - base - 4, v * perPt)
  const bw = W / e.days.length
  const diff = e.thisWeek.earned - e.lastWeek.earned
  const pct = e.lastWeek.earned > 0 ? Math.round((diff / e.lastWeek.earned) * 100) : null
  const h = hover != null ? e.days[hover] : null

  return (
    <div className={`rx-chart ${seen ? 'seen' : ''}`} ref={ref}>
      <div className="rx-chart-stats">
        <div>
          <span className="rx-kicker">This week</span>
          <b className="num">+{e.thisWeek.earned.toLocaleString()}</b>
          <small className={diff >= 0 ? 'up' : 'down'}>
            {pct == null ? (e.lastWeek.earned ? '' : 'first week') : `${diff >= 0 ? '↑' : '↓'} ${Math.abs(pct)}% vs last week`}
          </small>
        </div>
        <div>
          <span className="rx-kicker">Best day</span>
          <b className="num">{e.best ? `+${e.best.total}` : '—'}</b>
          <small>{e.best ? dayLabel(e.best.day) : 'not yet'}</small>
        </div>
        <div>
          <span className="rx-kicker">30 days</span>
          <b className="num">+{e.earned.toLocaleString()}</b>
          <small>spent {e.spent.toLocaleString()}</small>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="rx-chart-svg" role="img" aria-label={`Points earned and spent over 30 days: ${e.earned} earned, ${e.spent} spent`} onPointerLeave={() => setHover(null)}>
        <line x1="0" x2={W} y1={base + 0.5} y2={base + 0.5} className="axis" />
        {e.days.map((d, i) => {
          let y = base
          const x = i * bw + bw * 0.18
          const w = bw * 0.64
          return (
            <g key={d.day} className={`col ${hover === i ? 'hot' : ''} ${e.best?.day === d.day ? 'best' : ''}`} style={{ '--i': i } as React.CSSProperties} onPointerEnter={() => setHover(i)}>
              <rect x={i * bw} y="0" width={bw} height={H} className="hit" />
              <g className="upbars">
                {SOURCES.map((s) => {
                  const v = d.earned[s.id as SourceId]
                  if (!v) return null
                  const hh = Math.max(1.5, up(v))
                  y -= hh
                  return <rect key={s.id} x={x} y={y} width={w} height={hh} rx="1.2" fill={s.color} />
                })}
              </g>
              {d.spent > 0 && <rect className="spent" x={x} y={base + 2} width={w} height={Math.max(1.5, down(d.spent))} rx="1.2" />}
            </g>
          )
        })}
      </svg>
      <div className="rx-chart-foot">
        {h ? (
          <span className="rx-chart-tip">
            <b>{dayLabel(h.day)}</b> +{h.total} earned{h.spent ? ` · ${h.spent} spent` : ''}
          </span>
        ) : (
          <span className="rx-legend">
            {SOURCES.map((s) => (
              <i key={s.id} style={{ '--c': s.color } as React.CSSProperties}>
                {s.label}
              </i>
            ))}
            <i className="spent">Spent</i>
          </span>
        )}
      </div>
    </div>
  )
}
