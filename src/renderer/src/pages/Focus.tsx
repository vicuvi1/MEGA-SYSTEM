// Focus: the page for studying and working. A timer that logs real minutes
// per subject (coins for focus time), today's 1–3 must-dos with a 30-second
// evening review, goals with a deadline (weekly hours target), the week in
// numbers, and fun time that costs coins.
import { useCallback, useEffect, useState } from 'react'
import { REASONS, hm, type GoalProgress } from '@core/focus'
import type { FocusState } from '@shared/api'
import { life } from '../bridge'
import { Icon } from '../Icon'
import { soundCoin, soundSuccess } from '../sound'
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

function useTick(on: boolean) {
  const [, set] = useState(0)
  useEffect(() => {
    if (!on) return
    const t = setInterval(() => set((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [on])
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${h ? h + ':' : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** The timer: pick a subject and a length, start; stop logs the minutes. */
export function FocusTimer({ st, onState, onWallet }: { st: FocusState; onState: (s: FocusState) => void; onWallet: () => void }) {
  const act = useAction()
  const [subject, setSubject] = useState(st.subjects[0] ?? '')
  const [planned, setPlanned] = useState(50)
  const run = st.running
  useTick(!!run)
  if (run) {
    const elapsed = Date.now() - Date.parse(run.startedAt)
    const pct = Math.min(100, (elapsed / (run.planned * 60000)) * 100)
    return (
      <div className="focus-run">
        <div className="focus-clock">{clock(elapsed)}</div>
        <div className="focus-sub">
          <b>{run.subject}</b> · of {run.planned} min{pct >= 100 ? ' · time! stop when you finish the thought' : ''}
        </div>
        <div className="bar">
          <i style={{ width: `${pct}%` }} />
        </div>
        <div className="row">
          <button
            className="btn primary"
            onClick={async () => {
              const r = await act(() => life.focus.stop(), undefined)
              if (!r) return
              r.coins ? soundCoin() : soundSuccess()
              onState(r.state)
              onWallet()
            }}
          >
            <Icon name="check" size={14} /> Stop & log
          </button>
          <button className="btn ghost" onClick={async () => { const s = await act(() => life.focus.cancel()); if (s) onState(s) }}>
            Cancel
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="focus-start">
      <div className="focus-chips">
        {st.subjects.map((s) => (
          <button key={s} className={`chip ${s === subject ? 'on' : ''}`} onClick={() => setSubject(s)}>
            {s}
          </button>
        ))}
      </div>
      <div className="row focus-start-row">
        <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="What? e.g. Math, Programming, Work" maxLength={40} />
        <div className="seg">
          {[25, 50, 90].map((n) => (
            <button key={n} type="button" className={planned === n ? 'on' : ''} onClick={() => setPlanned(n)}>
              {n}m
            </button>
          ))}
        </div>
        <button className="btn primary" disabled={!subject.trim()} onClick={async () => { const s = await act(() => life.focus.start(subject, planned)); if (s) onState(s) }}>
          <Icon name="clock" size={14} /> Start focus
        </button>
      </div>
      <p className="hint">1 coin per 5 minutes, +5 for a full 50. Telegram: <code>/focus 50 math</code>, <code>/stop</code>.</p>
    </div>
  )
}

/** Today's must-dos: write 1–3, tick them off; the evening review below. */
export function DayPlanCard({ st, onState, onWallet, review = true }: { st: FocusState; onState: () => void; onWallet: () => void; review?: boolean }) {
  const act = useAction()
  const plan = st.plan
  const [editing, setEditing] = useState(plan.items.length === 0)
  const [text, setText] = useState(plan.items.map((i) => i.text).join('\n'))
  const [reasons, setReasons] = useState<string[]>(plan.reasons)
  const [note, setNote] = useState(plan.review ?? '')
  useEffect(() => {
    setEditing(plan.items.length === 0)
    setText(plan.items.map((i) => i.text).join('\n'))
    setReasons(plan.reasons)
    setNote(plan.review ?? '')
  }, [plan.day, plan.items.length, plan.review])
  const done = plan.items.filter((i) => i.done).length
  const evening = new Date().getHours() >= 18

  return (
    <div className="day-plan">
      {editing ? (
        <>
          <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={'1–3 must-dos for today, one per line\ne.g. Essay intro\nGym\nCall Leo'} />
          <div className="row">
            <button
              className="btn primary"
              disabled={!text.trim()}
              onClick={async () => {
                const items = text.split('\n').map((l) => l.replace(/^\s*(\d+[.)]|-)\s*/, '').trim()).filter(Boolean)
                if (await act(() => life.focus.setPlan(items), 'Plan saved')) {
                  setEditing(false)
                  onState()
                }
              }}
            >
              Save plan
            </button>
            {plan.items.length > 0 && (
              <button className="btn ghost" onClick={() => setEditing(false)}>
                Cancel
              </button>
            )}
          </div>
          <p className="hint">The bot asks for these every morning; reply to it, or send <code>/plan essay; gym; call Leo</code>.</p>
        </>
      ) : (
        <>
          <ul className="plan-list">
            {plan.items.map((it, i) => (
              <li key={i} className={it.done ? 'done' : ''}>
                <button
                  className="plan-check"
                  aria-label={it.done ? `Untick ${it.text}` : `Tick ${it.text}`}
                  onClick={async () => {
                    const r = await act(() => life.focus.togglePlan(i))
                    if (!r) return
                    if (r.coins) {
                      soundCoin()
                      onWallet()
                    }
                    onState()
                  }}
                >
                  {it.done ? '✓' : ''}
                </button>
                <span>{it.text}</span>
              </li>
            ))}
          </ul>
          <div className="row">
            <span className="hint">
              {done}/{plan.items.length} done · +10 coins each
            </span>
            <span className="spacer" />
            <button className="btn small ghost" onClick={() => setEditing(true)}>
              <Icon name="edit" size={12} /> Edit
            </button>
          </div>
          {review && (evening || plan.review || plan.reasons.length > 0) && (
            <div className="plan-review">
              <h3>Evening review{done === plan.items.length ? ' · all done 🎉' : ''}</h3>
              {done < plan.items.length && (
                <>
                  <span className="hint">What got in the way?</span>
                  <div className="focus-chips">
                    {REASONS.map((r) => (
                      <button key={r} className={`chip ${reasons.includes(r) ? 'on' : ''}`} onClick={() => setReasons((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]))}>
                        {r}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="One line about today (optional)" maxLength={500} />
              <button className="btn small" onClick={async () => { if (await act(() => life.focus.review(note || null, reasons), 'Review saved')) onState() }}>
                Save review
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
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

export function Focus({ onWallet }: { onWallet: () => void }) {
  const act = useAction()
  const [st, load, setSt] = useFocus()
  const [goal, setGoal] = useState({ title: '', subject: '', deadline: '', hours: 20 })
  const [addMin, setAddMin] = useState({ subject: '', minutes: 30 })
  const [funMin, setFunMin] = useState(30)
  const [funWhat, setFunWhat] = useState('YouTube')
  if (!st) return <div className="empty">Loading…</div>
  const w = st.week
  const maxDay = Math.max(60, ...w.byDay.map((d) => d.minutes))

  return (
    <div className="focus-page">
      <section className="panel">
        <header className="panel-head">
          <h2>
            <Icon name="clock" /> Focus
          </h2>
          <span className="hint">
            Today {hm(st.todayMin)} · {st.focusCoinsToday} coins
          </span>
        </header>
        <FocusTimer st={st} onState={setSt} onWallet={onWallet} />
        {st.todayBySubject.length > 0 && <p className="hint block">{st.todayBySubject.map((s) => `${s.subject} ${hm(s.minutes)}`).join(' · ')}</p>}
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

      <div className="cols even">
        <section className="panel">
          <header className="panel-head">
            <h2>
              <Icon name="check" /> Today's must-dos
            </h2>
          </header>
          <DayPlanCard st={st} onState={load} onWallet={onWallet} />
        </section>

        <section className="panel">
          <header className="panel-head">
            <h2>
              <Icon name="trophy" /> Goals with a deadline
            </h2>
          </header>
          {st.goals.length === 0 && <p className="hint block">An exam or project? Add it with the hours it needs; Life System works out the weekly target and tells you if you're behind.</p>}
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

      <div className="cols even">
        <section className="panel">
          <header className="panel-head">
            <h2>
              <Icon name="list" /> This week
            </h2>
            <span className="hint">{hm(w.totalMin)} focused</span>
          </header>
          <div className="week-bars" role="img" aria-label="Focus minutes per day, last 7 days">
            {w.byDay.map((d) => (
              <div key={d.day} className="week-bar" title={`${d.day}: ${hm(d.minutes)}`}>
                <i style={{ height: `${Math.max(2, (d.minutes / maxDay) * 100)}%` }} />
                <span>{new Date(`${d.day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'narrow', timeZone: 'UTC' })}</span>
              </div>
            ))}
          </div>
          <ul className="week-facts">
            {w.bySubject.map((s) => (
              <li key={s.subject}>
                <span>{s.subject}</span>
                <b>{hm(s.minutes)}</b>
              </li>
            ))}
            <li>
              <span>Must-dos done</span>
              <b>
                {w.planDone}/{w.planTotal}
              </b>
            </li>
            {w.topReasons.length > 0 && (
              <li>
                <span>What got in the way</span>
                <b>{w.topReasons.map((r) => `${r.reason} (${r.count})`).join(', ')}</b>
              </li>
            )}
            <li>
              <span>Fun time</span>
              <b>{hm(w.funMin)}</b>
            </li>
          </ul>
        </section>

        <section className="panel">
          <header className="panel-head">
            <h2>
              <Icon name="gift" /> Earn your fun
            </h2>
            <span className="hint">today {hm(st.funToday)}</span>
          </header>
          <p className="hint block">Games, YouTube, scrolling: log it and it costs 1 coin a minute. Focus earns the coins first. Telegram: <code>/fun 30</code>.</p>
          <div className="row">
            <input value={funWhat} onChange={(e) => setFunWhat(e.target.value)} placeholder="What" maxLength={40} />
            <div className="seg">
              {[15, 30, 60].map((n) => (
                <button key={n} type="button" className={funMin === n ? 'on' : ''} onClick={() => setFunMin(n)}>
                  {n}m
                </button>
              ))}
            </div>
            <button className="btn" onClick={async () => { const r = await act(() => life.focus.fun(funMin, funWhat), `Enjoy! −${funMin} coins`); if (r) { onWallet(); load() } }}>
              Spend {funMin} 🪙
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}

/** Today's compact version: the timer and the must-dos. */
export function FocusToday({ onWallet, timerOnly = false }: { onWallet: () => void; timerOnly?: boolean }) {
  const [st, load, setSt] = useFocus()
  if (!st) return null
  if (timerOnly) {
    return (
      <section className="panel">
        <header className="panel-head">
          <h2>
            <Icon name="clock" /> Focus
          </h2>
          <span className="hint">today {hm(st.todayMin)}</span>
        </header>
        <FocusTimer st={st} onState={setSt} onWallet={onWallet} />
      </section>
    )
  }
  return (
    <div className="cols even">
      <section className="panel">
        <header className="panel-head">
          <h2>
            <Icon name="clock" /> Focus
          </h2>
          <span className="hint">today {hm(st.todayMin)}</span>
        </header>
        <FocusTimer st={st} onState={setSt} onWallet={onWallet} />
      </section>
      <section className="panel">
        <header className="panel-head">
          <h2>
            <Icon name="check" /> Today's must-dos
          </h2>
        </header>
        <DayPlanCard st={st} onState={load} onWallet={onWallet} />
      </section>
    </div>
  )
}
