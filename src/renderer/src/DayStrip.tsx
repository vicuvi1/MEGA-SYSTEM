// Today as one column on the right: your day from 06:00 to midnight running
// down, a "now" line, and every block where it really is.
// - Drag a block up or down to move it, pull its bottom edge to change its
//   length (15-minute steps): it moves at once, Google catches up, Undo.
// - ✓ on a block marks it done in one click; click it (or Enter) for its
//   details: edit, done, skip, start the timer, move, delete (EventSheet).
// - Events at the same time sit side by side (core/calLayout.ts); a short
//   one is drawn at least 24 px tall and gets its own column if it needs it.
// - Drop a task from the list onto the strip to book it there, or onto a
//   block to add it to that block's checklist.
// - Free time shows as "free 1h"; click to fill it with your top task.
// - Running late? Shift everything after now by 15 / 30 / 60 minutes.
import { useEffect, useMemo, useRef, useState } from 'react'
import { layoutDay, minLenFor } from '@core/calLayout'
import { EventSheet, type SheetCalendar } from './EventSheet'
import { dedupeColumn } from '@core/dayColumn'
import { addBlockTask, blockTasks } from '@core/blockTasks'
import { blockState, freeGaps, localDay, localHM, planKept, type BlockState, type CalEvent } from '@core/dayTime'
import type { TodoTask } from '@core/todoist'
import { bookMinutes } from '@core/booking'
import { blockKindOf, type BlockKinds } from '@core/blockKind'
import { life } from './bridge'
import { useLive } from './live'
import { useFocus } from './pages/Focus'
import { localToday, calendarToday, reloadToday, useTodayEvents } from './todayEvents'
import { isDeclined, isInvite, isMarker, isTentative } from '@core/calResponse'
import { soundSuccess } from './soundKit'
import { useAction, useToast } from './ui'
import { travelFor } from '@core/eventAlerts'

