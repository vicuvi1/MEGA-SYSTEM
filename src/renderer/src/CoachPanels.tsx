// Coach page: "Is the coach working?" (the weekly scorecard from its history)
// and "Goal plans" (each goal planned backward from its deadline: minutes a
// day, weekly milestones, what a miss costs, and its blocks booked for 7 days).
import { useCallback, useEffect, useState } from 'react'
import type { FocusState } from '@shared/api'
import type { WeekRow } from '@core/coachImpact'
import { calendarDay } from '@core/dates'
import { missCost, planGoal, type GoalPlan } from '@core/goalPlan'
import { life } from './bridge'
import { Icon } from './Icon'
import { useAction } from './ui'
import { useLive } from './live'

const VERDICT: Record<string, { label: string; cls: string }> = {
  working: { label: 'Working: you are improving', cls: 'good' },
  mixed: { label: 'Mixed: some up, some down', cls: 'ok' },
  'not yet': { label: 'Not working yet: change something', cls: 'low' },
  'too early': { label: 'Too early to tell', cls: 'ok' }
}

const shortWeek = (monday: string) => {
  const d = new Date(`${monday}T12:00:00Z`)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

export function CoachScorecard() {
  const [data, setData] = useState<{ rows: WeekRow[]; verdict: string; lines: string[] } | null>(null)
  const load = useCallback(() => {
    life.coach?.scorecard?.().then(setData).catch(() => {})
  }, [])
  useEffect(load, [load])
  useLive(load)
  if (!life.coach?.scorecard || !data) return null
  const v = VERDICT[data.verdict] ?? VERDICT['too early']
  const rows = data.rows.slice(-6)
  return (
    <section className="panel sc">
      <header className="panel-head">
        <h2>
          <Icon name="chart" /> Is the coach working?
        </h2>
      </header>
      <p className={`sc-verdict ${v.cls}`}>{v.label}</p>
      <ul className="sc-lines">
        {data.lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <div className="sc-table" role="table" aria-label="Last weeks">
        <div className="sc-row sc-headrow" role="row">
          <span>Week</span>
          <span title="Promises kept out of all judged">Kept</span>
          <span title="Average evening score">Score</span>
          <span>Focus</span>
          <span title="Plans approved out of proposed">Plans</span>
        </div>
        {rows.map((r) => (
          <div key={r.week} className="sc-row" role="row">
            <span>{shortWeek(r.week)}</span>
            <span>{r.keptPct == null ? '—' : `${r.keptPct}%`}</span>
            <span className="sc-score">
              {r.avgScore == null ? '—' : (
                <>
                  <i style={{ width: `${r.avgScore}%` }} />
                  <b>{r.avgScore}</b>
                </>
              )}
            </span>
            <span>{r.focusMin ? `${(r.focusMin / 60).toFixed(1)}h` : '—'}</span>
            <span>{r.plansProposed ? `${r.plansApproved}/${r.plansProposed}` : '—'}</span>
          </div>
        ))}
      </div>
      <p className="hint small">Last 2 weeks against the 2 before. Answer check-ins and approve plans so it can measure.</p>
    </section>
  )
}

const STATUS: Record<GoalPlan['status'], string> = { done: 'Done', ahead: 'Ahead', 'on track': 'On track', behind: 'Behind', late: 'Past deadline' }

export function GoalPlans() {
  const act = useAction()
  const [focus, setFocus] = useState<FocusState | null>(null)
  const [busy, setBusy] = useState<number | 'all' | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ title: '', subject: '', deadline: '', hours: '' })
  const load = useCallback(() => {
    life.focus.state().then(setFocus).catch(() => {})
  }, [])
  useEffect(load, [load])
  useLive(load)
  if (!focus) return null
  const today = calendarDay()
  const plans = focus.goals.map((g) => planGoal(g, today, focus.todaySessions.filter((x) => x.subject.toLowerCase() === g.subject.toLowerCase()).reduce((t, x) => t + x.minutes, 0)))
  const book = async (id?: number) => {
    setBusy(id ?? 'all')
    const r = await act(() => life.coach!.rhythm!('book', id ? String(id) : undefined))
    setBusy(null)
    if (r?.lines?.length) await act(async () => r, r.lines.join(' · '))
  }
  const save = async () => {
    const hours = Number(form.hours)
    if (!form.title.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(form.deadline) || !(hours > 0)) return
    const r = await act(() => life.focus.saveGoal({ title: form.title.trim(), subject: (form.subject || form.title).trim(), deadline: form.deadline, hours }), 'Goal added: book its blocks next')
    if (r) {
      setFocus(r)
      setAdding(false)
      setForm({ title: '', subject: '', deadline: '', hours: '' })
    }
  }
  return (
    <section className="panel gp">
      <header className="panel-head">
        <h2>
          <Icon name="trophy" /> Goal plans
        </h2>
        {plans.length > 1 && life.coach?.rhythm && (
          <button className="btn small ghost" disabled={busy != null} onClick={() => void book()}>
            {busy === 'all' ? 'Booking…' : 'Book all'}
          </button>
        )}
      </header>
      {!plans.length && !adding && <p className="hint small">A goal with a deadline and the hours it needs (an exam, a project, your CV). The coach works backward: minutes a day, weekly milestones, blocks in your calendar that move when you miss a day.</p>}
      <div className="gp-list">
        {plans.map((p) => {
          const cost = missCost(p)
          const doneH = (focus.goals.find((g) => g.id === p.goalId)?.doneMin ?? 0) / 60
          const total = focus.goals.find((g) => g.id === p.goalId)?.hours ?? 1
          return (
            <article key={p.goalId} className={`gp-goal ${p.status.replace(' ', '-')}`}>
              <div className="gp-top">
                <div>
                  <h3>{p.title}</h3>
                  <small>
                    {p.subject} · due {p.deadline} · {p.daysLeft} day{p.daysLeft === 1 ? '' : 's'} left
                  </small>
                </div>
                <span className={`gp-status ${p.status.replace(' ', '-')}`}>{STATUS[p.status]}</span>
              </div>
              <div className="gp-bar" aria-label={`${doneH.toFixed(1)} of ${total} hours`}>
                <i style={{ width: `${Math.min(100, (doneH / total) * 100)}%` }} />
              </div>
              <p className="gp-nums">
                <b>{doneH.toFixed(1)}</b>/{total}h · <b>{p.perDayMin} min/day</b>
                {p.status !== 'done' && (p.todayLeftMin ? ` · ${p.todayLeftMin} min still today` : ' · today done ✓')}
              </p>
              {cost > 0 && <p className="gp-cost">Skip today and it becomes {p.perDayMin + cost} min/day (+{cost}).</p>}
              {p.milestones.length > 0 && (
                <ol className="gp-miles">
                  {p.milestones.slice(0, 4).map((m) => (
                    <li key={m.by} className={m.state}>
                      <span>by {m.by.slice(5)}</span>
                      <b>{m.targetH}h</b>
                    </li>
                  ))}
                </ol>
              )}
              {p.status !== 'done' && p.status !== 'late' && life.coach?.rhythm && (
                <button className="btn small primary" disabled={busy != null} onClick={() => void book(p.goalId)}>
                  {busy === p.goalId ? 'Booking…' : 'Book next 7 days'}
                </button>
              )}
            </article>
          )
        })}
      </div>
      {adding ? (
        <form
          className="gp-form"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <input autoFocus placeholder="Goal, e.g. Pass the algebra exam" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <input placeholder="Subject (what you focus on), e.g. Algebra" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
          <div className="gp-form-row">
            <label>
              Deadline
              <input type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
            </label>
            <label>
              Hours it needs
              <input type="number" min={1} max={500} placeholder="20" value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} />
            </label>
          </div>
          <div className="gp-form-row">
            <button className="btn primary small">Add goal</button>
            <button type="button" className="btn ghost small" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button className="btn small ghost gp-add" onClick={() => setAdding(true)}>
          <Icon name="plus" size={13} /> Add a goal with a deadline
        </button>
      )}
    </section>
  )
}
