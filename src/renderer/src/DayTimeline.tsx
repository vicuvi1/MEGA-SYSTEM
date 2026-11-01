// "Your day": today's calendar and timed Todoist tasks in order, with the
// free time between them, a moving "now" line, and what's next.
// - Tap a block to act on it: focus on it, mark it done or skipped, move or
//   resize it, delete it. Drag a block onto a free gap to move it there.
// - Deep-work blocks (study, deep block, lab, project…) count as focus: past
//   ones show what really happened (✓ done, ◐ partial, ✗ skipped) and the
//   day's "plan kept" %. Each shows the points it pays.
// - The coach fills your free time with your must-dos, big 3 and urgent
//   Todoist tasks as suggestions right in the timeline: add one, add all, or
//   dismiss. No building study blocks by hand.
import { useEffect, useMemo, useRef, useState } from 'react'
import { blockState, freeGaps, isFocusBlock, localDay, localHM, planKept, suggestBlocks, untilText, type BlockState, type CalEvent } from '@core/dayTime'
import { focusCoins } from '@core/focus'
import { activePlan } from '@core/weekPlan'
import { sortTasks, type TodoTask } from '@core/todoist'
import { life } from './bridge'
import { Icon } from './Icon'
import type { PageId } from './modules'
import { useFocus } from './pages/Focus'
import { useWeekPlan } from './WeekPlanner'
import { soundSuccess } from './sound'
import { useAction } from './ui'
import { useLive } from './live'
import { localToday, useTodayEvents } from './todayEvents'

