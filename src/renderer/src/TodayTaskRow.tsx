// One Todoist task on Today, editable in place:
// - the date chip: Today, Tomorrow, This weekend, Next week, No date, a
//   calendar to pick any day (and a time), or type it like Todoist
//   ("fri 18:00", "every monday");
// - the flag: P1–P4 (keys 1–4 on the task under the mouse);
// - ⋯: rename, details, area, how long it takes, not today, delete.
// Drag the row to reorder it, onto another area to move it, or onto free
// time in "Your day" to block it in your calendar.
import { dayLabel } from '@core/dates'
import { useEffect, useRef, useState } from 'react'
import type { Area, TodoTask } from '@core/todoist'
import { plainName } from '@core/todoist'
import { Icon } from './Icon'

export const P_COLOR: Record<number, string> = { 4: '#FF5D6C', 3: '#FF9F43', 2: '#5BA8FF', 1: 'var(--faint)' }
const P_NAME: Record<number, string> = { 4: 'P1 · urgent', 3: 'P2 · high', 2: 'P3 · medium', 1: 'P4 · none' }
const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00`)
  d.setDate(d.getDate() + n)
  return ymd(d)
}

export function dueText(t: TodoTask, today: string): { text: string; late: boolean } | null {
  if (!t.due) return null
  const tm = t.dueTime ? ` ${t.dueTime}` : ''
  if (t.due < today) return { text: `late · ${dayLabel(t.due, false)}`, late: true }
  if (t.due === today) return { text: t.dueTime ? t.dueTime : 'today', late: false }
  if (t.due === addDays(today, 1)) return { text: `tomorrow${tm}`, late: false }
  return { text: new Date(`${t.due}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + tm, late: false }
}

type Menu = 'due' | 'prio' | 'more' | null

