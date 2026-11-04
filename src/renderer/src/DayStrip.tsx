// Today as one column on the right: your day from 06:00 to midnight running
// down, a "now" line, and every block where it really is.
// - Drag a block up or down to move it, pull its bottom edge to change its
//   length (15-minute steps): it moves at once, Google catches up, Undo.
// - ✓ on a block marks it done in one click; click it for Done / Skip /
//   ±15 min / Start focus.
// - Drop a task from the list onto the strip to book it there, or onto a
//   block to add it to that block's checklist.
// - Free time shows as "free 1h"; click to fill it with your top task.
// - Running late? Shift everything after now by 15 / 30 / 60 minutes.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { layoutDay } from '@core/calLayout'
import { addBlockTask, blockTasks } from '@core/blockTasks'
import { blockState, blockSubject, freeGaps, isFocusBlock, localDay, localHM, planKept, type BlockState, type CalEvent } from '@core/dayTime'
import type { TodoTask } from '@core/todoist'
import { life } from './bridge'
import { useLive } from './live'
import { useFocus } from './pages/Focus'
import { localToday, calendarToday, reloadToday, useTodayEvents } from './todayEvents'
import { soundSuccess } from './sound'
import { useAction, useToast } from './ui'

const START_H = 6
const END_H = 24
const MIN_PX = 34 // pixels per hour at least; more when the column is tall (the whole day fits)
const LANE_LEFT = 42 // right of the hour labels
const LANE_RIGHT = 6
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
  const [over, setOver] = useState<Record<string, { start: string; end: string }>>({})
  const [ghost, setGhost] = useState<{ key: string; start: number; end: number } | null>(null)
  const [menu, setMenuRaw] = useState<{ key: string; x: number; y: number } | null>(null)
  const setMenu = (k: string | null, el?: HTMLElement | null) => {
    if (!k || !el) return setMenuRaw(null)
    const r = el.getBoundingClientRect()
    // Beside the block (left of it: the column sits on the right), kept on screen.
    const x = r.left - 246 > 8 ? r.left - 246 : Math.min(window.innerWidth - 250, r.right + 6)
    setMenuRaw({ key: k, x, y: Math.max(8, Math.min(window.innerHeight - 160, r.top)) })
  }
  // Click anywhere else, scroll or Escape closes the menu.
  useEffect(() => {
    if (!menu) return
    const close = (ev: Event) => !(ev.target as HTMLElement).closest?.('.ds-menu, .ds-block') && setMenuRaw(null)
    const esc = (ev: KeyboardEvent) => ev.key === 'Escape' && setMenuRaw(null)
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', esc)
    window.addEventListener('scroll', () => setMenuRaw(null), { once: true, capture: true })
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [menu])
  const [dropAt, setDropAt] = useState<{ key: string | null; min: number } | null>(null)
  const drag = useRef<Drag | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  // Pixels per hour: 06–24 fills the column's height (scrolls only if very short).
  const [px, setPx] = useState(48)
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
  const menuRef = useRef<{ key: string } | null>(null)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  const loadMarks = () => void life.timeline?.marks(today).then(setMarks).catch(() => {})
  useEffect(loadMarks, [today])
  useLive(loadMarks, { external: true })
  // Open on now (an hour before it), not at 06:00.
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = Math.max(0, yOf(new Date().getHours() * 60 - 60))
  }, [])

  const nowMin = new Date(now).getHours() * 60 + new Date(now).getMinutes()
  const todayEvents = useMemo(() => events.filter((e) => !e.allDay && localDay(e.start) === today).map((e) => (over[e.id] ? { ...e, ...over[e.id] } : e)), [events, today, over])
  const grouped = useMemo(() => new Set(todayEvents.flatMap((e) => blockTasks(e.description).map((t) => t.id))), [todayEvents])
  const blocks: Block[] = useMemo(() => {
    const out: Block[] = todayEvents.map((e) => {
      const s = toMin(localHM(e.start))
      const en = localDay(e.end) > today ? 24 * 60 : toMin(localHM(e.end))
      return { key: `e:${e.id}`, title: e.title, start: s, end: Math.max(en, s + 15), color: e.color ?? '#7cc4ff', event: e }
    })
    for (const t of tasks) {
      if (t.due !== today || !t.dueTime || grouped.has(t.id) || todayEvents.some((e) => e.title.trim().toLowerCase() === t.content.trim().toLowerCase())) continue
      const s = toMin(t.dueTime)
      out.push({ key: `t:${t.id}`, title: t.content, start: s, end: s + Math.max(15, Math.min(240, t.duration ?? 30)), color: '#94a3b8', task: t })
    }
    return out.filter((b) => b.end > START_H * 60)
  }, [todayEvents, tasks, today, grouped])
  const lay = useMemo(() => layoutDay(blocks), [blocks])

  const sessions = focus?.todaySessions ?? []
  const stateOf = (b: Block): BlockState | null => {
    const id = b.event?.id ?? b.key
    const m = marks[id]
    if (m) return m === 'done' ? 'done' : 'skipped'
    if (b.event && isFocusBlock(b.event)) return blockState(b.event.start, b.event.end, sessions, now, focus?.running ?? null).state
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
    const later = blocks.filter((b) => b.event && b.start >= nowMin)
    if (!later.length) return toast('Nothing left to shift today', 'info')
    const before = later.map((b) => ({ b, start: b.start, end: b.end }))
    for (const b of later) {
      const e = b.event!
      const next = { start: iso(today, Math.min(24 * 60 - 15, b.start + minutes)), end: iso(today, Math.min(24 * 60, b.end + minutes)) }
      setOver((o) => ({ ...o, [e.id]: next }))
      void life.google!.move(e.calendarId, e.id, next.start, next.end).catch(() => null)
    }
    toast(`${later.length} block${later.length === 1 ? '' : 's'} pushed ${minutes} min later`, 'good', {
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
  menuRef.current = menu
  const startFocus = async (b: Block) => {
    const minutes = Math.max(10, Math.min(180, b.end - Math.max(b.start, nowMin)))
    if (await act(() => life.focus.start(blockSubject(b.title), minutes, b.task ? { kind: 'todoist', ref: b.task.id, title: b.task.content } : null), `Focus: ${b.title} · ${minutes} min`)) setMenu(null)
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
      if (!d.moved) return setMenu(menuRef.current?.key === d.b.key ? null : d.b.key, d.el)
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
            return (
              <div
                key={b.key}
                data-key={b.key}
                className={`ds-block ${backdrop ? 'band' : ''} ${b.task ? 'task' : ''} ${done ? 'done' : ''} ${st === 'skipped' ? 'skipped' : ''} ${st === 'now' ? 'now' : ''} ${g ? 'dragging' : ''} ${yOf(e) - yOf(s) < 38 ? 'short' : ''} ${dropAt?.key === b.key ? 'drop' : ''}`}
                style={{ top: yOf(s) + 1, height: Math.max(16, yOf(e) - yOf(s) - 2), left: lane(left), width: `calc((100% - ${LANE_LEFT + LANE_RIGHT}px) * ${w / 100} - 3px)`, ['--c' as string]: b.color }}
                onPointerDown={(ev) => startDrag(ev, b, 'move')}
                title={`${b.title} · ${hmOf(s)}–${hmOf(e)}${bt.length ? ` · ${bt.length} tasks` : ''}`}
              >
                <b>{b.title}</b>
                <small>
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
            <span key={`m${m.start}`} className="ds-more" style={{ top: yOf(m.start) + 1, left: lane(m.left) }} title={m.items.map((x) => x.title).join(', ')}>
              +{m.items.length}
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
          // On the page itself: a moved parent would carry a fixed menu off screen.
          return createPortal(
            <div className="ds-menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(ev) => ev.stopPropagation()}>
              <b className="ds-menu-title">{b.title}</b>
              <button onClick={() => void mark(b, st === 'done' ? null : 'done').then(() => setMenu(null))}>{st === 'done' ? 'Not done' : '✓ Done'}</button>
              <button onClick={() => void mark(b, st === 'skipped' ? null : 'skip').then(() => setMenu(null))}>{st === 'skipped' ? 'Not skipped' : 'Skip'}</button>
              <button onClick={() => (move(b, b.start + 15, b.end + 15), setMenu(null))}>+15 min</button>
              <button onClick={() => (move(b, Math.max(START_H * 60, b.start - 15), b.end - 15), setMenu(null))}>−15 min</button>
              <button onClick={() => (move(b, b.start, b.end + 15), setMenu(null))}>Longer</button>
              <button className="go" onClick={() => void startFocus(b)}>
                ▶ Start
              </button>
            </div>,
            document.body
          )
        })()}
      <p className="hint small ds-tip">Drag to move · pull the bottom edge to resize · ✓ to mark done · drop a task here to book it, or onto a block to add it</p>
    </section>
  )
}
