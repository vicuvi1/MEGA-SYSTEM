// Progress → Body composition: the weekly average weight is the headline
// (daily weigh-ins are small grey dots: they swing with water and food), the
// change against last week and the target band (+0.25 to +0.5 kg a week),
// the waist, body fat % and muscle kg smoothed and labeled as estimates, and
// the food log's average calories alongside. Data: life.coach.bodyComp
// (main/bodyComp.ts → core/bodyComp.ts). Calm colours, no alarms.
import { useEffect, useState } from 'react'
import { addDays, daysBetween } from '@core/dates'
import { BAND_LABEL, MIN_WEEK, TARGET_BAND, signed } from '@core/bodyComp'
import type { BodyCompView } from '../../../../main/bodyComp'
import { life } from '../../bridge'
import './bodyComp.css'

/** The body composition view, reloaded after any body change (null until loaded or without the log). */
export function useBodyComp(): BodyCompView | null {
  const [v, setV] = useState<BodyCompView | null>(null)
  useEffect(() => {
    let live = true
    const load = () =>
      void life.coach?.bodyComp
        ?.view()
        .then((x) => live && setV(x))
        .catch(() => {})
    load()
    window.addEventListener('life-body-changed', load)
    return () => {
      live = false
      window.removeEventListener('life-body-changed', load)
    }
  }, [])
  return v
}

const W = 560
const H = 200
const PAD = { l: 40, r: 14, t: 14, b: 22 }
const fmtK = (n: number) => Math.round(n).toLocaleString('en-US')

export function BodyCompPanel({ v, onLog, onMonth }: { v: BodyCompView; onLog: () => void; onMonth: () => void }) {
  const h = v.head
  const today = v.today
  const start = addDays(today, -55)
  const first = v.points[0]?.day ?? today
  const from = first < start ? start : first
  const span = Math.max(14, daysBetween(from, today))
  const x = (d: string) => PAD.l + (Math.max(0, daysBetween(from, d)) / span) * (W - PAD.l - PAD.r)
  const daily = v.points.filter((p) => p.weight != null)
  const b = v.bandFrom
  const bandWeeks = b ? daysBetween(b.day, today) / 7 : 0
  const vals = [...daily.map((p) => p.weight as number), ...v.weightAvg.map((p) => p.value), ...(b ? [b.value + TARGET_BAND.hi * bandWeeks, b.value] : [])]
  const lo = vals.length ? Math.floor((Math.min(...vals) - 0.3) * 2) / 2 : 60
  const hi = vals.length ? Math.ceil((Math.max(...vals) + 0.3) * 2) / 2 : 80
  const y = (val: number) => PAD.t + (1 - (val - lo) / Math.max(0.5, hi - lo)) * (H - PAD.t - PAD.b)
  const line = v.weightAvg.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
  const band = b && bandWeeks > 0 ? `M${x(b.day)},${y(b.value)} L${x(today)},${y(b.value + TARGET_BAND.lo * bandWeeks)} L${x(today)},${y(b.value + TARGET_BAND.hi * bandWeeks)} L${x(b.day)},${y(b.value)} Z` : ''
  const last = v.weightAvg[v.weightAvg.length - 1]
  const recent = v.weeks.slice(-4)
  return (
    <section className="card bpg-card bcp" aria-label="Body composition">
      <header className="bpg-head">
        <h2>Body composition</h2>
        <button type="button" className="btn ghost small bcp-log" onClick={onLog}>
          Log body
        </button>
      </header>

      {h ? (
        <div className="bcp-hero">
          <div>
            <b className="bcp-big">
              {h.avg.toFixed(1)}
              <small> kg</small>
            </b>
            <span className="bcp-sub">
              Weekly average, {h.which} · {h.n} weigh-ins
            </span>
          </div>
          <div className="bcp-change">
            {h.delta != null ? <b>{signed(h.delta)} vs last week</b> : <b>Change shows after 2 full weeks</b>}
            {h.band && <span className={`bcp-band ${h.band}`}>{BAND_LABEL[h.band]}</span>}
          </div>
        </div>
      ) : (
        <div className="bcp-hero">
          <div>
            <b className="bcp-big muted">–</b>
            <span className="bcp-sub bcp-nodata">
              Not enough data: {v.thisWeek} of {MIN_WEEK} weigh-ins this week
            </span>
          </div>
        </div>
      )}

      {daily.length > 0 && (
        <svg className="bpg-chart bcp-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Weight: 7-day average ${last ? last.value.toFixed(1) : ''} kg. ${v.verdict}`}>
          {[lo, Math.round(lo + hi) / 2, hi].filter((g, i, l) => l.indexOf(g) === i).map((g) => (
            <g key={g}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(g)} y2={y(g)} className="bpg-grid" />
              <text x={PAD.l - 6} y={y(g) + 4} className="bpg-axis" textAnchor="end">
                {g.toFixed(1)}
              </text>
            </g>
          ))}
          {band && <path d={band} className="bcp-target" />}
          {daily.map((p) => (
            <circle key={p.day} cx={x(p.day)} cy={y(p.weight as number)} r="2.6" className="bcp-day">
              <title>{`${p.day.slice(5)}: ${p.weight} kg`}</title>
            </circle>
          ))}
          {line && <path d={line} className="bpg-line" />}
          {last && <circle cx={x(last.day)} cy={y(last.value)} r="4.5" className="bpg-now" />}
          <text x={PAD.l} y={H - 6} className="bpg-axis">
            {from.slice(5)}
          </text>
          <text x={W - PAD.r} y={H - 6} className="bpg-axis" textAnchor="end">
            today
          </text>
        </svg>
      )}
      {daily.length > 0 && (
        <ul className="bpg-legend inline" aria-label="Chart key">
          <li className="k-day">
            <i aria-hidden="true" />
            Daily weigh-in
          </li>
          <li className="k-line">
            <i aria-hidden="true" />
            7-day average
          </li>
          <li className="k-target">
            <i aria-hidden="true" />
            Target +{TARGET_BAND.lo} to +{TARGET_BAND.hi} kg a week
          </li>
        </ul>
      )}
      <p className="bpg-verdict bcp-verdict" role="status">
        {v.verdict}
      </p>

      {recent.some((w) => w.n > 0) && (
        <ol className="bcp-weeks" aria-label="Weekly averages">
          {recent.map((w) => (
            <li key={w.week} className={w.enough ? '' : 'short'}>
              <span>{w.week === v.weeks[v.weeks.length - 1].week ? 'This week' : `Wk ${w.week.slice(5)}`}</span>
              <b>{w.enough && w.avg != null ? `${w.avg.toFixed(1)} kg` : w.n ? `${w.n} of ${MIN_WEEK}` : '–'}</b>
              {w.kcal != null && <small>{fmtK(w.kcal)} kcal/day</small>}
            </li>
          ))}
        </ol>
      )}

      <div className="bcp-minis">
        <Mini title="Waist" unit="cm" pts={v.waist.map((w) => ({ day: w.day, value: w.waist }))} from={from} today={today} note="weekly, morning" />
        <Mini title="Body fat" unit="%" pts={v.fatAvg} dots={v.points.filter((p) => p.fat != null).map((p) => ({ day: p.day, value: p.fat as number }))} from={from} today={today} note="estimate, watch the trend" />
        <Mini title="Muscle" unit="kg" pts={v.muscleAvg} dots={v.points.filter((p) => p.muscle != null).map((p) => ({ day: p.day, value: p.muscle as number }))} from={from} today={today} note="estimate, watch the trend" />
        {v.kcal && (
          <div className="bcp-mini bcp-kcal">
            <span className="bcp-mini-t">Calories</span>
            <b>
              {fmtK(v.kcal.avg)}
              <small> kcal a day</small>
            </b>
            <span className="bcp-mini-n">
              {v.kcal.which}, {v.kcal.days} day{v.kcal.days === 1 ? '' : 's'} logged
            </span>
          </div>
        )}
      </div>
      <button type="button" className="btn ghost small bcp-month" onClick={onMonth}>
        Monthly summary
      </button>
    </section>
  )
}

