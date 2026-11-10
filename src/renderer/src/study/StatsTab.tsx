// Study Time → Stats: the full window. A big donut with its legend (tap a
// slice: that subject's sessions and trend), totals, weekly goals per
// subject, a calendar heat map, the timeline of a day, your best hours and
// the CSV export. Rules: src/core/studyInsights.ts, src/core/studyTime.ts.
import { useMemo, useState } from 'react'
import { addDays, dayLabel } from '@core/dates'
import { bestHours, dayTimeline, goalViews, heatMap, sessionsCsv, sliceDetail } from '@core/studyInsights'
import { categoryEmoji, hmText, rangeOf, studyStats, type GroupBy, type RangeKind, type StudySession, type StudyStore } from '@core/studyTime'
import { life } from '../bridge'
import { Donut } from '../Donut'
import { useAction } from '../ui'
import { hhmm } from './studyData'

const RANGES: [RangeKind, string][] = [
  ['day', 'Day'],
  ['week', 'Week'],
  ['month', 'Month'],
  ['custom', 'Custom']
]
const GROUPS: [GroupBy, string][] = [
  ['category', 'Subject'],
  ['tag', 'Tag'],
  ['block', 'Block']
]

export function StatsTab({ store, sessions, today }: { store: StudyStore; sessions: StudySession[]; today: string }) {
  const [kind, setKind] = useState<RangeKind>('week')
  const [by, setBy] = useState<GroupBy>('category')
  const [from, setFrom] = useState(addDays(today, -13))
  const [to, setTo] = useState(today)
  const [picked, setPicked] = useState<string | null>(null)
  const st = useMemo(() => studyStats(sessions, store, rangeOf(kind, today, { from, to }), by, today, 7), [sessions, store, kind, by, from, to, today])
  const change = st.beforeMin ? Math.round(((st.totalMin - st.beforeMin) / st.beforeMin) * 100) : null
  const pick = st.slices.find((s) => s.key === picked) ?? null
  const exportCsv = () => {
    const blob = new Blob([sessionsCsv(sessions, store)], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `study-sessions-${today}.csv`
    document.body.appendChild(a)
    a.click()
    setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 1000)
  }
  return (
    <div className="sy-stats">
      <div className="sy-statbar">
        <div className="sy-seg" role="group" aria-label="Range">
          {RANGES.map(([k, l]) => (
            <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
              {l}
            </button>
          ))}
        </div>
        {kind === 'custom' && (
          <span className="sy-row">
            <input type="date" aria-label="From" value={from} max={today} onChange={(e) => setFrom(e.target.value)} />
            <input type="date" aria-label="To" value={to} max={today} onChange={(e) => setTo(e.target.value)} />
          </span>
        )}
        <span className="sy-hint">{st.range.from === st.range.to ? dayLabel(st.range.from) : `${dayLabel(st.range.from, false)} – ${dayLabel(st.range.to, false)}`}</span>
        <span className="sy-fspace" />
        <button className="btn small" data-testid="study-csv" onClick={exportCsv} title="Every session: block, subject, tags, start, end, breaks, pause, note">
          ⬇ Export CSV
        </button>
      </div>
      <div className="sy-kpis" aria-label="Totals">
        <Kpi label="Studied" value={hmText(st.totalMin)} sub={change === null ? 'nothing before to compare' : `${change >= 0 ? '+' : ''}${change}% vs before`} />
        <Kpi label="Sessions" value={String(st.sessions)} sub={`average ${hmText(st.avgSessionMin)}`} />
        <Kpi label="Breaks" value={hmText(st.breakMin)} sub="kept apart" />
        <Kpi label="Streak" value={`${st.streak} d`} sub={`best ${st.bestStreak} d`} />
        <Kpi label="Against plan" value={st.plan.pct === null ? '—' : `${st.plan.pct}%`} sub={st.plan.plannedMin ? `${hmText(st.plan.actualMin)} of ${hmText(st.plan.plannedMin)}` : 'no planned blocks'} />
        <Kpi label="Best day" value={st.bestDay ? hmText(st.bestDay.minutes) : '—'} sub={st.bestDay ? dayLabel(st.bestDay.day) : ''} />
      </div>
      <div className="sy-sgrid">
        <section className="sy-card sy-where" aria-label="Where your time goes">
          <header className="sy-head">
            <h2>Where your time goes</h2>
            <div className="sy-seg small" role="group" aria-label="Group by">
              {GROUPS.map(([k, l]) => (
                <button key={k} className={by === k ? 'on' : ''} onClick={() => (setBy(k), setPicked(null))}>
                  {l}
                </button>
              ))}
            </div>
          </header>
          <div className="sy-where-body">
            <Donut className="sy-donut" parts={st.slices.map((s) => ({ key: s.key, value: s.minutes, color: s.color, label: `${s.label} · ${hmText(s.minutes)}` }))} total={by === 'tag' ? st.slices.reduce((t, s) => t + s.minutes, 0) : st.totalMin} picked={picked} onPick={(k) => setPicked((p) => (p === k ? null : k))}>
              <b className="num" data-testid="study-donut-total">
                {hmText(pick ? pick.minutes : st.totalMin)}
              </b>
              <small>{pick ? pick.label : 'studied'}</small>
              {!pick && change !== null && <em className={change < 0 ? 'up' : 'down'}>{change > 0 ? `▲ ${change}%` : change < 0 ? `▼ ${Math.abs(change)}%` : 'same as before'}</em>}
            </Donut>
            <ul className="sy-legend">
              {st.slices.map((s) => (
                <li key={s.key} className={picked === s.key ? 'on' : ''}>
                  <button onClick={() => setPicked((p) => (p === s.key ? null : s.key))} aria-pressed={picked === s.key}>
                    <i style={{ background: s.color }} />
                    <span>
                      {by === 'category' && categoryEmoji(store, s.label) ? `${categoryEmoji(store, s.label)} ` : ''}
                      {s.label}
                    </span>
                    <b className="num">{hmText(s.minutes)}</b>
                    <small>{st.totalMin ? Math.round((s.minutes / st.totalMin) * 100) : 0}%</small>
                  </button>
                </li>
              ))}
              {!st.slices.length && <li className="sy-hint">Nothing studied in this range yet.</li>}
            </ul>
          </div>
          {by === 'tag' && st.slices.length > 0 && <p className="sy-hint">A session with two tags counts under both.</p>}
        </section>
        <section className="sy-card sy-detail" aria-label={pick ? `${pick.label}: sessions and trend` : 'Goals this week'}>
          {pick && pick.key !== 'other' ? <SliceDetail store={store} sessions={sessions} by={by} slice={pick} today={today} onClose={() => setPicked(null)} /> : <Goals store={store} sessions={sessions} today={today} />}
        </section>
        <Heat sessions={sessions} today={today} />
        <BestHours sessions={sessions} today={today} />
        <Timeline store={store} sessions={sessions} today={today} />
      </div>
    </div>
  )
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="sy-kpi">
      <small>{label}</small>
      <b className="num">{value}</b>
      <em>{sub}</em>
    </div>
  )
}

