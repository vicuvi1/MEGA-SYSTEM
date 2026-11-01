// "Am I improving?": every area in one place. A week score, then for each
// area: the last 7 days against last week, a bar toward a good week, the 7
// days one by one and your last 6 weeks (numbers from @core/progress).
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Metric, ProgressReport } from '@core/progress'
import { life } from '../bridge'
import { Icon } from '../Icon'
import type { PageId } from '../modules'
import { WeekCard, WeekPlanner, shouldPlan, useWeekPlan } from '../WeekPlanner'
import { activePlan } from '@core/weekPlan'
import type { Insights } from '@core/insights'
import { FocusInsights } from './Focus'
import { PageSkeleton } from '../blocks'

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

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** Counts from 0 up to `to` once (ease-out), so numbers arrive with a little life. */
function useCountUp(to: number, ms = 900): number {
  const [v, setV] = useState(reduced() ? to : 0)
  const from = useRef(0)
  useEffect(() => {
    if (reduced()) return setV(to)
    const start = performance.now()
    const a = from.current
    let raf = 0
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / ms)
      const e = 1 - Math.pow(1 - k, 3)
      setV(a + (to - a) * e)
      if (k < 1) raf = requestAnimationFrame(step)
      else from.current = to
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [to, ms])
  return v
}

/** True one frame after mount: CSS transitions then run from their start state. */
function useShown(): boolean {
  const [on, setOn] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setOn(true))
    return () => cancelAnimationFrame(id)
  }, [])
  return on
}

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const weekday = (day: string) => WD[new Date(`${day}T12:00:00Z`).getUTCDay()]