export function TodayTaskRow({
  t,
  today,
  color,
  areas,
  starred,
  running,
  leaving,
  dropping,
  onDone,
  onFocus,
  onBook,
  extra,
  onStar,
  onPatch,
  onMove,
  onDelete,
  onHot,
  dragHandlers
}: {
  t: TodoTask
  today: string
  color: string
  areas: Area[]
  starred: boolean
  running: boolean
  leaving: boolean
  dropping: boolean
  onDone: () => void
  onFocus: () => void
  /** Put it into the next free time today (only for tasks without a time). */
  onBook?: () => void
  /** Extra quick buttons (e.g. Today / Tomorrow in the other tabs). */
  extra?: React.ReactNode
  onStar: () => void
  /** Change the task (optimistic in the list, then Todoist). */
  onPatch: (patch: { content?: string; priority?: number; due?: string; description?: string; duration?: number | null }, local: Partial<TodoTask>, msg?: string) => void
  onMove: (area: Area) => void
  onDelete: () => void
  onHot: (id: string | null) => void
  dragHandlers: React.HTMLAttributes<HTMLLIElement> & { draggable?: boolean }
}) {
  const [menu, setMenuRaw] = useState<Menu>(null)
  const [up, setUp] = useState(false)
  // Near the bottom of the screen, menus open upward so nothing is cut off.
  const setMenu = (m: Menu) => {
    if (m && ref.current) setUp(ref.current.getBoundingClientRect().bottom > window.innerHeight - (m === 'prio' ? 200 : 440))
    setMenuRaw(m)
  }
  const [editing, setEditing] = useState(false)
  const ref = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (!menu) return
    const on = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setMenu(null)
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(null)
    document.addEventListener('pointerdown', on)
    window.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', on)
      window.removeEventListener('keydown', key)
    }
  }, [menu])
  const due = dueText(t, today)
  const setDue = (value: string, label: string, local: Partial<TodoTask>) => {
    setMenu(null)
    onPatch({ due: value }, local, `${t.content}: ${label}`)
  }
  return (
    <li
      ref={ref}
      data-swipe={`${starred ? 'star' : 'todo'}:${t.id}`}
      data-task={t.id}
      className={`tt-row ${leaving ? 'leaving' : ''} ${dropping ? 'drop-before' : ''} ${menu ? 'menu-open' : ''} ${up ? 'pop-up' : ''}`}
      style={{ ['--c' as string]: color, ['--pc' as string]: P_COLOR[t.priority] }}
      onMouseEnter={() => onHot(t.id)}
      onMouseLeave={() => onHot(null)}
      {...dragHandlers}
    >
      <span className="tt-grip" aria-hidden="true" title="Drag to reorder, move to another area, or onto free time">
        ⋮⋮
      </span>
      <button className="dl-check" aria-label={`Complete ${t.content}`} onClick={onDone} />
      <div className="tt-main">
        {editing ? (
          <input
            className="tt-edit"
            autoFocus
            defaultValue={t.content}
            onBlur={(e) => {
              setEditing(false)
              const v = e.target.value.trim()
              if (v && v !== t.content) onPatch({ content: v }, { content: v }, 'Renamed')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') setEditing(false)
            }}
          />
        ) : (
          <span className="dl-text" onDoubleClick={() => setEditing(true)} title="Double-click to rename">
            {t.content}
          </span>
        )}
        {t.description && !editing && <span className="tt-desc">{t.description.split('\n')[0].slice(0, 120)}</span>}
      </div>
      <div className="tt-chips">
        <button className={`tt-chip ${due?.late ? 'late' : ''} ${due ? '' : 'empty'}`} onClick={() => setMenu(menu === 'due' ? null : 'due')} title="Change the date">
          <Icon name="calendar" size={12} /> {due?.text ?? 'No date'}
        </button>
        {t.duration ? <span className="tt-chip dur">{t.duration}m</span> : null}
        <button className="tt-flag" style={{ color: P_COLOR[t.priority] }} onClick={() => setMenu(menu === 'prio' ? null : 'prio')} title={`${P_NAME[t.priority]} (keys 1–4)`} aria-label="Priority">
          ⚑
        </button>
        {extra}
        {onBook && (
          <button className="tt-book" onClick={onBook} title="Book it into your next free time today" aria-label={`Book ${t.content} into your calendar`}>
            <Icon name="calendar" size={12} /> Book
          </button>
        )}
        {!running && (
          <button className="dl-play" aria-label={`Focus on ${t.content}`} title="Focus on this" onClick={onFocus}>
            ▶
          </button>
        )}
        <button className={`dl-star ${starred ? 'on' : ''}`} aria-label={starred ? `Unstar ${t.content}` : `Make ${t.content} a must-do`} title={starred ? 'No longer a must-do' : 'Make it a must-do (⭐ today)'} onClick={onStar}>
          {starred ? '★' : '☆'}
        </button>
        <button className="tt-more" onClick={() => setMenu(menu === 'more' ? null : 'more')} aria-label="More" title="More">
          ⋯
        </button>
      </div>
      {menu === 'due' && <DueMenu t={t} today={today} onPick={setDue} />}
      {menu === 'prio' && (
        <div className="tt-pop small">
          {[4, 3, 2, 1].map((p) => (
            <button
              key={p}
              className={`tt-pop-item ${t.priority === p ? 'on' : ''}`}
              onClick={() => {
                setMenu(null)
                onPatch({ priority: p }, { priority: p }, P_NAME[p])
              }}
            >
              <span style={{ color: P_COLOR[p] }}>⚑</span> {P_NAME[p]} <kbd>{5 - p}</kbd>
            </button>
          ))}
        </div>
      )}
      {menu === 'more' && (
        <MoreMenu
          t={t}
          areas={areas}
          onRename={() => {
            setMenu(null)
            setEditing(true)
          }}
          onDetails={(d) => {
            setMenu(null)
            onPatch({ description: d }, { description: d }, 'Details saved')
          }}
          onArea={(a) => {
            setMenu(null)
            onMove(a)
          }}
          onDuration={(m) => {
            setMenu(null)
            onPatch({ duration: m }, { duration: m }, m ? `Takes ${m} min` : 'Duration cleared')
          }}
          onNotToday={() => setDue('no date', 'not today (no date)', { due: null, dueTime: null })}
          onDelete={() => {
            setMenu(null)
            onDelete()
          }}
        />
      )}
    </li>
  )
}

