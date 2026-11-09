// Progress → weight and waist: the 7-day weight average with the target
// band (+0.25 to +0.5 kg a week from 4 weeks ago), the waist on its own
// scale, and one plain verdict written from the numbers.
import { daysBetween } from '@core/dates'
import { trendView } from '@core/bodyProgress'

const W = 560
const H = 190
const PAD = { l: 38, r: 38, t: 14, b: 22 }

export function TrendPanel({ metrics, today, onLog }: { metrics: { day: string; weight?: number | null; waist?: number | null }[]; today: string; onLog: () => void }) {
  const t = trendView(
    metrics.map((m) => ({ day: m.day, weight: m.weight })),
    metrics,
    today
  )
  const pts = t.points
  if (!pts.length && !t.waist.length)
    return (
      <section className="card bpg-card" aria-label="Weight and waist">
        <h2>Weight and waist</h2>
        <p className="bpg-empty">Log weight and waist weekly.</p>
        <button type="button" className="btn primary small" onClick={onLog}>
          Log weight & waist
        </button>
      </section>
    )
  const start = pts[0]?.day ?? t.waist[0].day
  const span = Math.max(14, daysBetween(start, today))
  const x = (d: string) => PAD.l + (Math.max(0, daysBetween(start, d)) / span) * (W - PAD.l - PAD.r)
  const wv = [...pts.flatMap((p) => [p.trend, ...(p.weight != null ? [p.weight] : [])]), ...(t.zone ? [t.zone.lo1, t.zone.hi1] : [])]
  const wMin = wv.length ? Math.floor((Math.min(...wv) - 0.3) * 2) / 2 : 60
  const wMax = wv.length ? Math.ceil((Math.max(...wv) + 0.3) * 2) / 2 : 80
  const y = (v: number) => PAD.t + (1 - (v - wMin) / Math.max(0.5, wMax - wMin)) * (H - PAD.t - PAD.b)
  const ws = t.waist.map((w) => w.waist)
  const sMin = ws.length ? Math.floor(Math.min(...ws) - 1) : 0
  const sMax = ws.length ? Math.ceil(Math.max(...ws) + 1) : 1
  const yw = (v: number) => PAD.t + (1 - (v - sMin) / Math.max(2, sMax - sMin)) * (H - PAD.t - PAD.b)
  const trendLine = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)},${y(p.trend).toFixed(1)}`).join(' ')
  const waistLine = t.waist.map((w, i) => `${i ? 'L' : 'M'}${x(w.day).toFixed(1)},${yw(w.waist).toFixed(1)}`).join(' ')
  const z = t.zone
  const zonePath = z ? `M${x(z.from)},${y(z.lo0)} L${x(z.to)},${y(z.lo1)} L${x(z.to)},${y(z.hi1)} L${x(z.from)},${y(z.hi0)} Z` : ''
  const last = pts[pts.length - 1]
  const lastW = t.waist[t.waist.length - 1]
  return (
    <section className="card bpg-card" aria-label="Weight and waist">
      <header className="bpg-head">
        <h2>Weight and waist</h2>
        <button type="button" className="btn ghost small" onClick={onLog}>
          Log
        </button>
      </header>
      <div className="bpg-nums">
        <span>
          <b>{last ? `${Math.round(last.trend * 10) / 10} kg` : '–'}</b>
          <small>7-day average</small>
        </span>
        <span>
          <b>{lastW ? `${lastW.waist} cm` : '–'}</b>
          <small>waist</small>
        </span>
      </div>
      <svg className="bpg-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Weight trend ${last?.trend ?? ''} kg, waist ${lastW?.waist ?? ''} cm. ${t.verdict.text}`}>
        {[wMin, (wMin + wMax) / 2, wMax].map((g) => (
          <g key={g}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(g)} y2={y(g)} className="bpg-grid" />
            <text x={PAD.l - 6} y={y(g) + 4} className="bpg-axis" textAnchor="end">
              {g.toFixed(1)}
            </text>
          </g>
        ))}
        {ws.length > 0 &&
          [sMin, sMax].map((g) => (
            <text key={g} x={W - PAD.r + 6} y={yw(g) + 4} className="bpg-axis waist">
              {g}
            </text>
          ))}
        {zonePath && <path d={zonePath} className="bpg-zone" />}
        {pts
          .filter((p) => p.weight != null)
          .map((p) => (
            <circle key={p.day} cx={x(p.day)} cy={y(p.weight!)} r="2.4" className="bpg-wdot" />
          ))}
        {trendLine && <path d={trendLine} className="bpg-line" />}
        {waistLine && <path d={waistLine} className="bpg-waist" />}
        {t.waist.map((w) => (
          <circle key={w.day} cx={x(w.day)} cy={yw(w.waist)} r="3" className="bpg-waist-dot">
            <title>{`${w.day.slice(5)}: waist ${w.waist} cm`}</title>
          </circle>
        ))}
        {last && <circle cx={x(last.day)} cy={y(last.trend)} r="4.5" className="bpg-now" />}
        <text x={PAD.l} y={H - 6} className="bpg-axis">
          {start.slice(5)}
        </text>
        <text x={W - PAD.r} y={H - 6} className="bpg-axis" textAnchor="end">
          today
        </text>
      </svg>
      <ul className="bpg-legend inline" aria-label="Chart key">
        <li className="k-line">
          <i aria-hidden="true" />
          Weight (7-day average)
        </li>
        <li className="k-zone">
          <i aria-hidden="true" />
          Target band (+0.25 to +0.5 kg a week)
        </li>
        <li className="k-waist">
          <i aria-hidden="true" />
          Waist
        </li>
      </ul>
      <p className={`bpg-verdict ${t.verdict.tone}`} role="status">
        {t.verdict.text}
      </p>
      {t.verdict.dKg == null && (
        <button type="button" className="btn primary small" onClick={onLog}>
          Log weight & waist
        </button>
      )}
    </section>
  )
}