function Bars({ values, color, height = 56, labels }: { values: number[]; color: string; height?: number; labels?: string[] }) {
  const max = Math.max(1, ...values)
  return (
    <div className="sy-minibars" style={{ height }}>
      {values.map((v, i) => (
        <div key={i} className="sy-minibar" title={labels ? `${labels[i]} · ${hmText(v)}` : hmText(v)}>
          <i style={{ transform: `scaleY(${v / max})`, background: color }} />
        </div>
      ))}
    </div>
  )
}

function SliceDetail({ store, sessions, by, slice, today, onClose }: { store: StudyStore; sessions: StudySession[]; by: GroupBy; slice: { key: string; label: string; color: string }; today: string; onClose: () => void }) {
  const d = useMemo(() => sliceDetail(sessions, store, by, slice.key, today, 8), [sessions, store, by, slice.key, today])
  const blocks = new Map(store.blocks.map((b) => [b.id, b]))
  const total = d.trend.reduce((t, w) => t + w.minutes, 0)
  return (
    <>
      <header className="sy-head">
        <h2>
          <i className="sy-dot" style={{ background: slice.color }} /> {slice.label}
        </h2>
        <button className="btn small ghost" onClick={onClose} title="Back to your goals">
          ✕ Close
        </button>
      </header>
      <div className="sy-trend">
        <small className="sy-hint">Last 8 weeks · {hmText(total)}</small>
        <Bars values={d.trend.map((w) => w.minutes)} color={slice.color} labels={d.trend.map((w) => `Week of ${dayLabel(w.week, false)}`)} />
      </div>
      <ul className="sy-sesslist compact" data-testid="study-slice-sessions">
        {d.sessions.slice(0, 8).map((s) => (
          <li key={s.id} style={{ ['--c' as string]: slice.color }}>
            <span className="sy-time num">{s.day === today ? hhmm(s.startedAt) : dayLabel(s.day, false)}</span>
            <div className="sy-smain">
              <b>{(s.blockId && blocks.get(s.blockId)?.name) || s.subject}</b>
              {s.note && <small>{s.note}</small>}
            </div>
            <span className="sy-smin num">{hmText(s.minutes)}</span>
          </li>
        ))}
        {!d.sessions.length && <li className="sy-hint">No sessions yet.</li>}
      </ul>
    </>
  )
}

