// Three small things on Today:
// - QuickCapture: type anything ("gym 18:00", "spent 50 lei", "water 500",
//   "call mom tomorrow") and Ben puts it where it belongs (calendar,
//   Finance, water, Todoist). Without Ben's AI it becomes a Todoist task.
// - DeepWork: a calm full-screen view of the running focus: only the task,
//   the timer and the block's checklist, until you stop or press Esc.
// - WeekStrip: the last 7 days of focus as bars, against the week before.
import { useEffect, useState } from 'react'
import { AnimatePresence, m } from 'framer-motion'
import { blockTasks, setBlockTaskDone } from '@core/blockTasks'
import { localDay, type CalEvent } from '@core/dayTime'
import type { CoachStatus } from './web/coachStatus'
import { life } from './bridge'
import { capture } from './capture'
import { useLive } from './live'
import { useFocus } from './pages/Focus'
import { reloadToday, useTodayEvents } from './todayEvents'
import { soundSuccess } from './sound'
import { useAction, useToast } from './ui'
import { countdown, daySummary, isMeeting, nextUp } from '@core/dayGlance'

export function QuickCapture() {
  const toast = useToast()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const send = async () => {
    const t = text.trim()
    if (!t || busy) return
    setBusy(true)
    try {
      const r = await capture(t)
      toast(r.said, r.ok ? 'good' : 'info')
      setText('')
      soundSuccess()
      void reloadToday()
    } catch (e) {
      toast((e as Error).message, 'bad')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form
      className={`qc ${busy ? 'busy' : ''}`}
      onSubmit={(e) => {
        e.preventDefault()
        void send()
      }}
    >
      <span className="qc-plus">+</span>
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type anything: gym 18:00 · spent 50 lei · water 500 · call mom tomorrow" aria-label="Quick capture" maxLength={300} disabled={busy} />
      {text.trim() && <button className="btn small primary">{busy ? 'Ben is on it…' : 'Add'}</button>}
    </form>
  )
}

/** The block happening now (the shortest one, if they overlap). */
const blockNow = (events: CalEvent[], t: number) =>
  events.filter((e) => !e.allDay && Date.parse(e.start) <= t && Date.parse(e.end) > t).sort((a, b) => Date.parse(a.end) - Date.parse(a.start) - (Date.parse(b.end) - Date.parse(b.start)))[0]

export function DeepWork() {
  const act = useAction()
  const [open, setOpen] = useState(false)
  const [focus, reload] = useFocus()
  const { events } = useTodayEvents()
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const on = () => setOpen(true)
    window.addEventListener('life-deep-work', on)
    return () => window.removeEventListener('life-deep-work', on)
  }, [])
  useEffect(() => {
    if (!open) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', esc)
    return () => {
      clearInterval(t)
      window.removeEventListener('keydown', esc)
    }
  }, [open])
  const run = focus?.running
  useEffect(() => {
    if (open && focus && !run) setOpen(false)
  }, [open, focus, run])
  const block = blockNow(events, now)
  const [notes, setNotes] = useState<string | null>(null)
  useEffect(() => setNotes(block?.description ?? null), [block?.id, block?.description])
  const tasks = blockTasks(notes)
  const end = run ? Date.parse(run.startedAt) + run.planned * 60000 : 0
  const left = Math.round((end - now) / 1000)
  const over = left < 0
  const mm = Math.floor(Math.abs(left) / 60)
  const ss = Math.abs(left) % 60
  const pct = run ? Math.min(100, Math.max(0, ((now - Date.parse(run.startedAt)) / (run.planned * 60000)) * 100)) : 0
  return (
    <AnimatePresence>
      {open && run && (
        <m.div className="dw" role="dialog" aria-label="Deep work" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="dw-inner">
            <small className="dw-label">Deep work</small>
            <h1>{run.subject}</h1>
            <div className={`dw-timer ${over ? 'over' : ''}`} style={{ ['--p' as string]: `${pct}%` }}>
              <b>
                {over ? '+' : ''}
                {mm}:{String(ss).padStart(2, '0')}
              </b>
              <small>{over ? 'over time' : 'left'}</small>
            </div>
            {tasks.length > 0 && (
              <ul className="dw-tasks">
                {tasks.map((t) => (
                  <li key={t.id} className={t.done ? 'done' : ''}>
                    <button
                      className="dl-check"
                      disabled={t.done}
                      aria-label={`Done: ${t.text}`}
                      onClick={async () => {
                        const next = setBlockTaskDone(notes ?? '', t.id, true)
                        setNotes(next)
                        soundSuccess()
                        await act(async () => {
                          await life.todoist!.complete({ id: t.id, content: t.text, priority: 1, due: null, dueTime: null, project: null, recurring: false })
                          if (block) await life.google!.update!(block.calendarId, block.id, { description: next })
                          return true
                        }, `Done: ${t.text}`)
                      }}
                    >
                      {t.done ? '✓' : ''}
                    </button>
                    <span>{t.text}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="dw-actions">
              <button className="btn" onClick={() => void act(() => life.focus.extend!(5), '+5 min').then(() => reload())}>
                +5 min
              </button>
              <button className="btn primary" onClick={() => void act(() => life.focus.stop(), 'Logged').then(() => (reload(), setOpen(false)))}>
                ■ Stop & log
              </button>
              <button className="btn ghost" onClick={() => setOpen(false)}>
                Leave (keeps running)
              </button>
            </div>
            <p className="dw-hint">Esc to leave · the timer keeps running</p>
          </div>
        </m.div>
      )}
    </AnimatePresence>
  )
}

export function WeekStrip() {
  const [st, setSt] = useState<CoachStatus | null>(null)
  const load = () => void life.coach?.status?.().then(setSt).catch(() => {})
  useEffect(load, [])
  useLive(load)
  if (!st) return null
  const total = st.week.reduce((t, d) => t + d.min, 0)
  const max = Math.max(60, ...st.week.map((d) => d.min))
  const diff = total - (st.prevWeekMin ?? 0)
  const today = localDay(new Date().toISOString())
  const h = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`)
  // An empty week is not news (D5): it shows once there's focus to compare.
  if (total === 0 && !(st.prevWeekMin ?? 0)) return null
  return (
    <section className="ws" aria-label="This week">
      <header>
        <b>This week</b>
        <span className={diff >= 0 ? 'up' : 'down'}>
          {h(total)} focus · {diff >= 0 ? '▲' : '▼'} {h(Math.abs(diff))} vs last week
        </span>
      </header>
      <div className="ws-plot">
        {st.week.map((d) => (
          <div key={d.day} className={`ws-day ${d.day === today ? 'today' : ''} ${d.min >= 50 ? 'hit' : ''}`} title={`${d.day}: ${h(d.min)} focus`}>
            <i style={{ height: `${Math.max(4, (d.min / max) * 100)}%` }} />
          </div>
        ))}
        <span className="ws-goal" style={{ bottom: `${(50 / max) * 100}%` }} title="Goal: 50 min a day" />
      </div>
      <div className="ws-labels">
        {st.week.map((d) => (
          <small key={d.day} className={d.day === today ? 'today' : ''}>
            {new Date(`${d.day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'narrow' })}
          </small>
        ))}
      </div>
    </section>
  )
}