function ScoreRing({ score, size = 132 }: { score: number; size?: number }) {
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

/** The 7 days one by one: a tick per day, or a small bar for amounts. */
function DayStrip({ m }: { m: Metric }) {
  const max = Math.max(1, ...m.days.map((d) => d.value))
  return (
    <div className="pg-days" role="img" aria-label={`${m.label}, last 7 days: ${m.days.map((d) => `${weekday(d.day)} ${m.dayText(d.value)}`).join(', ')}`}>
      {m.days.map((d, k) => (
        <div key={d.day} className="pg-day" title={`${weekday(d.day)} ${d.day.slice(5)}: ${m.dayText(d.value)}`}>
          {m.daily ? (
            <span className={`pg-dot ${d.value ? 'on' : ''}`} style={{ animationDelay: `${k * 60}ms` }} />
          ) : (
            <span className="pg-mini-bar">
              <i className={d.value ? 'on' : ''} style={{ height: `${d.value ? Math.max(14, (d.value / max) * 100) : 6}%`, animationDelay: `${k * 60}ms` }} />
            </span>
          )}
          <small>{weekday(d.day)[0]}</small>
        </div>
      ))}
    </div>
  )
}

/** The last 6 weeks, labelled, the current one bright with its value on top. */
function WeekBars({ m }: { m: Metric }) {
  const max = Math.max(1, ...m.weeks)
  const n = m.weeks.length
  return (
    <div className="pg-weeks">
      <div className="pg-weeks-bars" role="img" aria-label={`${m.label}, last ${n} weeks: ${m.weeks.map((v) => m.fmt(v)).join(', ')}`}>
        {m.weeks.map((v, k) => (
          <div key={k} className={`pg-week ${k === n - 1 ? 'now' : ''}`} title={`${k === n - 1 ? 'Last 7 days' : `${n - 1 - k} week${n - 1 - k > 1 ? 's' : ''} before`}: ${m.fmt(v)}`}>
            {k === n - 1 && v > 0 && <em>{m.fmt(v)}</em>}
            <i style={{ height: `${v ? Math.max(8, (v / max) * 100) : 3}%`, animationDelay: `${k * 70}ms` }} />
          </div>
        ))}
      </div>
      <div className="pg-weeks-x">
        {m.weeks.map((_, k) => (
          <small key={k}>{k === n - 1 ? 'now' : `${n - 1 - k}w`}</small>
        ))}
      </div>
    </div>
  )
}

const EMPTY: Partial<Record<Metric['id'], string>> = {
  focus: 'No focus sessions yet. Tap ▶ on any task on Today, or send /focus 50 math to the bot.',
  mustdo: 'No must-dos yet. Write 1–3 each morning on Today.',
  todoist: 'Tasks you finish in Todoist show up here.',
  sport: 'Log a workout in Sport Track or the reps on Today.',
  wake: 'Log your wake-up each morning (Waky or the Now card).'
}

function MetricCard({ m, index, onGo }: { m: Metric; index: number; onGo?: (p: PageId) => void }) {
  const shown = useShown()
  const v = useCountUp(m.now)
  const pct = m.target ? Math.min(100, (m.now / m.target) * 100) : null
  const empty = m.weeks.every((x) => x === 0)
  const arrow = m.trend === 'better' ? '▲' : m.trend === 'worse' ? '▼' : '•'
  return (
    <div className={`pg-card ${m.trend}`} style={{ animationDelay: `${index * 70}ms` }}>
      <div className="pg-top">
        <span className="pg-label">{m.label}</span>
        <span className={`pg-trend ${m.trend}`}>
          {arrow} {m.deltaText}
        </span>
      </div>
      <div className="pg-value">{m.fmt(Math.round(v))}</div>
      {pct !== null ? (
        <div className="pg-goal">
          <div className="pg-goal-bar">
            <i style={{ width: shown ? `${pct}%` : '0%' }} className={pct >= 100 ? 'full' : ''} />
          </div>
          <span>
            {pct >= 100 ? 'Goal reached 🎉' : `${Math.round(pct)}% of a good week`} · goal {m.targetText}
          </span>
        </div>
      ) : (
        <div className="pg-goal">
          <span>Last week {m.prevText} · usual {m.fmt(Math.round(m.usual))}</span>
        </div>
      )}
      {empty ? (
        <p className="pg-empty">
          {EMPTY[m.id] ?? 'Nothing logged yet.'}
          {m.id === 'focus' && onGo && (
            <button className="btn small" onClick={() => onGo('today')}>
              Start on Today
            </button>
          )}
        </p>
      ) : (
        <>
          <DayStrip m={m} />
          <WeekBars m={m} />
        </>
      )}
    </div>
  )
}

/** The full page. */

function useInsights(): Insights | null {
  const [r, setR] = useState<Insights | null>(null)
  useEffect(() => {
    life.progress?.insights?.().then(setR).catch(() => setR(null))
  }, [])
  return r
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const STREAK_ICON: Record<string, string> = { focus: '🎯', wake: '☀️', sport: '💪', clean: '🛡️', tasks: '✅' }

/** Your year: one square per day, darker for more good things that day. */
function YearHeatmap({ ins }: { ins: Insights }) {
  // Columns are weeks (Monday on top), so pad the first week.
  const first = ins.days[0]
  const pad = first ? (new Date(`${first.day}T12:00:00Z`).getUTCDay() + 6) % 7 : 0
  const cells = [...Array.from({ length: pad }, () => null), ...ins.days]
  const weeks = Math.ceil(cells.length / 7)
  const labels: { col: number; text: string }[] = []
  let last = -1
  for (let c = 0; c < weeks; c++) {
    const d = cells[c * 7] ?? cells[c * 7 + 6]
    if (!d) continue
    const m = Number(d.day.slice(5, 7)) - 1
    if (m !== last) {
      labels.push({ col: c, text: MONTHS[m] })
      last = m
    }
  }
  return (
    <section className="card ins-heat">
      <header className="card-head">
        <h2>
          <Icon name="calendar" size={16} /> Your year
        </h2>
        <span className="hint">
          {ins.activeDays} good days · {Math.round(ins.totalFocusMin / 60)}h focus{ins.bestWeekday ? ` · best day: ${ins.bestWeekday}` : ''}
        </span>
      </header>
      <div className="heat-scroll">
        <div className="heat" style={{ gridTemplateColumns: `repeat(${weeks}, 1fr)` }} role="img" aria-label={`${ins.activeDays} good days in the last year`}>
          <div className="heat-months" style={{ gridColumn: `1 / span ${weeks}`, gridTemplateColumns: `repeat(${weeks}, 1fr)` }}>
            {labels.map((l) => (
              <span key={l.col} style={{ gridColumn: l.col + 1 }}>
                {l.text}
              </span>
            ))}
          </div>
          {cells.map((c, k) =>
            c ? (
              <i key={c.day} className={`l${c.level}`} style={{ gridColumn: Math.floor(k / 7) + 1, gridRow: (k % 7) + 2 }} title={`${c.day}: ${c.parts.length ? c.parts.join(', ') : 'nothing logged'}${c.focusMin ? ` (${c.focusMin} min focus)` : ''}`} />
            ) : (
              <b key={`p${k}`} style={{ gridColumn: 1, gridRow: (k % 7) + 2 }} />
            )
          )}
        </div>
      </div>
      <div className="heat-legend">
        <span className="hint small">Less</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <i key={l} className={`l${l}`} />
        ))}
        <span className="hint small">More · a day counts 50+ min focus, on-time wake-up, workout, clean day, a task done</span>
      </div>
    </section>
  )
}