/** A small smoothed line (and faint daily dots) with the latest value. Hidden without data. */
function Mini({ title, unit, pts, dots = [], from, today, note }: { title: string; unit: string; pts: { day: string; value: number }[]; dots?: { day: string; value: number }[]; from: string; today: string; note: string }) {
  if (!pts.length)
    return (
      <div className="bcp-mini empty">
        <span className="bcp-mini-t">{title}</span>
        <b>–</b>
        <span className="bcp-mini-n">{title === 'Waist' ? 'Measure on Sunday mornings' : `Add it from the scale (${note})`}</span>
      </div>
    )
  const w = 160
  const h = 44
  const all = [...pts, ...dots].map((p) => p.value)
  const lo = Math.min(...all)
  const hi = Math.max(...all)
  const span = Math.max(14, daysBetween(from, today))
  const x = (d: string) => 2 + (Math.max(0, daysBetween(from, d)) / span) * (w - 4)
  const y = (v: number) => 4 + (1 - (v - lo) / Math.max(hi - lo, 0.5)) * (h - 8)
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
  const last = pts[pts.length - 1]
  return (
    <div className="bcp-mini">
      <span className="bcp-mini-t">{title}</span>
      <b>
        {last.value.toFixed(1)}
        <small> {unit}</small>
      </b>
      <svg viewBox={`0 0 ${w} ${h}`} className="bcp-spark" role="img" aria-label={`${title} ${last.value.toFixed(1)} ${unit}, ${note}`}>
        {dots.map((p) => (
          <circle key={p.day} cx={x(p.day)} cy={y(p.value)} r="1.8" className="bcp-day" />
        ))}
        {pts.length > 1 ? <path d={d} className="bcp-spark-line" /> : <circle cx={x(last.day)} cy={y(last.value)} r="3" className="bpg-now" />}
      </svg>
      <span className="bcp-mini-n">{note}</span>
    </div>
  )
}
