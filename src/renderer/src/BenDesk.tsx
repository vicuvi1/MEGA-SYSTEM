// Ben's desk: the right side of the Coach page. Five tabs:
//   Today: sleep link, rescue my day, mood, stakes, reviews and habit chains due
//   Plan:  plan my week (one tap into Google Calendar), deadlines, study topics, habit stacks, Sunday coach call
//   You:   the weekly pattern report, energy map, mood, excuses, Ben's profile of you
//   Money: the spending coach, repeating charges, "should I buy it?"
//   Month: the month as a calendar, its numbers and Ben's letter
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { life } from './bridge'
import { useAction } from './ui'
import { useLive } from './live'
import type { DeskView } from './web/benDesk'
import type { CoachStatus } from './web/coachStatus'
import { MOOD_FACES, hoursText, moodFace } from '@core/benKnows'
import { planWeek, rescueDay, type DayBlock, type Rescue, type WeekBlock } from '@core/benPlans'
import { CALL_QUESTIONS, type CallId } from '@core/benStakes'
import { purchaseCheck, type PurchaseVerdict } from '@core/benMoney'
import { isFocusBlock, type CalEvent } from '@core/dayTime'
import { addDays } from '@core/dates'
import { PROFILE_NOTE } from '@core/benKnows'
import { BenLog } from './BenLog'

export type DeskTab = 'today' | 'plan' | 'you' | 'money' | 'month' | 'log'
export const DESK_TABS: { id: DeskTab; label: string; icon: string }[] = [
  { id: 'today', label: 'Today', icon: '☀️' },
  { id: 'plan', label: 'Plan', icon: '🗓' },
  { id: 'you', label: 'You', icon: '🧠' },
  { id: 'money', label: 'Money', icon: '💸' },
  { id: 'month', label: 'Month', icon: '📖' },
  { id: 'log', label: 'Log', icon: '🧾' }
]

