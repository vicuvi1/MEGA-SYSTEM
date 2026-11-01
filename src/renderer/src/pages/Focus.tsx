// Focus state (shared by Today's Now card and the bots' focus buttons), and
// the focus section of Insights: this week, goals with a deadline, and a
// session logged by hand. The timer itself lives in Today's Now card.
import { useCallback, useEffect, useState } from 'react'
import { hm, type GoalProgress } from '@core/focus'
import type { FocusState } from '@shared/api'
import { life } from '../bridge'
import { Icon } from '../Icon'
import { useAction } from '../ui'

export function useFocus(): [FocusState | null, () => void, (s: FocusState) => void] {
  const [st, setSt] = useState<FocusState | null>(null)
  const load = useCallback(() => {
    life.focus.state().then(setSt).catch(() => {})
  }, [])
  useEffect(() => {
    load()
    window.addEventListener('life-wallet-changed', load)
    window.addEventListener('life-focus-changed', load)
    return () => {
      window.removeEventListener('life-wallet-changed', load)
      window.removeEventListener('life-focus-changed', load)
    }
  }, [load])
  return [st, load, setSt]
}

function GoalRow({ g, onArchive }: { g: GoalProgress; onArchive: () => void }) {
  const pct = Math.min(100, (g.doneMin / 60 / g.hours) * 100)
  return (
    <li className="goal-row">
      <div className="row">
        <b>{g.title}</b>
        <span className="hint">
          #{g.subject} · {g.daysLeft} days left
        </span>
        <span className="spacer" />
        <span className={`chip ${g.aheadH >= 0 ? 'ok' : 'warn'}`}>{g.aheadH >= 0 ? `${g.aheadH}h ahead` : `${-g.aheadH}h behind`}</span>
        <button className="icon-btn" aria-label={`Archive ${g.title}`} title="Done / archive" onClick={onArchive}>
          ✕
        </button>
      </div>
      <div className="bar">
        <i style={{ width: `${pct}%` }} />
      </div>
      <span className="hint">
        {hm(g.doneMin)} of {g.hours}h · needs about <b>{g.perWeekH}h a week</b> from now
      </span>
    </li>
  )
}

/** Focus on Insights: this week's minutes, goals with a deadline, and a session logged by hand. */
export function FocusInsights({ onWallet }: { onWallet: () => void }) {
  const act = useAction()
  const [st, , setSt] = useFocus()
  const [goal, setGoal] = useState({ title: '', subject: '', deadline: '', hours: 20 })
  const [addMin, setAddMin] = useState({ subject: '', minutes: 30 })
  if (!st) return null
  const w = st.week
  const maxDay = Math.max(60, ...w.byDay.map((d) => d.minutes))
  return (
    <div className="ins-two">
      <section className="card">
        <header className="card-head">
          <h2>
            <Icon name="clock" size={16} /> Focus this week
          </h2>
          <span className="hint">{hm(w.totalMin)} · today {hm(st.todayMin)}</span>
        </header>
        {w.totalMin === 0 ? (
          <p className="hint">No focus sessions this week yet. Tap ▶ on any task on Today.</p>
        ) : (
          <div className="week-bars" role="img" aria-label="Focus minutes per day, last 7 days">
            {w.byDay.map((d) => (
              <div key={d.day} className="week-bar" title={`${d.day}: ${hm(d.minutes)}`}>
                <i style={{ height: `${Math.max(2, (d.minutes / maxDay) * 100)}%` }} />
                <span>{new Date(`${d.day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'narrow', timeZone: 'UTC' })}</span>
              </div>
            ))}
          </div>
        )}
        <ul className="week-facts">
          {w.bySubject.map((s) => (
            <li key={s.subject}>
              <span>{s.subject}</span>
              <b>{hm(s.minutes)}</b>
            </li>
          ))}
          {w.topReasons.length > 0 && (
            <li>
              <span>What got in the way</span>
              <b>{w.topReasons.map((r) => `${r.reason} (${r.count})`).join(', ')}</b>
            </li>
          )}
        </ul>
        <details className="focus-add">
          <summary>Did a session without the timer?</summary>
          <div className="row">
            <input value={addMin.subject} onChange={(e) => setAddMin({ ...addMin, subject: e.target.value })} placeholder="Subject" maxLength={40} />
            <input type="number" min={1} max={600} value={addMin.minutes} onChange={(e) => setAddMin({ ...addMin, minutes: Number(e.target.value) })} style={{ width: 90 }} />
            <span className="hint">min</span>
            <button className="btn small" disabled={!addMin.subject.trim()} onClick={async () => { const r = await act(() => life.focus.add(addMin.subject, addMin.minutes), 'Logged'); if (r) { setSt(r.state); onWallet() } }}>
              Add
            </button>
          </div>
        </details>
      </section>

      <section className="card">
        <header className="card-head">
          <h2>
            <Icon name="trophy" size={16} /> Goals with a deadline
          </h2>
        </header>
        {st.goals.length === 0 && <p className="hint">An exam or project? Add it with the hours it needs; you'll see the weekly target and whether you're behind.</p>}
        <ul className="goal-list">
          {st.goals.map((g) => (
            <GoalRow key={g.id} g={g} onArchive={async () => { const s = await act(() => life.focus.archiveGoal(g.id), 'Goal archived'); if (s) setSt(s) }} />
          ))}
        </ul>
        <div className="goal-form">
          <input value={goal.title} onChange={(e) => setGoal({ ...goal, title: e.target.value })} placeholder="Goal, e.g. Math exam" maxLength={80} />
          <input value={goal.subject} onChange={(e) => setGoal({ ...goal, subject: e.target.value })} placeholder="Subject it counts (e.g. Math)" maxLength={40} />
          <input type="date" value={goal.deadline} onChange={(e) => setGoal({ ...goal, deadline: e.target.value })} />
          <label className="row">
            <input type="number" min={1} max={2000} value={goal.hours} onChange={(e) => setGoal({ ...goal, hours: Number(e.target.value) })} style={{ width: 80 }} /> <span className="hint">hours</span>
          </label>
          <button
            className="btn small"
            disabled={!goal.title.trim() || !goal.deadline}
            onClick={async () => {
              const s = await act(() => life.focus.saveGoal({ ...goal, subject: goal.subject || goal.title }), 'Goal added')
              if (s) {
                setSt(s)
                setGoal({ title: '', subject: '', deadline: '', hours: 20 })
              }
            }}
          >
            <Icon name="plus" size={12} /> Add goal
          </button>
        </div>
      </section>
    </div>
  )
}