function Streaks({ ins }: { ins: Insights }) {
  return (
    <section className="ins-streaks" aria-label="Streaks">
      {ins.streaks.map((s) => (
        <div key={s.id} className={`card tight ins-streak ${s.current > 0 ? 'on' : ''}`}>
          <span className="ins-streak-icon">{STREAK_ICON[s.id]}</span>
          <b>{s.current}</b>
          <span className="ins-streak-label">{s.label}</span>
          <small>{s.current === 1 ? 'day' : 'days'} in a row · best {s.best}</small>
        </div>
      ))}
    </section>
  )
}

export function Progress({ onGo, onWallet }: { onGo?: (p: PageId) => void; onWallet?: () => void }) {
  const ins = useInsights()
  const r = useProgress()
  const [plan] = useWeekPlan()
  const [editing, setEditing] = useState(false)
  if (r === undefined) return <PageSkeleton />
  if (r === null) return <section className="panel"><p className="hint">Progress needs your data on this device. Open it on the website.</p></section>
  const diff = r.score - r.prevScore
  const best = r.metrics.filter((m) => m.trend === 'better')
  const worst = r.metrics.filter((m) => m.trend === 'worse')
  const active = plan ? activePlan(plan, r.to) : null
  const planNow = plan !== undefined && (editing || shouldPlan(plan, r.to))
  return (
    <div className="pg">
      {planNow && <WeekPlanner report={r} plan={plan ?? null} today={r.to} onDone={() => setEditing(false)} />}
      {!planNow && active && <WeekCard plan={active} report={r} onEdit={() => setEditing(true)} />}
      <section className="panel pg-hero">
        <ScoreRing score={r.score} />
        <div className="pg-hero-text">
          <span className="pg-kicker">Week score · {r.from.slice(5).replace('-', '/')} to {r.to.slice(5).replace('-', '/')}</span>
          <h2>{r.verdict}</h2>
          <div className="pg-hero-chips">
            <span className={`pg-chip ${diff > 0 ? 'better' : diff < 0 ? 'worse' : ''}`}>
              {diff > 0 ? '▲' : diff < 0 ? '▼' : '•'} {diff === 0 ? 'same score as last week' : `${Math.abs(diff)} points ${diff > 0 ? 'up' : 'down'} on last week (${r.prevScore})`}
            </span>
            {best.length > 0 && <span className="pg-chip better">Best: {best.map((m) => m.label.toLowerCase()).join(', ')}</span>}
            {worst.length > 0 && <span className="pg-chip worse">Fix: {worst.map((m) => m.label.toLowerCase()).join(', ')}</span>}
          </div>
          <p className="hint">The score is how close your last 7 days came to a good week in each area (the goal under each bar). Arrows compare with the 7 days before.</p>
        </div>
      </section>
      {ins && <Streaks ins={ins} />}
      {ins && <YearHeatmap ins={ins} />}
      <div className="pg-grid">
        {r.metrics.map((m, k) => (
          <MetricCard key={m.id} m={m} index={k} onGo={onGo} />
        ))}
      </div>
      <FocusInsights onWallet={onWallet ?? (() => {})} />
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
        </div>
      </div>
    </section>
  )
}
