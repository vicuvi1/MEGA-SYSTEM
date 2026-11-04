// Calendar: your Google Calendar and timed Todoist tasks.
// - Views: Day, 3 days, Week, Month, Agenda; zoom the hours in or out.
// - Drag an event to move it (also to another day), pull its bottom edge to
//   resize, drag on empty time to create one. Click to edit (title, day,
//   times), delete, or start focus on it.
// - Drag a task from "To schedule" onto a time: a block in your calendar and
//   the time set in Todoist.
// - Hide or dim calendars (e.g. university, routine); overlaps sit side by side.
// - Repeat a new block (daily, weekdays, weekly) and save a day as a template
//   ("Study day") to drop onto any other day.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { localDay, localHM, type CalEvent } from '@core/dayTime'
import { layoutDay } from '@core/calLayout'
import { blocksToApply, repeatRule, templateFromDay, type DayTemplate, type Repeat } from '@core/calTemplates'
import { defaultAreaColor, sortTasks, type Area, type TodoTask } from '@core/todoist'
import { life, type GoogleStatus } from '../bridge'
import { Icon } from '../Icon'
import type { PageId } from '../modules'
import { useAction } from '../ui'
import { useLive } from '../live'
import { soundSuccess } from '../sound'

type View = 'day' | '3day' | 'week' | 'month' | 'agenda'
const START_H = 6
const END_H = 24
const ZOOMS = [32, 44, 56, 72, 96]
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
const hmOf = (min: number) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`
const isoAt = (day: string, min: number) => (min >= 24 * 60 ? new Date(`${addDays(day, 1)}T00:00:00`).toISOString() : new Date(`${day}T${hmOf(min)}:00`).toISOString())
const store = {
  get<T>(k: string, d: T): T {
    try {
      const v = localStorage.getItem(k)
      return v == null ? d : (JSON.parse(v) as T)
    } catch {
      return d
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(k, JSON.stringify(v))
    } catch {
      /* private window */
    }
  }
}

interface Item {
  key: string
  title: string
  day: string
  start: number
  end: number
  color: string
  kind: 'event' | 'task'
  event?: CalEvent
  task?: TodoTask
  dim?: boolean
}

type Drag =
  | { kind: 'move'; item: Item; offset: number; len: number; x0: number; y0: number; moved: boolean }
  | { kind: 'resize'; item: Item; x0: number; y0: number; moved: boolean }
  | { kind: 'create'; day: string; from: number; x0: number; y0: number; moved: boolean }

export function CalendarPage({ onGo }: { onGo: (p: PageId) => void }) {
  const act = useAction()
  const today = ymd(new Date())
  const [view, setViewRaw] = useState<View>(() => store.get('ls.calView', 'week'))
  const setView = (v: View) => {
    setMenu(null)
    setViewRaw(v)
    store.set('ls.calView', v)
  }
  // Roomier by default (56 px an hour); your zoom is remembered.
  const [zoom, setZoomRaw] = useState<number>(() => store.get('ls.calZoom2', 2))
  const setZoom = (z: number) => {
    const n = Math.max(0, Math.min(ZOOMS.length - 1, z))
    setZoomRaw(n)
    store.set('ls.calZoom2', n)
  }
  const [moreOpen, setMoreOpen] = useState<{ day: string; top: number; left: number; items: Item[] } | null>(null)
  const hourPx = ZOOMS[zoom] ?? 44
  const [hidden, setHidden] = useState<string[]>(() => store.get('ls.calHidden', []))
  const [dimmed, setDimmed] = useState<string[]>(() => store.get('ls.calDim', []))
  const [anchor, setAnchor] = useState(today)
  const [events, setEvents] = useState<CalEvent[]>([])
  const [status, setStatus] = useState<GoogleStatus | null>(null)
  const [todo, setTodo] = useState<{ tasks: TodoTask[]; areas: Area[] } | null>(null)
  const [colors, setColors] = useState<Record<string, string>>({})
  const [draft, setDraft] = useState<{ day: string; start: number; end: number } | null>(null)
  const [editing, setEditing] = useState<Item | null>(null)
  const [ghost, setGhost] = useState<{ day: string; start: number; end: number; title: string; color: string; key?: string } | null>(null)
  const [templates, setTemplates] = useState<DayTemplate[]>([])
  const [menu, setMenu] = useState<'cals' | 'templates' | null>(null)
  const [now, setNow] = useState(new Date())
  const drag = useRef<Drag | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const ghostRef = useRef(ghost)
  ghostRef.current = ghost
  const connected = !!status?.connected

  const days = useMemo(() => {
    if (view === 'day') return [anchor]
    if (view === '3day') return [anchor, addDays(anchor, 1), addDays(anchor, 2)]
    if (view === 'week') return Array.from({ length: 7 }, (_, i) => addDays(monday(anchor), i))
    if (view === 'agenda') return Array.from({ length: 14 }, (_, i) => addDays(anchor, i))
    const first = monday(`${anchor.slice(0, 7)}-01`)
    return Array.from({ length: 42 }, (_, i) => addDays(first, i))
  }, [view, anchor])

  const load = useCallback(async () => {
    const st = await life.google?.status().catch(() => null)
    setStatus(st ?? { configured: false, connected: false })
    if (st?.connected) {
      const from = new Date(`${days[0]}T00:00:00`).toISOString()
      const to = new Date(`${addDays(days[days.length - 1], 1)}T00:00:00`).toISOString()
      setEvents(await life.google!.events(from, to).catch(() => []))
    }
    if (life.todoist?.everything && (await life.todoist.status().catch(() => ({ connected: false }))).connected) {
      setTodo(await life.todoist.everything().catch(() => null))
      life.todoist.colors?.().then(setColors).catch(() => {})
    }
    life.calTemplates?.list().then(setTemplates).catch(() => {})
  }, [days])
  useEffect(() => {
    void load()
  }, [load])
  useLive(() => void load(), { external: true })
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])
  // Open on "now" (an hour before), not at 06:00.
  useEffect(() => {
    const el = gridRef.current
    if (!el) return
    el.scrollTop = Math.max(0, (new Date().getHours() - 1 - START_H) * hourPx)
  }, [view, hourPx])

  const calColor = (id: string) => status?.calendars?.find((c) => c.id === id)?.color
  /** Calendars you can't change (e.g. a shared university timetable) stay put. */
  const writable = (id: string) => status?.calendars?.find((c) => c.id === id)?.canWrite !== false
  const areaColor = (t: TodoTask) => {
    const key = t.sectionId ? `s:${t.sectionId}` : `p:${t.projectId ?? ''}`
    const a = todo?.areas.find((x) => x.key === key)
    return a ? colors[a.key] ?? defaultAreaColor(a) : '#94A3B8'
  }

  const visible = useMemo(() => events.filter((e) => !hidden.includes(e.calendarId)), [events, hidden])
  const items: Item[] = useMemo(() => {
    const out: Item[] = []
    for (const e of visible.filter((x) => !x.allDay)) {
      const day = localDay(e.start)
      const s = toMin(localHM(e.start))
      const en = localDay(e.end) > day ? 24 * 60 : toMin(localHM(e.end))
      out.push({ key: `e:${e.calendarId}:${e.id}`, title: e.title, day, start: s, end: Math.max(en, s + 15), color: e.color ?? calColor(e.calendarId) ?? '#7CC4FF', kind: 'event', event: e, dim: dimmed.includes(e.calendarId) })
    }
    const blocked = new Set(events.filter((e) => e.ours).map((e) => `${localDay(e.start)}|${e.title}`))
    for (const t of todo?.tasks ?? []) {
      if (!t.due || !t.dueTime || blocked.has(`${t.due}|${t.content}`)) continue
      const s = toMin(t.dueTime)
      out.push({ key: `t:${t.id}`, title: t.content, day: t.due, start: s, end: s + 30, color: areaColor(t), kind: 'task', task: t })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, events, todo, colors, dimmed, status])

  const toSchedule = sortTasks((todo?.tasks ?? []).filter((t) => !t.dueTime && (!t.due || t.due <= addDays(today, 7))), today).slice(0, 30)

  // ---- Changes ----------------------------------------------------------
  const block = async (task: TodoTask, day: string, start: number, minutes = 50) => {
    const ok = await act(async () => {
      if (connected) await life.google!.create({ title: task.content, start: isoAt(day, start), end: isoAt(day, start + minutes), description: 'Todoist task · planned in Life System' })
      await life.todoist?.update?.(task.id, { due: `${day} ${hmOf(start)}` })
      return true
    }, `Planned: ${task.content} at ${hmOf(start)}`)
    if (ok) void load()
  }
  const commitMove = async (it: Item, day: string, start: number, end: number) => {
    if (it.kind === 'event' && it.event) {
      const e = it.event
      const s = isoAt(day, start)
      const en = isoAt(day, end)
      setEvents((list) => list.map((x) => (x.id === e.id && x.calendarId === e.calendarId ? { ...x, start: s, end: en } : x)))
      const wd = day === it.day ? '' : `${new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short' })} `
      const ok = await act(() => life.google!.move(e.calendarId, e.id, s, en).then(() => true), `${e.title}: ${wd}${hmOf(start)}–${hmOf(end)}`)
      if (!ok) void load()
    } else if (it.task) {
      setTodo((t) => (t ? { ...t, tasks: t.tasks.map((x) => (x.id === it.task!.id ? { ...x, due: day, dueTime: hmOf(start) } : x)) } : t))
      const ok = await act(() => life.todoist!.update!(it.task!.id, { due: `${day} ${hmOf(start)}` }).then(() => true), `${it.title}: ${hmOf(start)}`)
      if (!ok) void load()
    }
  }
  const createEvent = async (title: string, day: string, start: number, end: number, repeat: Repeat) => {
    const ok = await act(() => life.google!.create({ title, start: isoAt(day, start), end: isoAt(day, end), recurrence: repeatRule(repeat, day) }).then(() => true), repeat === 'none' ? 'Added to your calendar' : `Added, repeating ${repeat}`)
    if (ok) {
      soundSuccess()
      setDraft(null)
      void load()
    }
  }

  // ---- Pointer drag (move, resize, create) --------------------------------
  const minuteAt = (clientY: number, col: HTMLElement) => {
    const y = clientY - col.getBoundingClientRect().top
    return Math.min(END_H * 60, Math.max(START_H * 60, START_H * 60 + Math.round((y / hourPx) * 4) * 15))
  }
  const colAt = (x: number, y: number) => (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-day]') ?? null
  const commitRef = useRef(commitMove)
  commitRef.current = commitMove
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current
      if (!d) return
      if (!d.moved && Math.abs(e.clientX - d.x0) + Math.abs(e.clientY - d.y0) < 5) return
      d.moved = true
      const col = colAt(e.clientX, e.clientY)
      if (!col) return
      const day = col.dataset.day!
      const m = minuteAt(e.clientY, col)
      if (d.kind === 'move') {
        const start = Math.max(START_H * 60, Math.min(END_H * 60 - d.len, m - d.offset))
        setGhost({ day, start, end: start + d.len, title: d.item.title, color: d.item.color, key: d.item.key })
      } else if (d.kind === 'resize') {
        setGhost({ day: d.item.day, start: d.item.start, end: Math.max(d.item.start + 15, m), title: d.item.title, color: d.item.color, key: d.item.key })
      } else {
        setGhost({ day: d.day, start: Math.min(d.from, m), end: Math.max(d.from + 15, m), title: 'New event', color: 'var(--accent)' })
      }
    }
    const up = () => {
      const d = drag.current
      drag.current = null
      if (!d) return
      const g = ghostRef.current
      setGhost(null)
      if (!d.moved) {
        if (d.kind === 'create') setDraft({ day: d.day, start: d.from, end: Math.min(24 * 60, d.from + 50) })
        else setEditing(d.item)
        return
      }
      if (!g) return
      if (d.kind === 'create') setDraft({ day: g.day, start: g.start, end: g.end })
      else if (g.day !== d.item.day || g.start !== d.item.start || g.end !== d.item.end) void commitRef.current(d.item, g.day, g.start, d.kind === 'resize' ? g.end : g.start + (d.item.end - d.item.start))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hourPx])

  const startItemDrag = (e: React.PointerEvent, it: Item, resize = false) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const col = (e.currentTarget as HTMLElement).closest<HTMLElement>('[data-day]')
    if (!col) return
    const canMove = it.kind === 'task' || (connected && !!life.google && writable(it.event!.calendarId))
    if (!canMove) return setEditing(it)
    drag.current = resize ? { kind: 'resize', item: it, x0: e.clientX, y0: e.clientY, moved: false } : { kind: 'move', item: it, offset: minuteAt(e.clientY, col) - it.start, len: it.end - it.start, x0: e.clientX, y0: e.clientY, moved: false }
  }
  const startCreate = (e: React.PointerEvent, day: string) => {
    if (e.button !== 0 || !connected || (e.target as HTMLElement).closest('.cal-item, .cal-draft')) return
    setEditing(null)
    drag.current = { kind: 'create', day, from: minuteAt(e.clientY, e.currentTarget as HTMLElement), x0: e.clientX, y0: e.clientY, moved: false }
  }

  // ---- Templates ----------------------------------------------------------
  const templateDay = view === 'day' ? anchor : today
  const applyTemplate = async (t: DayTemplate) => {
    const fit = blocksToApply(t, templateDay, visible)
    setMenu(null)
    if (!fit.length) return void act(async () => true, `Nothing fits: ${t.name}'s times are taken that day`)
    const ok = await act(async () => {
      for (const b of fit) await life.google!.create({ title: b.title, start: isoAt(templateDay, toMin(b.start)), end: isoAt(templateDay, toMin(b.end)), description: `From template "${t.name}" · Life System` })
      return true
    }, `${t.name}: ${fit.length} block${fit.length === 1 ? '' : 's'} added${fit.length < t.blocks.length ? ` (${t.blocks.length - fit.length} skipped, time taken)` : ''}`)
    if (ok) void load()
  }
  const saveTemplate = async (name: string) => {
    const t = templateFromDay(name, visible, templateDay)
    if (!t.blocks.length) return void act(async () => true, 'That day has no timed events to save')
    const next = await act(() => life.calTemplates!.save(t), `Saved "${t.name}" (${t.blocks.length} blocks)`)
    if (next) setTemplates(next)
  }

  if (status && !connected && !todo)
    return (
      <section className="card">
        <p className="hint">Connect Google Calendar in Settings to see your events here.</p>
        <button className="btn primary" onClick={() => onGo('settings')}>
          Open Settings
        </button>
      </section>
    )

  const step = view === 'day' ? 1 : view === '3day' ? 3 : view === 'week' ? 7 : 14
  const go = (dir: number) => {
    if (view === 'month') {
      const d = new Date(`${anchor.slice(0, 7)}-15T12:00:00`)
      d.setMonth(d.getMonth() + dir)
      setAnchor(ymd(d))
    } else setAnchor(addDays(anchor, dir * step))
  }
  const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', o)
  const title =
    view === 'month'
      ? fmt(`${anchor.slice(0, 7)}-15`, { month: 'long', year: 'numeric' })
      : view === 'day'
        ? fmt(anchor, { weekday: 'long', day: 'numeric', month: 'long' })
        : `${fmt(days[0], { day: 'numeric', month: 'short' })} – ${fmt(days[days.length - 1], { day: 'numeric', month: 'short', year: 'numeric' })}`
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const gridDays = view === 'day' || view === '3day' || view === 'week' ? days : []
  const closeMenus = (e: React.PointerEvent) => {
    if (menu && !(e.target as HTMLElement).closest('.cal-pop-wrap')) setMenu(null)
    if (moreOpen && !(e.target as HTMLElement).closest('.cal-more-pop, .cal-more')) setMoreOpen(null)
  }
  const cols = `52px repeat(${gridDays.length}, minmax(0, 1fr))`

  return (
    <div className="cal cal2" onPointerDownCapture={closeMenus}>
      <section className="card cal-bar">
        <div className="cal-nav">
          <button className="btn small ghost" onClick={() => go(-1)} aria-label="Back">
            ‹
          </button>
          <button className="btn small" onClick={() => setAnchor(today)}>
            Today
          </button>
          <button className="btn small ghost" onClick={() => go(1)} aria-label="Forward">
            ›
          </button>
          <h2 className="cal-title">{title}</h2>
        </div>
        <div className="cal-tools">
          {!connected && status && (
            <button className="btn small ghost" onClick={() => onGo('settings')}>
              <Icon name="calendar" size={13} /> Connect Google Calendar
            </button>
          )}
          <div className="ta-tabs" role="tablist" aria-label="View">
            {(
              [
                ['day', 'Day'],
                ['3day', '3 days'],
                ['week', 'Week'],
                ['month', 'Month'],
                ['agenda', 'Agenda']
              ] as const
            ).map(([v, l]) => (
              <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
                {l}
              </button>
            ))}
          </div>
          {gridDays.length > 0 && (
            <div className="cal-zoom" aria-label="Zoom">
              <button className="btn small ghost" onClick={() => setZoom(zoom - 1)} disabled={zoom === 0} title="Zoom out">
                −
              </button>
              <button className="btn small ghost" onClick={() => setZoom(zoom + 1)} disabled={zoom === ZOOMS.length - 1} title="Zoom in">
                +
              </button>
            </div>
          )}
          {connected && (
            <div className="cal-pop-wrap">
              <button className={`btn small ${menu === 'cals' ? 'on' : 'ghost'}`} onClick={() => setMenu(menu === 'cals' ? null : 'cals')}>
                Calendars
              </button>
              {menu === 'cals' && (
                <div className="cal-pop">
                  <p className="hint small">Show, dim (quieter) or hide each calendar on this device.</p>
                  {(status?.calendars ?? []).map((c) => {
                    const st = hidden.includes(c.id) ? 'hide' : dimmed.includes(c.id) ? 'dim' : 'show'
                    const set = (v: 'show' | 'dim' | 'hide') => {
                      const h = hidden.filter((x) => x !== c.id)
                      const d = dimmed.filter((x) => x !== c.id)
                      if (v === 'hide') h.push(c.id)
                      if (v === 'dim') d.push(c.id)
                      setHidden(h)
                      setDimmed(d)
                      store.set('ls.calHidden', h)
                      store.set('ls.calDim', d)
                    }
                    return (
                      <div key={c.id} className="cal-pop-row">
                        <i style={{ background: c.color }} />
                        <span>{c.name}</span>
                        <div className="seg">
                          {(['show', 'dim', 'hide'] as const).map((v) => (
                            <button key={v} type="button" className={st === v ? 'on' : ''} onClick={() => set(v)}>
                              {v === 'show' ? 'Show' : v === 'dim' ? 'Dim' : 'Hide'}
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
          {connected && life.calTemplates && (
            <div className="cal-pop-wrap">
              <button className={`btn small ${menu === 'templates' ? 'on' : 'ghost'}`} onClick={() => setMenu(menu === 'templates' ? null : 'templates')}>
                Templates
              </button>
              {menu === 'templates' && <TemplatesPop templates={templates} day={templateDay} onApply={applyTemplate} onSave={saveTemplate} onRemove={async (n) => setTemplates((await life.calTemplates!.remove(n)) ?? [])} />}
            </div>
          )}
        </div>
      </section>

      <div className="cal-body">
        <aside className="card cal-side">
          <h3>To schedule</h3>
          <p className="hint small">Drag a task onto a time: a 50-minute block in your calendar, and its time set in Todoist.</p>
          <ul className="cal-todo">
            {toSchedule.map((t) => (
              <li key={t.id} draggable onDragStart={(e) => e.dataTransfer.setData('text/task', t.id)} style={{ ['--c' as string]: areaColor(t) }} title={t.content}>
                <i />
                <span>{t.content}</span>
                {t.due && t.due < today && <em>late</em>}
              </li>
            ))}
            {!toSchedule.length && <li className="hint">Nothing waiting.</li>}
          </ul>
        </aside>

        <section className="card cal-main">
          {view === 'month' && (
            <MonthGrid
              days={days}
              month={anchor.slice(0, 7)}
              today={today}
              events={visible}
              items={items}
              onDay={(d) => {
                setAnchor(d)
                setView('day')
              }}
            />
          )}
          {view === 'agenda' && <Agenda days={days} today={today} items={items} allDay={visible.filter((e) => e.allDay)} onPick={setEditing} />}
          {gridDays.length > 0 && (
            <>
              {visible.some((e) => e.allDay && gridDays.some((d) => localDay(e.start) <= d && localDay(e.end) > d)) && (
                <div className="cal-allday" style={{ gridTemplateColumns: cols }}>
                  <span className="cal-hour-label">all day</span>
                  {gridDays.map((d) => (
                    <div key={d} className="cal-allday-cell">
                      {visible
                        .filter((e) => e.allDay && localDay(e.start) <= d && localDay(e.end) > d)
                        .map((e) => (
                          <span key={e.id} className="cal-chip" style={{ ['--c' as string]: e.color ?? '#7CC4FF' }}>
                            {e.title}
                          </span>
                        ))}
                    </div>
                  ))}
                </div>
              )}
              <div className="cal-head" style={{ gridTemplateColumns: cols }}>
                <span />
                {gridDays.map((d) => (
                  <button
                    key={d}
                    className={`cal-dayname ${d === today ? 'today' : ''}`}
                    onClick={() => {
                      setAnchor(d)
                      setView('day')
                    }}
                  >
                    <small>{fmt(d, { weekday: 'short' })}</small>
                    <b>{d.slice(8)}</b>
                  </button>
                ))}
              </div>
              <div className="cal-scroll" ref={gridRef}>
                <div className="cal-grid" style={{ gridTemplateColumns: cols, height: (END_H - START_H) * hourPx }}>
                  <div className="cal-hours">
                    {Array.from({ length: END_H - START_H }, (_, i) => (
                      <span key={i} style={{ top: i * hourPx }}>
                        {pad(START_H + i)}:00
                      </span>
                    ))}
                  </div>
                  {gridDays.map((d) => {
                    const lay = layoutDay(items.filter((x) => x.day === d && x.end > START_H * 60))
                    const bands = lay.placed.filter((p) => p.backdrop).map((p) => p.it)
                    const yOf = (m: number) => ((Math.max(m, START_H * 60) - START_H * 60) / 60) * hourPx
                    return (
                      <div
                        key={d}
                        data-day={d}
                        className={`cal-col ${d === today ? 'today' : ''}`}
                        onPointerDown={(e) => startCreate(e, d)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault()
                          const t = todo?.tasks.find((x) => x.id === e.dataTransfer.getData('text/task'))
                          if (t) void block(t, d, minuteAt(e.clientY, e.currentTarget))
                        }}
                      >
                        {Array.from({ length: END_H - START_H }, (_, i) => (
                          <i key={i} className="cal-line" style={{ top: i * hourPx }} />
                        ))}
                        {d === today && nowMin >= START_H * 60 && <i className="cal-now" style={{ top: ((nowMin - START_H * 60) / 60) * hourPx }} />}
                        {lay.placed.map(({ it, left, width, backdrop }) => {
                          const top = yOf(it.start)
                          const h = Math.max(18, ((Math.min(it.end, END_H * 60) - Math.max(it.start, START_H * 60)) / 60) * hourPx - 2)
                          const tiny = h < 34
                          // Events inside a long "window" sit a little in, so the window's name stays visible.
                          const inset = !backdrop && bands.some((b) => b.start < it.end && it.start < b.end) ? 12 : 0
                          const l = inset + (left * (100 - inset)) / 100
                          const w = (width * (100 - inset)) / 100
                          return (
                            <div
                              key={it.key}
                              role="button"
                              tabIndex={0}
                              className={`cal-item ${it.kind} ${tiny ? 'tiny' : ''} ${backdrop ? 'band' : ''} ${it.dim ? 'dim' : ''} ${ghost?.key === it.key ? 'dragging' : ''}`}
                              style={{ top, height: h, left: `calc(${l}% + 2px)`, width: `calc(${w}% - 4px)`, ['--c' as string]: it.color }}
                              onPointerDown={(e) => startItemDrag(e, it)}
                              onKeyDown={(e) => e.key === 'Enter' && setEditing(it)}
                              title={`${it.title} · ${hmOf(it.start)}–${hmOf(it.end)}`}
                            >
                              {tiny ? (
                                <b>
                                  {it.title} <small>{hmOf(it.start)}</small>
                                </b>
                              ) : (
                                <>
                                  <b>{it.title}</b>
                                  <small>
                                    {hmOf(it.start)}–{hmOf(it.end)}
                                    {it.kind === 'task' ? ' · Todoist' : ''}
                                  </small>
                                </>
                              )}
                              {it.kind === 'event' && connected && writable(it.event!.calendarId) && <span className="cal-resize" onPointerDown={(e) => startItemDrag(e, it, true)} title="Drag to resize" />}
                            </div>
                          )
                        })}
                        {lay.more.map((m) => (
                          <button
                            key={`more-${m.start}`}
                            className="cal-more"
                            style={{ top: yOf(m.start), left: `calc(${m.left}% + 2px)`, width: `calc(${m.width}% - 4px)` }}
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={() => setMoreOpen({ day: d, top: yOf(m.start), left: m.left, items: m.items })}
                            title={m.items.map((x) => x.title).join(', ')}
                          >
                            +{m.items.length} more
                          </button>
                        ))}
                        {moreOpen?.day === d && (
                          <div className="cal-more-pop" style={{ top: moreOpen.top + 26 }} onPointerDown={(e) => e.stopPropagation()}>
                            {moreOpen.items.map((x) => (
                              <button key={x.key} style={{ ['--c' as string]: x.color }} onClick={() => (setMoreOpen(null), setEditing(x))}>
                                <i />
                                <span>{x.title}</span>
                                <small>
                                  {hmOf(x.start)}–{hmOf(x.end)}
                                </small>
                              </button>
                            ))}
                          </div>
                        )}
                        {ghost?.day === d && (
                          <div className="cal-ghost" style={{ top: ((ghost.start - START_H * 60) / 60) * hourPx, height: Math.max(14, ((ghost.end - ghost.start) / 60) * hourPx - 2), ['--c' as string]: ghost.color }}>
                            <b>{ghost.title}</b>
                            <small>
                              {hmOf(ghost.start)}–{hmOf(ghost.end)}
                            </small>
                          </div>
                        )}
                        {draft?.day === d && <DraftForm top={((draft.start - START_H * 60) / 60) * hourPx} start={draft.start} end={draft.end} day={d} onCancel={() => setDraft(null)} onSave={(t, s, e, r) => createEvent(t, d, s, e, r)} />}
                      </div>
                    )
                  })}
                </div>
              </div>
              <p className="hint small cal-tip">Drag to move · pull the bottom edge to resize · drag on empty time to create · click to edit</p>
            </>
          )}
        </section>
      </div>

      {editing && (
        <EditSheet
          item={editing}
          connected={connected && (editing.kind === 'task' || writable(editing.event!.calendarId))}
          onClose={() => setEditing(null)}
          onChanged={() => {
            setEditing(null)
            void load()
          }}
        />
      )}
    </div>
  )
}

function MonthGrid({ days, month, today, events, items, onDay }: { days: string[]; month: string; today: string; events: CalEvent[]; items: Item[]; onDay: (d: string) => void }) {
  return (
    <div className="cal-month">
      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((w) => (
        <span key={w} className="cal-month-wd">
          {w}
        </span>
      ))}
      {days.map((d) => {
        const allDay = events.filter((e) => e.allDay && localDay(e.start) <= d && localDay(e.end) > d)
        const list = items.filter((x) => x.day === d).sort((a, b) => a.start - b.start)
        const shown = [...allDay.map((e) => ({ key: e.id, title: e.title, color: e.color ?? '#7CC4FF', time: '' })), ...list.map((x) => ({ key: x.key, title: x.title, color: x.color, time: hmOf(x.start) }))]
        return (
          <button key={d} className={`cal-month-cell ${d.slice(0, 7) !== month ? 'out' : ''} ${d === today ? 'today' : ''}`} onClick={() => onDay(d)}>
            <span className="cal-month-n">{Number(d.slice(8))}</span>
            {shown.slice(0, 3).map((x) => (
              <span key={x.key} className="cal-month-ev" style={{ ['--c' as string]: x.color }}>
                {x.time && <small>{x.time}</small>} {x.title}
              </span>
            ))}
            {shown.length > 3 && <span className="cal-month-more">+{shown.length - 3} more</span>}
          </button>
        )
      })}
    </div>
  )
}

function Agenda({ days, today, items, allDay, onPick }: { days: string[]; today: string; items: Item[]; allDay: CalEvent[]; onPick: (it: Item) => void }) {
  const groups = days.map((d) => ({ d, all: allDay.filter((e) => localDay(e.start) <= d && localDay(e.end) > d), list: items.filter((x) => x.day === d).sort((a, b) => a.start - b.start) })).filter((g) => g.all.length || g.list.length)
  if (!groups.length) return <p className="hint">Nothing in the next two weeks.</p>
  return (
    <div className="cal-agenda">
      {groups.map((g) => (
        <div key={g.d} className="cal-agenda-day">
          <h3 className={g.d === today ? 'today' : ''}>{new Date(`${g.d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
          <ul>
            {g.all.map((e) => (
              <li key={e.id} style={{ ['--c' as string]: e.color ?? '#7CC4FF' }}>
                <span className="cal-agenda-time">all day</span>
                <i />
                <span>{e.title}</span>
              </li>
            ))}
            {g.list.map((it) => (
              <li key={it.key} className={it.dim ? 'dim' : ''} style={{ ['--c' as string]: it.color }} onClick={() => onPick(it)}>
                <span className="cal-agenda-time">
                  {hmOf(it.start)}–{hmOf(it.end)}
                </span>
                <i />
                <span>
                  {it.title}
                  {it.kind === 'task' ? <small> · Todoist</small> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function DraftForm({ top, start, end, day, onSave, onCancel }: { top: number; start: number; end: number; day: string; onSave: (title: string, start: number, end: number, repeat: Repeat) => void; onCancel: () => void }) {
  const [title, setTitle] = useState('')
  const [len, setLen] = useState(end - start)
  const [repeat, setRepeat] = useState<Repeat>('none')
  const wd = new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long' })
  const stop = Math.min(24 * 60, start + len)
  return (
    <form
      className="cal-draft"
      style={{ top }}
      onPointerDown={(e) => e.stopPropagation()}
      onSubmit={(e) => {
        e.preventDefault()
        if (title.trim()) onSave(title.trim(), start, stop, repeat)
      }}
    >
      <small>
        {hmOf(start)}–{hmOf(stop)}
      </small>
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What? e.g. Study math" onKeyDown={(e) => e.key === 'Escape' && onCancel()} />
      <div className="row">
        {[25, 50, 90].map((m) => (
          <button type="button" key={m} className={`btn small ${len === m ? '' : 'ghost'}`} onClick={() => setLen(m)}>
            {m}m
          </button>
        ))}
      </div>
      <select value={repeat} onChange={(e) => setRepeat(e.target.value as Repeat)} aria-label="Repeat">
        <option value="none">Doesn't repeat</option>
        <option value="daily">Every day (4 weeks)</option>
        <option value="weekdays">Weekdays (8 weeks)</option>
        <option value="weekly">Every {wd} (12 weeks)</option>
      </select>
      <div className="row">
        <button className="btn small primary" disabled={!title.trim()}>
          Add
        </button>
        <button type="button" className="btn small ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function EditSheet({ item, connected, onClose, onChanged }: { item: Item; connected: boolean; onClose: () => void; onChanged: () => void }) {
  const act = useAction()
  const [title, setTitle] = useState(item.title)
  const [day, setDay] = useState(item.day)
  const [start, setStart] = useState(hmOf(item.start))
  const [end, setEnd] = useState(hmOf(Math.min(item.end, 23 * 60 + 59)))
  const [sure, setSure] = useState(false)
  const e = item.event
  useEffect(() => {
    const on = (ev: KeyboardEvent) => ev.key === 'Escape' && onClose()
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [onClose])
  const save = async () => {
    const s = toMin(start)
    const en = toMin(end)
    if (e) {
      if (en <= s) return void act(async () => true, 'The end must be after the start')
      const ok = await act(async () => {
        if (life.google?.update) await life.google.update(e.calendarId, e.id, { title: title.trim() || e.title, start: isoAt(day, s), end: isoAt(day, en) })
        else await life.google!.move(e.calendarId, e.id, isoAt(day, s), isoAt(day, en))
        return true
      }, 'Saved')
      if (ok) onChanged()
    } else if (item.task) {
      const ok = await act(() => life.todoist!.update!(item.task!.id, { content: title.trim() || item.task!.content, due: `${day} ${start}` }).then(() => true), 'Saved in Todoist')
      if (ok) onChanged()
    }
  }
  const focus = async () => {
    const nowM = new Date().getHours() * 60 + new Date().getMinutes()
    const left = Math.max(10, Math.min(180, toMin(end) - Math.max(toMin(start), nowM)))
    if (await act(() => life.focus.start(item.title.replace(/^[^\p{L}\p{N}]+/u, '').slice(0, 40), left, item.task ? { kind: 'todoist', ref: item.task.id, title: item.task.content } : null), `Focus started · ${left} min`)) onClose()
  }
  const canEdit = item.kind === 'task' || connected
  return (
    <div className="sheet" role="dialog" aria-label={item.title} onClick={(ev) => ev.target === ev.currentTarget && onClose()}>
      <div className="sheet-card cal-edit">
        <header className="card-head">
          <h2>
            <span className="cal-dot" style={{ background: item.color }} /> {item.kind === 'task' ? 'Todoist task' : 'Event'}
          </h2>
          <button className="btn small ghost" onClick={onClose}>
            Close
          </button>
        </header>
        <input value={title} onChange={(ev) => setTitle(ev.target.value)} disabled={!canEdit} aria-label="Title" />
        <div className="cal-edit-times">
          <input type="date" value={day} onChange={(ev) => setDay(ev.target.value)} disabled={!canEdit} aria-label="Day" />
          <input type="time" value={start} step={300} onChange={(ev) => setStart(ev.target.value)} disabled={!canEdit} aria-label="Start" />
          <span>–</span>
          <input type="time" value={end} step={300} onChange={(ev) => setEnd(ev.target.value)} disabled={!canEdit || item.kind === 'task'} aria-label="End" />
        </div>
        {e?.location && <p className="hint small">📍 {e.location}</p>}
        {e && !connected && <p className="hint small">This calendar is read-only (shared with you), so it can't be changed here.</p>}
        <div className="sheet-actions cal-edit-actions">
          <button className="btn small" onClick={() => void focus()}>
            ▶ Focus
          </button>
          {item.task && (
            <button
              className="btn small"
              onClick={async () => {
                if (await act(() => life.todoist!.complete(item.task!), 'Done in Todoist')) onChanged()
              }}
            >
              <Icon name="check" size={13} /> Done
            </button>
          )}
          {e && connected && (
            <button
              className={`btn small ghost ${sure ? 'danger' : ''}`}
              onClick={async () => {
                if (!sure) return setSure(true)
                if (await act(() => life.google!.remove(e.calendarId, e.id).then(() => true), 'Removed from your calendar')) onChanged()
              }}
            >
              <Icon name="trash" size={13} /> {sure ? 'Sure? Delete' : 'Delete'}
            </button>
          )}
          <span style={{ flex: 1 }} />
          {canEdit && (
            <button className="btn small primary" onClick={() => void save()}>
              Save
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function TemplatesPop({ templates, day, onApply, onSave, onRemove }: { templates: DayTemplate[]; day: string; onApply: (t: DayTemplate) => void; onSave: (name: string) => void; onRemove: (name: string) => void }) {
  const [name, setName] = useState('')
  const label = new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  return (
    <div className="cal-pop">
      <p className="hint small">Drop a saved day onto {label} (times already taken are skipped). Open another day in Day view to use it there.</p>
      {templates.length === 0 && <p className="hint small">No templates yet.</p>}
      {templates.map((t) => (
        <div key={t.name} className="cal-pop-row">
          <span>
            <b>{t.name}</b> <small className="hint">· {t.blocks.length} blocks</small>
          </span>
          <button className="btn small" onClick={() => onApply(t)}>
            Add to {label}
          </button>
          <button className="btn small ghost" onClick={() => onRemove(t.name)} aria-label={`Delete ${t.name}`}>
            <Icon name="trash" size={12} />
          </button>
        </div>
      ))}
      <form
        className="cal-pop-save"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) {
            onSave(name.trim())
            setName('')
          }
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`Save ${label} as… e.g. Study day`} maxLength={40} />
        <button className="btn small primary" disabled={!name.trim()}>
          Save
        </button>
      </form>
    </div>
  )
}
