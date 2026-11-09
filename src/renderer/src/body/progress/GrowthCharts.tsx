// Small long-run charts for Body → Growth, drawn as inline SVG to scale:
// one y-axis each, smooth lines that break where a week has no data, an
// optional band (the target corridor) or goal line, the latest value labeled,
// and a hover / tap crosshair with the week's value. Colours come from CSS
// classes (growth.css), so light and dark both work.
import { useId, useRef, useState, type ReactNode } from 'react'

export interface Series {
  id: string
  label: string
  values: (number | null)[]
  /** CSS class for the line colour (s1…s4; none = the accent). */
  cls?: string
}

const W = 560
const H = 190
const PAD = { l: 42, r: 46, t: 12, b: 22 }
const shortDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

/** A smooth path through the points (Catmull–Rom as curves); a gap of more than 3 weeks breaks the line. */
function smoothPath(pts: ({ x: number; y: number } | null)[]): string {
  const runs: { x: number; y: number }[][] = []
  let cur: { x: number; y: number }[] = []
  let gap = 0
  for (const p of pts) {
    if (!p) {
      gap++
      continue
    }
    if (gap > 3 && cur.length) {
      runs.push(cur)
      cur = []
    }
    gap = 0
    cur.push(p)
  }
  if (cur.length) runs.push(cur)
  return runs
    .map((r) => {
      if (r.length === 1) return `M${r[0].x.toFixed(1)},${r[0].y.toFixed(1)}h0.1`
      let d = `M${r[0].x.toFixed(1)},${r[0].y.toFixed(1)}`
      for (let i = 0; i < r.length - 1; i++) {
        const p0 = r[i - 1] ?? r[i]
        const p1 = r[i]
        const p2 = r[i + 1]
        const p3 = r[i + 2] ?? p2
        const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 }
        const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 }
        d += ` C${c1.x.toFixed(1)},${c1.y.toFixed(1)} ${c2.x.toFixed(1)},${c2.y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`
      }
      return d
    })
    .join(' ')
}

/** End labels pushed apart so they never overlap (at least 12 px between them). */
function spread(ys: { id: string; y: number }[], min = 12): Map<string, number> {
  const l = [...ys].sort((a, b) => a.y - b.y)
  for (let i = 1; i < l.length; i++) if (l[i].y - l[i - 1].y < min) l[i] = { ...l[i], y: l[i - 1].y + min }
  return new Map(l.map((p) => [p.id, p.y]))
}

function niceTicks(lo: number, hi: number, n = 4): number[] {
  const span = hi - lo || 1
  const raw = span / n
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  const out: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000)
  return out
}

