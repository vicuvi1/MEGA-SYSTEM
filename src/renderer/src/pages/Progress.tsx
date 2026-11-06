// "Am I improving?": every area in one place. A week score, then for each
// area: the last 7 days against last week, a bar toward a good week, the 7
// days one by one and your last 6 weeks (numbers from @core/progress).
import { dayRange } from '@core/dates'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { Metric } from '@core/progress'
import { life } from '../bridge'
import { Icon } from '../Icon'
import type { PageId } from '../modules'
import { WeekCard, WeekPlanner, shouldPlan, useWeekPlan } from '../WeekPlanner'
import { activePlan } from '@core/weekPlan'
import type { Insights } from '@core/insights'
import { FocusInsights } from './Focus'
import { PageSkeleton } from '../blocks'
import { useLive } from '../live'
import { GrowthSections } from './Growth'
import { MonthReview, MoodLinksCard, PlannedVsReal, YearRecapView, saveTab, savedTab, type InsightsTab } from './Reviews'
import { barFill } from '../motionKit'
import { PageTabs, TabPanel, usePageTab, type PageTab } from '../PageTabs'
import './insights.css'
import { useSeen } from '../motionKit'
export { YearOffer, openYear } from './Reviews'
import { ScoreRing, useCountUp, useProgress, useShown, weekday } from './ProgressCard'
export { ProgressCard, useProgress } from './ProgressCard'


