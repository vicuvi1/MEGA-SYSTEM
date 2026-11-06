// One place to see and change a calendar item, shared by Today's "Your day"
// and the Calendar page (day, week, month, agenda).
// - Click an item: its details (when, calendar, place, call link, people,
//   repeats, notes, event or focus block) and Edit, Done, Start timer (focus
//   blocks), Move to…, Delete.
// - Edit in place: title, day, start and end, quick lengths, color, place,
//   notes, event or focus block. It shows at once, Google catches up, Undo.
// - Repeating events ask "Only this one / All repeats".
// - Keys: Esc closes, Delete asks to delete. On a phone it's a bottom sheet.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { localDay, localHM, type CalEvent } from '@core/dayTime'
import { blockTasks, removeBlockTask, setBlockTaskDone } from '@core/blockTasks'
import { customRule, repeatRule, type CustomRepeat, type Repeat } from '@core/calTemplates'
import { parseWhen, type When } from '@core/whenParse'
import { blockKindOf, type BlockKind, type BlockKinds } from '@core/blockKind'
import type { TodoTask } from '@core/todoist'
import { addLocalDays, dayDiff, hmOf, isoAt, lenLabel, toMin } from '@core/calMath'
import { life } from './bridge'
import { Icon } from './Icon'
import { Select } from './Select'
import { useAction, useToast } from './ui'
import { soundSuccess } from './soundKit'
import './eventSheet.css'

const addDays = addLocalDays
/** Quick lengths in the editor. */
const SHEET_LENGTHS = [15, 30, 45, 60, 90]
/** Reminder choices (D6), in minutes before. "default" = the calendar's own. */
export const REMINDERS: [string, string][] = [
  ['default', 'Calendar default'],
  ['0', 'No reminder'],
  ['5', '5 min before'],
  ['10', '10 min before'],
  ['30', '30 min before'],
  ['60', '1 hour before'],
  ['1440', '1 day before']
]
export const WD2 = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
export type RepeatChoice = Repeat | 'custom'
export const CUSTOM0: CustomRepeat = { freq: 'weekly', interval: 1, days: [], until: null, count: 12 }