const lei = (bani: number) => `${Math.round(bani / 100).toLocaleString('en-US')} lei`
const hm = (ms: number) => new Date(ms).toTimeString().slice(0, 5)
const dayName = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
const left = (iso: string, now: number) => {
  const m = Math.round((Date.parse(iso) - now) / 60000)
  if (m <= 0) return 'time up'
  return m >= 60 * 24 ? `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h` : m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m} min`
}

function Card({ title, icon, tone, sub, action, children, className = '' }: { title: string; icon?: string; tone?: 'accent' | 'warn' | 'bad' | 'calm'; sub?: ReactNode; action?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <section className={`bd-card ${tone ? `tone-${tone}` : ''} ${className}`}>
      <header>
        {icon && <span className="bd-ico">{icon}</span>}
        <div>
          <h3>{title}</h3>
          {sub && <small>{sub}</small>}
        </div>
        {action && <div className="bd-card-act">{action}</div>}
      </header>
      {children}
    </section>
  )
}

export function BenDesk({ tab, setTab, status, slots, onChange, onSay }: { tab: DeskTab; setTab: (t: DeskTab) => void; status: CoachStatus | null; slots: { plan: ReactNode; goals: ReactNode; score: ReactNode; about: ReactNode }; onChange: () => void; onSay: (t: string) => void }) {
  const act = useAction()
  const [v, setV] = useState<DeskView | null>(null)
  const [now, setNow] = useState(Date.now())
  const load = useCallback(() => {
    life.coach?.desk?.().then(setV).catch(() => {})
  }, [])
  useEffect(() => {
    load()
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [load])
  useLive(load)
  const change = async (op: Parameters<NonNullable<NonNullable<typeof life.coach>['deskDo']>>[0], quiet = false) => {
    const line = await act(() => life.coach!.deskDo!(op))
    if (line != null) {
      if (!quiet) await act(async () => line, line)
      load()
      onChange()
    }
    return line
  }
  if (!life.coach?.desk) return <p className="hint">Ben's desk needs the web app.</p>
  return (
    <div className="bd">
      <nav className="bd-tabs" role="tablist">
        {DESK_TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            <span>{t.icon}</span>
            {t.label}
            {t.id === 'today' && v && (v.moodDue || v.study.some((x) => x.due) || v.stakes.some((x) => x.status === 'open')) && <i className="bd-dot" />}
            {t.id === 'plan' && v?.callDue && <i className="bd-dot" />}
          </button>
        ))}
      </nav>
      <div className="bd-body" key={tab}>
        {!v ? (
          <div className="bd-skel">
            <i />
            <i />
            <i />
          </div>
        ) : tab === 'today' ? (
          <TodayTab v={v} now={now} status={status} change={change} onSay={onSay} />
        ) : tab === 'plan' ? (
          <PlanTab v={v} change={change} slots={slots} onSay={onSay} reload={load} />
        ) : tab === 'you' ? (
          <YouTab v={v} slots={slots} />
        ) : tab === 'money' ? (
          <MoneyTab v={v} />
        ) : tab === 'log' ? (
          <BenLog />
        ) : (
          <MonthTab v={v} reload={load} />
        )}
      </div>
    </div>
  )
}

type Change = (op: any, quiet?: boolean) => Promise<string | undefined | null>

// ------------------------------------------------------------------- Today

function TodayTab({ v, now, status, change, onSay }: { v: DeskView; now: number; status: CoachStatus | null; change: Change; onSay: (t: string) => void }) {
  const open = v.stakes.filter((s) => s.status === 'open')
  const due = v.study.filter((t) => t.due)
  const todayMoods = v.moods.filter((m) => m.day === v.today)
  return (
    <>
      <SleepCard v={v} />
      <RescueCard status={status} />
      <Card title={v.moodDue ? (v.moodDue === 'noon' ? 'How do you feel right now?' : 'How was today, really?') : 'Mood'} icon="🙂" tone={v.moodDue ? 'accent' : undefined} sub={todayMoods.length ? `Today: ${todayMoods.map((m) => `${m.slot} ${moodFace(m.mood)}`).join(' · ')}` : '5 seconds. Ben links it to sleep, training and spending.'}>
        <div className="bd-moods">
          {MOOD_FACES.map((f, i) => (
            <button key={f} className={todayMoods[todayMoods.length - 1]?.mood === i + 1 ? 'on' : ''} onClick={() => void change({ op: 'mood', mood: i + 1 })} aria-label={`Mood ${i + 1} of 5`}>
              {f}
            </button>
          ))}
        </div>
      </Card>
      <StakesCard v={v} now={now} change={change} />
      {!!due.length && (
        <Card title="Review time" icon="📚" tone="accent" sub="From memory first, then check. 15 minutes each.">
          <ul className="bd-list">
            {due.map((t) => (
              <li key={t.id}>
                <span>
                  <b>{t.topic}</b>
                  <small>{t.exam} · review {t.reviews.length + 1} of 5</small>
                </span>
                <button className="bd-btn" onClick={() => void change({ op: 'reviewed', id: t.id })}>
                  ✓ Reviewed
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {!!v.stacks.length && (
        <Card title="Habit chains" icon="🔗" sub="Tick each link as you go.">
          {v.stacks.map((s) => (
            <div key={s.id} className="bd-chain">
              <small>
                After {s.cue}
                {s.streak > 0 && <em> · 🔥 {s.streak}</em>}
              </small>
              <div>
                {s.steps.map((st, i) => (
                  <button key={i} className={s.today.includes(i) ? 'done' : ''} onClick={() => void change({ op: 'tickStack', id: s.id, step: i }, true)}>
                    {s.today.includes(i) ? '✓ ' : ''}
                    {st}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </Card>
      )}
      {!open.length && !due.length && !v.moodDue && (
        <div className="bd-empty">
          <span>✨</span>
          <p>Nothing waiting. Want to raise the bar?</p>
          <button className="bd-btn" onClick={() => onSay('Give me a stake for today: one thing I must finish, with points on it.')}>
            💎 Give me a stake
          </button>
        </div>
      )}
    </>
  )
}

function SleepCard({ v }: { v: DeskView }) {
  const s = v.sleep
  return (
    <Card title={s.title} icon={s.level === 'ok' ? '🔋' : s.level === 'short' ? '🪫' : '😵'} tone={s.level === 'ok' ? 'calm' : s.level === 'short' ? 'warn' : 'bad'} className="bd-sleep" sub={s.slept != null ? 'From last night (Waky)' : undefined}>
      {s.slept != null && (
        <div className="bd-sleepbar">
          <i style={{ width: `${Math.min(100, (s.slept / 480) * 100)}%` }} />
          <span>{`${Math.floor(s.slept / 60)}h ${String(s.slept % 60).padStart(2, '0')}m`}</span>
          <em>8h</em>
        </div>
      )}
      {!!s.tips.length && (
        <ul className="bd-tips">
          {s.tips.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/** The day fell apart: keep the must-dos, shrink the rest, move what doesn't fit to tomorrow. */
function RescueCard({ status }: { status: CoachStatus | null }) {
  const act = useAction()
  const [plan, setPlan] = useState<{ r: Rescue; evs: CalEvent[] } | null>(null)
  const [busy, setBusy] = useState(false)
  if (!life.google) return null
  const make = async () => {
    setBusy(true)
    const d0 = new Date()
    d0.setHours(0, 0, 0, 0)
    const evs = (await act(() => life.google!.events(d0.toISOString(), new Date(d0.getTime() + 86400000).toISOString()))) ?? []
    setBusy(false)
    const timed = evs.filter((e) => !e.allDay)
    const musts = (status?.mustdos ?? []).filter((m) => !m.done).map((m) => m.text.toLowerCase())
    const blocks: DayBlock[] = timed.map((e) => ({ id: e.id, title: e.title, start: Date.parse(e.start), end: Date.parse(e.end), fixed: !isFocusBlock(e), must: musts.some((m) => e.title.toLowerCase().includes(m.slice(0, 20)) || m.includes(e.title.toLowerCase())) }))
    const end = new Date()
    end.setHours(22, 30, 0, 0)
    setPlan({ r: rescueDay(blocks, Date.now(), end.getTime()), evs: timed })
  }
  const apply = async () => {
    if (!plan) return
    setBusy(true)
    let n = 0
    for (const m of plan.r.moves) {
      const e = plan.evs.find((x) => x.id === m.id)
      if (!e || m.action === 'keep') continue
      const start = m.action === 'tomorrow' ? Date.parse(e.start) + 86400000 : m.start!
      const end = m.action === 'tomorrow' ? Date.parse(e.end) + 86400000 : m.end!
      const ok = await act(() => life.google!.move(e.calendarId, e.id, new Date(start).toISOString(), new Date(end).toISOString()))
      if (ok !== undefined) n++
    }
    setBusy(false)
    setPlan(null)
    await act(async () => n, `Rescued: ${n} block${n === 1 ? '' : 's'} moved`)
  }
  const changes = plan?.r.moves.filter((m) => m.action !== 'keep') ?? []
  return (
    <Card title="Rescue my day" icon="🛟" sub={plan ? `${plan.r.freeMin} min still free today` : 'Late, sick, a surprise? I re-plan what\'s left.'} action={!plan && <button className="bd-btn strong" disabled={busy} onClick={() => void make()}>{busy ? '…' : 'Rescue'}</button>} className="bd-rescue">
      {plan && (
        <>
          {changes.length ? (
            <ul className="bd-moves">
              {plan.r.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          ) : (
            <p className="hint small">Your day still fits. Nothing to move.</p>
          )}
          <div className="bd-row">
            <button className="bd-btn ghost" onClick={() => setPlan(null)}>
              Cancel
            </button>
            {!!changes.length && (
              <button className="bd-btn strong" disabled={busy} onClick={() => void apply()}>
                {busy ? 'Moving…' : `Apply ${changes.length} change${changes.length === 1 ? '' : 's'}`}
              </button>
            )}
          </div>
        </>
      )}
    </Card>
  )
}

function StakesCard({ v, now, change }: { v: DeskView; now: number; change: Change }) {
  const [text, setText] = useState('')
  const [due, setDue] = useState('18:00')
  const [pts, setPts] = useState(50)
  const [adding, setAdding] = useState(false)
  const open = v.stakes.filter((s) => s.status === 'open')
  const past = v.stakes.filter((s) => s.status !== 'open').slice(0, 3)
  const st = v.stakeStats
  return (
    <Card title="Promises with stakes" icon="💎" tone={open.length ? 'warn' : undefined} sub={st.kept + st.lost ? `30 days: ${st.kept} won · ${st.lost} lost${st.pointsLost ? ` (−${st.pointsLost} pts)` : ''}` : 'Put points on a promise. Miss it and they\'re gone, automatically.'} action={!adding && <button className="bd-btn" onClick={() => setAdding(true)}>＋ New</button>}>
      {open.map((s) => {
        const total = Date.parse(s.due) - Date.parse(s.at)
        const pct = Math.max(0, Math.min(100, ((now - Date.parse(s.at)) / Math.max(1, total)) * 100))
        return (
          <div key={s.id} className={`bd-stake ${pct > 80 ? 'hot' : ''}`}>
            <div>
              <b>{s.text}</b>
              <small>
                by {hm(Date.parse(s.due))} · {left(s.due, now)} left · <em>−{s.points} pts</em>
              </small>
              <div className="bd-meter">
                <i style={{ width: `${pct}%` }} />
              </div>
            </div>
            <button className="bd-btn strong" onClick={() => void change({ op: 'keepStake', id: s.id })}>
              ✓ Done
            </button>
          </div>
        )
      })}
      {adding && (
        <form
          className="bd-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (!text.trim()) return
            void change({ op: 'stake', text: text.trim(), due, points: pts }).then((ok) => ok && (setText(''), setAdding(false)))
          }}
        >
          <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="I will… (e.g. finish the lab report)" />
          <div className="bd-row">
            <label>
              by <input type="time" value={due} onChange={(e) => setDue(e.target.value)} />
            </label>
            <label>
              or lose
              <select value={pts} onChange={(e) => setPts(Number(e.target.value))}>
                {[20, 50, 100, 200].map((p) => (
                  <option key={p} value={p}>
                    {p} pts
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="bd-row">
            <button type="button" className="bd-btn ghost" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button className="bd-btn strong">Lock it in 🔒</button>
          </div>
        </form>
      )}
      {!!past.length && (
        <ul className="bd-past">
          {past.map((s) => (
            <li key={s.id} className={s.status}>
              {s.status === 'kept' ? '💎' : '💸'} {s.text} <small>{s.status === 'kept' ? 'won' : `−${s.points}`}</small>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

// -------------------------------------------------------------------- Plan

function PlanTab({ v, change, slots, onSay, reload }: { v: DeskView; change: Change; slots: { plan: ReactNode; goals: ReactNode }; onSay: (t: string) => void; reload: () => void }) {
  return (
    <>
      <CallCard v={v} change={change} />
      <WeekCard v={v} />
      <DeadlinesCard v={v} reload={reload} />
      <StudyCard v={v} change={change} />
      <StacksCard v={v} change={change} onSay={onSay} />
      <details className="bd-more">
        <summary>Today's plan & daily rhythm</summary>
        {slots.plan}
      </details>
      <details className="bd-more">
        <summary>Goals in detail</summary>
        {slots.goals}
      </details>
    </>
  )
}

function WeekCard({ v }: { v: DeskView }) {
  const act = useAction()
  const [blocks, setBlocks] = useState<WeekBlock[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [booked, setBooked] = useState(0)
  if (!life.google) return null
  // From today to Sunday (or the whole next week from Saturday evening / Sunday).
  const startOf = () => {
    const d = new Date()
    const dow = (d.getDay() + 6) % 7
    const monday = addDays(v.today, -dow)
    return d.getDay() === 0 || (d.getDay() === 6 && d.getHours() >= 17) ? addDays(monday, 7) : monday
  }
  const make = async () => {
    setBusy(true)
    const start = startOf()
    const from = new Date(`${start}T00:00:00`)
    const evs = (await act(() => life.google!.events(from.toISOString(), new Date(from.getTime() + 7 * 86400000).toISOString()))) ?? []
    const busyT = evs.filter((e) => !e.allDay).map((e) => ({ start: Date.parse(e.start), end: Date.parse(e.end) }))
    const reviews = v.study.filter((t) => t.next).map((t) => ({ day: t.next as string, title: t.topic }))
    setBlocks(planWeek({ start, today: v.today, busy: busyT, goals: v.goals.map((g) => ({ title: g.title, hoursLeft: g.hoursLeft, deadline: g.deadline })), energy: v.energy, restDays: v.restDays, gymPerWeek: 3, reviews }))
    setBusy(false)
  }
  const book = async () => {
    if (!blocks) return
    setBusy(true)
    let n = 0
    for (const b of blocks) {
      const start = new Date(`${b.day}T${b.start}:00`)
      const ok = await act(() => life.google!.create({ title: b.kind === 'deep' ? `📚 ${b.title}` : b.kind === 'gym' ? '💪 Gym' : b.kind === 'review' ? `🔁 ${b.title}` : `⏳ ${b.title}`, start: start.toISOString(), end: new Date(start.getTime() + b.minutes * 60000).toISOString(), description: 'Planned by Ben (Plan my week)' }))
      if (ok) n++
      setBooked(n)
    }
    setBusy(false)
    setBlocks(null)
    setBooked(0)
    await act(async () => n, `Your week is in Google Calendar: ${n} blocks`)
  }
  const byDay = useMemo(() => {
    const m = new Map<string, WeekBlock[]>()
    for (const b of blocks ?? []) m.set(b.day, [...(m.get(b.day) ?? []), b])
    return [...m.entries()]
  }, [blocks])
  const hours = (blocks ?? []).filter((b) => b.kind === 'deep').reduce((t, b) => t + b.minutes, 0) / 60
  return (
    <Card title="Plan my week" icon="🗓" sub={blocks ? `${blocks.length} blocks · ${hours.toFixed(1)}h deep work${v.energy.ready ? ` in your best hours (${hoursText(v.energy.best)})` : ''}` : 'Exams, goals, gym, rest days and buffers around your calendar.'} action={!blocks && <button className="bd-btn strong" disabled={busy} onClick={() => void make()}>{busy ? '…' : 'Propose'}</button>} className="bd-week">
      {blocks && (
        <>
          {blocks.length ? (
            <div className="bd-weekgrid">
              {byDay.map(([day, list]) => (
                <div key={day} className="bd-wday">
                  <small>{dayName(day)}</small>
                  {list.map((b, i) => (
                    <span key={i} className={`bd-wb k-${b.kind}`} title={`${b.start} · ${b.minutes} min`}>
                      <em>{b.start}</em> {b.title}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <p className="hint small">Nothing to plan: add a goal with a deadline (Deadlines below) and I'll fill the week.</p>
          )}
          <div className="bd-row">
            <button className="bd-btn ghost" onClick={() => setBlocks(null)}>
              Not now
            </button>
            {!!blocks.length && (
              <button className="bd-btn strong" disabled={busy} onClick={() => void book()}>
                {busy ? `Booking ${booked}/${blocks.length}…` : `✓ Put ${blocks.length} in Google Calendar`}
              </button>
            )}
          </div>
        </>
      )}
    </Card>
  )
}

function DeadlinesCard({ v, reload }: { v: DeskView; reload: () => void }) {
  const act = useAction()
  const today = Date.parse(`${v.today}T12:00:00Z`)
  return (
    <Card title="Deadlines" icon="⏳" sub="Ben works backward from each date and re-books missed blocks by himself." action={life.coach?.rhythm && !!v.goals.length && <button className="bd-btn" onClick={() => void act(() => life.coach!.rhythm!('book'), 'Re-planned every goal for the next 7 days').then(reload)}>Re-book all</button>}>
      {v.goals.length ? (
        <ul className="bd-list">
          {v.goals.map((g) => {
            const days = Math.round((Date.parse(`${g.deadline}T12:00:00Z`) - today) / 86400000)
            return (
              <li key={g.id} className={g.behind ? 'bad' : ''}>
                <span>
                  <b>{g.title}</b>
                  <small>
                    {days >= 0 ? `${days} days` : `${-days} days late`} · {g.hoursLeft}h left{g.behind ? ' · behind' : ''}
                  </small>
                </span>
                <span className={`bd-pill ${days <= 3 ? 'hot' : days <= 10 ? 'warm' : ''}`}>{dayName(g.deadline)}</span>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="hint small">No deadlines. Tell Ben: "Etica exam on 20 Nov, needs 8 hours".</p>
      )}
    </Card>
  )
}

function StudyCard({ v, change }: { v: DeskView; change: Change }) {
  const [exam, setExam] = useState(v.exams[0]?.title ?? '')
  const [topic, setTopic] = useState('')
  const list = v.study.slice(0, 12)
  return (
    <Card title="Study coach" icon="📚" sub="Learned something? It comes back for review after 1, 3, 7, 14 and 30 days.">
      <form
        className="bd-form inline"
        onSubmit={(e) => {
          e.preventDefault()
          if (!exam.trim() || !topic.trim()) return
          void change({ op: 'study', exam: exam.trim(), topic: topic.trim() }).then((ok) => ok && setTopic(''))
        }}
      >
        <input value={exam} onChange={(e) => setExam(e.target.value)} placeholder="Exam" list="bd-exams" />
        <datalist id="bd-exams">
          {v.exams.map((x) => (
            <option key={x.title} value={x.title} />
          ))}
        </datalist>
        <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Topic (e.g. Chapter 3)" />
        <button className="bd-btn strong">Add</button>
      </form>
      {!!list.length && (
        <ul className="bd-list">
          {list.map((t) => (
            <li key={t.id} className={t.due ? 'due' : ''}>
              <span>
                <b>{t.topic}</b>
                <small>
                  {t.exam} · {t.next ? (t.due ? 'due today' : `next ${dayName(t.next)}`) : 'learned for good ✓'} · {t.reviews.length}/5
                </small>
              </span>
              <span className="bd-srs">
                {[0, 1, 2, 3, 4].map((k) => (
                  <i key={k} className={k < t.reviews.length ? 'on' : ''} />
                ))}
              </span>
              {t.due ? (
                <button className="bd-btn" onClick={() => void change({ op: 'reviewed', id: t.id })}>
                  ✓
                </button>
              ) : (
                <button className="bd-x" onClick={() => void change({ op: 'dropStudy', id: t.id }, true)} aria-label="Remove">
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function StacksCard({ v, change, onSay }: { v: DeskView; change: Change; onSay: (t: string) => void }) {
  const [text, setText] = useState('')
  return (
    <Card title="Habit stacks" icon="🔗" sub="Hang new habits on things you already do.">
      {v.stacks.map((s) => (
        <div key={s.id} className="bd-stackrow">
          <div>
            <b>After {s.cue}</b>
            <small>{s.steps.join(' → ')}</small>
          </div>
          <span className="bd-pill">{s.streak ? `🔥 ${s.streak}` : `${s.rate}%`}</span>
          <button className="bd-x" onClick={() => void change({ op: 'dropStack', id: s.id }, true)} aria-label="Remove">
            ✕
          </button>
        </div>
      ))}
      <form
        className="bd-form inline"
        onSubmit={(e) => {
          e.preventDefault()
          if (!text.trim()) return
          void change({ op: 'stack', text: text.trim() }).then((ok) => ok && setText(''))
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="after coffee → 10 pushups → plan review" />
        <button className="bd-btn strong">Add</button>
      </form>
      {!v.stacks.length && (
        <button className="bd-link" onClick={() => onSay('Suggest one habit stack for me from my data (cue → 2 small steps).')}>
          Ask Ben to suggest one →
        </button>
      )}
    </Card>
  )
}

function CallCard({ v, change }: { v: DeskView; change: Change }) {
  const [step, setStep] = useState(-1)
  const [ans, setAns] = useState<Record<string, string>>({})
  const q = CALL_QUESTIONS[step]
  const last = v.lastCall
  if (step < 0)
    return (
      <Card title="Sunday coach call" icon="🎙" tone={v.callDue ? 'accent' : undefined} sub={v.callDue ? '5 questions · 5 minutes · next week set' : last ? `Last: week of ${dayName(last.week)} · change: "${last.answers.change}"` : '5 questions on Sunday: wins, misses, one change, next week\'s big 3.'} action={<button className={`bd-btn ${v.callDue ? 'strong' : ''}`} onClick={() => setStep(0)}>{v.callDue ? 'Start' : 'Do it now'}</button>} />
    )
  return (
    <Card title={`Coach call · ${step + 1}/${CALL_QUESTIONS.length}`} icon="🎙" tone="accent" className="bd-call">
      <div className="bd-steps">
        {CALL_QUESTIONS.map((x, i) => (
          <i key={x.id} className={i < step ? 'done' : i === step ? 'now' : ''} />
        ))}
      </div>
      <h4>{q.q}</h4>
      <textarea autoFocus rows={q.id === 'big3' ? 3 : 2} value={ans[q.id] ?? ''} onChange={(e) => setAns({ ...ans, [q.id]: e.target.value })} placeholder={q.hint} />
      <div className="bd-row">
        <button className="bd-btn ghost" onClick={() => (step ? setStep(step - 1) : setStep(-1))}>
          {step ? '← Back' : 'Cancel'}
        </button>
        {step < CALL_QUESTIONS.length - 1 ? (
          <button className="bd-btn strong" onClick={() => setStep(step + 1)}>
            Next →
          </button>
        ) : (
          <button
            className="bd-btn strong"
            onClick={() =>
              void change({ op: 'call', answers: Object.fromEntries(CALL_QUESTIONS.map((x) => [x.id, (ans[x.id] ?? '').trim()])) as Record<CallId, string> }).then(async (ok) => {
                if (!ok) return
                const big3 = (ans.big3 ?? '').split(/\n/).map((x) => x.replace(/^\s*(\d[.)]|[-•*])\s*/, '').trim()).filter(Boolean).slice(0, 3)
                if (big3.length && life.weekPlan?.save) await life.weekPlan.save({ big3 } as any).catch(() => null)
                setStep(-1)
                setAns({})
              })
            }
          >
            ✓ Set next week
          </button>
        )}
      </div>
    </Card>
  )
}

// --------------------------------------------------------------------- You

function YouTab({ v, slots }: { v: DeskView; slots: { score: ReactNode; about: ReactNode } }) {
  return (
    <>
      <Card title="Your weekly pattern report" icon="🔍" sub="From your own last 8 weeks. Each comes with one change to try.">
        {v.patterns.length ? (
          <div className="bd-patterns">
            {v.patterns.map((p) => (
              <div key={p.id} className="bd-pattern">
                <p>{p.text}</p>
                <span>
                  <b>Try:</b> {p.change}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="hint small">Not enough data yet. About two weeks of focus sessions, sleep and workouts and the first patterns show up.</p>
        )}
      </Card>
      <EnergyCard v={v} />
      <MoodTrend v={v} />
      <Card title="Excuse tracker" icon="🧾" sub="The reasons you gave for skipping, last 30 days. Ben calls out repeats, kindly.">
        {v.excuses.length ? (
          <div className="bd-bars">
            {v.excuses.map((e) => (
              <div key={e.kind}>
                <span>{e.kind}</span>
                <i style={{ width: `${Math.min(100, (e.n / Math.max(...v.excuses.map((x) => x.n))) * 100)}%` }} />
                <b>×{e.n}</b>
              </div>
            ))}
          </div>
        ) : (
          <p className="hint small">No excuses logged. Keep it that way 😎</p>
        )}
      </Card>
      <Card
        title="Ben's profile of you"
        icon="📓"
        sub="Goals, exams, people, what works, what fails. Ben keeps it current; you correct it."
        action={
          <button className="bd-btn" onClick={() => (localStorage.setItem('ls.openNote', PROFILE_NOTE), window.dispatchEvent(new CustomEvent('life-open-page', { detail: 'notebook' })))}>
            Open
          </button>
        }
      />
      <details className="bd-more" open>
        <summary>About you, goals & rules, memory</summary>
        {slots.about}
      </details>
      <details className="bd-more">
        <summary>Is Ben working? (scorecard)</summary>
        {slots.score}
      </details>
    </>
  )
}

function EnergyCard({ v }: { v: DeskView }) {
  const max = Math.max(1, ...v.energy.hours.map((h) => h.score))
  return (
    <Card title="Energy map" icon="⚡" sub={v.energy.ready ? `Best: ${hoursText(v.energy.best)}. Hard tasks go there automatically.` : 'Learning your best hours from focus quality and finished blocks…'}>
      <div className={`bd-energy ${v.energy.ready ? '' : 'dim'}`}>
        {v.energy.hours.map((h) => (
          <span key={h.h} className={`${v.energy.best.includes(h.h) ? 'best' : ''} ${v.energy.worst.includes(h.h) ? 'worst' : ''}`} title={`${String(h.h).padStart(2, '0')}:00 · score ${h.score} · ${h.minutes} min`}>
            <i style={{ height: `${Math.max(4, (h.score / max) * 100)}%` }} />
            <em>{h.h % 3 === 0 ? h.h : ''}</em>
          </span>
        ))}
      </div>
    </Card>
  )
}

function MoodTrend({ v }: { v: DeskView }) {
  const days = Array.from({ length: 14 }, (_, k) => addDays(v.today, k - 13))
  const by = new Map<string, number[]>()
  for (const m of v.moods) by.set(m.day, [...(by.get(m.day) ?? []), m.mood])
  const links = v.patterns.filter((p) => p.id.startsWith('mood-'))
  return (
    <Card title="Mood" icon="🌡" sub={v.moodAvg != null ? `7-day average ${v.moodAvg.toFixed(1)} / 5 ${moodFace(v.moodAvg)}` : 'One tap at lunch and in the evening (Today tab or Telegram).'}>
      <div className="bd-moodline">
        {days.map((d) => {
          const xs = by.get(d)
          const m = xs ? xs.reduce((t, x) => t + x, 0) / xs.length : null
          return (
            <span key={d} title={`${dayName(d)}${m != null ? ` · ${m.toFixed(1)}` : ''}`} className={m == null ? 'none' : ''}>
              <i style={{ height: m == null ? '6%' : `${(m / 5) * 100}%`, ['--m' as string]: m ?? 0 }} />
              <em>{m != null ? moodFace(m) : '·'}</em>
            </span>
          )
        })}
      </div>
      {links.map((l) => (
        <p key={l.id} className="bd-note">
          {l.text} <b>{l.change}</b>
        </p>
      ))}
    </Card>
  )
}

// ------------------------------------------------------------------- Money

function MoneyTab({ v }: { v: DeskView }) {
  const [what, setWhat] = useState('')
  const [price, setPrice] = useState('')
  const [verdict, setVerdict] = useState<PurchaseVerdict | null>(null)
  const sp = v.spend
  const max = Math.max(1, ...(sp?.cats ?? []).flatMap((c) => [c.week, c.usual]))
  return (
    <>
      <Card title="Should I buy it?" icon="🛍" sub="From your budget, goals and what an hour of your work earns." className="bd-buy">
        <form
          className="bd-form inline"
          onSubmit={(e) => {
            e.preventDefault()
            const p = Math.round(Number(price.replace(',', '.')) * 100)
            if (!what.trim() || !(p > 0)) return
            setVerdict(purchaseCheck({ ...v.money, price: p, what: what.trim() }))
          }}
        >
          <input value={what} onChange={(e) => (setWhat(e.target.value), setVerdict(null))} placeholder="What? (headphones)" />
          <input value={price} onChange={(e) => (setPrice(e.target.value), setVerdict(null))} placeholder="lei" inputMode="decimal" className="short" />
          <button className="bd-btn strong">Check</button>
        </form>
        {verdict && (
          <div className={`bd-verdict v-${verdict.verdict}`}>
            <b>
              {verdict.verdict === 'buy' ? '🟢' : verdict.verdict === 'wait' ? '🟡' : '🔴'} {verdict.title}
            </b>
            <ul>
              {verdict.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </div>
        )}
      </Card>
      <Card title="Spending coach" icon="📊" tone={sp?.line ? 'warn' : undefined} sub={sp ? (sp.line ?? `This week ${lei(sp.week)} vs your usual ${lei(sp.usual)} by now. On track.`) : 'Finance Helper data not found on this device.'}>
        {!!sp?.cats.length && (
          <div className="bd-cats">
            {sp.cats.map((c) => (
              <div key={c.category} className={c.pct >= 25 && c.week - c.usual >= 5000 ? 'over' : ''}>
                <span>{c.category}</span>
                <div className="bd-cbar">
                  <i className="usual" style={{ width: `${(c.usual / max) * 100}%` }} />
                  <i className="week" style={{ width: `${(c.week / max) * 100}%` }} />
                </div>
                <b>{lei(c.week)}</b>
                <small>{c.usual ? `${c.pct > 0 ? '+' : ''}${c.pct}%` : 'new'}</small>
              </div>
            ))}
            <p className="bd-legend">
              <i className="week" /> this week <i className="usual" /> your usual week so far · {sp.daysLeft} day{sp.daysLeft === 1 ? '' : 's'} left
            </p>
          </div>
        )}
      </Card>
      <Card title="Charges that repeat" icon="🔁" sub="Same amount, same place, every month. Still using them all?">
        {v.recurring.length ? (
          <ul className="bd-list">
            {v.recurring.map((r) => (
              <li key={r.key}>
                <span>
                  <b>{r.name}</b>
                  <small>
                    {r.months} months · next about {dayName(r.next)}
                  </small>
                </span>
                <b className="bd-amt">{lei(r.amount)}/mo</b>
              </li>
            ))}
          </ul>
        ) : (
          <p className="hint small">No forgotten subscriptions found in the last 4 months.</p>
        )}
      </Card>
    </>
  )
}

// ------------------------------------------------------------------- Month

function MonthTab({ v, reload }: { v: DeskView; reload: () => void }) {
  const act = useAction()
  const [busy, setBusy] = useState(false)
  const [pick, setPick] = useState<string | null>(null)
  const s = v.month
  const cell = s.days.find((d) => d.day === pick)
  const ask = async () => {
    setBusy(true)
    await act(() => life.coach!.rhythm!('month'))
    setBusy(false)
    reload()
  }
  return (
    <>
      <section className="bd-story">
        <header>
          <small>Your month</small>
          <h3>{s.label}</h3>
        </header>
        <div className="bd-tiles">
          <div>
            <b>{s.stats.focusH}h</b>
            <small>focus</small>
          </div>
          <div>
            <b>{s.stats.trained}</b>
            <small>days trained</small>
          </div>
          <div>
            <b>{s.stats.avgSleep ?? '–'}</b>
            <small>avg sleep</small>
          </div>
          <div>
            <b>{s.stats.spent ? lei(s.stats.spent).replace(' lei', '') : '–'}</b>
            <small>lei spent</small>
          </div>
        </div>
        <div className="bd-cal">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
            <em key={i}>{d}</em>
          ))}
          {Array.from({ length: s.pad }, (_, i) => (
            <span key={`p${i}`} className="pad" />
          ))}
          {s.days.map((d) => (
            <button key={d.day} className={`lv-${d.level} ${d.rest ? 'rest' : ''} ${pick === d.day ? 'on' : ''}`} onClick={() => setPick(pick === d.day ? null : d.day)} title={d.day}>
              {Number(d.day.slice(8))}
              {d.trained && <i>💪</i>}
            </button>
          ))}
        </div>
        {cell && (
          <p className="bd-cellinfo">
            <b>{dayName(cell.day)}</b> · {Math.round(cell.focus)} min focus{cell.trained ? ' · trained' : cell.rest ? ' · rest day' : ''}
            {cell.slept != null ? ` · slept ${Math.floor(cell.slept / 60)}h${String(cell.slept % 60).padStart(2, '0')}` : ''}
            {cell.mood != null ? ` · mood ${moodFace(cell.mood)}` : ''}
          </p>
        )}
        <ul className="bd-lines">
          {s.lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </section>
      <Card title="Ben's letter" icon="💌" sub={v.letter ? `For ${s.label}` : 'His honest take on your month, from these numbers.'} action={life.coach?.rhythm && <button className="bd-btn strong" disabled={busy} onClick={() => void ask()}>{busy ? 'Writing…' : v.letter ? 'Rewrite' : 'Write it'}</button>}>
        {v.letter && <p className="bd-letter">{v.letter}</p>}
      </Card>
    </>
  )
}
