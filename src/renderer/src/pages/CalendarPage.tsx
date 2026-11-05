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
import { addBlockTask, blockTasks, removeBlockTask, setBlockTaskDone } from '@core/blockTasks'
import { blocksToApply, repeatRule, templateFromDay, type DayTemplate, type Repeat } from '@core/calTemplates'
import { defaultAreaColor, sortTasks, type Area, type TodoTask } from '@core/todoist'
import { life, type GoogleStatus } from '../bridge'
import { bookMinutes, bookTask } from '../booking'
import { Icon } from '../Icon'
import type { PageId } from '../modules'
import { useAction, useToast } from '../ui'
import { useLive } from '../live'
import { soundSuccess } from '../sound'

type View = 'day' | '3day' | 'ndays' | 'workweek' | 'week' | 'month' | 'agenda'
/** Hour height: 72 px by default (C1), any size from 32 to 160 (C2). */
const PX_MIN = 32
const PX_MAX = 160
const PX_DEFAULT = 72
/** Your calendar's look (F1–F3): day hours (or fit to your events), work hours, days shown, week start. */
interface CalPrefs { startH: number; endH: number; fit: boolean; workFrom: number; workTo: number; days: number; weekStart: 0 | 1 | 6; weekNumbers: boolean }
const CAL_PREFS: CalPrefs = { startH: 6, endH: 24, fit: true, workFrom: 8, workTo: 20, days: 3, weekStart: 1, weekNumbers: true }
/** ISO week number (Monday weeks), for the title and the month view. */
export const isoWeek = (day: string) => {
  const d = new Date(`${day}T12:00:00Z`)
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7))
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return Math.ceil(((t.getTime() - y0.getTime()) / 86400000 + 1) / 7)
}
const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00`)
  d.setDate(d.getDate() + n)
  return ymd(d)
}
/** The first day of `day`'s week (F3: Monday, Sunday or Saturday). */
const weekStartOf = (day: string, ws: number = 1) => {
  const d = new Date(`${day}T12:00:00`)
  return addDays(day, -((d.getDay() - ws + 7) % 7))
}
const monday = (day: string) => weekStartOf(day, 1)
const agoShort = (ms: number) => (ms < 10_000 ? 'just now' : ms < 60_000 ? `${Math.round(ms / 1000)} s ago` : `${Math.round(ms / 60_000)} min ago`)
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
  // On a phone a week is 7 slivers: it opens on 3 days unless you picked a view there (U7).
  const phone = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 760px)').matches
  const [view, setViewRaw] = useState<View>(() => store.get(phone ? 'ls.calViewPhone' : 'ls.calView', phone ? '3day' : 'week'))
  const setView = (v: View) => {
    setMenu(null)
    setViewRaw(v)
    store.set(phone ? 'ls.calViewPhone' : 'ls.calView', v)
  }
  // Bigger by default (72 px an hour, C1); any size by +/−, Ctrl+scroll or a pinch (C2). Remembered.
  const [hourPx, setHourPxRaw] = useState<number>(() => Math.max(PX_MIN, Math.min(PX_MAX, Number(store.get('ls.calHourPx', PX_DEFAULT)) || PX_DEFAULT)))
  const setHourPx = (v: number) => {
    const n = Math.round(Math.max(PX_MIN, Math.min(PX_MAX, v)))
    setHourPxRaw(n)
    store.set('ls.calHourPx', n)
  }
  const [prefs, setPrefsRaw] = useState<CalPrefs>(() => ({ ...CAL_PREFS, ...store.get<Partial<CalPrefs>>('ls.calPrefs', {}) }))
  const setPrefs = (p: Partial<CalPrefs>) => {
    const next = { ...prefs, ...p }
    setPrefsRaw(next)
    store.set('ls.calPrefs', next)
  }
  // The "To schedule" list folds to a thin strip (C3).
  const [sideOpen, setSideOpenRaw] = useState<boolean>(() => store.get('ls.calSideOpen', !phone))
  const setSideOpen = (v: boolean) => {
    setSideOpenRaw(v)
    store.set('ls.calSideOpen', v)
  }
  const [dropOn, setDropOn] = useState<string | null>(null)
  const [moreOpen, setMoreOpen] = useState<{ day: string; top: number; left: number; items: Item[] } | null>(null)
  const [hidden, setHidden] = useState<string[]>(() => store.get('ls.calHidden', []))
  const [dimmed, setDimmed] = useState<string[]>(() => store.get('ls.calDim', []))
  const [anchor, setAnchor] = useState(today)
  const [events, setEvents] = useState<CalEvent[]>([])
  const [status, setStatus] = useState<GoogleStatus | null>(null)
  const statusRef = useRef(status)
  statusRef.current = status
  const [sync, setSync] = useState<{ at: number; busy: boolean; error: string | null }>({ at: 0, busy: false, error: null })
  const syncRef = useRef(sync)
  syncRef.current = sync
  const [todo, setTodo] = useState<{ tasks: TodoTask[]; areas: Area[] } | null>(null)
  const [colors, setColors] = useState<Record<string, string>>({})
  const [draft, setDraft] = useState<{ day: string; start: number; end: number } | null>(null)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const [editing, setEditing] = useState<Item | null>(null)
  const editingRef = useRef(editing)
  editingRef.current = editing
  const [ghost, setGhost] = useState<{ day: string; start: number; end: number; title: string; color: string; key?: string } | null>(null)
  const [templates, setTemplates] = useState<DayTemplate[]>([])
  const [menu, setMenu] = useState<'cals' | 'templates' | 'view' | 'date' | null>(null)
  const [now, setNow] = useState(new Date())
  // Ticks every 5 s, only for the "Synced 10 s ago" chip.
  const [clock, setClock] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setClock(Date.now()), 5000)
    return () => clearInterval(t)
  }, [])
  const drag = useRef<Drag | null>(null)
  const itemsRef = useRef<Item[]>([])
  const pending = useRef(new Map<string, { start: string; end: string }>())
  const toast = useToast()
  const gridRef = useRef<HTMLDivElement>(null)
  const ghostRef = useRef(ghost)
  ghostRef.current = ghost
  const connected = !!status?.connected

  const days = useMemo(() => {
    if (view === 'day') return [anchor]
    if (view === '3day') return [anchor, addDays(anchor, 1), addDays(anchor, 2)]
    if (view === 'ndays') return Array.from({ length: Math.max(1, Math.min(7, prefs.days)) }, (_, i) => addDays(anchor, i))
    if (view === 'workweek') return Array.from({ length: 5 }, (_, i) => addDays(monday(anchor), i))
    if (view === 'week') return Array.from({ length: 7 }, (_, i) => addDays(weekStartOf(anchor, prefs.weekStart), i))
    if (view === 'agenda') return Array.from({ length: 14 }, (_, i) => addDays(anchor, i))
    const first = weekStartOf(`${anchor.slice(0, 7)}-01`, prefs.weekStart)
    return Array.from({ length: 42 }, (_, i) => addDays(first, i))
  }, [view, anchor, prefs.days, prefs.weekStart])
  // The day's hours (F1): yours, stretched to fit an earlier or later event when "fit" is on.
  const { startH, endH } = useMemo(() => {
    let a = Math.max(0, Math.min(23, prefs.startH))
    let b = Math.max(a + 1, Math.min(24, prefs.endH))
    if (prefs.fit) {
      for (const e of events) {
        if (e.allDay || !days.includes(localDay(e.start))) continue
        const s0 = new Date(e.start)
        const e0 = new Date(e.end)
        a = Math.min(a, s0.getHours())
        b = Math.max(b, localDay(e.end) > localDay(e.start) ? 24 : e0.getHours() + (e0.getMinutes() ? 1 : 0))
      }
    }
    return { startH: a, endH: b }
  }, [events, days, prefs.startH, prefs.endH, prefs.fit])

  const load = useCallback(async (quick = false) => {
    setSync((x) => ({ ...x, busy: true }))
    // The quick check (every 15 s) only reads events; the full one also the calendars list.
    const st = quick && statusRef.current?.connected ? statusRef.current : await life.google?.status().catch(() => null)
    if (!quick || !statusRef.current) setStatus(st ?? { configured: false, connected: false })
    if (st?.connected) {
      const from = new Date(`${days[0]}T00:00:00`).toISOString()
      const to = new Date(`${addDays(days[days.length - 1], 1)}T00:00:00`).toISOString()
      const fresh = await life.google!.events(from, to).catch((e: Error) => (setSync({ at: syncRef.current.at, busy: false, error: e.message }), null))
      if (fresh) {
        // Moves still on their way to Google keep their new time on screen.
        const next = fresh.map((x) => (pending.current.get(`${x.calendarId}:${x.id}`) ? { ...x, ...pending.current.get(`${x.calendarId}:${x.id}`)! } : x))
        // Only redraw when something really changed (no flicker every 15 s).
        setEvents((cur) => (JSON.stringify(cur) === JSON.stringify(next) ? cur : next))
        setSync({ at: Date.now(), busy: false, error: null })
      }
    } else setSync((x) => ({ ...x, busy: false }))
    if (quick) return
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
  // Changes made in Google Calendar (your phone, the website) show up within
  // 15 s while this page is open, and at once when you come back to it.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'visible' || drag.current || editingRef.current || draftRef.current) return
      void load(true)
    }
    const t = setInterval(tick, 15_000)
    const back = () => document.visibilityState === 'visible' && tick()
    window.addEventListener('focus', tick)
    document.addEventListener('visibilitychange', back)
    return () => {
      clearInterval(t)
      window.removeEventListener('focus', tick)
      document.removeEventListener('visibilitychange', back)
    }
  }, [load])
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])
  // Open on "now" (an hour before), not at 06:00.
  useEffect(() => {
    const el = gridRef.current
    if (!el) return
    el.scrollTop = Math.max(0, (new Date().getHours() - 1 - startH) * hourPx)
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
    // Tasks grouped into a block show inside it, not again on their own.
    const grouped = new Set(events.flatMap((e) => blockTasks(e.description).map((t) => t.id)))
    for (const t of todo?.tasks ?? []) {
      if (!t.due || !t.dueTime || blocked.has(`${t.due}|${t.content}`) || grouped.has(t.id)) continue
      const s = toMin(t.dueTime)
      out.push({ key: `t:${t.id}`, title: t.content, day: t.due, start: s, end: s + bookMinutes(t), color: areaColor(t), kind: 'task', task: t })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, events, todo, colors, dimmed, status])

  itemsRef.current = items
  const toSchedule = sortTasks((todo?.tasks ?? []).filter((t) => !t.dueTime && (!t.due || t.due <= addDays(today, 7))), today).slice(0, 30)

  // ---- Changes ----------------------------------------------------------
  // The one way to book a task (booking.ts): its own length, calendar block + Todoist time together.
  const block = async (task: TodoTask, day: string, start: number, minutes = bookMinutes(task)) => {
    const ok = await act(async () => {
      if (connected) await bookTask(task, day, hmOf(start), hmOf(Math.min(24 * 60 - 1, start + minutes)))
      else await life.todoist?.update?.(task.id, { due: `${day} ${hmOf(start)}`, duration: minutes } as any)
      return true
    }, `Planned: ${task.content} at ${hmOf(start)} · ${minutes} min`)
    if (ok) void load()
  }
  /**
   * Moves happen at once on screen; Google / Todoist are told in the
   * background. A refresh meanwhile keeps showing the new time, a failure
   * puts it back and says why, and every move can be undone.
   */
  const commitMove = (it: Item, day: string, start: number, end: number, undoable = true) => {
    const wd = day === it.day ? '' : `${new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short' })} `
    const said = `${it.title}: ${wd}${hmOf(start)}–${hmOf(end)}`
    const undo = undoable ? { label: 'Undo', run: () => commitMove({ ...it, day, start, end }, it.day, it.start, it.end, false) } : undefined
    if (it.kind === 'event' && it.event) {
      const e = it.event
      const s = isoAt(day, start)
      const en = isoAt(day, end)
      const key = `${e.calendarId}:${e.id}`
      pending.current.set(key, { start: s, end: en })
      setEvents((list) => list.map((x) => (x.id === e.id && x.calendarId === e.calendarId ? { ...x, start: s, end: en } : x)))
      toast(undoable ? said : `Moved back: ${it.title}`, 'good', undo)
      life.google!
        .move(e.calendarId, e.id, s, en)
        .catch((err: Error) => {
          setEvents((list) => list.map((x) => (x.id === e.id && x.calendarId === e.calendarId ? { ...x, start: e.start, end: e.end } : x)))
          toast(`Google didn't take that move (${err.message}). It's back where it was.`, 'bad')
        })
        .finally(() => pending.current.delete(key))
    } else if (it.task) {
      const id = it.task.id
      const before = { due: it.task.due, dueTime: it.task.dueTime }
      const minutes = end - start
      const resized = minutes !== it.end - it.start
      setTodo((t) => (t ? { ...t, tasks: t.tasks.map((x) => (x.id === id ? { ...x, due: day, dueTime: hmOf(start), ...(resized ? { duration: minutes } : {}) } : x)) } : t))
      toast(undoable ? said : `Moved back: ${it.title}`, 'good', undo)
      life.todoist!.update!(id, { due: `${day} ${hmOf(start)}`, ...(resized ? { duration: minutes } : {}) }).catch((err: Error) => {
        setTodo((t) => (t ? { ...t, tasks: t.tasks.map((x) => (x.id === id ? { ...x, ...before } : x)) } : t))
        toast(`Todoist didn't take that move (${err.message}). It's back where it was.`, 'bad')
      })
    }
  }
  /**
   * A task dropped onto a block joins it: a checklist line in the block's
   * Google notes, and the block's time on the task in Todoist.
   */
  const groupTask = (task: TodoTask, it: Item) => {
    const e = it.event
    if (!e) return
    const before = { notes: e.description ?? '', due: task.due, dueTime: task.dueTime }
    const notes = addBlockTask(e.description, { id: task.id, text: task.content })
    if (notes === (e.description ?? '')) return toast(`${task.content} is already in ${e.title}`, 'info')
    const setNotes = (d: string) => setEvents((list) => list.map((x) => (x.id === e.id && x.calendarId === e.calendarId ? { ...x, description: d } : x)))
    setNotes(notes)
    setTodo((t) => (t ? { ...t, tasks: t.tasks.map((x) => (x.id === task.id ? { ...x, due: it.day, dueTime: hmOf(it.start) } : x)) } : t))
    toast(`${task.content} → ${e.title}`, 'good', {
      label: 'Undo',
      run: () => {
        setNotes(before.notes)
        setTodo((t) => (t ? { ...t, tasks: t.tasks.map((x) => (x.id === task.id ? { ...x, due: before.due, dueTime: before.dueTime } : x)) } : t))
        void life.google!.update!(e.calendarId, e.id, { description: before.notes }).catch(() => null)
        void life.todoist!.update!(task.id, { due: before.due ? (before.dueTime ? `${before.due} ${before.dueTime}` : before.due) : 'no date' }).catch(() => null)
      }
    })
    Promise.all([life.google!.update!(e.calendarId, e.id, { description: notes }), life.todoist!.update!(task.id, { due: `${it.day} ${hmOf(it.start)}` })]).catch((err: Error) => {
      setNotes(before.notes)
      toast(`Couldn't add it to the block (${err.message})`, 'bad')
    })
  }
  const groupRef = useRef(groupTask)
  groupRef.current = groupTask

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
    return Math.min(endH * 60, Math.max(startH * 60, startH * 60 + Math.round((y / hourPx) * 4) * 15))
  }
  const colAt = (x: number, y: number) => (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-day]') ?? null
  const commitRef = useRef(commitMove)
  commitRef.current = commitMove
  // Touch (M1): a finger drag scrolls; hold ~0.35 s to pick up, move, resize or create.
  const pendingTouch = useRef<{ timer: ReturnType<typeof setTimeout>; d: Drag; x: number; y: number } | null>(null)
  const beginDrag = (d: Drag, e: React.PointerEvent) => {
    if (e.pointerType !== 'touch') {
      drag.current = d
      return
    }
    if (pendingTouch.current) clearTimeout(pendingTouch.current.timer)
    pendingTouch.current = {
      d,
      x: e.clientX,
      y: e.clientY,
      timer: setTimeout(() => {
        drag.current = d
        pendingTouch.current = null
        try {
          navigator.vibrate?.(12)
        } catch {
          /* no vibration */
        }
      }, 350)
    }
  }
  useEffect(() => {
    let frame = 0
    let last: PointerEvent | null = null
    const move = (ev: PointerEvent) => {
      const pt = pendingTouch.current
      // The finger moved before the hold: it's a scroll (or a swipe), not a drag.
      if (pt && Math.abs(ev.clientX - pt.x) + Math.abs(ev.clientY - pt.y) > 8) {
        clearTimeout(pt.timer)
        pendingTouch.current = null
      }
      last = ev
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        if (last) step(last)
      })
    }
    const put = (g: NonNullable<typeof ghostRef.current>) => {
      ghostRef.current = g
      setGhost(g)
    }
    const step = (e: PointerEvent) => {
      const d = drag.current
      if (!d) return
      if (!d.moved && Math.abs(e.clientX - d.x0) + Math.abs(e.clientY - d.y0) < 5) return
      d.moved = true
      const col = colAt(e.clientX, e.clientY)
      if (!col) return
      const day = col.dataset.day!
      const m = minuteAt(e.clientY, col)
      if (d.kind === 'move') {
        const start = Math.max(startH * 60, Math.min(endH * 60 - d.len, m - d.offset))
        put({ day, start, end: start + d.len, title: d.item.title, color: d.item.color, key: d.item.key })
      } else if (d.kind === 'resize') {
        put({ day: d.item.day, start: d.item.start, end: Math.max(d.item.start + 15, m), title: d.item.title, color: d.item.color, key: d.item.key })
      } else {
        put({ day: d.day, start: Math.min(d.from, m), end: Math.max(d.from + 15, m), title: 'New event', color: 'var(--accent)' })
      }
    }
    const up = (pe: PointerEvent) => {
      // A quick tap on touch (no hold): open it / start a new event there.
      const pt = pendingTouch.current
      if (pt) {
        clearTimeout(pt.timer)
        pendingTouch.current = null
        if (pt.d.kind === 'create') setDraft({ day: pt.d.day, start: pt.d.from, end: Math.min(24 * 60, pt.d.from + 50) })
        else setEditing(pt.d.item)
        return
      }
      const upAt = { x: pe.clientX, y: pe.clientY }
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      if (last && drag.current?.moved) step(last)
      last = null
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
      // A timed task dropped onto a block joins the block.
      const under = upAt && d.kind === 'move' && d.item.kind === 'task' ? (document.elementFromPoint(upAt.x, upAt.y) as HTMLElement | null)?.closest<HTMLElement>('.cal-item.event[data-key]') : null
      const target = under ? itemsRef.current.find((x) => x.key === under.dataset.key) : null
      if (target?.event && d.kind === 'move' && d.item.task) return void groupRef.current(d.item.task, target)
      if (d.kind === 'create') setDraft({ day: g.day, start: g.start, end: g.end })
      else if (g.day !== d.item.day || g.start !== d.item.start || g.end !== d.item.end) void commitRef.current(d.item, g.day, g.start, d.kind === 'resize' ? g.end : g.start + (d.item.end - d.item.start))
    }
    // The browser took the gesture (a scroll) or the touch was cancelled: drop the drag cleanly.
    const cancel = () => {
      if (pendingTouch.current) clearTimeout(pendingTouch.current.timer)
      pendingTouch.current = null
      drag.current = null
      last = null
      ghostRef.current = null
      setGhost(null)
    }
    // While dragging with a finger, the page must not scroll under it.
    const noScroll = (ev: TouchEvent) => {
      if (drag.current) ev.preventDefault()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('touchmove', noScroll, { passive: false })
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('touchmove', noScroll)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hourPx, startH, endH])

  const startItemDrag = (e: React.PointerEvent, it: Item, resize = false) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const col = (e.currentTarget as HTMLElement).closest<HTMLElement>('[data-day]')
    if (!col) return
    const canMove = it.kind === 'task' || (connected && !!life.google && writable(it.event!.calendarId))
    if (!canMove) return setEditing(it)
    beginDrag(resize ? { kind: 'resize', item: it, x0: e.clientX, y0: e.clientY, moved: false } : { kind: 'move', item: it, offset: minuteAt(e.clientY, col) - it.start, len: it.end - it.start, x0: e.clientX, y0: e.clientY, moved: false }, e)
  }
  const startCreate = (e: React.PointerEvent, day: string) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.cal-item, .cal-draft')) return
    // A task picked from "To schedule" (M4): this tap books it here.
    if (armed) {
      const t = armed
      setArmed(null)
      return void block(t, day, minuteAt(e.clientY, e.currentTarget as HTMLElement))
    }
    if (!connected) return
    setEditing(null)
    beginDrag({ kind: 'create', day, from: minuteAt(e.clientY, e.currentTarget as HTMLElement), x0: e.clientX, y0: e.clientY, moved: false }, e)
  }
  /** A new event at the next free half hour today (M5, and the N key). */
  const newAtNextSlot = () => {
    const d = new Date()
    const m = Math.ceil((d.getHours() * 60 + d.getMinutes() + 5) / 30) * 30
    const taken = items.filter((x) => x.day === today)
    let at = Math.min(m, 23 * 60)
    while (taken.some((x) => x.start < at + 30 && x.end > at) && at < 23 * 60) at += 30
    if (view === 'month' || view === 'agenda') setView('day')
    setAnchor(today)
    setDraft({ day: today, start: at, end: Math.min(24 * 60, at + 50) })
  }
  const [armed, setArmed] = useState<TodoTask | null>(null)

  // ---- Zoom by Ctrl+scroll / pinch (C2), swipe days (M2), keys (D2) --------
  const pxRef = useRef(hourPx)
  pxRef.current = hourPx
  const goRef = useRef<(dir: number) => void>(() => {})
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {})
  /** Zoom to `next` px an hour, keeping the hour under `y` (px from the scroll box top) in place. */
  const zoomAt = (next: number, y: number) => {
    const el = gridRef.current
    const px = pxRef.current
    const n = Math.max(PX_MIN, Math.min(PX_MAX, next))
    if (!el || n === px) return
    const hourAt = (el.scrollTop + y) / px
    setHourPx(n)
    requestAnimationFrame(() => {
      if (gridRef.current) gridRef.current.scrollTop = hourAt * n - y
    })
  }
  useEffect(() => {
    const el = gridRef.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      zoomAt(pxRef.current * (e.deltaY < 0 ? 1.08 : 1 / 1.08), e.clientY - el.getBoundingClientRect().top)
    }
    // Two fingers: pinch to zoom. One finger, quick and sideways: the next/previous days.
    let pinch: { d: number; px: number } | null = null
    let swipe: { x: number; y: number; t: number } | null = null
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    const tstart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        pinch = { d: dist(e.touches), px: pxRef.current }
        swipe = null
      } else if (e.touches.length === 1) swipe = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() }
    }
    const tmove = (e: TouchEvent) => {
      if (pinch && e.touches.length === 2) {
        e.preventDefault()
        const mid = (e.touches[0].clientY + e.touches[1].clientY) / 2 - el.getBoundingClientRect().top
        zoomAt(pinch.px * (dist(e.touches) / pinch.d), mid)
      }
    }
    const tend = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null
      const t = e.changedTouches[0]
      if (swipe && t && !drag.current && Date.now() - swipe.t < 600) {
        const dx = t.clientX - swipe.x
        const dy = t.clientY - swipe.y
        if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy)) goRef.current(dx < 0 ? 1 : -1)
      }
      swipe = null
    }
    el.addEventListener('wheel', wheel, { passive: false })
    el.addEventListener('touchstart', tstart, { passive: true })
    el.addEventListener('touchmove', tmove, { passive: false })
    el.addEventListener('touchend', tend)
    return () => {
      el.removeEventListener('wheel', wheel)
      el.removeEventListener('touchstart', tstart)
      el.removeEventListener('touchmove', tmove)
      el.removeEventListener('touchend', tend)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, status])
  useEffect(() => {
    const on = (e: KeyboardEvent) => keyRef.current(e)
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])

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

  const step = view === 'day' ? 1 : view === '3day' ? 3 : view === 'ndays' ? Math.max(1, prefs.days) : view === 'week' || view === 'workweek' ? 7 : 14
  const go = (dir: number) => {
    if (view === 'month') {
      const d = new Date(`${anchor.slice(0, 7)}-15T12:00:00`)
      d.setMonth(d.getMonth() + dir)
      setAnchor(ymd(d))
    } else setAnchor(addDays(anchor, dir * step))
  }
  goRef.current = go
  // Keys (D2): T today, ←/→, D/W/M/A views, +/− zoom, N new event, G go to date. Not while typing or in a sheet.
  keyRef.current = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null
    if (e.ctrlKey || e.metaKey || e.altKey || editing || draft || (t && (t.closest('input, textarea, select, [contenteditable="true"]') || t.isContentEditable))) return
    const k = e.key
    const hit = () => e.preventDefault()
    if (k === 't' || k === 'T') (hit(), setAnchor(today))
    else if (k === 'ArrowLeft') (hit(), go(-1))
    else if (k === 'ArrowRight') (hit(), go(1))
    else if (k === 'd' || k === 'D') (hit(), setView('day'))
    else if (k === 'w' || k === 'W') (hit(), setView('week'))
    else if (k === 'm' || k === 'M') (hit(), setView('month'))
    else if (k === 'a' || k === 'A') (hit(), setView('agenda'))
    else if (k === '+' || k === '=') (hit(), setHourPx(hourPx * 1.2))
    else if (k === '-' || k === '_') (hit(), setHourPx(hourPx / 1.2))
    else if (k === 'n' || k === 'N') (hit(), newAtNextSlot())
    else if (k === 'g' || k === 'G') (hit(), setMenu('date'))
  }
  const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', o)
  const title =
    view === 'month'
      ? fmt(`${anchor.slice(0, 7)}-15`, { month: 'long', year: 'numeric' })
      : view === 'day'
        ? fmt(anchor, { weekday: 'long', day: 'numeric', month: 'long' })
        : `${fmt(days[0], { day: 'numeric', month: 'short' })} – ${fmt(days[days.length - 1], { day: 'numeric', month: 'short', year: 'numeric' })}`
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const now2 = clock
  const gridDays = view === 'day' || view === '3day' || view === 'ndays' || view === 'workweek' || view === 'week' ? days : []
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
          <div className="cal-pop-wrap">
            <button className="cal-title" onClick={() => setMenu(menu === 'date' ? null : 'date')} title="Pick a date (G)" aria-haspopup="dialog">
              {title}
              {prefs.weekNumbers && view !== 'month' && view !== 'agenda' && <small className="cal-wk">W{isoWeek(days[0])}</small>}
              <span aria-hidden> ▾</span>
            </button>
            {menu === 'date' && <DatePop value={anchor} today={today} weekStart={prefs.weekStart} onPick={(d) => (setAnchor(d), setMenu(null))} />}
          </div>
          {connected && (
            <button className={`cal-sync ${sync.error ? 'bad' : sync.busy ? 'busy' : 'ok'}`} onClick={() => void load()} title={sync.error ? `Google: ${sync.error}. Click to try again.` : 'Checks Google Calendar every 15 seconds. Click to check now.'}>
              <i />
              {sync.error ? "Couldn't reach Google · Retry" : sync.busy && !sync.at ? 'Syncing…' : sync.at ? `Synced ${agoShort(now2 - sync.at)}` : 'Syncing…'}
            </button>
          )}
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
                ...(prefs.days !== 3 && prefs.days !== 1 && prefs.days !== 7 ? ([['ndays', `${prefs.days} days`]] as const) : []),
                ['workweek', 'Mon–Fri'],
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
              <button className="btn small ghost" onClick={() => setHourPx(hourPx / 1.2)} disabled={hourPx <= PX_MIN} title="Zoom out (−, or Ctrl+scroll)">
                −
              </button>
              <button className="btn small ghost cal-zoom-n" onClick={() => setHourPx(PX_DEFAULT)} title="Back to the normal size">
                {Math.round((hourPx / PX_DEFAULT) * 100)}%
              </button>
              <button className="btn small ghost" onClick={() => setHourPx(hourPx * 1.2)} disabled={hourPx >= PX_MAX} title="Zoom in (+, or Ctrl+scroll / pinch)">
                +
              </button>
            </div>
          )}
          <div className="cal-pop-wrap">
            <button className={`btn small ${menu === 'view' ? 'on' : 'ghost'}`} onClick={() => setMenu(menu === 'view' ? null : 'view')} title="Hours, days shown, week start">
              <Icon name="gear" size={13} /> View
            </button>
            {menu === 'view' && <ViewPop prefs={prefs} onChange={setPrefs} onView={setView} />}
          </div>
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
        {!sideOpen ? (
          <button className="card cal-side-rail" onClick={() => setSideOpen(true)} title="Show the tasks to schedule" aria-label="Show the tasks to schedule">
            <span>To schedule</span>
            <b>{toSchedule.length}</b>
          </button>
        ) : (
        <aside className="card cal-side">
          <div className="cal-side-head">
            <h3>To schedule</h3>
            <button className="btn small ghost" onClick={() => setSideOpen(false)} title="Fold away (more room for the calendar)" aria-label="Fold the list away">
              ‹
            </button>
          </div>
          <p className="hint small">{armed ? `Now tap a time for "${armed.content}" (tap it again to cancel).` : 'Drag a task onto a time (or tap it, then tap a time) for a block; onto a block to add it to its checklist. The time goes to Todoist too.'}</p>
          <ul className="cal-todo">
            {toSchedule.map((t) => (
              <li key={t.id} className={armed?.id === t.id ? 'armed' : ''} draggable onDragStart={(e) => e.dataTransfer.setData('text/task', t.id)} onClick={() => setArmed(armed?.id === t.id ? null : t)} style={{ ['--c' as string]: areaColor(t) }} title={t.content}>
                <i />
                <span>{t.content}</span>
                {t.due && t.due < today && <em>late</em>}
              </li>
            ))}
            {!toSchedule.length && <li className="hint">Nothing waiting.</li>}
          </ul>
        </aside>
        )}

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
                <div className="cal-grid" style={{ gridTemplateColumns: cols, height: (endH - startH) * hourPx, ['--hourPx' as string]: `${hourPx}px` }}>
                  <div className="cal-hours">
                    {Array.from({ length: endH - startH }, (_, i) => (
                      <span key={i} className={startH + i === now.getHours() && gridDays.includes(today) ? 'cur' : ''} style={{ top: i * hourPx }}>
                        {pad(startH + i)}:00
                      </span>
                    ))}
                    {gridDays.includes(today) && nowMin >= startH * 60 && nowMin < endH * 60 && (
                      <span className="cal-now-t" style={{ top: ((nowMin - startH * 60) / 60) * hourPx }}>
                        {hmOf(nowMin)}
                      </span>
                    )}
                  </div>
                  {gridDays.map((d) => {
                    const lay = layoutDay(items.filter((x) => x.day === d && x.end > startH * 60))
                    const bands = lay.placed.filter((p) => p.backdrop).map((p) => p.it)
                    const yOf = (m: number) => ((Math.max(m, startH * 60) - startH * 60) / 60) * hourPx
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
                        {/* Outside work hours: shaded (F1). */}
                        {prefs.workFrom > startH && <i className="cal-off" style={{ top: 0, height: (Math.min(prefs.workFrom, endH) - startH) * hourPx }} />}
                        {prefs.workTo < endH && <i className="cal-off" style={{ top: (Math.max(prefs.workTo, startH) - startH) * hourPx, height: (endH - Math.max(prefs.workTo, startH)) * hourPx }} />}
                        {Array.from({ length: endH - startH }, (_, i) => (
                          <i key={i} className="cal-line" style={{ top: i * hourPx }} />
                        ))}
                        {/* Half-hour lines when there's room (C5). */}
                        {hourPx >= 44 && Array.from({ length: endH - startH }, (_, i) => <i key={`h${i}`} className="cal-line cal-hl" style={{ top: i * hourPx + hourPx / 2 }} />)}
                        {d === today && nowMin >= startH * 60 && <i className="cal-now" style={{ top: ((nowMin - startH * 60) / 60) * hourPx }} />}
                        {lay.placed.map(({ it, left, width, backdrop }) => {
                          const top = yOf(it.start)
                          const h = Math.max(22, ((Math.min(it.end, endH * 60) - Math.max(it.start, startH * 60)) / 60) * hourPx - 2)
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
                              data-key={it.key}
                              className={`cal-item ${it.kind} ${tiny ? 'tiny' : ''} ${backdrop ? 'band' : ''} ${it.dim ? 'dim' : ''} ${ghost?.key === it.key ? 'dragging' : ''} ${dropOn === it.key ? 'drop' : ''}`}
                              onDragOver={(ev) => {
                                if (it.kind !== 'event' || !connected || !writable(it.event!.calendarId)) return
                                ev.preventDefault()
                                ev.stopPropagation()
                                if (dropOn !== it.key) setDropOn(it.key)
                              }}
                              onDragLeave={() => dropOn === it.key && setDropOn(null)}
                              onDrop={(ev) => {
                                if (it.kind !== 'event' || !connected || !writable(it.event!.calendarId)) return
                                ev.preventDefault()
                                ev.stopPropagation()
                                setDropOn(null)
                                const t = todo?.tasks.find((x) => x.id === ev.dataTransfer.getData('text/task'))
                                if (t) groupTask(t, it)
                              }}
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
                              {(() => {
                                const bt = it.event ? blockTasks(it.event.description) : []
                                return bt.length > 0 && !tiny ? (
                                  <span className="cal-tasks" title={bt.map((t) => `${t.done ? '✓' : '○'} ${t.text}`).join('\n')}>
                                    ✓ {bt.filter((t) => t.done).length}/{bt.length} tasks
                                  </span>
                                ) : null
                              })()}
                              {((it.kind === 'event' && connected && writable(it.event!.calendarId)) || it.kind === 'task') && <span className="cal-resize" onPointerDown={(e) => startItemDrag(e, it, true)} title="Drag to resize" />}
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
                          <div className="cal-ghost" style={{ top: ((ghost.start - startH * 60) / 60) * hourPx, height: Math.max(14, ((ghost.end - ghost.start) / 60) * hourPx - 2), ['--c' as string]: ghost.color }}>
                            <b>{ghost.title}</b>
                            <small>
                              {hmOf(ghost.start)}–{hmOf(ghost.end)}
                            </small>
                          </div>
                        )}
                        {draft?.day === d && <DraftForm top={((draft.start - startH * 60) / 60) * hourPx} start={draft.start} end={draft.end} day={d} onCancel={() => setDraft(null)} onSave={(t, s, e, r) => createEvent(t, d, s, e, r)} />}
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

      {connected && (
        <button className="cal-fab" onClick={newAtNextSlot} aria-label="New event at the next free half hour" title="New event (N)">
          +
        </button>
      )}
      {editing && (
        <EditSheet
          item={editing}
          calendars={(status?.calendars ?? []) as any}
          tasks={todo?.tasks ?? []}
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

/** Google's event colors, as Google shows them (id → name, color). */
const EVENT_COLORS: [string, string, string][] = [
  ['', 'Calendar color', ''],
  ['7', 'Peacock', '#039be5'],
  ['9', 'Blueberry', '#3f51b5'],
  ['1', 'Lavender', '#7986cb'],
  ['3', 'Grape', '#8e24aa'],
  ['4', 'Flamingo', '#e67c73'],
  ['11', 'Tomato', '#d50000'],
  ['6', 'Tangerine', '#f4511e'],
  ['5', 'Banana', '#f6bf26'],
  ['2', 'Sage', '#33b679'],
  ['10', 'Basil', '#0b8043'],
  ['8', 'Graphite', '#616161']
]

function EditSheet({ item, connected, calendars, tasks, onClose, onChanged }: { item: Item; connected: boolean; calendars: { id: string; name: string; color?: string; canWrite?: boolean }[]; tasks: TodoTask[]; onClose: () => void; onChanged: () => void }) {
  const act = useAction()
  const e = item.event
  const [title, setTitle] = useState(item.title)
  const [day, setDay] = useState(item.day)
  const [start, setStart] = useState(hmOf(item.start))
  const [end, setEnd] = useState(hmOf(Math.min(item.end, 23 * 60 + 59)))
  const [notes, setNotes] = useState(e?.description ?? '')
  const [colorId, setColorId] = useState(e?.colorId ?? '')
  const [cal, setCal] = useState(e?.calendarId ?? '')
  const [repeat, setRepeat] = useState<Repeat>('none')
  const series = !!e?.recurringEventId
  const [scope, setScope] = useState<'one' | 'all'>('one')
  const [sure, setSure] = useState<null | 'one' | 'all'>(null)
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
      const timesChanged = day !== item.day || s !== item.start || en !== Math.min(item.end, 23 * 60 + 59)
      const ok = await act(async () => {
        await life.google!.update!(e.calendarId, e.id, {
          title: title.trim() || e.title,
          ...(timesChanged ? { start: isoAt(day, s), end: isoAt(day, en) } : {}),
          description: notes,
          colorId: colorId || null,
          ...(cal && cal !== e.calendarId ? { moveTo: cal } : {}),
          ...(series ? { scope, recurringEventId: e.recurringEventId } : repeat !== 'none' ? { recurrence: repeatRule(repeat, day) } : {})
        })
        return true
      }, series && scope === 'all' ? 'Saved for every repeat' : 'Saved')
      if (ok) onChanged()
    } else if (item.task) {
      const ok = await act(() => life.todoist!.update!(item.task!.id, { content: title.trim() || item.task!.content, due: `${day} ${start}`, ...(en > s ? { duration: en - s } : {}) }).then(() => true), 'Saved in Todoist')
      if (ok) onChanged()
    }
  }
  const remove = async (which: 'one' | 'all') => {
    if (!e) return
    if (sure !== which) return setSure(which)
    const id = which === 'all' && e.recurringEventId ? e.recurringEventId : e.id
    if (await act(() => life.google!.remove(e.calendarId, id).then(() => true), which === 'all' ? 'Every repeat removed' : 'Removed from your calendar')) onChanged()
  }
  const focus = async () => {
    const nowM = new Date().getHours() * 60 + new Date().getMinutes()
    const left = Math.max(10, Math.min(180, toMin(end) - Math.max(toMin(start), nowM)))
    if (await act(() => life.focus.start(item.title.replace(/^[^\p{L}\p{N}]+/u, '').slice(0, 40), left, item.task ? { kind: 'todoist', ref: item.task.id, title: item.task.content } : null), `Focus started · ${left} min`)) onClose()
  }
  const canEdit = item.kind === 'task' || connected
  const writableCals = calendars.filter((c) => c.canWrite !== false)
  const shown = colorId ? EVENT_COLORS.find((c) => c[0] === colorId)?.[2] : item.color
  return (
    <div className="sheet" role="dialog" aria-label={item.title} onClick={(ev) => ev.target === ev.currentTarget && onClose()}>
      <div className="sheet-card cal-edit ce">
        <header className="ce-head" style={{ ['--c' as string]: shown ?? item.color }}>
          <i className="ce-bar" />
          <input className="ce-title" value={title} onChange={(ev) => setTitle(ev.target.value)} disabled={!canEdit} aria-label="Title" placeholder="Title" />
          <button className="btn small ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="ce-row">
          <Icon name="clock" size={15} />
          <input type="date" value={day} onChange={(ev) => setDay(ev.target.value)} disabled={!canEdit} aria-label="Day" />
          <input type="time" value={start} step={300} onChange={(ev) => setStart(ev.target.value)} disabled={!canEdit} aria-label="Start" />
          <span>–</span>
          <input type="time" value={end} step={300} onChange={(ev) => setEnd(ev.target.value)} disabled={!canEdit} aria-label="End" />
          <small className="ce-len">{toMin(end) > toMin(start) ? `${toMin(end) - toMin(start)} min` : ''}</small>
        </div>
        {e && (
          <>
            {series ? (
              <div className="ce-row">
                <Icon name="refresh" size={15} />
                <span className="ce-label">Repeating event · change</span>
                <div className="sx-seg" role="radiogroup" aria-label="Which repeats">
                  <button type="button" className={scope === 'one' ? 'on' : ''} onClick={() => setScope('one')}>
                    Only this one
                  </button>
                  <button type="button" className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>
                    All repeats
                  </button>
                </div>
              </div>
            ) : (
              <div className="ce-row">
                <Icon name="refresh" size={15} />
                <span className="ce-label">Repeat</span>
                <select value={repeat} onChange={(ev) => setRepeat(ev.target.value as Repeat)} disabled={!canEdit} aria-label="Repeat">
                  <option value="none">Doesn't repeat</option>
                  <option value="daily">Every day</option>
                  <option value="weekdays">Every weekday</option>
                  <option value="weekly">Every week</option>
                </select>
              </div>
            )}
            <div className="ce-row ce-colors" role="radiogroup" aria-label="Color">
              <span className="ce-label">Color</span>
              {EVENT_COLORS.map(([id, name, hex]) => (
                <button key={id || 'cal'} type="button" title={name} aria-label={name} aria-checked={colorId === id} role="radio" className={`ce-swatch ${colorId === id ? 'on' : ''} ${id ? '' : 'cal'}`} style={{ ['--s' as string]: hex || item.color }} onClick={() => setColorId(id)} disabled={!canEdit} />
              ))}
            </div>
            {writableCals.length > 1 && (
              <div className="ce-row">
                <Icon name="calendar" size={15} />
                <span className="ce-label">Calendar</span>
                <select value={cal} onChange={(ev) => setCal(ev.target.value)} disabled={!canEdit} aria-label="Calendar">
                  {writableCals.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {blockTasks(notes).length > 0 && (
              <div className="ce-tasks">
                <span className="ce-label">Tasks in this block</span>
                {blockTasks(notes).map((t) => (
                  <div key={t.id} className={`ce-task ${t.done ? 'done' : ''}`}>
                    <button
                      className="dl-check"
                      aria-label={t.done ? `${t.text} is done` : `Done: ${t.text}`}
                      disabled={!canEdit || t.done}
                      onClick={async () => {
                        const next = setBlockTaskDone(notes, t.id, true)
                        setNotes(next)
                        const full = tasks.find((x) => x.id === t.id) ?? ({ id: t.id, content: t.text, priority: 1, due: null, dueTime: null, project: null, recurring: false } as TodoTask)
                        await act(async () => {
                          await life.todoist!.complete(full)
                          await life.google!.update!(e.calendarId, e.id, { description: next })
                          return true
                        }, `Done: ${t.text}`)
                      }}
                    >
                      {t.done ? '✓' : ''}
                    </button>
                    <span>{t.text}</span>
                    {!t.done && canEdit && (
                      <button
                        className="nc-x"
                        title="Take it out of this block"
                        aria-label={`Take ${t.text} out of this block`}
                        onClick={async () => {
                          const next = removeBlockTask(notes, t.id)
                          setNotes(next)
                          await act(async () => {
                            await life.google!.update!(e.calendarId, e.id, { description: next })
                            await life.todoist!.update!(t.id, { due: item.day })
                            return true
                          }, `${t.text}: back to your list`)
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            <textarea className="ce-notes" value={notes} onChange={(ev) => setNotes(ev.target.value)} disabled={!canEdit} placeholder="Notes" rows={3} aria-label="Notes" />
            {e.location && <p className="hint small">📍 {e.location}</p>}
            {!connected && <p className="hint small">This calendar is read-only (shared with you), so it can't be changed here.</p>}
          </>
        )}
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
            <button className={`btn small ghost ${sure === 'one' ? 'danger' : ''}`} onClick={() => void remove('one')}>
              <Icon name="trash" size={13} /> {sure === 'one' ? 'Sure? Delete' : series ? 'Delete this one' : 'Delete'}
            </button>
          )}
          {e && connected && series && (
            <button className={`btn small ghost ${sure === 'all' ? 'danger' : ''}`} onClick={() => void remove('all')}>
              {sure === 'all' ? 'Sure? Delete all' : 'Delete all repeats'}
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

/** View settings (F1–F3): the day's hours (or fit to events), work hours, how many days, week start. */
function ViewPop({ prefs, onChange, onView }: { prefs: CalPrefs; onChange: (p: Partial<CalPrefs>) => void; onView: (v: View) => void }) {
  const hours = Array.from({ length: 25 }, (_, i) => i)
  const sel = (v: number, set: (n: number) => void, from: number, to: number, label: string) => (
    <select value={v} onChange={(e) => set(Number(e.target.value))} aria-label={label}>
      {hours.filter((h) => h >= from && h <= to).map((h) => (
        <option key={h} value={h}>
          {pad(h % 24)}:00{h === 24 ? ' (midnight)' : ''}
        </option>
      ))}
    </select>
  )
  return (
    <div className="cal-pop cal-viewpop">
      <div className="cal-pop-row">
        <span>Day shows</span>
        {sel(prefs.startH, (n) => onChange({ startH: n }), 0, 22, 'Day starts')}
        <span>to</span>
        {sel(prefs.endH, (n) => onChange({ endH: n }), prefs.startH + 1, 24, 'Day ends')}
      </div>
      <label className="cal-pop-row cal-check">
        <input type="checkbox" checked={prefs.fit} onChange={(e) => onChange({ fit: e.target.checked })} />
        <span>Stretch to fit earlier or later events</span>
      </label>
      <div className="cal-pop-row">
        <span>Work hours</span>
        {sel(prefs.workFrom, (n) => onChange({ workFrom: n }), 0, 23, 'Work from')}
        <span>to</span>
        {sel(prefs.workTo, (n) => onChange({ workTo: n }), prefs.workFrom + 1, 24, 'Work until')}
      </div>
      <p className="hint small">Hours outside work hours are shaded.</p>
      <div className="cal-pop-row">
        <span>Days view</span>
        <div className="seg">
          {[1, 2, 3, 4, 5, 6, 7].map((n) => (
            <button
              key={n}
              type="button"
              className={prefs.days === n ? 'on' : ''}
              onClick={() => {
                onChange({ days: n })
                onView(n === 1 ? 'day' : n === 3 ? '3day' : n === 7 ? 'week' : 'ndays')
              }}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
      <div className="cal-pop-row">
        <span>Week starts</span>
        <div className="seg">
          {([[1, 'Mon'], [0, 'Sun'], [6, 'Sat']] as const).map(([v, l]) => (
            <button key={v} type="button" className={prefs.weekStart === v ? 'on' : ''} onClick={() => onChange({ weekStart: v })}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <label className="cal-pop-row cal-check">
        <input type="checkbox" checked={prefs.weekNumbers} onChange={(e) => onChange({ weekNumbers: e.target.checked })} />
        <span>Week numbers</span>
      </label>
      <p className="hint small">Keys: T today · ← → back/forward · D W M A views · + − zoom · N new · G go to date</p>
    </div>
  )
}

/** A small month to pick a day from (D1), and a box to type one. */
function DatePop({ value, today, weekStart, onPick }: { value: string; today: string; weekStart: number; onPick: (d: string) => void }) {
  const [month, setMonth] = useState(value.slice(0, 7))
  const [typed, setTyped] = useState(value)
  const first = weekStartOf(`${month}-01`, weekStart)
  const cells = Array.from({ length: 42 }, (_, i) => addDays(first, i))
  const shift = (n: number) => {
    const d = new Date(`${month}-15T12:00:00`)
    d.setMonth(d.getMonth() + n)
    setMonth(ymd(d).slice(0, 7))
  }
  const names = Array.from({ length: 7 }, (_, i) => new Date(`${addDays(first, i)}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'narrow' }))
  return (
    <div className="cal-pop cal-datepop" role="dialog" aria-label="Pick a date">
      <div className="cal-dp-head">
        <button type="button" className="btn small ghost" onClick={() => shift(-1)} aria-label="Previous month">‹</button>
        <b>{new Date(`${month}-15T12:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</b>
        <button type="button" className="btn small ghost" onClick={() => shift(1)} aria-label="Next month">›</button>
      </div>
      <div className="cal-dp-grid">
        {names.map((n, i) => (
          <small key={i}>{n}</small>
        ))}
        {cells.map((d) => (
          <button key={d} type="button" className={`${d.slice(0, 7) !== month ? 'out' : ''} ${d === today ? 'today' : ''} ${d === value ? 'on' : ''}`} onClick={() => onPick(d)}>
            {Number(d.slice(8))}
          </button>
        ))}
      </div>
      <form
        className="cal-dp-go"
        onSubmit={(e) => {
          e.preventDefault()
          if (/^\d{4}-\d{2}-\d{2}$/.test(typed)) onPick(typed)
        }}
      >
        <input id="cal-go" type="date" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Go to date" />
        <button className="btn small primary">Go</button>
        <button type="button" className="btn small" onClick={() => onPick(today)}>Today</button>
      </form>
    </div>
  )
}