export function LineChart({
  label,
  weeks,
  series,
  band,
  goal,
  fmt,
  empty,
  legend
}: {
  label: string
  weeks: string[]
  series: Series[]
  band?: { lo: (number | null)[]; hi: (number | null)[]; label: string }
  goal?: { value: number; label: string } | null
  fmt: (n: number) => string
  empty: string
  legend?: boolean
}) {
  const [hover, setHover] = useState<number | null>(null)
  const ref = useRef<SVGSVGElement>(null)
  const tipId = useId()
  const vals = [...series.flatMap((s) => s.values), ...(band ? [...band.lo, ...band.hi] : []), ...(goal ? [goal.value] : [])].filter((v): v is number => v != null)
  const have = series.some((s) => s.values.some((v) => v != null))
  if (!have || weeks.length === 0) return <p className="bpg-empty gr-empty">{empty}</p>
  let lo = Math.min(...vals)
  let hi = Math.max(...vals)
  const padY = (hi - lo) * 0.12 || Math.max(1, Math.abs(hi) * 0.05)
  lo -= padY
  hi += padY
  const n = weeks.length
  const x = (i: number) => PAD.l + (n === 1 ? (W - PAD.l - PAD.r) / 2 : (i / (n - 1)) * (W - PAD.l - PAD.r))
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b)
  const ticks = niceTicks(lo, hi)
  const lastOf = (s: Series) => s.values.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0).pop()
  const labelY = spread(series.flatMap((s) => { const i = lastOf(s); return i == null ? [] : [{ id: s.id, y: y(s.values[i]!) }] }))
  const xTicks = n <= 1 ? [0] : [0, Math.round((n - 1) / 2), n - 1]
  const bandPath = band
    ? (() => {
        const idx = weeks.map((_, i) => i).filter((i) => band.lo[i] != null && band.hi[i] != null)
        if (idx.length < 2) return ''
        const top = idx.map((i) => `${x(i).toFixed(1)},${y(band.hi[i]!).toFixed(1)}`)
        const bot = [...idx].reverse().map((i) => `${x(i).toFixed(1)},${y(band.lo[i]!).toFixed(1)}`)
        return `M${top.join(' L')} L${bot.join(' L')} Z`
      })()
    : ''
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const px = ((e.clientX - r.left) / r.width) * W
    const i = n === 1 ? 0 : Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (n - 1))
    setHover(Math.max(0, Math.min(n - 1, i)))
  }
  const tip: ReactNode =
    hover != null ? (
      <div className="gr-tip" id={tipId} role="status" style={{ left: `${(x(hover) / W) * 100}%` }}>
        <b>Week of {shortDay(weeks[hover])}</b>
        {series.map((s) => (
          <span key={s.id}>
            {series.length > 1 && <i className={`gr-key ${s.cls ?? ''}`} />}
            {series.length > 1 ? `${s.label}: ` : ''}
            {s.values[hover] == null ? 'no data' : fmt(s.values[hover]!)}
          </span>
        ))}
        {band && band.lo[hover] != null && (
          <span className="gr-tip-muted">
            {band.label}: {fmt(band.lo[hover]!)}–{fmt(band.hi[hover]!)}
          </span>
        )}
      </div>
    ) : null
  return (
    <div className="gr-chart-wrap">
      <svg ref={ref} className="bpg-chart gr-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)} aria-describedby={hover != null ? tipId : undefined}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="bpg-grid" x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} />
            <text className="bpg-axis" x={PAD.l - 6} y={y(t) + 3} textAnchor="end">
              {fmt(t)}
            </text>
          </g>
        ))}
        {xTicks.map((i) => (
          <text key={i} className="bpg-axis" x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>
            {shortDay(weeks[i])}
          </text>
        ))}
        {bandPath && <path className="gr-band" d={bandPath} />}
        {goal && <line className="gr-goal" x1={PAD.l} x2={W - PAD.r} y1={y(goal.value)} y2={y(goal.value)} />}
        {goal && (
          <text className="bpg-axis gr-goal-t" x={W - PAD.r + 4} y={y(goal.value) + 3}>
            {goal.label}
          </text>
        )}
        {series.map((s) => {
          const pts = s.values.map((v, i) => (v == null ? null : { x: x(i), y: y(v) }))
          const lastI = lastOf(s)
          return (
            <g key={s.id} className={`gr-series ${s.cls ?? ''}`}>
              <path className="gr-line" d={smoothPath(pts)} />
              {lastI != null && (
                <>
                  <circle className="gr-end" cx={x(lastI)} cy={y(s.values[lastI]!)} r={4} />
                  <text className="gr-end-t" x={x(lastI) + 7} y={(labelY.get(s.id) ?? y(s.values[lastI]!)) + 4}>
                    {series.length > 1 ? s.label : fmt(s.values[lastI]!)}
                  </text>
                </>
              )}
            </g>
          )
        })}
        {hover != null && <line className="gr-cross" x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} />}
        {hover != null &&
          series.map((s) => (s.values[hover] == null ? null : <circle key={s.id} className={`gr-hdot ${s.cls ?? ''}`} cx={x(hover)} cy={y(s.values[hover]!)} r={4.5} />))}
      </svg>
      {tip}
      {(legend || band || goal) && (
        <ul className="bpg-legend gr-legend">
          {(legend ? series : []).map((s) => (
            <li key={s.id}>
              <i className={`gr-key ${s.cls ?? ''}`} />
              {s.label}
            </li>
          ))}
          {band && (
            <li className="k-zone">
              <i />
              {band.label}
            </li>
          )}
          {goal && (
            <li className="gr-k-goal">
              <i />
              {goal.label}
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

/** Weekly bars (sessions) against a dashed plan line. */
export function BarsChart({ label, weeks, values, plan, unit }: { label: string; weeks: string[]; values: number[]; plan: number; unit: string }) {
  const [hover, setHover] = useState<number | null>(null)
  if (!weeks.length) return null
  const hi = Math.max(plan, ...values, 1) + 1
  const n = weeks.length
  const slot = (W - PAD.l - PAD.r) / n
  const bw = Math.max(2, Math.min(26, slot - 2))
  const y = (v: number) => PAD.t + (1 - v / hi) * (H - PAD.t - PAD.b)
  const ticks = niceTicks(0, hi, 3).filter((t) => Number.isInteger(t))
  return (
    <div className="gr-chart-wrap">
      <svg className="bpg-chart gr-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} onPointerLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="bpg-grid" x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} />
            <text className="bpg-axis" x={PAD.l - 6} y={y(t) + 3} textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {values.map((v, i) => {
          const cx = PAD.l + slot * i + slot / 2
          const top = y(v)
          const h = Math.max(0, y(0) - top)
          return (
            <g key={weeks[i]} onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)}>
              <rect className="gr-hit" x={cx - slot / 2} y={PAD.t} width={slot} height={H - PAD.t - PAD.b} />
              {h > 0 && <path className={`gr-bar ${v >= plan ? 'full' : ''} ${hover === i ? 'on' : ''}`} d={`M${cx - bw / 2},${y(0)} V${top + Math.min(4, h)} Q${cx - bw / 2},${top} ${cx - bw / 2 + Math.min(4, bw / 2)},${top} H${cx + bw / 2 - Math.min(4, bw / 2)} Q${cx + bw / 2},${top} ${cx + bw / 2},${top + Math.min(4, h)} V${y(0)} Z`} />}
            </g>
          )
        })}
        <line className="gr-goal" x1={PAD.l} x2={W - PAD.r} y1={y(plan)} y2={y(plan)} />
        <text className="bpg-axis gr-goal-t" x={W - PAD.r + 4} y={y(plan) + 3}>
          plan {plan}
        </text>
        {[0, n - 1].map((i) => (
          <text key={i} className="bpg-axis" x={PAD.l + slot * i + slot / 2} y={H - 6} textAnchor={i === 0 ? 'start' : 'end'}>
            {shortDay(weeks[i])}
          </text>
        ))}
      </svg>
      {hover != null && (
        <div className="gr-tip" role="status" style={{ left: `${((PAD.l + slot * hover + slot / 2) / W) * 100}%` }}>
          <b>Week of {shortDay(weeks[hover])}</b>
          <span>
            {values[hover]} of {plan} {unit}
          </span>
        </div>
      )}
    </div>
  )
}
