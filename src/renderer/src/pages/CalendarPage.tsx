// Calendar: your Google Calendar events and your timed Todoist tasks, by
// week or by day (07:00–23:00). Drag a task from the side onto a time to
// block it (a Google event + the time set in Todoist), click a free slot to
// add an event, click an event to delete it.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { DAY_END, DAY_START, localDay, localHM, type CalEvent } from '@core/dayTime'
import { defaultAreaColor, sortTasks, type Area, type TodoTask } from '@core/todoist'
import { life } from '../bridge'
import { Icon } from '../Icon'
import type { PageId } from '../modules'
import { useAction } from '../ui'
import { useLive } from '../live'

const HOUR_PX = 52
const START_H = Number(DAY_START.slice(0, 2))
const END_H = Number(DAY_END.slice(0, 2))
const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00`)
  d.setDate(d.getDate() + n)
  return ymd(d)
}
const monday = (day: string) => {
  const d = new Date(`${day}T12:00:00`)
  return addDays(day, -((d.getDay() + 6) % 7))
}
const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))
const isoAt = (day: string, min: number) => new Date(`${day}T${pad(Math.floor(min / 60))}:${pad(min % 60)}:00`).toISOString()

interface Item {
  key: string
  title: string
  day: string
  start: number // minutes
  end: number
  color: string
  kind: 'event' | 'task'
  event?: CalEvent
  task?: TodoTask
}

export function CalendarPage({ onGo }: { onGo: (p: PageId) => void }) {
  const act = useAction()
  const today = ymd(new Date())
  const [mode, setMode] = useState<'week' | 'day'>('week')
  const [anchor, setAnchor] = useState(today)
  const [events, setEvents] = useState<CalEvent[]>([])
  const [todo, setTodo] = useState<{ tasks: TodoTask[]; areas: Area[] } | null>(null)
  const [colors, setColors] = useState<Record<string, string>>({})
  const [connected, setConnected] = useState<boolean | null>(null)
  const [draft, setDraft] = useState<{ day: string; start: number } | null>(null)
  const [picked, setPicked] = useState<Item | null>(null)
  const [now, setNow] = useState(new Date())

  const days = useMemo(() => (mode === 'week' ? Array.from({ length: 7 }, (_, i) => addDays(monday(anchor), i)) : [anchor]), [mode, anchor])
  const load = useCallback(async () => {
    const st = await life.google?.status().catch(() => null)
    setConnected(!!st?.connected)
    if (st?.connected) {
      const from = new Date(`${days[0]}T00:00:00`).toISOString()
      const to = new Date(`${addDays(days[days.length - 1], 1)}T00:00:00`).toISOString()
      setEvents(await life.google!.events(from, to).catch(() => []))
    }
    if (life.todoist?.everything && (await life.todoist.status().catch(() => ({ connected: false }))).connected) {
      setTodo(await life.todoist.everything().catch(() => null))
      life.todoist.colors?.().then(setColors).catch(() => {})
    }
  }, [days])
  useEffect(() => {
    void load()
  }, [load])
  // Live: events and tasks changed elsewhere (Google, Todoist, a bot) appear by themselves.
  useLive(() => void load(), { external: true })
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  const areaColor = (t: TodoTask) => {
    const key = t.sectionId ? `s:${t.sectionId}` : `p:${t.projectId ?? ''}`
    const a = todo?.areas.find((x) => x.key === key)
    return a ? colors[a.key] ?? defaultAreaColor(a) : '#94A3B8'
  }

  const items: Item[] = useMemo(() => {
    const out: Item[] = []
    for (const e of events.filter((x) => !x.allDay)) {
      const day = localDay(e.start)
      if (!days.includes(day)) continue
      const s = toMin(localHM(e.start))
      const en = localDay(e.end) > day ? 24 * 60 : toMin(localHM(e.end))
      out.push({ key: `e:${e.calendarId}:${e.id}`, title: e.title, day, start: s, end: Math.max(en, s + 15), color: e.color ?? '#7CC4FF', kind: 'event', event: e })
    }
    // Timed Todoist tasks that aren't already a Life System event.
    const blocked = new Set(events.filter((e) => e.ours).map((e) => `${localDay(e.start)}|${e.title}`))
    for (const t of todo?.tasks ?? []) {
      if (!t.due || !t.dueTime || !days.includes(t.due) || blocked.has(`${t.due}|${t.content}`)) continue
      const s = toMin(t.dueTime)
      out.push({ key: `t:${t.id}`, title: t.content, day: t.due, start: s, end: s + 30, color: areaColor(t), kind: 'task', task: t })
    }
    return out
  }, [events, todo, days, colors])

  const allDay = events.filter((e) => e.allDay)
  const toSchedule = sortTasks((todo?.tasks ?? []).filter((t) => !t.dueTime && (!t.due || t.due <= addDays(today, 7))), today).slice(0, 30)

  const block = async (task: TodoTask, day: string, start: number, minutes = 50) => {
    const ok = await act(async () => {
      if (connected) await life.google!.create({ title: task.content, start: isoAt(day, start), end: isoAt(day, start + minutes), description: `Todoist task · planned in Life System` })
      await life.todoist?.update?.(task.id, { due: `${day} ${pad(Math.floor(start / 60))}:${pad(start % 60)}` })
      return true
    }, `Planned: ${task.content} at ${pad(Math.floor(start / 60))}:${pad(start % 60)}`)
    if (ok) void load()
  }
  const createEvent = async (title: string, day: string, start: number, minutes: number) => {
    if (await act(() => life.google!.create({ title, start: isoAt(day, start), end: isoAt(day, start + minutes) }), 'Added to your calendar')) {
      setDraft(null)
      void load()
    }
  }

  // Position inside a day column (top = 07:00), snapped to 15 minutes.
  const slotFrom = (e: React.MouseEvent | React.DragEvent, el: HTMLElement) => {
    const y = e.clientY - el.getBoundingClientRect().top
    return Math.min(END_H * 60 - 15, Math.max(START_H * 60, START_H * 60 + Math.round((y / HOUR_PX) * 4) * 15))
  }

  if (connected === false && !todo)
    return (
      <section className="panel">
        <p className="hint">Connect Google Calendar in Settings to see your events here.</p>
        <button className="btn primary" onClick={() => onGo('settings')}>
          Open Settings
        </button>
      </section>
    )

  const nowMin = now.getHours() * 60 + now.getMinutes()
  const title = mode === 'week' ? `${new Date(`${days[0]}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${new Date(`${days[6]}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : new Date(`${anchor}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="cal">
      <section className="panel cal-bar">
        <div className="row">
          <button className="btn small ghost" onClick={() => setAnchor(addDays(anchor, mode === 'week' ? -7 : -1))} aria-label="Back">
            ‹
          </button>
          <button className="btn small" onClick={() => setAnchor(today)}>
            Today
          </button>
          <button className="btn small ghost" onClick={() => setAnchor(addDays(anchor, mode === 'week' ? 7 : 1))} aria-label="Forward">
            ›
          </button>
          <h2 className="cal-title">{title}</h2>
        </div>
        <div className="row">
          {connected === false && (
            <button className="btn small ghost" onClick={() => onGo('settings')}>
              <Icon name="calendar" size={13} /> Connect Google Calendar
            </button>
          )}
          <div className="ta-tabs">
            <button className={mode === 'day' ? 'on' : ''} onClick={() => setMode('day')}>
              Day
            </button>
            <button className={mode === 'week' ? 'on' : ''} onClick={() => setMode('week')}>
              Week
            </button>
          </div>
        </div>
      </section>

      <div className="cal-body">
        <aside className="panel cal-side">
          <h3>To schedule</h3>
          <p className="hint small">Drag a task onto a time. It becomes a 50-minute block in your calendar, and its time is set in Todoist.</p>
          <ul className="cal-todo">
            {toSchedule.map((t) => (
              <li
                key={t.id}
                draggable
                onDragStart={(e) => e.dataTransfer.setData('text/task', t.id)}
                style={{ ['--c' as string]: areaColor(t) }}
                title={t.content}
              >
                <i />
                <span>{t.content}</span>
                {t.due && t.due < today && <em>late</em>}
              </li>
            ))}
            {!toSchedule.length && <li className="hint">Nothing waiting.</li>}
          </ul>
        </aside>

        <section className="panel cal-grid-wrap">
          {allDay.some((e) => days.includes(localDay(e.start))) && (
            <div className="cal-allday" style={{ gridTemplateColumns: `52px repeat(${days.length}, 1fr)` }}>
              <span className="cal-hour-label">all day</span>
              {days.map((d) => (
                <div key={d} className="cal-allday-cell">
                  {allDay
                    .filter((e) => localDay(e.start) <= d && localDay(e.end) > d)
                    .map((e) => (
                      <span key={e.id} className="cal-chip" style={{ ['--c' as string]: e.color ?? '#7CC4FF' }}>
                        {e.title}
                      </span>
                    ))}
                </div>
              ))}
            </div>
          )}
          <div className="cal-head" style={{ gridTemplateColumns: `52px repeat(${days.length}, 1fr)` }}>
            <span />
            {days.map((d) => (
              <button key={d} className={`cal-dayname ${d === today ? 'today' : ''}`} onClick={() => { setAnchor(d); setMode('day') }}>
                <small>{new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short' })}</small>
                <b>{d.slice(8)}</b>
              </button>
            ))}
          </div>
          <div className="cal-grid" style={{ gridTemplateColumns: `52px repeat(${days.length}, 1fr)`, height: (END_H - START_H) * HOUR_PX }}>
            <div className="cal-hours">
              {Array.from({ length: END_H - START_H }, (_, i) => (
                <span key={i} style={{ top: i * HOUR_PX }}>
                  {pad(START_H + i)}:00
                </span>
              ))}
            </div>
            {days.map((d) => (
              <div
                key={d}
                className={`cal-col ${d === today ? 'today' : ''}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  const id = e.dataTransfer.getData('text/task')
                  const t = todo?.tasks.find((x) => x.id === id)
                  if (t) void block(t, d, slotFrom(e, e.currentTarget))
                }}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('.cal-item, .cal-draft')) return
                  if (!connected) return
                  setPicked(null)
                  setDraft({ day: d, start: slotFrom(e, e.currentTarget) })
                }}
              >
                {Array.from({ length: END_H - START_H }, (_, i) => (
                  <i key={i} className="cal-line" style={{ top: i * HOUR_PX }} />
                ))}
                {d === today && nowMin >= START_H * 60 && nowMin <= END_H * 60 && <i className="cal-now" style={{ top: ((nowMin - START_H * 60) / 60) * HOUR_PX }} />}
                {layout(items.filter((x) => x.day === d)).map(({ it, col, cols }) => {
                  const top = ((Math.max(it.start, START_H * 60) - START_H * 60) / 60) * HOUR_PX
                  const h = Math.max(18, ((Math.min(it.end, END_H * 60) - Math.max(it.start, START_H * 60)) / 60) * HOUR_PX - 2)
                  if (it.end <= START_H * 60 || it.start >= END_H * 60) return null
                  return (
                    <button
                      key={it.key}
                      className={`cal-item ${it.kind}`}
                      style={{ top, height: h, left: `calc(${(col / cols) * 100}% + 2px)`, width: `calc(${100 / cols}% - 4px)`, ['--c' as string]: it.color }}
                      onClick={() => setPicked(it)}
                      title={`${it.title} · ${pad(Math.floor(it.start / 60))}:${pad(it.start % 60)}–${pad(Math.floor(it.end / 60))}:${pad(it.end % 60)}`}
                    >
                      <b>{it.title}</b>
                      {h > 30 && (
                        <small>
                          {pad(Math.floor(it.start / 60))}:{pad(it.start % 60)}
                          {it.kind === 'task' ? ' · Todoist' : ''}
                        </small>
                      )}
                    </button>
                  )
                })}
                {draft?.day === d && <DraftForm top={((draft.start - START_H * 60) / 60) * HOUR_PX} start={draft.start} onCancel={() => setDraft(null)} onSave={(t, m) => createEvent(t, d, draft.start, m)} />}
              </div>
            ))}
          </div>
        </section>
      </div>

      {picked && (
        <div className="sheet" role="dialog" aria-label={picked.title} onClick={(e) => e.target === e.currentTarget && setPicked(null)}>
          <div className="sheet-card cal-picked">
            <span className="cal-dot" style={{ background: picked.color }} />
            <h3>{picked.title}</h3>
            <p className="hint">
              {new Date(`${picked.day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })} · {pad(Math.floor(picked.start / 60))}:{pad(picked.start % 60)}–{pad(Math.floor(picked.end / 60))}:{pad(picked.end % 60)}
              {picked.task ? ' · Todoist task' : picked.event?.location ? ` · ${picked.event.location}` : ''}
            </p>
            <div className="row">
              {picked.event && (
                <button
                  className="btn small ghost"
                  onClick={async () => {
                    if (await act(() => life.google!.remove(picked.event!.calendarId, picked.event!.id).then(() => true), 'Removed from your calendar')) {
                      setPicked(null)
                      void load()
                    }
                  }}
                >
                  <Icon name="trash" size={13} /> Delete event
                </button>
              )}
              {picked.task && (
                <button
                  className="btn small"
                  onClick={async () => {
                    if (await act(() => life.todoist!.complete(picked.task!), 'Done in Todoist')) {
                      setPicked(null)
                      void load()
                    }
                  }}
                >
                  <Icon name="check" size={13} /> Done
                </button>
              )}
              <button className="btn small ghost" onClick={() => setPicked(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** Side-by-side columns for overlapping items in one day. */
function layout(items: Item[]): { it: Item; col: number; cols: number }[] {
  const sorted = items.slice().sort((a, b) => a.start - b.start || b.end - a.end)
  const out: { it: Item; col: number; cols: number }[] = []
  let group: { it: Item; col: number }[] = []
  let groupEnd = -1
  const flush = () => {
    const cols = Math.max(1, ...group.map((g) => g.col + 1))
    for (const g of group) out.push({ ...g, cols })
    group = []
  }
  for (const it of sorted) {
    if (it.start >= groupEnd && group.length) flush()
    const used = new Set(group.filter((g) => g.it.end > it.start).map((g) => g.col))
    let col = 0
    while (used.has(col)) col++
    group.push({ it, col })
    groupEnd = Math.max(groupEnd, it.end)
  }
  if (group.length) flush()
  return out
}

function DraftForm({ top, start, onSave, onCancel }: { top: number; start: number; onSave: (title: string, minutes: number) => void; onCancel: () => void }) {
  const [title, setTitle] = useState('')
  const [minutes, setMinutes] = useState(50)
  return (
    <form
      className="cal-draft"
      style={{ top }}
      onSubmit={(e) => {
        e.preventDefault()
        if (title.trim()) onSave(title.trim(), minutes)
      }}
    >
      <small>
        {pad(Math.floor(start / 60))}:{pad(start % 60)}
      </small>
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What? e.g. Study math" onKeyDown={(e) => e.key === 'Escape' && onCancel()} />
      <div className="row">
        {[25, 50, 90].map((m) => (
          <button type="button" key={m} className={`btn small ${minutes === m ? '' : 'ghost'}`} onClick={() => setMinutes(m)}>
            {m}m
          </button>
        ))}
        <button className="btn small primary">Add</button>
      </div>
    </form>
  )
}