/**
 * Next up and the day in one line (T1, T3): "Next: Algebra · in 23 min ·
 * 14:00–15:30 · Room 204 · Join · Start early", and "3 events · 2 blocks ·
 * 4h free · done at 18:30 · bed 23:30". The countdown ticks every second
 * in the last 10 minutes.
 */
export function NextUpBar() {
  const { events } = useTodayEvents()
  const [now, setNow] = useState(Date.now())
  const [bed, setBed] = useState<string | null>(null)
  useEffect(() => {
    life.sleep.state().then((s: any) => setBed(s?.bedTarget ?? null)).catch(() => {})
  }, [])
  const today = localDay(new Date(now).toISOString())
  const todays = events.filter((e) => localDay(e.start) === today)
  const next = nextUp(todays, now)
  const soon = next ? Date.parse(next.start) - now < 10 * 60_000 : false
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), soon ? 1000 : 30_000)
    return () => clearInterval(t)
  }, [soon])
  const sum = daySummary(todays, now, bed)
  const hm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (!todays.length && !next) return null
  const mins = next ? Math.max(5, Math.min(180, Math.round((Date.parse(next.end) - Date.parse(next.start)) / 60000))) : 0
  return (
    <section className={`nub ${soon ? 'soon' : ''}`} aria-label="Next up">
      {next ? (
        <div className="nub-next">
          <small>Next</small>
          <b title={next.title}>{next.title}</b>
          <span className="nub-cd">{countdown(Date.parse(next.start) - now)}</span>
          <span className="nub-meta">
            {hm(next.start)}–{hm(next.end)}
            {next.location ? ` · ${next.location}` : ''}
          </span>
          {next.meet && (
            <a className="btn small primary" href={next.meet} target="_blank" rel="noopener noreferrer">
              🎥 Join
            </a>
          )}
          {!isMeeting(next) && (
            <button className="btn small" onClick={() => void life.focus.start(next.title, mins, null).then(() => window.dispatchEvent(new CustomEvent('life-focus-changed')))}>
              ▶ Start early
            </button>
          )}
        </div>
      ) : (
        <div className="nub-next">
          <small>Next</small>
          <b>Nothing more in your calendar today</b>
        </div>
      )}
      <span className="nub-day">{sum.text}</span>
    </section>
  )
}

/**
 * Never miss twice (D4): yesterday slipped, so today starts with the small
 * version (15 minutes of focus, 10 push-ups). Gone once done or dismissed.
 */
export function MissTwiceCard() {
  const [st, setSt] = useState<CoachStatus | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const today = localDay(new Date().toISOString())
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem('ls.missTwiceHidden') === today
    } catch {
      return false
    }
  })
  const load = () => void life.coach?.status?.().then(setSt).catch(() => {})
  useEffect(load, [])
  useLive(load)
  const items = st?.missTwice ?? []
  if (hidden || !items.length) return null
  const run = async (id: string) => {
    setBusy(id)
    try {
      if (id === 'focus') await life.focus.start('Focus', 15)
      else await capture('10 pushups')
      window.dispatchEvent(new CustomEvent(id === 'focus' ? 'life-focus-changed' : 'life-body-changed'))
      load()
    } catch {
      /* the toast from the action says why */
    }
    setBusy(null)
  }
  return (
    <section className="miss-twice" aria-label="Never miss twice">
      <div>
        <b>Never miss twice</b>
        <small>{items.map((x) => x.missed).join(' · ')}. One day is fine; today, just the small version.</small>
      </div>
      <div className="row">
        {items.map((x) => (
          <button key={x.id} className="btn primary small" disabled={!!busy} onClick={() => void run(x.id)}>
            {x.id === 'focus' ? '▶ ' : '💪 '}
            {x.small}
          </button>
        ))}
        <button
          className="btn ghost small"
          onClick={() => {
            setHidden(true)
            try {
              localStorage.setItem('ls.missTwiceHidden', today)
            } catch {
              /* private window */
            }
          }}
        >
          Not today
        </button>
      </div>
    </section>
  )
}