function Goals({ store, sessions, today }: { store: StudyStore; sessions: StudySession[]; today: string }) {
  const act = useAction()
  const goals = goalViews(sessions, store, today)
  const [cat, setCat] = useState('')
  const [hours, setHours] = useState('')
  const cats = [...new Set([...store.categories.map((c) => c.name), ...store.blocks.map((b) => b.category)].filter(Boolean))]
  return (
    <>
      <header className="sy-head">
        <h2>Goals this week</h2>
        <span className="sy-hint">tap a slice for its sessions</span>
      </header>
      <ul className="sy-goals">
        {goals.map((g) => (
          <li key={g.category} className={g.behind ? 'behind' : g.reached ? 'reached' : ''} style={{ ['--c' as string]: g.color }}>
            <div className="sy-goal-top">
              <b>
                {g.emoji} {g.category}
              </b>
              <span className="num">
                {hmText(g.doneMin)} / {hmText(g.goalMin)}
              </span>
              <button className="sy-icon" title="Remove this goal" aria-label={`Remove the ${g.category} goal`} onClick={() => void act(() => life.study!.change({ op: 'goal', category: g.category, minutes: null }), 'Goal removed')}>
                ✕
              </button>
            </div>
            <div className="sy-goalbar" aria-hidden="true">
              <i style={{ transform: `scaleX(${Math.min(1, g.pct / 100)})` }} />
              <em style={{ left: `${Math.min(100, (g.expectedMin / g.goalMin) * 100)}%` }} title="Where an even pace would be today" />
            </div>
            <small className={g.behind ? 'sy-warn' : 'sy-hint'}>{g.reached ? '🎉 Reached' : g.behind ? `⚠ Behind: about ${hmText(g.perDayMin)} a day gets you there` : `${hmText(g.leftMin)} to go · ${g.daysLeft} day${g.daysLeft === 1 ? '' : 's'} left`}</small>
          </li>
        ))}
        {!goals.length && <li className="sy-hint">No goals yet. Set one per subject, e.g. Math 6 h a week.</li>}
      </ul>
      <form
        className="sy-row sy-goalform"
        onSubmit={(e) => {
          e.preventDefault()
          void act(() => life.study!.change({ op: 'goal', category: cat, minutes: Math.round(Number(hours) * 60) }), `Goal: ${cat} ${hours} h a week`).then((r) => r && (setCat(''), setHours('')))
        }}
      >
        <input list="sy-goal-cats" placeholder="Subject" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Goal subject" />
        <datalist id="sy-goal-cats">
          {cats.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <input type="number" min={0.5} max={100} step={0.5} placeholder="Hours a week" value={hours} onChange={(e) => setHours(e.target.value)} aria-label="Hours a week" />
        <button className="btn small primary" disabled={!cat.trim() || !(Number(hours) > 0)}>
          Set goal
        </button>
      </form>
    </>
  )
}

const WEEKDAYS = ['Mon', '', 'Wed', '', 'Fri', '', 'Sun']

function Heat({ sessions, today }: { sessions: StudySession[]; today: string }) {
  const h = useMemo(() => heatMap(sessions, today, 52), [sessions, today])
  return (
    <section className="sy-card sy-heat" aria-label="Minutes per day">
      <header className="sy-head">
        <h2>Every day</h2>
        <span className="sy-hint sy-heat-key">
          last 52 weeks · {h.activeDays} days · {hmText(h.totalMin)}
          <small>less</small>
          {[0, 1, 2, 3, 4].map((l) => (
            <i key={l} className={`l${l}`} aria-hidden="true" />
          ))}
          <small>more</small>
        </span>
      </header>
      <div className="sy-heat-body">
        <div className="sy-heat-days" aria-hidden="true">
          {WEEKDAYS.map((d, i) => (
            <small key={i}>{d}</small>
          ))}
        </div>
        <div className="sy-heat-grid" data-testid="study-heat">
          {h.weeks.map((w, i) => (
            <div key={i} className="sy-heat-col">
              {w.map((c) => (
                <i key={c.day} className={`l${c.level} ${c.future ? 'future' : ''} ${c.day === today ? 'today' : ''}`} title={c.future ? '' : `${dayLabel(c.day)} · ${hmText(c.minutes)}`} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function BestHours({ sessions, today }: { sessions: StudySession[]; today: string }) {
  const b = useMemo(() => bestHours(sessions, today, 30), [sessions, today])
  const max = Math.max(1, ...b.hours.map((h) => h.minutes))
  const best = new Set(b.best)
  return (
    <section className="sy-card sy-hours" aria-label="Best hours">
      <header className="sy-head">
        <h2>Best hours</h2>
        <span className="sy-hint">last 30 days</span>
      </header>
      <div className="sy-hourbars">
        {b.hours.map((h) => (
          <div key={h.hour} className={`sy-hourbar ${best.has(h.hour) ? 'best' : ''}`} title={`${h.hour}:00–${h.hour + 1}:00 · ${hmText(h.minutes)}${h.sessions ? ` · ${h.sessions} started, ${hmText(h.avgMin)} on average` : ''}`}>
            <i style={{ transform: `scaleY(${h.minutes / max})` }} />
            {h.hour % 3 === 0 && <small>{h.hour}</small>}
          </div>
        ))}
      </div>
      <p className="sy-hint" data-testid="study-best-hours">
        {b.line || 'A few more timed sessions and your best hours show here.'}
      </p>
    </section>
  )
}

function Timeline({ store, sessions, today }: { store: StudyStore; sessions: StudySession[]; today: string }) {
  const [day, setDay] = useState(today)
  const t = useMemo(() => dayTimeline(sessions, store, day), [sessions, store, day])
  const span = t.to - t.from
  const hours = Array.from({ length: Math.floor(span / 60) + 1 }, (_, i) => t.from / 60 + i)
  const total = t.segs.reduce((a, s) => a + s.minutes, 0)
  return (
    <section className="sy-card sy-timeline" aria-label="The day's timeline">
      <header className="sy-head">
        <h2>The day</h2>
        <div className="sy-tl-legend">
          {!t.segs.length && <span>Nothing studied this day.</span>}
          {[...new Map(t.segs.map((s) => [s.label, s])).values()].slice(0, 6).map((s) => (
            <span key={s.label}>
              <i style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
        <div className="sy-row">
          <button className="sy-icon" onClick={() => setDay(addDays(day, -1))} aria-label="The day before" title="The day before">
            ‹
          </button>
          <span className="sy-tday">{day === today ? 'Today' : dayLabel(day)}</span>
          <button className="sy-icon" onClick={() => setDay(addDays(day, 1))} disabled={day >= today} aria-label="The next day" title="The next day">
            ›
          </button>
          <span className="sy-hint">{hmText(total)}</span>
        </div>
      </header>
      <div className="sy-tl" data-testid="study-timeline">
        <div className="sy-tl-track">
          {t.segs.map((s, i) => (
            <span
              key={i}
              className="sy-tl-seg"
              style={{ left: `${((s.from - t.from) / span) * 100}%`, width: `${Math.max(0.4, ((s.to - s.from) / span) * 100)}%`, background: s.color }}
              title={`${s.emoji ? `${s.emoji} ` : ''}${s.label} · ${hmText(s.minutes)}${s.note ? ` · ${s.note}` : ''}`}
            >
              {(s.to - s.from) / span > 0.06 && <small>{s.label}</small>}
            </span>
          ))}
        </div>
        <div className="sy-tl-hours" aria-hidden="true">
          {hours.map((h) => (
            <small key={h} style={{ left: `${((h * 60 - t.from) / span) * 100}%` }}>
              {h % 3 === 0 ? `${h % 24}:00` : ''}
            </small>
          ))}
        </div>
      </div>

    </section>
  )
}