const pad = (n: number) => String(n).padStart(2, '0')
const hmOf = (ms: number) => {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const hmUp15 = () => {
  const d = new Date()
  const m = Math.ceil((d.getHours() * 60 + d.getMinutes()) / 15) * 15
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
}
const dur = (m: number) => {
  const r = Math.max(0, Math.round(m))
  return r >= 60 ? `${Math.floor(r / 60)}h${r % 60 ? ` ${r % 60}m` : ''}` : `${r}m`
}
const iso = (day: string, hm: string) => new Date(`${day}T${hm}:00`).toISOString()
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

type Row =
  | { kind: 'event'; key: string; start: string; end: string; ev: CalEvent; focus: boolean }
  | { kind: 'task'; key: string; start: string; end: string; task: TodoTask }
  | { kind: 'gap'; key: string; start: string; end: string; minutes: number }
  | { kind: 'suggest'; key: string; start: string; end: string; title: string; taskId?: string }
  | { kind: 'now'; key: string; start: string; end: string }

const STATE_ICON: Record<BlockState, string> = { upcoming: '', now: '', done: '✓', partial: '◐', skipped: '✗' }
const STATE_TITLE: Record<BlockState, string> = { upcoming: 'Coming up', now: 'Now', done: 'Done', partial: 'Partly done', skipped: 'Skipped' }

export function DayTimeline({ onGo }: { onGo: (p: PageId) => void }) {
  const act = useAction()
  const today = localToday()
  const { events, connected, reload } = useTodayEvents()
  const [todo, setTodo] = useState<TodoTask[]>([])
  const [marks, setMarks] = useState<Record<string, 'done' | 'skip'>>({})
  const [open, setOpen] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [focus] = useFocus()
  const [week] = useWeekPlan()
  const [now, setNow] = useState(Date.now())
  const dismissKey = `ls.tlDismissed.${today}`
  const [dismissed, setDismissed] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(dismissKey) || '[]')
    } catch {
      return []
    }
  })
  const box = useRef<HTMLElement>(null)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  const loadSide = () => {
    if (life.todoist) life.todoist.today().then(setTodo).catch(() => {})
    life.timeline?.marks(today).then(setMarks).catch(() => {})
  }
  useEffect(loadSide, [today])
  useLive(loadSide, { external: true })

  const dismiss = (titles: string[]) => {
    const next = [...new Set([...dismissed, ...titles])]
    setDismissed(next)
    try {
      localStorage.setItem(dismissKey, JSON.stringify(next))
    } catch {
      /* private window */
    }
  }

  const todayEvents = useMemo(() => events.filter((e) => !e.allDay && localDay(e.start) === today), [events, today])
  const sessions = focus?.todaySessions ?? []

  // The coach's suggestions: open must-dos, big 3 and urgent tasks in your free time from now on.
  const suggestions = useMemo(() => {
    if (!connected) return []
    const wp = week ? activePlan(week, today) : null
    const planned = (t: string) => todayEvents.some((e) => same(e.title, t) || e.title.toLowerCase().includes(t.toLowerCase().slice(0, 24)))
    const items = [
      ...(focus?.plan.items.filter((p) => !p.done).map((p) => ({ title: p.text, minutes: 50, taskId: undefined as string | undefined })) ?? []),
      ...(wp?.big3.filter((b) => !b.done && b.text).map((b) => ({ title: b.text, minutes: 50, taskId: b.todoistId ?? undefined })) ?? []),
      ...sortTasks(todo.filter((t) => !t.dueTime && (t.priority >= 3 || (t.due && t.due < today))), today).map((t) => ({ title: t.content, minutes: 50, taskId: t.id as string | undefined }))
    ]
      .filter((x, i, all) => all.findIndex((y) => same(y.title, x.title)) === i)
      .filter((x) => !planned(x.title) && !dismissed.includes(x.title))
      .slice(0, 4)
    if (!items.length) return []
    const gaps = freeGaps(todayEvents, today, { after: hmUp15(), minMinutes: 30 })
    return suggestBlocks(gaps, items).map((b) => ({ ...b, taskId: items.find((i) => i.title === b.title)?.taskId }))
    // `now` keeps "from now on" fresh
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, week, today, todayEvents, focus, todo, dismissed, now])

  const stateOf = (e: CalEvent): BlockState | null => {
    const m = marks[e.id]
    if (m) return m === 'done' ? 'done' : 'skipped'
    if (!isFocusBlock(e)) return Date.parse(e.end) <= now ? null : Date.parse(e.start) <= now ? 'now' : 'upcoming'
    return blockState(e.start, e.end, sessions, now, focus?.running ?? null).state
  }

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [
      ...todayEvents.map((ev) => ({ kind: 'event' as const, key: `e:${ev.id}`, start: localHM(ev.start), end: localDay(ev.end) > today ? '23:59' : localHM(ev.end), ev, focus: isFocusBlock(ev) })),
      ...todo.filter((t) => t.due === today && t.dueTime && !todayEvents.some((e) => same(e.title, t.content))).map((t) => ({ kind: 'task' as const, key: `t:${t.id}`, start: t.dueTime!, end: t.dueTime!, task: t })),
      // Free time left once the suggestions are in.
      ...freeGaps([...todayEvents, ...suggestions.map((x) => ({ id: x.title, calendarId: '', title: x.title, start: iso(today, x.start), end: iso(today, x.end), allDay: false }))], today, { minMinutes: 45 }).map((g) => ({ kind: 'gap' as const, key: `g:${g.start}`, start: g.start, end: g.end, minutes: g.minutes })),
      ...suggestions.map((b) => ({ kind: 'suggest' as const, key: `s:${b.title}`, start: b.start, end: b.end, title: b.title, taskId: b.taskId }))
    ]
    const n = hmOf(now)
    if (n >= '06:00') out.push({ kind: 'now', key: 'now', start: n, end: n })
    const order = { now: 0, event: 1, task: 1, suggest: 2, gap: 3 }
    return out.sort((a, b) => a.start.localeCompare(b.start) || order[a.kind] - order[b.kind])
  }, [todayEvents, todo, suggestions, now, today])

  const states = todayEvents.map(stateOf).filter((s): s is BlockState => !!s)
  const kept = planKept(states)
  const next = todayEvents.filter((e) => Date.parse(e.start) > now).sort((a, b) => a.start.localeCompare(b.start))[0]
  const current = todayEvents.find((e) => Date.parse(e.start) <= now && now < Date.parse(e.end))

  // Actions
  const google = life.google
  const shift = async (e: CalEvent, startMin: number, endMin: number, msg: string) => {
    if (!google) return
    const s = new Date(Date.parse(e.start) + startMin * 60000).toISOString()
    const en = new Date(Date.parse(e.end) + endMin * 60000).toISOString()
    if (Date.parse(en) - Date.parse(s) < 10 * 60000) return
    if (await act(() => google.move(e.calendarId, e.id, s, en).then(() => true), msg)) void reload()
  }
  const moveTo = async (e: CalEvent, hm: string) => {
    if (!google) return
    const len = Date.parse(e.end) - Date.parse(e.start)
    const s = iso(today, hm)
    if (await act(() => google.move(e.calendarId, e.id, s, new Date(Date.parse(s) + len).toISOString()).then(() => true), `Moved to ${hm}`)) void reload()
  }
  const remove = async (e: CalEvent) => {
    if (!google) return
    setOpen(null)
    if (await act(() => google.remove(e.calendarId, e.id).then(() => true), 'Deleted from your calendar')) void reload()
  }
  const mark = async (e: CalEvent, v: 'done' | 'skip' | null) => {
    setMarks((m) => {
      const n = { ...m }
      if (v) n[e.id] = v
      else delete n[e.id]
      return n
    })
    if (v === 'done') soundSuccess()
    await life.timeline?.mark(today, e.id, v).catch(() => null)
  }
  const focusOn = async (e: CalEvent) => {
    const left = Math.round((Date.parse(e.end) - Math.max(now, Date.parse(e.start))) / 60000)
    const minutes = Math.max(10, Math.min(180, left))
    if (await act(() => life.focus.start(e.title.replace(/^[^\p{L}\p{N}]+/u, '').slice(0, 40), minutes, null), `Focus started: ${e.title} · ${minutes} min`)) {
      soundSuccess()
      setOpen(null)
    }
  }
  const addSuggestions = async (list: { title: string; start: string; end: string; taskId?: string }[]) => {
    if (!google || !list.length) return
    const ok = await act(async () => {
      for (const b of list) {
        await google.create({ title: b.title, start: iso(today, b.start), end: iso(today, b.end), description: 'Planned in Life System' })
        if (b.taskId) await life.todoist?.update?.(b.taskId, { due: `${today} ${b.start}` }).catch(() => null)
      }
      return true
    }, `${list.length} block${list.length === 1 ? '' : 's'} added to your calendar`)
    if (ok) {
      soundSuccess()
      void reload()
    }
  }

  // The morning card's "Plan my day": show the suggestions (again) and scroll here.
  useEffect(() => {
    const on = () => {
      if (!connected) return onGo('settings')
      setDismissed([])
      try {
        localStorage.removeItem(dismissKey)
      } catch {
        /* ignore */
      }
      box.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    window.addEventListener('life-plan-day', on)
    return () => window.removeEventListener('life-plan-day', on)
  }, [connected, onGo, dismissKey])

  const nowHM = hmOf(now)
  return (
    <section className="card tl" ref={box}>
      <header className="card-head">
        <h2>
          <Icon name="calendar" size={16} /> Your day
        </h2>
        <div className="actions">
          <button className="btn small ghost" onClick={() => onGo(connected === false ? 'settings' : 'calendar')}>
            {connected === false ? 'Connect calendar' : 'Week'}
          </button>
        </div>
      </header>

      {connected && (
        <div className="tl-sum">
          {current ? (
            <span className="tl-sum-now">
              <i /> Now: <b>{current.title}</b> · {dur((Date.parse(current.end) - now) / 60000)} left
            </span>
          ) : next ? (
            <span>
              Next: <b>{next.title}</b> {untilText(next.start, now)}
            </span>
          ) : (
            <span className="hint">Nothing else planned today.</span>
          )}
          {kept.pct !== null && (
            <span className={`chip ${kept.pct >= 70 ? 'ok' : kept.pct >= 40 ? 'warn' : 'bad'}`} title="Finished blocks you did (partial counts half)">
              Plan kept {kept.pct}% · {kept.done}/{kept.total}
            </span>
          )}
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="tl-suggest-bar">
          <span>
            <Icon name="spark" size={13} /> Coach's plan for your free time
          </span>
          <button className="btn small primary" onClick={() => void addSuggestions(suggestions)}>
            Add all {suggestions.length}
          </button>
          <button className="btn small ghost" onClick={() => dismiss(suggestions.map((s) => s.title))}>
            Not today
          </button>
        </div>
      )}

      {connected === null ? (
        <p className="hint">Loading your day…</p>
      ) : (
        <ol className="tl-list">
          {rows.map((r) => {
            if (r.kind === 'now')
              return (
                <li key="now" className="tl-nowline" aria-label={`Now ${r.start}`}>
                  <span className="tl-time">{r.start}</span>
                  <i />
                </li>
              )
            if (r.kind === 'gap') {
              const past = r.end <= nowHM
              return (
                <li
                  key={r.key}
                  className={`tl-row gap ${past ? 'past' : ''} ${dragOver === r.key ? 'drop' : ''}`}
                  onDragOver={(e) => {
                    if (past || !(e.dataTransfer.types.includes('text/x-event') || e.dataTransfer.types.includes('text/x-task'))) return
                    e.preventDefault()
                    setDragOver(r.key)
                  }}
                  onDragLeave={() => setDragOver(null)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setDragOver(null)
                    const at = r.start < nowHM ? hmUp15() : r.start
                    const raw = e.dataTransfer.getData('text/x-task')
                    if (raw) {
                      // A task from Today's list: a block in your free time, and its time in Todoist.
                      try {
                        const t = JSON.parse(raw) as { id: string; title: string; minutes: number }
                        const startMin = Number(at.slice(0, 2)) * 60 + Number(at.slice(3, 5))
                        const endMin = Math.min(Number(r.end.slice(0, 2)) * 60 + Number(r.end.slice(3, 5)), startMin + (t.minutes || 50))
                        void addSuggestions([{ title: t.title, start: at, end: `${pad(Math.floor(endMin / 60))}:${pad(endMin % 60)}`, taskId: t.id }])
                      } catch {
                        /* not a task */
                      }
                      return
                    }
                    const ev = todayEvents.find((x) => x.id === e.dataTransfer.getData('text/x-event'))
                    if (ev) void moveTo(ev, at)
                  }}
                >
                  <span className="tl-time">
                    {r.start}–{r.end}
                  </span>
                  <span className="tl-bar" />
                  <span className="tl-title">
                    Free · <b>{dur(r.minutes)}</b>
                    {dragOver === r.key && <small> · drop to move here</small>}
                  </span>
                </li>
              )
            }
            if (r.kind === 'suggest')
              return (
                <li key={r.key} className="tl-row suggest">
                  <span className="tl-time">
                    {r.start}–{r.end}
                  </span>
                  <span className="tl-bar" />
                  <span className="tl-title">
                    {r.title}
                    <small> · suggested · +15</small>
                  </span>
                  <span className="tl-acts">
                    <button className="tl-btn ok" title="Add to my calendar" aria-label={`Add ${r.title}`} onClick={() => void addSuggestions([r])}>
                      ✓
                    </button>
                    <button className="tl-btn" title="Not today" aria-label={`Dismiss ${r.title}`} onClick={() => dismiss([r.title])}>
                      ✕
                    </button>
                  </span>
                </li>
              )
            if (r.kind === 'task')
              return (
                <li key={r.key} className="tl-row task" style={{ ['--c' as string]: 'var(--accent)' }}>
                  <span className="tl-time">{r.start}</span>
                  <span className="tl-bar" />
                  <span className="tl-title">
                    {r.task.content}
                    <small> · Todoist · +5</small>
                  </span>
                </li>
              )
            // A calendar event
            const e = r.ev
            const st = stateOf(e)
            const isOpen = open === r.key
            const s0 = Date.parse(e.start)
            const e0 = Date.parse(e.end)
            const len = (e0 - s0) / 60000
            const pts = r.focus ? focusCoins(len) : 0
            const isNow = st === 'now'
            const done = Math.min(100, ((now - s0) / Math.max(1, e0 - s0)) * 100)
            return (
              <li
                key={r.key}
                className={`tl-row event ${st ?? ''} ${e0 <= now && !isNow ? 'past' : ''} ${isOpen ? 'open' : ''} ${r.focus ? 'focusy' : ''}`}
                style={{ ['--c' as string]: e.color ?? '#7CC4FF' }}
                draggable={!!google}
                onDragStart={(ev) => {
                  ev.dataTransfer.setData('text/x-event', e.id)
                  ev.dataTransfer.effectAllowed = 'move'
                }}
              >
                <button className="tl-main" onClick={() => setOpen(isOpen ? null : r.key)} aria-expanded={isOpen}>
                  <span className="tl-time">
                    {r.start}–{r.end}
                  </span>
                  <span className="tl-bar">{isNow && <i style={{ height: `${done}%` }} />}</span>
                  <span className="tl-title">
                    {e.title}
                    {isNow && <small className="tl-left"> · {dur((e0 - now) / 60000)} left</small>}
                  </span>
                  {pts > 0 && st !== 'done' && st !== 'skipped' && (
                    <span className="tl-pts" title="Focus on it: +3 per 10 min">
                      +{pts}
                    </span>
                  )}
                  {st && STATE_ICON[st] && (
                    <span className={`tl-state ${st}`} title={STATE_TITLE[st]}>
                      {STATE_ICON[st]}
                    </span>
                  )}
                </button>
                {isOpen && (
                  <div className="tl-menu">
                    {e0 > now && (
                      <button className="btn small primary" onClick={() => void focusOn(e)} disabled={!!focus?.running}>
                        ▶ Focus{r.focus ? ` · +${focusCoins((e0 - Math.max(now, s0)) / 60000)}` : ''}
                      </button>
                    )}
                    <button className={`btn small ${marks[e.id] === 'done' ? 'on' : ''}`} onClick={() => void mark(e, marks[e.id] === 'done' ? null : 'done')}>
                      ✓ Done
                    </button>
                    <button className={`btn small ${marks[e.id] === 'skip' ? 'on' : ''}`} onClick={() => void mark(e, marks[e.id] === 'skip' ? null : 'skip')}>
                      ✗ Skipped
                    </button>
                    {google && (
                      <>
                        <span className="tl-sep" />
                        <button className="btn small ghost" title="30 minutes earlier" onClick={() => void shift(e, -30, -30, 'Moved 30 min earlier')}>
                          −30m
                        </button>
                        <button className="btn small ghost" title="30 minutes later" onClick={() => void shift(e, 30, 30, 'Moved 30 min later')}>
                          +30m
                        </button>
                        <button className="btn small ghost" title="An hour later" onClick={() => void shift(e, 60, 60, 'Moved 1 hour later')}>
                          +1h
                        </button>
                        <span className="tl-sep" />
                        <button className="btn small ghost" title="15 minutes shorter" onClick={() => void shift(e, 0, -15, 'Shortened by 15 min')}>
                          −15 min
                        </button>
                        <button className="btn small ghost" title="15 minutes longer" onClick={() => void shift(e, 0, 15, 'Extended by 15 min')}>
                          +15 min
                        </button>
                        <DeleteBlock onDelete={() => void remove(e)} />
                      </>
                    )}
                  </div>
                )}
              </li>
            )
          })}
          {!rows.some((r) => r.kind !== 'now') && <li className="hint">Nothing planned. A free day: plan it.</li>}
        </ol>
      )}
      {connected && <p className="hint small tl-tip">Tap a block to act on it · drag it onto free time to move it</p>}
    </section>
  )
}

function DeleteBlock({ onDelete }: { onDelete: () => void }) {
  const [sure, setSure] = useState(false)
  useEffect(() => {
    if (!sure) return
    const t = setTimeout(() => setSure(false), 2500)
    return () => clearTimeout(t)
  }, [sure])
  return (
    <button className={`btn small ghost ${sure ? 'danger' : ''}`} onClick={() => (sure ? onDelete() : setSure(true))} title="Delete from your calendar">
      {sure ? 'Sure?' : <Icon name="trash" size={13} />}
    </button>
  )
}