/** The 7 days one by one: a tick per day, or a small bar for amounts. */
function DayStrip({ m }: { m: Metric }) {
  const max = Math.max(1, ...m.days.map((d) => d.value))
  const [seenRef, seen] = useSeen<HTMLDivElement>()
  return (
    <div ref={seenRef} className={`pg-days chart-in ${seen ? 'seen' : ''}`} role="img" aria-label={`${m.label}, last 7 days: ${m.days.map((d) => `${weekday(d.day)} ${m.dayText(d.value)}`).join(', ')}`}>
      {m.days.map((d, k) => (
        <div key={d.day} className="pg-day" title={`${weekday(d.day)} ${d.day.slice(5)}: ${m.dayText(d.value)}`}>
          {m.daily ? (
            <span className={`pg-dot ${d.value ? 'on' : ''}`} style={{ animationDelay: `${k * 20}ms` }} />
          ) : (
            <span className="pg-mini-bar">
              <i className={d.value ? 'on' : ''} style={{ height: `${d.value ? Math.max(14, (d.value / max) * 100) : 6}%`, animationDelay: `${k * 20}ms` }} />
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
  const [seenRef, seen] = useSeen<HTMLDivElement>()
  return (
    <div className="pg-weeks">
      <div ref={seenRef} className={`pg-weeks-bars chart-in ${seen ? 'seen' : ''}`} role="img" aria-label={`${m.label}, last ${n} weeks: ${m.weeks.map((v) => m.fmt(v)).join(', ')}`}>
        {m.weeks.map((v, k) => (
          <div key={k} className={`pg-week ${k === n - 1 ? 'now' : ''}`} title={`${k === n - 1 ? 'Last 7 days' : `${n - 1 - k} week${n - 1 - k > 1 ? 's' : ''} before`}: ${m.fmt(v)}`}>
            {k === n - 1 && v > 0 && <em>{m.fmt(v)}</em>}
            <i style={{ height: `${v ? Math.max(8, (v / max) * 100) : 3}%`, animationDelay: `${k * 20}ms` }} />
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
          <div className="pg-goal-bar pbar">
            <i style={barFill(shown ? pct / 100 : 0)} className={pct >= 100 ? 'full' : ''} />
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
  const load = useCallback(() => {
    life.progress?.insights?.().then(setR).catch(() => setR(null))
  }, [])
  useEffect(load, [load])
  useLive(load)
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

/** Month or Year inside "Look back". */
function LookBackTabs({ tab, setTab }: { tab: InsightsTab; setTab: (t: InsightsTab) => void }) {
  return (
    <div className="rv-tabs" role="tablist" aria-label="Look back at">
      {(['month', 'year'] as InsightsTab[]).map((t) => (
        <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
          {t === 'month' ? 'Month' : 'Your year'}
        </button>
      ))}
    </div>
  )
}

const INSIGHTS_TABS: PageTab[] = [
  { id: 'week', label: 'Week', title: 'Week score, your week plan, planned vs real (1)' },
  { id: 'areas', label: 'Areas', title: 'Each area: the last 7 days against last week (2)' },
  { id: 'streaks', label: 'Streaks', title: 'Streaks, milestones, the long view and your year (3)' },
  { id: 'focus', label: 'Focus', title: 'Focus this week and goals with a deadline (4)' },
  { id: 'look', label: 'Look back', title: 'Month and year reviews (5)' }
]

export function Progress({ onGo, onWallet }: { onGo?: (p: PageId) => void; onWallet?: () => void }) {
  const [tab, setTab] = usePageTab('progress', INSIGHTS_TABS.map((t) => t.id), savedTab() === 'week' ? 'week' : 'look')
  // Month or year inside Look back (kept as before).
  const [back, setBackRaw] = useState<InsightsTab>(() => (savedTab() === 'year' ? 'year' : 'month'))
  const setBack = (t: InsightsTab) => {
    setBackRaw(t)
    saveTab(t)
  }
  useEffect(() => {
    // Links from elsewhere (the year recap offer, Ctrl+K "month review").
    const on = (e: Event) => {
      const d = ((e as CustomEvent).detail as InsightsTab) || 'week'
      if (d === 'week') setTab('week')
      else {
        setBackRaw(d)
        setTab('look')
      }
    }
    window.addEventListener('life-insights-tab', on)
    return () => window.removeEventListener('life-insights-tab', on)
  }, [setTab])
  const ins = useInsights()
  const r = useProgress()
  return (
    <div className="pg">
      <PageTabs page="progress" label="Insights views" tabs={INSIGHTS_TABS} value={tab} onChange={setTab} />
      <TabPanel page="progress" id="week" value={tab}>
        <WeekInsights r={r} />
      </TabPanel>
      <TabPanel page="progress" id="areas" value={tab}>
        {r ? (
          <div className="pg-grid pg-grid-tab">
            {r.metrics.map((m, k) => (
              <MetricCard key={m.id} m={m} index={k} onGo={onGo} />
            ))}
          </div>
        ) : r === undefined ? <PageSkeleton /> : null}
      </TabPanel>
      <TabPanel page="progress" id="streaks" value={tab}>
        <GrowthSections />
        {ins && <Streaks ins={ins} />}
        {ins && <YearHeatmap ins={ins} />}
      </TabPanel>
      <TabPanel page="progress" id="focus" value={tab}>
        <FocusInsights onWallet={onWallet ?? (() => {})} />
      </TabPanel>
      <TabPanel page="progress" id="look" value={tab}>
        <LookBackTabs tab={back} setTab={setBack} />
        {tab === 'look' && (back === 'year' ? <YearRecapView /> : <MonthReview />)}
      </TabPanel>
    </div>
  )
}

function WeekInsights({ r }: { r: ReturnType<typeof useProgress> }) {
  const [plan] = useWeekPlan()
  const [editing, setEditing] = useState(false)
  if (r === undefined) return <PageSkeleton />
  if (r === null) return <section className="panel"><p className="hint">Progress needs your data on this device. Open it on the website.</p></section>
  const diff = r.score - r.prevScore
  const best = r.metrics.filter((m) => m.trend === 'better')
  const worst = r.metrics.filter((m) => m.trend === 'worse')
  const active = plan ? activePlan(plan, r.to) : null
  const planNow = plan !== undefined && (editing || shouldPlan(plan, r.to))
  // Wide screens: the score and your week plan on the left, planned vs real and
  // mood on the right (insights.css); narrow screens: one column, as before.
  return (
    <div className="pg-wk">
      <section className="panel pg-hero">
        <ScoreRing score={r.score} />
        <div className="pg-hero-text">
          <span className="pg-kicker">Week score · {dayRange(r.from, r.to)}</span>
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
      {/* The score first, then planning the week (V6). */}
      {planNow && <WeekPlanner report={r} plan={plan ?? null} today={r.to} onDone={() => setEditing(false)} />}
      {!planNow && active && <WeekCard plan={active} report={r} onEdit={() => setEditing(true)} />}
      <div className="rv-pair pg-wk-side">
        <PlannedVsReal />
        <MoodLinksCard />
      </div>
    </div>
  )
}
