// "Are you growing?" on Insights: you against your past (last week, your
// 4-week average, your best week), growth charts per area over weeks or
// months with your best marked, personal records, and milestones (a new one
// is celebrated once, on any device). Numbers from @core/growth.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Growth, GrowthMetric, Milestone, Point } from '@core/growth'
import { newMilestones } from '@core/growth'
import { hm } from '@core/focus'
import { life } from '../bridge'
import { Icon } from '../Icon'
import { useLive } from '../live'
import { soundSuccess } from '../sound'

const lei = (bani: number) => `${Math.round(bani / 100).toLocaleString('en-US')} lei`
const fmt = (m: Pick<GrowthMetric, 'unit'>, v: number) => (m.unit === 'min' ? (v ? hm(Math.round(v)) : '0m') : m.unit === 'bani' ? lei(v) : String(Math.round(v * 10) / 10))
const weekLabel = (from: string) => new Date(`${from}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const monthLabel = (ym: string) => new Date(`${ym}-15T12:00:00`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`
const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

export function useGrowth(): Growth | null {
  const [g, setG] = useState<Growth | null>(null)
  const load = useCallback(() => {
    life.progress?.growth?.().then(setG).catch(() => setG(null))
  }, [])
  useEffect(load, [load])
  useLive(load)
  return g
}

/** Up/down against a past number, colored by whether it's good (spending: down is good). */
function Delta({ pct, good, label }: { pct: number | null; good: boolean; label: string }) {
  if (pct === null) return <span className="gr-delta none">new · {label}</span>
  if (pct === 0) return <span className="gr-delta same">= {label}</span>
  const up = pct > 0
  const ok = up === good
  return (
    <span className={`gr-delta ${ok ? 'good' : 'bad'}`}>
      {up ? '▲' : '▼'} {Math.abs(pct)}% {label}
    </span>
  )
}

function VsPast({ g }: { g: Growth }) {
  return (
    <section className="card">
      <header className="card-head">
        <h2>
          <Icon name="chart" size={16} /> You vs past you
        </h2>
        <span className="hint">Last 7 days against the 7 before, your 4-week average and your best week</span>
      </header>
      <div className="gr-vs">
        {g.metrics.map((m) => (
          <div key={m.id} className={`gr-vs-card ${m.record ? 'record' : ''}`}>
            <span className="gr-vs-label">
              {m.label}
              {m.record && <b className="gr-record">🏆 Best week ever</b>}
            </span>
            <span className="gr-vs-now">{fmt(m, m.thisWeek)}</span>
            <Delta pct={m.vsLast} good={m.higherBetter} label={`vs last week (${fmt(m, m.lastWeek)})`} />
            <Delta pct={m.vsAvg} good={m.higherBetter} label={`vs your average (${fmt(m, m.avg4)})`} />
            {m.best && !m.record && (
              <span className="gr-best">
                {m.higherBetter ? 'Best' : 'Lowest'} week: {fmt(m, m.best.value)} · {weekLabel(m.best.label)}
                {m.higherBetter && m.best.value > 0 && <i style={{ width: `${Math.min(100, (m.thisWeek / m.best.value) * 100)}%` }} />}
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(300)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(160, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

/** One area over time: a smooth line, your best marked, hover for any point. */
function GrowthChart({ m, points, label }: { m: GrowthMetric; points: Point[]; label: (p: Point) => string }) {
  const [box, W] = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const H = 120
  const pad = { l: 4, r: 4, t: 14, b: 4 }
  const max = Math.max(1, ...points.map((p) => p.value))
  const x = (i: number) => pad.l + (i / Math.max(1, points.length - 1)) * (W - pad.l - pad.r)
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b)
  const pts = points.map((p, i) => [x(i), y(p.value)] as const)
  // Monotone-ish smoothing: control points at 1/3, never overshooting.
  const path = pts.map(([px, py], i) => (i === 0 ? `M${px},${py}` : `C${pts[i - 1][0] + (px - pts[i - 1][0]) / 3},${pts[i - 1][1]} ${px - (px - pts[i - 1][0]) / 3},${py} ${px},${py}`)).join(' ')
  const area = `${path} L${x(points.length - 1)},${H - pad.b} L${x(0)},${H - pad.b} Z`
  const withData = points.map((p, i) => ({ p, i })).filter((o) => o.p.value > 0)
  const bestI = withData.length ? withData.reduce((b, o) => (m.higherBetter ? (o.p.value > b.p.value ? o : b) : o.p.value < b.p.value ? o : b)).i : -1
  const last = points.length - 1
  const shown = hover ?? last
  const id = `gr-${m.id}`
  const total = points.reduce((t, p) => t + p.value, 0)
  return (
    <div className="gr-chart">
      <div className="gr-chart-head">
        <span className="gr-chart-title">{m.label}</span>
        <span className="gr-chart-val">
          <b>{fmt(m, points[shown]?.value ?? 0)}</b> <small>{points[shown] ? label(points[shown]) : ''}</small>
        </span>
      </div>
      {total === 0 ? (
        <p className="hint small gr-empty">Nothing logged yet. It starts climbing with your first entry.</p>
      ) : (
        <div
          ref={box}
          className="gr-svg-wrap"
          onPointerMove={(e) => {
            const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
            const i = Math.round(((e.clientX - r.left - pad.l) / (W - pad.l - pad.r)) * last)
            setHover(Math.max(0, Math.min(last, i)))
          }}
          onPointerLeave={() => setHover(null)}
        >
          <svg width={W} height={H} role="img" aria-label={`${m.label}: ${points.map((p) => `${label(p)} ${fmt(m, p.value)}`).join(', ')}`}>
            <defs>
              <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {[0.25, 0.5, 0.75].map((f) => (
              <line key={f} x1={pad.l} x2={W - pad.r} y1={pad.t + f * (H - pad.t - pad.b)} y2={pad.t + f * (H - pad.t - pad.b)} className="gr-grid" />
            ))}
            <path d={area} fill={`url(#${id})`} />
            <path d={path} className="gr-line" />
            {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.t - 6} y2={H - pad.b} className="gr-cross" />}
            {bestI >= 0 && (
              <g className="gr-best-pt">
                <circle cx={x(bestI)} cy={y(points[bestI].value)} r={5} />
                <text x={Math.min(W - 24, Math.max(18, x(bestI)))} y={Math.max(10, y(points[bestI].value) - 8)} textAnchor="middle">
                  best
                </text>
              </g>
            )}
            <circle cx={x(shown)} cy={y(points[shown].value)} r={4} className="gr-now-pt" />
          </svg>
        </div>
      )}
      <div className="gr-axis">
        <span>{label(points[0])}</span>
        <span>{label(points[last])}</span>
      </div>
    </div>
  )
}

function Charts({ g }: { g: Growth }) {
  const [span, setSpan] = useState<'weeks' | 'months'>('weeks')
  return (
    <section className="card">
      <header className="card-head">
        <h2>
          <Icon name="chart" size={16} /> Are you growing?
        </h2>
        <div className="ta-tabs" role="tablist">
          <button role="tab" aria-selected={span === 'weeks'} className={span === 'weeks' ? 'on' : ''} onClick={() => setSpan('weeks')}>
            Weeks
          </button>
          <button role="tab" aria-selected={span === 'months'} className={span === 'months' ? 'on' : ''} onClick={() => setSpan('months')}>
            Months
          </button>
        </div>
      </header>
      <div className="gr-charts">
        {g.metrics.map((m) => (
          <GrowthChart key={`${m.id}-${span}`} m={m} points={span === 'weeks' ? m.weeks : m.months} label={(p) => (span === 'weeks' ? weekLabel(p.label) : monthLabel(p.label))} />
        ))}
      </div>
      <p className="hint small">Each point is a week (7 days) or a calendar month; the dot marks your best. Hover a chart for any point.</p>
    </section>
  )
}

function RecordsAndMilestones({ g }: { g: Growth }) {
  const r = g.records
  const recs = [
    r.bestFocusDay && { icon: '🎯', label: 'Most focus in a day', value: hm(r.bestFocusDay.minutes), when: dayLabel(r.bestFocusDay.day) },
    r.bestFocusWeek && r.bestFocusWeek.value > 0 && { icon: '📈', label: 'Best focus week', value: hm(r.bestFocusWeek.value), when: `week of ${weekLabel(r.bestFocusWeek.label)}` },
    r.longestFocusStreak > 0 && { icon: '🔥', label: 'Longest 50+ min focus streak', value: days(r.longestFocusStreak), when: '' },
    r.longestWakeStreak > 0 && { icon: '☀️', label: 'Longest on-time wake-up streak', value: days(r.longestWakeStreak), when: '' },
    r.longestCleanStreak > 0 && { icon: '🛡️', label: 'Longest clean streak', value: days(r.longestCleanStreak), when: '' },
    r.mostTasksDay && { icon: '✅', label: 'Most tasks in a day', value: String(r.mostTasksDay.count), when: dayLabel(r.mostTasksDay.day) }
  ].filter(Boolean) as { icon: string; label: string; value: string; when: string }[]
  const reached = g.milestones.filter((m) => m.at).sort((a, b) => (a.at! < b.at! ? 1 : -1))
  const next = g.milestones.filter((m) => !m.at).sort((a, b) => b.progress - a.progress)
  return (
    <div className="ins-two">
      <section className="card">
        <header className="card-head">
          <h2>
            <Icon name="trophy" size={16} /> Personal records
          </h2>
        </header>
        {recs.length ? (
          <ul className="gr-recs">
            {recs.map((x) => (
              <li key={x.label}>
                <span className="gr-rec-icon">{x.icon}</span>
                <span className="gr-rec-label">
                  {x.label}
                  {x.when && <small>{x.when}</small>}
                </span>
                <b>{x.value}</b>
              </li>
            ))}
          </ul>
        ) : (
          <p className="hint">Your records appear as soon as you log focus, wake-ups and tasks.</p>
        )}
      </section>
      <section className="card">
        <header className="card-head">
          <h2>
            <Icon name="spark" size={16} /> Milestones
          </h2>
        </header>
        <ul className="gr-ms">
          {next.map((m) => (
            <li key={m.id} className="next">
              <span className="gr-ms-label">
                Next: {m.label} <small>{Math.round(m.progress * 100)}%</small>
              </span>
              <span className="gr-ms-bar">
                <i style={{ width: `${m.progress * 100}%` }} />
              </span>
            </li>
          ))}
          {reached.slice(0, 6).map((m) => (
            <li key={m.id} className="done">
              <span className="gr-ms-label">
                🏆 {m.label} <small>{dayLabel(m.at!)}</small>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

/** A new milestone, celebrated once (on any device). */
function Celebrate({ g }: { g: Growth }) {
  const [fresh, setFresh] = useState<Milestone[]>([])
  useEffect(() => {
    life.progress
      ?.seenMilestones?.()
      .then((seen) => {
        const n = newMilestones(g.milestones, seen)
        // The first time ever, everything already reached is just recorded, not celebrated at once.
        if (!seen.length && n.length > 1) return life.progress?.markMilestones?.(n.map((m) => m.id))
        if (n.length) {
          setFresh(n)
          soundSuccess()
        }
      })
      .catch(() => {})
  }, [g])
  if (!fresh.length) return null
  const close = () => {
    void life.progress?.markMilestones?.(fresh.map((m) => m.id))
    setFresh([])
  }
  return (
    <section className="gr-celebrate" role="status">
      <div className="gr-confetti" aria-hidden="true">
        {Array.from({ length: 18 }, (_, i) => (
          <i key={i} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 6) * 0.12}s`, background: ['var(--accent)', '#7CC4FF', '#F5C84B', '#FF8A3D', '#B892FF'][i % 5] }} />
        ))}
      </div>
      <span className="gr-cel-icon">🏆</span>
      <div>
        <b>New milestone{fresh.length > 1 ? 's' : ''}!</b>
        <p>{fresh.map((m) => m.label).join(' · ')}</p>
      </div>
      <button className="btn primary" onClick={close}>
        Keep going
      </button>
    </section>
  )
}

export function GrowthSections() {
  const g = useGrowth()
  if (!g) return null
  return (
    <>
      <Celebrate g={g} />
      <VsPast g={g} />
      <Charts g={g} />
      <RecordsAndMilestones g={g} />
    </>
  )
}