/** A calendar item as both pages hand it over. */
export interface SheetItem {
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
export type SheetCalendar = { id: string; name: string; color?: string; canWrite?: boolean }

/** A box to type the time in (D4): "fri 18:00", "tomorrow 9-10:30", "in 2h", "every mon 8:00". */
export function WhenBox({ onWhen }: { onWhen: (w: When) => void }) {
  const [txt, setTxt] = useState('')
  const w = txt.trim() ? parseWhen(txt) : null
  const apply = () => {
    if (!w) return
    onWhen(w)
    setTxt('')
  }
  const said = w
    ? `${w.every ? `every ${w.every.map((d) => WD2[d]).join(', ')}, from ` : ''}${new Date(`${w.day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} ${hmOf(w.start)}${w.end != null ? `–${hmOf(w.end)}` : ''}`
    : ''
  return (
    <div className="ce-whenbox">
      <input
        value={txt}
        onChange={(e) => setTxt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          e.preventDefault()
          e.stopPropagation()
          apply()
        }}
        placeholder="Or type it: fri 18:00, tomorrow 9-10:30, in 2h"
        aria-label="Type the time"
      />
      {txt.trim() && (
        <small className={w ? 'ok' : 'bad'}>
          {w ? `→ ${said}` : "Can't read that time yet"}
          {w && (
            <button type="button" className="btn small" onClick={apply}>
              Use
            </button>
          )}
        </small>
      )}
    </div>
  )
}

/** Repeat every N days/weeks, on chosen weekdays, until a date or N times (D5). */
export function CustomRepeatFields({ value, day, onChange }: { value: CustomRepeat; day: string; onChange: (v: CustomRepeat) => void }) {
  return (
    <div className="ce-custom">
      <div className="ce-row">
        <span className="ce-label">Every</span>
        <input type="number" min={1} max={30} value={value.interval} onChange={(e) => onChange({ ...value, interval: Math.max(1, Math.min(30, Number(e.target.value) || 1)) })} aria-label="Every how many" style={{ width: 64 }} />
        <Select value={value.freq} onChange={(e) => onChange({ ...value, freq: e.target.value as CustomRepeat['freq'] })} aria-label="Days or weeks">
          <option value="daily">{value.interval > 1 ? 'days' : 'day'}</option>
          <option value="weekly">{value.interval > 1 ? 'weeks' : 'week'}</option>
        </Select>
      </div>
      {value.freq === 'weekly' && (
        <div className="ce-row ce-wd" role="group" aria-label="On these days">
          <span className="ce-label">On</span>
          {[1, 2, 3, 4, 5, 6, 0].map((d) => {
            const on = value.days.length ? value.days.includes(d) : new Date(`${day}T12:00:00`).getDay() === d
            return (
              <button
                key={d}
                type="button"
                className={on ? 'on' : ''}
                aria-pressed={on}
                onClick={() => {
                  const cur = value.days.length ? value.days : [new Date(`${day}T12:00:00`).getDay()]
                  const next = on ? cur.filter((x) => x !== d) : [...cur, d]
                  onChange({ ...value, days: next.length ? next : cur })
                }}
              >
                {WD2[d]}
              </button>
            )
          })}
        </div>
      )}
      <div className="ce-row">
        <span className="ce-label">Ends</span>
        <Select value={value.until ? 'until' : 'count'} onChange={(e) => onChange(e.target.value === 'until' ? { ...value, until: addDays(day, 56) } : { ...value, until: null })} aria-label="How it ends">
          <option value="count">After</option>
          <option value="until">On a date</option>
        </Select>
        {value.until ? (
          <input type="date" value={value.until} min={day} onChange={(e) => e.target.value && onChange({ ...value, until: e.target.value })} aria-label="Last day" />
        ) : (
          <>
            <input type="number" min={1} max={52} value={value.count ?? 12} onChange={(e) => onChange({ ...value, count: Math.max(1, Math.min(52, Number(e.target.value) || 1)) })} aria-label="How many times" style={{ width: 64 }} />
            <span>times</span>
          </>
        )}
      </div>
    </div>
  )
}

/** Google's event colors, as Google shows them (id → name, color). */
export const EVENT_COLORS: [string, string, string][] = [
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

const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v)
const sameTime = (a: string, b: string) => (isDate(a) || isDate(b) ? a === b : new Date(a).getTime() === new Date(b).getTime())
/** Notes without the block's checklist lines (those show as their own list). */
const plainNotes = (d: string | null | undefined) =>
  (d ?? '')
    .split('\n')
    .filter((l) => !/^\s*[☐☑]\s.*todoist:/.test(l) && l.trim() !== 'Tasks:')
    .join('\n')
    .trim()

export function EventSheet({
  item,
  canEdit: canWrite,
  calendars,
  tasks,
  startInEdit = false,
  done: doneProp,
  onClose,
  onChanged,
  onPatch,
  onMark,
  extra
}: {
  /** More buttons for the details' action row (e.g. Today's Skip). */
  extra?: ReactNode
  item: SheetItem
  /** You may change it (a calendar you can write to, or a Todoist task). */
  canEdit: boolean
  calendars: SheetCalendar[]
  tasks: TodoTask[]
  startInEdit?: boolean
  /** Done already? (the ✓ circle's state); loaded here when not given. */
  done?: boolean
  onClose: () => void
  /** A change reached Google / Todoist (or failed): load again. */
  onChanged: () => void
  /** Show a change at once, before Google answers (null: deleted). */
  onPatch?: (before: CalEvent, after: CalEvent | null) => void
  /** Mark done / not done (shared with the ✓ circle). */
  onMark?: (v: 'done' | null) => unknown
}) {
  const act = useAction()
  const toast = useToast()
  const e = item.event
  const [mode, setMode] = useState<'view' | 'edit'>(startInEdit ? 'edit' : 'view')
  const [title, setTitle] = useState(item.title)
  // Times (D5): the real end from Google, so events past midnight or over days keep it.
  const origAllDay = !!e?.allDay
  const origEndDay = e ? (origAllDay ? addDays(localDay(e.end), -1) : localDay(e.end)) : item.day
  const [allDay, setAllDay] = useState(origAllDay)
  const [day, setDayRaw] = useState(item.day)
  const [endDay, setEndDay] = useState(origEndDay < item.day ? item.day : origEndDay)
  const [start, setStart] = useState(hmOf(item.start))
  const [end, setEnd] = useState(e && !origAllDay ? localHM(e.end) : hmOf(item.end))
  const setDay = (d: string) => {
    if (!d) return
    setEndDay(addDays(d, Math.max(0, dayDiff(day, endDay))))
    setDayRaw(d)
  }
  const reminder0 = e?.reminder == null ? 'default' : String(e.reminder)
  const [reminder, setReminder] = useState(reminder0)
  const [notes, setNotes] = useState(e?.description ?? '')
  const [place, setPlace] = useState(e?.location ?? '')
  const [colorId, setColorId] = useState(e?.colorId ?? '')
  const [cal, setCal] = useState(e?.calendarId ?? '')
  const [repeat, setRepeat] = useState<RepeatChoice>('none')
  const [custom, setCustom] = useState<CustomRepeat>(CUSTOM0)
  const [moveOpen, setMoveOpen] = useState(false)
  // Event or focus block (core/blockKind.ts), your choice per title.
  const [kinds, setKinds] = useState<BlockKinds>({})
  useEffect(() => {
    void life.timeline?.kinds?.().then(setKinds).catch(() => {})
  }, [])
  const kind0: BlockKind = item.task ? 'focus' : e && !e.allDay ? blockKindOf({ title: item.title, ours: e.ours, call: !!e.meet }, kinds) : 'event'
  const [kindPick, setKindPick] = useState<BlockKind | null>(null)
  const kind = kindPick ?? kind0
  // Done, shared with the ✓ circle on the timeline.
  const markId = e?.id ?? item.key
  const [doneHere, setDoneHere] = useState<boolean | null>(null)
  useEffect(() => {
    if (doneProp !== undefined) return
    void life.timeline
      ?.marks(item.day)
      .then((m) => setDoneHere(m[markId] === 'done'))
      .catch(() => {})
  }, [item.day, markId, doneProp])
  const done = doneHere ?? doneProp ?? false

  /** Start and end as Google wants them; an end at or before the start on the same day = the next day. */
  const sp = (() => {
    if (allDay) {
      const last = endDay < day ? day : endDay
      return { s: day, en: addDays(last, 1), mins: (dayDiff(day, last) + 1) * 1440, nextDay: false }
    }
    const sm = toMin(start)
    const em = toMin(end)
    const ed = endDay > day ? endDay : em <= sm ? addDays(day, 1) : day
    return { s: isoAt(day, sm), en: isoAt(ed, em), mins: dayDiff(day, ed) * 1440 + em - sm, nextDay: ed !== day }
  })()
  const setLen = (m: number) => {
    const em = toMin(start) + m
    setEnd(hmOf(em % 1440))
    setEndDay(em >= 1440 ? addDays(day, 1) : day)
  }
  const applyWhen = (w: When) => {
    const len = !allDay && sp.mins > 0 && sp.mins < 1440 ? sp.mins : 60
    const em = w.end != null && w.end > w.start ? w.end : w.start + len
    setAllDay(false)
    setDayRaw(w.day)
    setStart(hmOf(w.start))
    setEnd(hmOf(em % 1440))
    setEndDay(em >= 1440 ? addDays(w.day, 1) : w.day)
    if (w.every && !e?.recurringEventId) {
      setRepeat('custom')
      setCustom({ ...CUSTOM0, days: w.every })
    }
  }
  const toggleAllDay = (on: boolean) => {
    setAllDay(on)
    if (on) setEndDay(endDay < day ? day : endDay)
    else {
      if (start === end) {
        setStart('09:00')
        setEnd('10:00')
      }
      setEndDay(day)
    }
  }
  const series = !!e?.recurringEventId
  const [scope, setScope] = useState<'one' | 'all'>('one')
  const [sure, setSure] = useState<null | 'ask' | 'one' | 'all'>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const canEdit = item.kind === 'task' || canWrite
  // Keys: Esc closes (or stops asking), Delete asks to delete. Not while typing.
  useEffect(() => {
    const on = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault()
        if (sure) setSure(null)
        else closeRef.current()
        return
      }
      const t = ev.target as HTMLElement | null
      if (t && (t.closest('input, textarea, select, [contenteditable="true"]') || t.isContentEditable)) return
      if (ev.key === 'Delete' && e && canWrite) {
        ev.preventDefault()
        setSure('ask')
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [sure, e, canWrite])
  const card = useRef<HTMLDivElement>(null)
  // Focus moves into the sheet, so keys and screen readers land there.
  useEffect(() => {
    card.current?.focus({ preventScroll: true })
  }, [mode])

  const setKind = async (to: BlockKind) => {
    const next = await life.timeline?.setKind?.(title.trim() || item.title, to).catch(() => null)
    if (next) setKinds(next)
  }
  const mark = async () => {
    const v = done ? null : 'done'
    setDoneHere(!done)
    if (v) soundSuccess()
    if (onMark) await onMark(v)
    else await life.timeline?.mark(item.day, markId, v).catch(() => null)
    toast(v ? `Done: ${item.title}` : `Not done: ${item.title}`, 'good', { label: 'Undo', run: () => (onMark ? void onMark(done ? 'done' : null) : void life.timeline?.mark(item.day, markId, done ? 'done' : null)) })
  }
  /** Change an event: on screen at once, Google in the background, Undo. */
  const writeEvent = (patch: Parameters<NonNullable<NonNullable<typeof life.google>['update']>>[2], after: CalEvent, said: string, undoable: boolean) => {
    if (!e) return
    const before = e
    onPatch?.(before, after)
    onClose()
    const undo = undoable
      ? {
          label: 'Undo',
          run: () => {
            onPatch?.(after, before)
            const back: typeof patch = { title: before.title, description: before.description ?? '', location: before.location ?? '', colorId: before.colorId ?? null }
            if (patch.start || patch.end) Object.assign(back, { start: before.start, end: before.end })
            if (patch.reminder !== undefined) back.reminder = before.reminder ?? null
            life.google!.update!(before.calendarId, before.id, back)
              .then(onChanged)
              .catch((err: Error) => (toast(`Couldn't undo that (${err.message})`, 'bad'), onChanged()))
          }
        }
      : undefined
    toast(said, 'good', undo)
    life.google!.update!(e.calendarId, e.id, patch)
      .then(onChanged)
      .catch((err: Error) => {
        onPatch?.(after, before)
        toast(`Google didn't take that (${err.message}). It's back as it was.`, 'bad')
        onChanged()
      })
  }
  const save = async () => {
    if (kindPick && kindPick !== kind0) void setKind(kindPick)
    if (e) {
      if (sp.mins <= 0) return void toast('The end must be after the start', 'bad')
      const timesChanged = allDay !== origAllDay || !sameTime(sp.s, e.start) || !sameTime(sp.en, e.end)
      const moved = !!cal && cal !== e.calendarId
      const patch = {
        title: title.trim() || e.title,
        ...(timesChanged ? { start: sp.s, end: sp.en } : {}),
        description: notes,
        location: place.trim(),
        colorId: colorId || null,
        ...(reminder !== reminder0 ? { reminder: reminder === 'default' ? null : Number(reminder) } : {}),
        ...(moved ? { moveTo: cal } : {}),
        ...(series ? { scope, recurringEventId: e.recurringEventId } : repeat !== 'none' ? { recurrence: repeat === 'custom' ? customRule(custom, day) : repeatRule(repeat, day) } : {})
      }
      const hex = colorId ? EVENT_COLORS.find((c) => c[0] === colorId)?.[2] : null
      const after: CalEvent = { ...e, title: patch.title, start: timesChanged ? sp.s : e.start, end: timesChanged ? sp.en : e.end, allDay, description: notes, location: patch.location || null, colorId: colorId || null, color: hex || (colorId ? e.color : (calendars.find((c) => c.id === e.calendarId)?.color ?? e.color)) }
      // A whole series, a calendar move or a new repeat can't be undone in one step.
      const undoable = !moved && !(series && scope === 'all') && repeat === 'none'
      writeEvent(patch, after, series && scope === 'all' ? 'Saved for every repeat' : `Saved: ${patch.title}`, undoable)
    } else if (item.task) {
      const s = toMin(start)
      const en = toMin(end)
      const ok = await act(() => life.todoist!.update!(item.task!.id, { content: title.trim() || item.task!.content, due: `${day} ${start}`, ...(en > s ? { duration: en - s } : {}) }).then(() => true), 'Saved in Todoist')
      if (ok) onChanged()
    }
  }
  /** Move to another time, keeping the length. */
  const moveBy = (days: number, minutes: number, said: string) => {
    setMoveOpen(false)
    const len = item.end - item.start
    const startM = Math.max(0, Math.min(24 * 60 - 15, item.start + minutes))
    const d = addDays(item.day, days)
    if (e) {
      if (e.allDay) {
        const n = Math.max(1, dayDiff(localDay(e.start), localDay(e.end)))
        return writeEvent({ start: d, end: addDays(d, n) }, { ...e, start: d, end: addDays(d, n) }, `${item.title}: ${said}`, true)
      }
      const realLen = Math.max(15, Math.round((new Date(e.end).getTime() - new Date(e.start).getTime()) / 60000)) || len
      const s = isoAt(d, startM)
      const en = new Date(new Date(s).getTime() + realLen * 60000).toISOString()
      writeEvent({ start: s, end: en },{ ...e, start: s, end: en }, `${item.title}: ${said}`, true)
    } else if (item.task) {
      const id = item.task.id
      onClose()
      void act(() => life.todoist!.update!(id, { due: `${d} ${hmOf(startM)}` }).then(() => true), `${item.title}: ${said}`).then(onChanged)
    }
  }
  const remove = async (which: 'one' | 'all') => {
    if (!e) return
    const id = which === 'all' && e.recurringEventId ? e.recurringEventId : e.id
    onPatch?.(e, null)
    onClose()
    const undo =
      which === 'one'
        ? {
            label: 'Undo',
            run: () => {
              void life
                .google!.create({ title: e.title, start: e.start, end: e.end, description: e.description ?? undefined, location: e.location ?? undefined, calendarId: e.calendarId, ...(e.reminder != null ? { reminder: e.reminder } : {}) })
                .then(() => toast(`Back: ${e.title}`, 'good'))
                .catch((err: Error) => toast(`Couldn't bring it back (${err.message})`, 'bad'))
                .finally(onChanged)
            }
          }
        : undefined
    toast(which === 'all' ? `Every repeat of “${e.title}” deleted` : `Deleted: ${e.title}`, 'good', undo)
    life.google!.remove(e.calendarId, id)
      .then(onChanged)
      .catch((err: Error) => {
        onPatch?.(e, e)
        toast(`Google didn't delete it (${err.message})`, 'bad')
        onChanged()
      })
  }
  const focus = async () => {
    const nowM = new Date().getHours() * 60 + new Date().getMinutes()
    const left = Math.max(10, Math.min(180, (sp.nextDay ? toMin(end) + 1440 : toMin(end)) - Math.max(toMin(start), nowM)))
    if (await act(() => life.focus.start(item.title.replace(/^[^\p{L}\p{N}]+/u, '').slice(0, 40), left, item.task ? { kind: 'todoist', ref: item.task.id, title: item.task.content } : null), `Timer started · ${left} min`)) onClose()
  }
  const writableCals = calendars.filter((c) => c.canWrite !== false)
  const calName = e ? (calendars.find((c) => c.id === e.calendarId)?.name ?? (e.calendarId === 'primary' ? 'Main calendar' : e.calendarId)) : 'Todoist'
  const shown = colorId ? EVENT_COLORS.find((c) => c[0] === colorId)?.[2] : item.color
  const when = (() => {
    const d = new Date(`${item.day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
    if (e?.allDay) {
      const n = Math.max(1, dayDiff(localDay(e.start), localDay(e.end)))
      return `${d} · all day${n > 1 ? ` · ${n} days` : ''}`
    }
    const realEnd = e ? localHM(e.end) : hmOf(item.end)
    const mins = e ? Math.round((new Date(e.end).getTime() - new Date(e.start).getTime()) / 60000) : item.end - item.start
    return `${d} · ${hmOf(item.start)}–${realEnd} (${lenLabel(mins)})`
  })()
  const bt = blockTasks(notes)
  const plain = plainNotes(e?.description)

  const checklist = bt.length > 0 && e && (
    <div className="ce-tasks">
      <span className="ce-label">Tasks in this block</span>
      {bt.map((t) => (
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
  )

  const kindSeg = (
    <div className="sx-seg ev-kind" role="radiogroup" aria-label="Event or focus block">
      <button type="button" role="radio" aria-checked={kind === 'event'} className={kind === 'event' ? 'on' : ''} onClick={() => setKindPick('event')}>
        📅 Event
      </button>
      <button type="button" role="radio" aria-checked={kind === 'focus'} className={kind === 'focus' ? 'on' : ''} onClick={() => setKindPick('focus')}>
        ⏱ Focus block
      </button>
    </div>
  )

  // On the page itself: a parent with a transform would carry a fixed sheet off screen.
  return createPortal(
    <div className="sheet ev-sheet-wrap" role="presentation" onClick={(ev) => ev.target === ev.currentTarget && onClose()} onPointerDown={(ev) => ev.stopPropagation()}>
      <div ref={card} tabIndex={-1} role="dialog" aria-modal="true" aria-label={item.title} className={`sheet-card cal-edit ce ev-sheet ${mode}`}>
        {mode === 'view' ? (
          <>
            <header className="ce-head ev-head" style={{ ['--c' as string]: shown ?? item.color }}>
              <i className="ce-bar" />
              <div className="ev-titles">
                <h2 className={`ev-title ${done ? 'done' : ''}`}>{item.title}</h2>
                <span className={`ev-chip ${kind}`}>{item.task ? '☑ Todoist task' : kind === 'focus' ? '⏱ Focus block' : '📅 Event'}</span>
                {done && <span className="ev-chip ok">✓ Done</span>}
              </div>
              <button className="btn small ghost" onClick={onClose} aria-label="Close">
                ✕
              </button>
            </header>
            <div className="ce-row ev-row">
              <Icon name="clock" size={15} />
              <span>{when}</span>
            </div>
            <div className="ce-row ev-row">
              <Icon name="calendar" size={15} />
              <span>
                {calName}
                {e?.ours ? ' · made by Life System' : ''}
                {e && !canWrite ? ' · read-only' : ''}
              </span>
            </div>
            {series && (
              <div className="ce-row ev-row">
                <Icon name="refresh" size={15} />
                <span>Repeats</span>
              </div>
            )}
            {e?.location && (
              <div className="ce-row ev-row">
                <span aria-hidden>📍</span>
                <span>{e.location}</span>
              </div>
            )}
            {e?.meet && (
              <div className="ce-row ev-row">
                <span aria-hidden>🎥</span>
                <a className="btn small primary" href={e.meet} target="_blank" rel="noopener noreferrer">
                  Join the call
                </a>
              </div>
            )}
            {!!e?.attendees && (
              <div className="ce-row ev-row">
                <span aria-hidden>👥</span>
                <span>
                  {e.attendees} {e.attendees === 1 ? 'person' : 'people'} invited
                  {e.response === 'needsAction' ? ' · you haven\'t answered yet' : e.response === 'tentative' ? ' · you said maybe' : ''}
                </span>
              </div>
            )}
            {e?.reminder != null && (
              <div className="ce-row ev-row">
                <Icon name="bell" size={15} />
                <span>{e.reminder ? `${lenLabel(e.reminder)} before` : 'No reminder'}</span>
              </div>
            )}
            {plain && <p className="ev-notes">{plain}</p>}
            {checklist}
            {e?.htmlLink && (
              <a className="ev-glink hint small" href={e.htmlLink} target="_blank" rel="noopener noreferrer">
                Open in Google Calendar ↗
              </a>
            )}
            {sure ? (
              <div className="ev-confirm" role="alertdialog" aria-label="Delete?">
                <b>Delete “{item.title}”?</b>
                <div className="row">
                  {series ? (
                    <>
                      <button className="btn small danger" onClick={() => void remove('one')}>
                        This event
                      </button>
                      <button className="btn small danger ghost" onClick={() => void remove('all')}>
                        All events
                      </button>
                    </>
                  ) : (
                    <button className="btn small danger" onClick={() => void remove('one')} autoFocus>
                      <Icon name="trash" size={13} /> Delete
                    </button>
                  )}
                  <button className="btn small ghost" onClick={() => setSure(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="sheet-actions ev-actions">
                {canEdit && (
                  <button className="btn small primary" onClick={() => setMode('edit')}>
                    <Icon name="edit" size={13} /> Edit
                  </button>
                )}
                <button className={`btn small ${done ? 'on' : ''}`} onClick={() => void (item.task && !done ? act(() => life.todoist!.complete(item.task!), 'Done in Todoist').then(() => (onClose(), onChanged())) : mark())}>
                  <Icon name={done ? 'undo' : 'check'} size={13} /> {done ? 'Undo done' : 'Mark done'}
                </button>
                {kind === 'focus' && (
                  <button className="btn small" onClick={() => void focus()}>
                    ▶ Start timer
                  </button>
                )}
                {canEdit && (
                  <span className="ev-move-wrap">
                    <button className="btn small ghost" aria-haspopup="menu" aria-expanded={moveOpen} onClick={() => setMoveOpen(!moveOpen)}>
                      Move to… ▾
                    </button>
                    {moveOpen && (
                      <span className="ev-move" role="menu">
                        <button role="menuitem" onClick={() => moveBy(0, 15, '15 min later')}>
                          15 min later
                        </button>
                        <button role="menuitem" onClick={() => moveBy(0, 60, '1 hour later')}>
                          1 hour later
                        </button>
                        <button role="menuitem" onClick={() => moveBy(1, 0, 'tomorrow, same time')}>
                          Tomorrow, same time
                        </button>
                        <button role="menuitem" onClick={() => moveBy(7, 0, 'next week, same time')}>
                          Next week, same time
                        </button>
                        <button role="menuitem" onClick={() => (setMoveOpen(false), setMode('edit'))}>
                          Pick a day and time…
                        </button>
                      </span>
                    )}
                  </span>
                )}
                {extra}
                <span style={{ flex: 1 }} />
                {e && canWrite && (
                  <button className="btn small ghost danger" onClick={() => setSure('ask')} title="Delete (Delete key)">
                    <Icon name="trash" size={13} /> Delete
                  </button>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <header className="ce-head" style={{ ['--c' as string]: shown ?? item.color }}>
              <i className="ce-bar" />
              <input className="ce-title" value={title} onChange={(ev) => setTitle(ev.target.value)} onKeyDown={(ev) => ev.key === 'Enter' && void save()} disabled={!canEdit} aria-label="Title" placeholder="Title" autoFocus />
              <button className="btn small ghost" onClick={onClose} aria-label="Close">
                ✕
              </button>
            </header>
            <div className="ce-row">
              <Icon name="clock" size={15} />
              <input type="date" value={day} onChange={(ev) => setDay(ev.target.value)} disabled={!canEdit} aria-label="Day" />
              {!allDay && <input type="time" value={start} step={300} onChange={(ev) => ev.target.value && setStart(ev.target.value)} disabled={!canEdit} aria-label="Start" />}
              <span>–</span>
              {!allDay && <input type="time" value={end} step={300} onChange={(ev) => ev.target.value && setEnd(ev.target.value)} disabled={!canEdit} aria-label="End" />}
              {e && (allDay || endDay !== day || sp.nextDay) && <input type="date" value={sp.nextDay && endDay === day ? addDays(day, 1) : endDay} min={day} onChange={(ev) => ev.target.value && setEndDay(ev.target.value)} disabled={!canEdit} aria-label="End day" />}
              <small className={`ce-len ${sp.mins <= 0 ? 'bad' : ''}`}>
                {sp.mins <= 0 ? 'ends before it starts' : allDay ? (sp.mins === 1440 ? '1 day' : `${sp.mins / 1440} days`) : `${lenLabel(sp.mins)}${sp.nextDay ? ' · ends next day' : ''}`}
              </small>
            </div>
            <div className="ce-row ce-lens">
              {e && (
                <label className="ce-check">
                  <input type="checkbox" checked={allDay} onChange={(ev) => toggleAllDay(ev.target.checked)} /> All day
                </label>
              )}
              {!allDay &&
                SHEET_LENGTHS.map((m) => (
                  <button key={m} type="button" className={`btn small ${sp.mins === m ? '' : 'ghost'}`} onClick={() => setLen(m)}>
                    {lenLabel(m)}
                  </button>
                ))}
              {e && !allDay && endDay === day && !sp.nextDay && (
                <button type="button" className="btn small ghost" onClick={() => setEndDay(addDays(day, 1))} title="Make it end on a later day">
                  Several days…
                </button>
              )}
            </div>
            <WhenBox onWhen={applyWhen} />
            {e && !e.allDay && !allDay && (
              <div className="ce-row">
                <span className="ce-label">Kind</span>
                {kindSeg}
              </div>
            )}
            {e && (
              <>
                {series ? (
                  <div className="ce-row">
                    <Icon name="refresh" size={15} />
                    <span className="ce-label">Repeating · change</span>
                    <div className="sx-seg" role="radiogroup" aria-label="Which repeats">
                      <button type="button" className={scope === 'one' ? 'on' : ''} onClick={() => setScope('one')}>
                        This event
                      </button>
                      <button type="button" className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>
                        All events
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="ce-row">
                    <Icon name="refresh" size={15} />
                    <span className="ce-label">Repeat</span>
                    <Select value={repeat} onChange={(ev) => setRepeat(ev.target.value as RepeatChoice)} aria-label="Repeat">
                      <option value="none">Doesn't repeat</option>
                      <option value="daily">Every day</option>
                      <option value="weekdays">Every weekday</option>
                      <option value="weekly">Every week</option>
                      <option value="custom">Custom…</option>
                    </Select>
                  </div>
                )}
                {!series && repeat === 'custom' && <CustomRepeatFields value={custom} day={day} onChange={setCustom} />}
                <div className="ce-row">
                  <span aria-hidden>📍</span>
                  <input className="ev-place" value={place} onChange={(ev) => setPlace(ev.target.value)} placeholder="Add a place" aria-label="Place" />
                </div>
                <div className="ce-row">
                  <Icon name="bell" size={15} />
                  <span className="ce-label">Reminder</span>
                  <Select value={reminder} onChange={(ev) => setReminder(ev.target.value)} aria-label="Reminder">
                    {REMINDERS.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                    {!REMINDERS.some(([v]) => v === reminder) && <option value={reminder}>{lenLabel(Number(reminder))} before</option>}
                  </Select>
                </div>
                <div className="ce-row ce-colors" role="radiogroup" aria-label="Color">
                  <span className="ce-label">Color</span>
                  {EVENT_COLORS.map(([id, name, hex]) => (
                    <button key={id || 'cal'} type="button" title={name} aria-label={name} aria-checked={colorId === id} role="radio" className={`ce-swatch ${colorId === id ? 'on' : ''} ${id ? '' : 'cal'}`} style={{ ['--s' as string]: hex || item.color }} onClick={() => setColorId(id)} />
                  ))}
                </div>
                {writableCals.length > 1 && (
                  <div className="ce-row">
                    <Icon name="calendar" size={15} />
                    <span className="ce-label">Calendar</span>
                    <Select value={cal} onChange={(ev) => setCal(ev.target.value)} aria-label="Calendar">
                      {writableCals.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}
                {checklist}
                <textarea className="ce-notes" value={notes} onChange={(ev) => setNotes(ev.target.value)} placeholder="Notes" rows={3} aria-label="Notes" />
              </>
            )}
            <div className="sheet-actions cal-edit-actions">
              <button className="btn small ghost" onClick={() => (startInEdit ? onClose() : setMode('view'))}>
                Cancel
              </button>
              <span style={{ flex: 1 }} />
              {canEdit && (
                <button className="btn small primary" onClick={() => void save()}>
                  Save
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  )
}
