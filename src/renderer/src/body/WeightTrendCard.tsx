// BD2: the lean-bulk weight trend. Dots are the morning weigh-ins, the line
// is the 7-day average, the shaded band is a lean-bulk pace (+0.25–0.5 % of
// body weight a month) from where the trend stood 4 weeks ago. Ben's nudge
// sits under it: "add about 200 kcal", "hold steady" or "ease off".
import type { WeightTrend } from '@core/weightTrend'
import { roughKcal } from '@core/weightTrend'
import { addDays, daysBetween } from '@core/dates'

export function WeightTrendCard({ trend, today, onLog }: { trend: WeightTrend; today: string; onLog?: () => void }) {
  const pts = trend.points.filter((p) => p.day > addDays(today, -42))
  const W = 560
  const H = 170
  const pad = { l: 36, r: 10, t: 12, b: 22 }
  const start = pts[0]?.day ?? addDays(today, -41)
  const span = Math.max(14, daysBetween(start, today))
  // The band: from the trend 28 days ago (or the first point), growing at the lean-bulk pace.
  const anchor = pts.find((p) => p.day >= addDays(today, -28)) ?? pts[0]
  const band = anchor && trend.targetKg
    ? [anchor.day, today].map((d) => {
        const m = daysBetween(anchor.day, d) / 30
        return { d, lo: anchor.trend + trend.targetKg!.lo * m, hi: anchor.trend + trend.targetKg!.hi * m }
      })
    : []
  const vals = [...pts.flatMap((p) => [p.trend, ...(p.weight != null ? [p.weight] : [])]), ...band.flatMap((b) => [b.lo, b.hi])]
  const min = vals.length ? Math.floor((Math.min(...vals) - 0.3) * 2) / 2 : 60
  const max = vals.length ? Math.ceil((Math.max(...vals) + 0.3) * 2) / 2 : 80
  const x = (d: string) => pad.l + (daysBetween(start, d) / span) * (W - pad.l - pad.r)
  const y = (v: number) => pad.t + (1 - (v - min) / Math.max(0.5, max - min)) * (H - pad.t - pad.b)
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)},${y(p.trend).toFixed(1)}`).join(' ')
  const bandPath = band.length === 2 ? `M${x(band[0].d)},${y(band[0].lo)} L${x(band[1].d)},${y(band[1].lo)} L${x(band[1].d)},${y(band[1].hi)} L${x(band[0].d)},${y(band[0].hi)} Z` : ''
  const ticks = [min, (min + max) / 2, max]
  const tone = trend.nudge === 'hold' ? 'good' : trend.nudge === 'wait' ? 'none' : 'warn'
  const kcal = roughKcal(trend.now)
  return (
    <section className="card wt-card" aria-label="Weight trend">
      <header className="card-head">
        <h2>Weight trend</h2>
        <span className="hint small">
          {trend.now ? `${Math.round(trend.now * 10) / 10} kg (7-day average)` : 'Morning weigh-ins, a few a week'}
          {trend.perMonthKg != null ? ` · ${trend.perMonthKg >= 0 ? '+' : '−'}${Math.abs(Math.round(trend.perMonthKg * 10) / 10)} kg a month` : ''}
        </span>
      </header>
      {pts.length > 0 ? (
        <svg className="wt-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Weight: ${pts.length} days, trend ${trend.now ?? ''} kg. ${trend.line}`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="wt-grid" />
              <text x={pad.l - 6} y={y(t) + 4} className="wt-axis" textAnchor="end">
                {t.toFixed(1)}
              </text>
            </g>
          ))}
          {bandPath && <path d={bandPath} className="wt-band" />}
          {pts.filter((p) => p.weight != null).map((p) => (
            <circle key={p.day} cx={x(p.day)} cy={y(p.weight!)} r="2.6" className="wt-dot" />
          ))}
          <path d={line} className="wt-line" />
          {pts.length > 0 && <circle cx={x(pts[pts.length - 1].day)} cy={y(pts[pts.length - 1].trend)} r="4" className="wt-now" />}
          <text x={pad.l} y={H - 5} className="wt-axis">
            {start.slice(5)}
          </text>
          <text x={W - pad.r} y={H - 5} className="wt-axis" textAnchor="end">
            today
          </text>
        </svg>
      ) : (
        <p className="empty">No weigh-ins yet.</p>
      )}
      <div className={`wt-nudge ${tone}`} role="status">
        <span aria-hidden="true">{trend.nudge === 'add' ? '🍽️' : trend.nudge === 'ease' ? '🐢' : trend.nudge === 'hold' ? '✅' : '⏳'}</span>
        <p>
          <b>{trend.nudge === 'add' ? `Add about ${trend.kcal} kcal a day` : trend.nudge === 'ease' ? 'Ease off a little' : trend.nudge === 'hold' ? 'Hold steady' : 'Not enough weigh-ins yet'}</b>
          <br />
          {trend.line}
        </p>
      </div>
      <div className="wt-foot">
        <small className="muted">
          <i className="wt-key line" /> 7-day average <i className="wt-key dot" /> weigh-ins <i className="wt-key band" /> lean-bulk pace (+0.25–0.5 % a month)
          {kcal ? ` · Rough daily need: about ${kcal} kcal (a guess from weight; the trend is the real test)` : ''}
        </small>
        {onLog && (
          <button type="button" className="btn small" onClick={onLog}>
            Log weight
          </button>
        )}
      </div>
    </section>
  )
}