const START_H = 6
const END_H = 24
const MIN_PX = 34 // pixels per hour at least; more when the column is tall (the whole day fits)
const LANE_LEFT = 42 // right of the hour labels
const LANE_RIGHT = 6
/** The shortest a block is drawn (px), so its title can be read. */
const MIN_BLOCK_PX = 24
const pad = (n: number) => String(n).padStart(2, '0')
const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))
const hmOf = (m: number) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`
/** A left/width share (0–100) of the lanes, as CSS. */
const lane = (pct: number) => `calc(${LANE_LEFT}px + (100% - ${LANE_LEFT + LANE_RIGHT}px) * ${pct / 100})`
const iso = (day: string, m: number) => (m >= 24 * 60 ? new Date(`${day}T23:59:00`).toISOString() : new Date(`${day}T${hmOf(m)}:00`).toISOString())

interface Block {
  key: string
  title: string
  start: number
  end: number
  color: string
  event?: CalEvent
  task?: TodoTask
}

type Drag = { kind: 'move' | 'resize'; b: Block; y0: number; moved: boolean; offset: number; el: HTMLElement | null }

export function DayStrip({ tasks, onBook }: { tasks: TodoTask[]; onBook: (task: TodoTask, startMin: number) => void }) {
  const act = useAction()
  const toast = useToast()
  const today = calendarToday()
  const { events, connected } = useTodayEvents()
  const [marks, setMarks] = useState<Record<string, 'done' | 'skip'>>({})
  const [focus] = useFocus()
  const [now, setNow] = useState(Date.now())
  // Changes shown at once while Google catches up (null: deleted).
  const [over, setOver] = useState<Record<string, Partial<CalEvent> | null>>({})
  const [ghost, setGhost] = useState<{ key: string; start: number; end: number } | null>(null)
  // The open details sheet (click or Enter on a block).
  const [menu, setMenuRaw] = useState<{ key: string } | null>(null)
  const setMenu = (k: string | null) => setMenuRaw(k ? { key: k } : null)
  const [moreAt, setMoreAt] = useState<number | null>(null)
  const [cals, setCals] = useState<SheetCalendar[]>([])
  useEffect(() => {
    if (menu && !cals.length) void life.google?.status().then((s) => setCals((s.calendars ?? []) as SheetCalendar[])).catch(() => {})
  }, [menu, cals.length])
  const [dropAt, setDropAt] = useState<{ key: string | null; min: number } | null>(null)
  const drag = useRef<Drag | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  // Pixels per hour: 06–24 fills the column's height (scrolls only if very short).
  const [px, setPx] = useState(48)
  // Travel times (E6): a shaded band before events at your places.
  const [travel, setTravel] = useState<{ place: string; minutes: number }[]>([])
  useEffect(() => {
    life.notifications?.settings?.().then((x) => setTravel(x.travel)).catch(() => {})
  }, [])
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const fit = () => setPx(Math.max(MIN_PX, Math.floor((el.clientHeight - 8) / (END_H - START_H))))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const yOf = (m: number) => ((m - START_H * 60) / 60) * px
  const ghostRef = useRef(ghost)
  ghostRef.current = ghost

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  // Event or focus block, your choice per title (the island reads the same setting).
  const [kinds, setKinds] = useState<BlockKinds>({})
  const loadMarks = () => {
    void life.timeline?.marks(today).then(setMarks).catch(() => {})
    void life.timeline?.kinds?.().then(setKinds).catch(() => {})
  }
  const isFocus = (e: CalEvent) => !e.allDay && blockKindOf({ title: e.title, ours: e.ours }, kinds) === 'focus'
  useEffect(loadMarks, [today])
  useLive(loadMarks, { external: true })
  // Open on now (an hour before it), not at 06:00.
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = Math.max(0, yOf(new Date().getHours() * 60 - 60))
  }, [])

  const nowMin = new Date(now).getHours() * 60 + new Date(now).getMinutes()
  const todayEvents = useMemo(
    () =>
      events
        .filter((e) => over[e.id] !== null)
        .map((e) => (over[e.id] ? { ...e, ...over[e.id] } : e))
        .filter((e) => !e.allDay && localDay(e.start) === today),
    [events, today, over]
  )
  const grouped = useMemo(() => new Set(todayEvents.flatMap((e) => blockTasks(e.description).map((t) => t.id))), [todayEvents])
  const blocks: Block[] = useMemo(() => {
    const out: Block[] = todayEvents.map((e) => {
      const s = toMin(localHM(e.start))
      const en = localDay(e.end) > today ? 24 * 60 : toMin(localHM(e.end))
      return { key: `e:${e.id}`, title: e.title, start: s, end: Math.max(en, s + 15), color: e.color ?? '#7cc4ff', event: e }
    })
    for (const t of tasks) {
      if (t.due !== today || !t.dueTime || grouped.has(t.id)) continue
      const s = toMin(t.dueTime)
      out.push({ key: `t:${t.id}`, title: t.content, start: s, end: s + bookMinutes(t), color: '#94a3b8', task: t })
    }
    // One thing = one entry (an old calendar event next to its moved task, or a copy).
    const one = dedupeColumn(
      out.map((b) => ({ ...b, kind: (b.event ? 'event' : 'task') as 'event' | 'task', ours: b.event?.ours, holds: b.event ? blockTasks(b.event.description).map((t) => t.id) : undefined, taskId: b.task?.id }))
    )
    return one.filter((b) => b.end > START_H * 60)
  }, [todayEvents, tasks, today, grouped])
  // Side by side when they overlap on screen: a short block counts as tall as it's drawn.
  const minLen = minLenFor(MIN_BLOCK_PX, px)
  const lay = useMemo(() => layoutDay(blocks, { minLen }), [blocks, minLen])

  const sessions = focus?.todaySessions ?? []
  const stateOf = (b: Block): BlockState | null => {
    const id = b.event?.id ?? b.key
    const m = marks[id]
    if (m) return m === 'done' ? 'done' : 'skipped'
    if (b.event && isFocus(b.event)) return blockState(b.event.start, b.event.end, sessions, now, focus?.running ?? null).state
    return b.end <= nowMin ? null : b.start <= nowMin ? 'now' : 'upcoming'
  }
  const kept = planKept(todayEvents.map((e) => stateOf({ key: `e:${e.id}`, title: e.title, start: 0, end: 0, color: '', event: e })).filter((s): s is BlockState => !!s))
  const gaps = connected ? freeGaps(todayEvents, today, { after: hmOf(Math.max(START_H * 60, Math.ceil(nowMin / 15) * 15)), minMinutes: 30 }) : []

  // ---- Changes: at once on screen, Google / Todoist in the background ----
  const move = (b: Block, start: number, end: number, undoable = true) => {
    const said = `${b.title}: ${hmOf(start)}–${hmOf(end)}`
    const undo = undoable ? { label: 'Undo', run: () => move({ ...b, start, end }, b.start, b.end, false) } : undefined
    if (b.event) {
      const e = b.event
      const next = { start: iso(today, start), end: iso(today, end) }
      setOver((o) => ({ ...o, [e.id]: next }))
      toast(undoable ? said : `Moved back: ${b.title}`, 'good', undo)
      life.google!
        .move(e.calendarId, e.id, next.start, next.end)
        .then(() => reloadToday())
        .catch((err: Error) => {
          setOver((o) => ({ ...o, [e.id]: { start: e.start, end: e.end } }))
          toast(`Google didn't take that move (${err.message}). It's back.`, 'bad')
        })
    } else if (b.task) {
      toast(undoable ? said : `Moved back: ${b.title}`, 'good', undo)
      void life.todoist!.update!(b.task.id, { due: `${today} ${hmOf(start)}`, duration: end - start }).then(() => window.dispatchEvent(new CustomEvent('life-external-changed')))
    }
  }
  const mark = async (b: Block, v: 'done' | 'skip' | null) => {
    const id = b.event?.id ?? b.key
    setMarks((m) => {
      const n = { ...m }
      if (v) n[id] = v
      else delete n[id]
      return n
    })
    if (v === 'done') soundSuccess()
    await life.timeline?.mark(today, id, v).catch(() => null)
  }
  const shiftRest = (minutes: number) => {
    // Only your own blocks move (focus, study, must-dos you planned); lectures,
    // meetings and other people's events stay where they are (F2).
    const later = blocks.filter((b) => b.event && b.start >= nowMin && isFocus(b.event))
    const fixed = blocks.filter((b) => b.event && b.start >= nowMin && !isFocus(b.event)).length
    if (!later.length) return toast(fixed ? 'Only meetings and classes left: those stay put' : 'Nothing left to shift today', 'info')
    const before = later.map((b) => ({ b, start: b.start, end: b.end }))
    for (const b of later) {
      const e = b.event!
      const next = { start: iso(today, Math.min(24 * 60 - 15, b.start + minutes)), end: iso(today, Math.min(24 * 60, b.end + minutes)) }
      setOver((o) => ({ ...o, [e.id]: next }))
      void life.google!.move(e.calendarId, e.id, next.start, next.end).catch(() => null)
    }
    toast(`${later.length} block${later.length === 1 ? '' : 's'} pushed ${minutes} min later${fixed ? ` (${fixed} meeting${fixed === 1 ? '' : 's'} kept)` : ''}`, 'good', {
      label: 'Undo',
      run: () => {
        for (const x of before) {
          const e = x.b.event!
          const back = { start: iso(today, x.start), end: iso(today, x.end) }
          setOver((o) => ({ ...o, [e.id]: back }))
          void life.google!.move(e.calendarId, e.id, back.start, back.end).catch(() => null)
        }
      }
    })
    setTimeout(() => void reloadToday(), 2500)
  }
  const group = (task: TodoTask, b: Block) => {
    const e = b.event!
    const notes = addBlockTask(e.description, { id: task.id, text: task.content })
    void act(async () => {
      await life.google!.update!(e.calendarId, e.id, { description: notes })
      await life.todoist!.update!(task.id, { due: `${today} ${hmOf(b.start)}` })
      return true
    }, `${task.content} → ${e.title}`).then(() => {
      void reloadToday()
      window.dispatchEvent(new CustomEvent('life-external-changed'))
    })
  }

  // ---- Pointer drag (up and down) ----------------------------------------
  const minuteAt = (clientY: number) => {
    const el = scroller.current
    if (!el) return 0
    const y = clientY - el.getBoundingClientRect().top + el.scrollTop
    return Math.max(START_H * 60, Math.min(END_H * 60, START_H * 60 + Math.round(((y / px) * 60) / 15) * 15))
  }
  useEffect(() => {
    const onMove = (ev: PointerEvent) => {
      const d = drag.current
      if (!d) return
      if (!d.moved && Math.abs(ev.clientY - d.y0) < 5) return
      d.moved = true
      const m = minuteAt(ev.clientY)
      const g = d.kind === 'move' ? { key: d.b.key, start: Math.max(START_H * 60, Math.min(END_H * 60 - (d.b.end - d.b.start), m - d.offset)), end: 0 } : { key: d.b.key, start: d.b.start, end: Math.max(d.b.start + 15, m) }
      if (d.kind === 'move') g.end = g.start + (d.b.end - d.b.start)
      ghostRef.current = g
      setGhost(g)
    }
    const onUp = () => {
      const d = drag.current
      drag.current = null
      const g = ghostRef.current
      setGhost(null)
      ghostRef.current = null
      if (!d) return
      // A click (moved less than 5 px), not a drag: open its details.
      if (!d.moved) return setMenu(d.b.key)
      if (g && (g.start !== d.b.start || g.end !== d.b.end)) move(d.b, g.start, g.end)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks])
  const startDrag = (ev: React.PointerEvent, b: Block, kind: 'move' | 'resize') => {
    if (ev.button !== 0 || (ev.target as HTMLElement).closest('.ds-tick, .ds-menu')) return
    ev.stopPropagation()
    drag.current = { kind, b, y0: ev.clientY, moved: false, offset: minuteAt(ev.clientY) - b.start, el: (ev.currentTarget as HTMLElement).closest('.ds-block') }
  }

  // ---- Tasks dropped from the list ----------------------------------------
  const taskFrom = (ev: React.DragEvent): TodoTask | null => {
    try {
      const j = JSON.parse(ev.dataTransfer.getData('text/x-task') || 'null')
      const id = j?.id ?? ev.dataTransfer.getData('text/task')
      return tasks.find((t) => t.id === id) ?? (j ? ({ id: j.id, content: j.title, priority: 1, due: null, dueTime: null, project: null, recurring: false, duration: j.minutes } as TodoTask) : null)
    } catch {
      return null
    }
  }

  const height = (END_H - START_H) * px
  const nowY = yOf(nowMin)
  return (
    <section className="ds ds-v" aria-label="Your day">
      <header className="ds-head">
        <b>Your day</b>
        {kept.pct != null && <span className={`ds-kept ${kept.pct >= 70 ? 'good' : ''}`}>Plan kept {kept.pct}% · {kept.done}/{kept.total}</span>}
        <span className="ds-space" />
        {connected && nowMin < 23 * 60 && (
          <span className="ds-shift" title="Running late? Push everything after now later">
            Late?
            {[15, 30, 60].map((m) => (
              <button key={m} onClick={() => shiftRest(m)}>
                +{m}
              </button>
            ))}
          </span>
        )}
      </header>
      {!connected && <p className="hint small">Connect Google Calendar in Settings to see and move your blocks here.</p>}
      {(() => {
        // All-day events and birthdays (E1), as chips above the timeline.
        const allDay = events.filter((e) => e.allDay && !isDeclined(e) && !isMarker(e) && e.start.slice(0, 10) <= today && (e.end.slice(0, 10) > today || e.end.slice(0, 10) === e.start.slice(0, 10)))
        return allDay.length ? (
          <div className="ds-allday" aria-label="All day">
            {allDay.map((e) => (
              <a key={e.id} className="ds-chip" href={e.htmlLink ?? undefined} target="_blank" rel="noopener noreferrer" style={{ ['--c' as string]: e.color ?? '#7cc4ff' }} title={e.title}>
                {/birthday|ziua|день рожд/i.test(e.title) ? '🎂 ' : ''}
                {e.title}
              </a>
            ))}
          </div>
        ) : null
      })()}
      <div className="ds-scroll" ref={scroller} style={{ ['--px' as string]: `${px}px` }}>
        <div
          className={`ds-track ${dropAt ? 'dropping' : ''}`}
          style={{ height }}
          onDragOver={(ev) => {
            if (!connected) return
            ev.preventDefault()
            const key = (ev.target as HTMLElement).closest<HTMLElement>('.ds-block[data-key]')?.dataset.key ?? null
            const m = minuteAt(ev.clientY)
            if (dropAt?.key !== key || dropAt?.min !== m) setDropAt({ key, min: m })
          }}
          onDragLeave={(ev) => !(ev.currentTarget as HTMLElement).contains(ev.relatedTarget as Node) && setDropAt(null)}
          onDrop={(ev) => {
            ev.preventDefault()
            const t = taskFrom(ev)
            const target = dropAt?.key ? blocks.find((b) => b.key === dropAt.key && b.event) : null
            // Where the drop line was while dragging (some drops report no position).
            const at = dropAt?.min ?? (ev.clientY ? minuteAt(ev.clientY) : null)
            setDropAt(null)
            if (!t || at == null) return
            if (target) group(t, target)
            else onBook(t, at)
          }}
        >
          {Array.from({ length: END_H - START_H }, (_, i) => (
            <span key={i} className="ds-hour" style={{ top: i * px }}>
              {pad(START_H + i)}
            </span>
          ))}
          {todayEvents.map((e) => {
            const t = travelFor(e.location, travel)
            if (!t) return null
            const s0 = toMin(localHM(e.start))
            return (
              <div key={`tr-${e.id}`} className="ds-travel" style={{ top: yOf(Math.max(START_H * 60, s0 - t)), height: Math.max(10, yOf(s0) - yOf(Math.max(START_H * 60, s0 - t)) - 1) }} title={`Travel ${t} min to ${e.location}`}>
                <span>🚶 {t}m</span>
              </div>
            )
          })}
          {gaps.map((g) => (
            <button key={g.start} className="ds-gap" style={{ top: yOf(toMin(g.start)) + 2, height: Math.max(22, yOf(toMin(g.end)) - yOf(toMin(g.start)) - 4) }} onClick={() => onBook(tasks.find((t) => !t.dueTime) ?? tasks[0], toMin(g.start))} title="Fill this with your top task" disabled={!tasks.length}>
              free {g.minutes >= 60 ? `${Math.floor(g.minutes / 60)}h${g.minutes % 60 ? ` ${g.minutes % 60}m` : ''}` : `${g.minutes}m`}
            </button>
          ))}
          {lay.placed.map(({ it: b, left, width: w, backdrop }) => {
            const st = stateOf(b)
            const done = st === 'done'
            const g = ghost?.key === b.key ? ghost : null
            const s = g ? g.start : b.start
            const e = g ? g.end : b.end
            const bt = b.event ? blockTasks(b.event.description) : []
            const h = Math.max(MIN_BLOCK_PX - 2, yOf(e) - yOf(s) - 2)
            return (
              <div
                key={b.key}
                data-key={b.key}
                id={b.event ? `event-${b.event.id}` : undefined}
                role="button"
                tabIndex={0}
                aria-label={`${b.title}, ${hmOf(s)} to ${hmOf(e)}. Enter for details`}
                className={`ds-block ${backdrop ? 'band' : ''} ${b.task ? 'task' : ''} ${b.event && isInvite(b.event) ? 'invite' : ''} ${b.event && isTentative(b.event) ? 'maybe' : ''} ${done ? 'done' : ''} ${st === 'skipped' ? 'skipped' : ''} ${st === 'now' ? 'now' : ''} ${g ? 'dragging' : ''} ${h < 38 ? 'short' : ''} ${w < 40 ? 'narrow' : ''} ${dropAt?.key === b.key ? 'drop' : ''}`}
                style={{ top: yOf(s) + 1, height: h, left: lane(left), width: `calc((100% - ${LANE_LEFT + LANE_RIGHT}px) * ${w / 100} - 3px)`, ['--c' as string]: b.color }}
                onPointerDown={(ev) => startDrag(ev, b, 'move')}
                onKeyDown={(ev) => {
                  if (ev.target !== ev.currentTarget) return
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault()
                    setMenu(b.key)
                  }
                }}
                title={`${b.title} · ${hmOf(s)}–${hmOf(e)}${bt.length ? ` · ${bt.length} tasks` : ''}`}
              >
                <b>{b.title}</b>
                <small>
                  {b.event && isInvite(b.event) ? 'Invite: accept? · ' : b.event && isTentative(b.event) ? 'Maybe · ' : ''}
                  {hmOf(s)}
                  {bt.length ? ` · ✓${bt.filter((t) => t.done).length}/${bt.length}` : ''}
                </small>
                {!backdrop && (b.start <= nowMin || done) && (
                  <button className={`ds-tick ${done ? 'on' : ''}`} aria-label={done ? `Undo done: ${b.title}` : `Done: ${b.title}`} onClick={() => void mark(b, done ? null : 'done')}>
                    ✓
                  </button>
                )}
                <span className="ds-resize" onPointerDown={(ev) => startDrag(ev, b, 'resize')} />
              </div>
            )
          })}
          {lay.more.map((m) => (
            <span key={`m${m.start}`} className="ds-more-wrap" style={{ top: yOf(m.start) + 1, left: lane(m.left) }}>
              <button type="button" className="ds-more" onPointerDown={(ev) => ev.stopPropagation()} onClick={() => setMoreAt(moreAt === m.start ? null : m.start)} title={m.items.map((x) => x.title).join(', ')} aria-expanded={moreAt === m.start}>
                +{m.items.length}
              </button>
              {moreAt === m.start && (
                <span className="ds-more-list" role="menu" onPointerDown={(ev) => ev.stopPropagation()}>
                  {m.items.map((x) => (
                    <button key={x.key} type="button" role="menuitem" style={{ ['--c' as string]: x.color }} onClick={() => (setMoreAt(null), setMenu(x.key))}>
                      <i />
                      {x.title} <small>{hmOf(x.start)}</small>
                    </button>
                  ))}
                </span>
              )}
            </span>
          ))}
          {dropAt && !dropAt.key && <i className="ds-drop" style={{ top: yOf(dropAt.min) }} />}
          {nowMin >= START_H * 60 && <i className="ds-now" style={{ top: nowY }} />}
        </div>
      </div>
      {menu &&
        (() => {
          const b = blocks.find((x) => x.key === menu.key)
          if (!b) return null
          const st = stateOf(b)
          const writable = !b.event || cals.find((c) => c.id === b.event!.calendarId)?.canWrite !== false
          return (
            <EventSheet
              key={b.key}
              item={{ key: b.key, title: b.title, day: today, start: b.start, end: b.end, color: b.color, kind: b.event ? 'event' : 'task', event: b.event, task: b.task }}
              canEdit={!!connected && writable}
              calendars={cals}
              tasks={tasks}
              done={st === 'done'}
              onMark={(v) => mark(b, v)}
              onClose={() => (setMenu(null), loadMarks())}
              onChanged={() => {
                void reloadToday()
                if (b.task) window.dispatchEvent(new CustomEvent('life-external-changed'))
              }}
              onPatch={(before, after) => setOver((o) => ({ ...o, [before.id]: after ? { ...after } : null }))}
              extra={
                <button className="btn small ghost" onClick={() => void mark(b, st === 'skipped' ? null : 'skip').then(() => setMenu(null))}>
                  {st === 'skipped' ? 'Not skipped' : 'Skip'}
                </button>
              }
            />
          )
        })()}
      <p className="hint small ds-tip">Click for details and edit · drag to move · pull the bottom edge to resize · ✓ to mark done · drop a task here to book it, or onto a block to add it</p>
    </section>
  )
}