function DueMenu({ t, today, onPick }: { t: TodoTask; today: string; onPick: (value: string, label: string, local: Partial<TodoTask>) => void }) {
  const [typed, setTyped] = useState('')
  const [month, setMonth] = useState((t.due ?? today).slice(0, 7))
  const [time, setTime] = useState(t.dueTime ?? '')
  const sat = (() => {
    const d = new Date(`${today}T12:00:00`)
    return addDays(today, (6 - d.getDay() + 7) % 7 || 7)
  })()
  const mon = (() => {
    const d = new Date(`${today}T12:00:00`)
    return addDays(today, (8 - d.getDay()) % 7 || 7)
  })()
  const quick: [string, string, string | null][] = [
    ['Today', 'today', today],
    ['Tomorrow', 'tomorrow', addDays(today, 1)],
    ['This weekend', 'saturday', sat],
    ['Next week', 'next monday', mon],
    ['No date', 'no date', null]
  ]
  const first = new Date(`${month}-01T12:00:00`)
  const lead = (first.getDay() + 6) % 7
  const daysIn = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  const cells = [...Array.from({ length: lead }, () => null), ...Array.from({ length: daysIn }, (_, i) => `${month}-${pad(i + 1)}`)]
  const shift = (n: number) => {
    const d = new Date(`${month}-15T12:00:00`)
    d.setMonth(d.getMonth() + n)
    setMonth(ymd(d).slice(0, 7))
  }
  const pick = (day: string) => onPick(time ? `${day} ${time}` : day, `${new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}${time ? ` ${time}` : ''}`, { due: day, dueTime: time || null })
  return (
    <div className="tt-pop due">
      <div className="tt-quick">
        {quick.map(([label, value, day]) => (
          <button key={label} className="tt-pop-item" onClick={() => onPick(day && time ? `${day} ${time}` : value, label.toLowerCase(), { due: day, dueTime: day ? time || null : null })}>
            {label}
            {day && <small>{new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })}</small>}
          </button>
        ))}
      </div>
      <div className="tt-cal">
        <div className="tt-cal-head">
          <button type="button" onClick={() => shift(-1)} aria-label="Previous month">
            ‹
          </button>
          <span>{first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</span>
          <button type="button" onClick={() => shift(1)} aria-label="Next month">
            ›
          </button>
        </div>
        <div className="tt-cal-grid">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((w, i) => (
            <span key={i} className="wd">
              {w}
            </span>
          ))}
          {cells.map((d, i) =>
            d ? (
              <button key={d} type="button" className={`${d === today ? 'today' : ''} ${d === t.due ? 'on' : ''} ${d < today ? 'past' : ''}`} onClick={() => pick(d)}>
                {Number(d.slice(8))}
              </button>
            ) : (
              <span key={`b${i}`} />
            )
          )}
        </div>
        <label className="tt-time">
          <span>Time</span>
          <input type="time" value={time} step={300} onChange={(e) => setTime(e.target.value)} />
          {time && (
            <button type="button" className="btn small ghost" onClick={() => setTime('')}>
              No time
            </button>
          )}
        </label>
      </div>
      <form
        className="tt-type"
        onSubmit={(e) => {
          e.preventDefault()
          const v = typed.trim()
          if (v) onPick(v, v, {})
        }}
      >
        <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder='Or type: "fri 18:00", "in 3 days", "every monday"' />
        <button className="btn small primary" disabled={!typed.trim()}>
          Set
        </button>
      </form>
    </div>
  )
}

function MoreMenu({ t, areas, onRename, onDetails, onArea, onDuration, onNotToday, onDelete }: { t: TodoTask; areas: Area[]; onRename: () => void; onDetails: (d: string) => void; onArea: (a: Area) => void; onDuration: (m: number | null) => void; onNotToday: () => void; onDelete: () => void }) {
  const [details, setDetails] = useState(t.description ?? '')
  const [sure, setSure] = useState(false)
  const cur = t.sectionId ? `s:${t.sectionId}` : `p:${t.projectId ?? ''}`
  return (
    <div className="tt-pop more">
      <button className="tt-pop-item" onClick={onRename}>
        <Icon name="edit" size={13} /> Rename
      </button>
      <label className="tt-field">
        <span>Details</span>
        <textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={2} placeholder="Notes, links…" />
        {details !== (t.description ?? '') && (
          <button className="btn small" onClick={() => onDetails(details)}>
            Save details
          </button>
        )}
      </label>
      <div className="tt-field">
        <span>How long it takes</span>
        <div className="tt-row-btns">
          {[15, 25, 50, 90].map((m) => (
            <button key={m} className={`chip ${t.duration === m ? 'on' : ''}`} onClick={() => onDuration(t.duration === m ? null : m)}>
              {m}m
            </button>
          ))}
        </div>
      </div>
      {areas.length > 0 && (
        <div className="tt-field">
          <span>Area</span>
          <div className="tt-row-btns">
            {areas
              .filter((a) => a.key !== cur)
              .slice(0, 10)
              .map((a) => (
                <button key={a.key} className="chip" onClick={() => onArea(a)}>
                  {plainName(a.name) || a.name}
                </button>
              ))}
          </div>
        </div>
      )}
      <div className="tt-pop-foot">
        <button className="btn small ghost" onClick={onNotToday} title="Out of today, no new date">
          Not today
        </button>
        <button
          className={`btn small ghost ${sure ? 'danger' : ''}`}
          onClick={() => {
            if (sure) onDelete()
            else setSure(true)
          }}
        >
          <Icon name="trash" size={13} /> {sure ? 'Sure? Delete' : 'Delete'}
        </button>
      </div>
    </div>
  )
}

/** Due-date words: if a new task says when, Todoist reads it; else it's for today. */
export const withToday = (text: string) => (/\b(today|tomorrow|tmrw|mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next|in \d+|every|\d{1,2}[:.]\d{2}|\d{1,2} ?(am|pm))\b/i.test(text) ? text : `${text} today`)
