// Today's Top 3: the must-dos (the same list Ben, the island and Telegram
// use), shown as three priorities. Big round checks, type to add, drag to
// reorder, ★ to take one back out. A tick strikes the line through and pops
// a small ✓. The rows' actions (ticking, Todoist, focus) stay in DayFlow.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Tick } from '../motionKit'

export interface TopItem {
  key: string
  text: string
  done: boolean
  /** What it pays when done ("+10"), or '' when it pays nothing (a 4th must-do). */
  pts: string
  /** Small muted text: when, how long, where it's from. */
  meta?: string
  /** The swipe key on the phone (must:2, star:<id>), none once done. */
  swipe?: string
  onTick: () => void
  /** Take it out of the Top 3 (★ off, or remove the typed one). */
  onUnstar?: () => void
  /** Drag to reorder: only the day plan's own rows. */
  movable?: boolean
  /** The ▶ focus button (or nothing). */
  play?: ReactNode
}

export function MustDos({
  items,
  coins,
  canAdd,
  adding,
  setAdding,
  onAdd,
  hasTodoist,
  week,
  onReorder
}: {
  items: TopItem[]
  coins: number
  canAdd: boolean
  adding: string
  setAdding: (v: string) => void
  onAdd: () => void
  hasTodoist: boolean
  /** This week's big 3, as one small line in the header (null when none are picked). */
  week?: { done: number; total: number; names: string[] } | null
  /** A row dropped before another one (null: to the end). */
  onReorder?: (key: string, before: string | null) => void
}) {
  // Just ticked: the check pops and the line strikes through.
  const prev = useRef(new Map<string, boolean>())
  const [just, setJust] = useState<string[]>([])
  useEffect(() => {
    const now = items.filter((i) => i.done && prev.current.get(i.key) === false).map((i) => i.key)
    prev.current = new Map(items.map((i) => [i.key, i.done]))
    if (!now.length) return
    setJust((j) => [...j, ...now])
    const t = setTimeout(() => setJust((j) => j.filter((k) => !now.includes(k))), 900)
    return () => clearTimeout(t)
  }, [items])
  const [drag, setDrag] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const done = items.filter((i) => i.done).length
  const total = items.length
  const allDone = total > 0 && done === total
  const drop = (before: string | null) => {
    const k = drag
    setDrag(null)
    setOver(null)
    if (k && k !== before) onReorder?.(k, before)
  }
  return (
    <div className={`t3 ${allDone ? 'all' : ''}`} aria-label="Top 3">
      <div className="t3-head">
        <h3>Top 3</h3>
        {total > 0 && (
          <span className="t3-count">
            {done}/{total}
          </span>
        )}
        <span className="t3-pts" title={`Each of your first 3 pays +${coins} when it's done`}>
          +{coins} each
        </span>
        {week && week.total > 0 && (
          <span className={`t3-week ${week.done === week.total ? 'all' : ''}`} title={`This week's big 3: ${week.names.join(' · ')}`}>
            {week.done === week.total ? "✓ Week's big 3 done" : `Week's big 3 · ${week.done}/${week.total}`}
          </span>
        )}
      </div>
      <ul className="t3-list" onDragOver={(e) => drag && e.preventDefault()} onDrop={(e) => (e.preventDefault(), drop(null))}>
        {items.map((m) => (
          <li
            key={m.key}
            className={`t3-item ${m.done ? 'done' : ''} ${just.includes(m.key) ? 'just' : ''} ${over === m.key && drag !== m.key ? 'drop-before' : ''} ${drag === m.key ? 'dragging' : ''}`}
            data-swipe={m.done ? undefined : m.swipe}
            draggable={!!onReorder && !!m.movable}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/x-top3', m.key)
              setDrag(m.key)
            }}
            onDragEnd={() => (setDrag(null), setOver(null))}
            onDragOver={(e) => {
              if (!drag) return
              e.preventDefault()
              e.stopPropagation()
              if (over !== m.key) setOver(m.key)
            }}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              drop(m.movable ? m.key : null)
            }}
          >
            <button className="t3-check" aria-label={m.done ? `Untick ${m.text}` : `Tick ${m.text}`} onClick={m.onTick}>
              {m.done && <Tick />}
            </button>
            <span className="t3-text">
              <span className="t3-t">{m.text}</span>
              {m.meta && <small className="t3-meta">{m.meta}</small>}
            </span>
            {just.includes(m.key) && (
              <span className="t3-pop" aria-hidden="true">
                ✓{m.pts ? ` ${m.pts}` : ''}
              </span>
            )}
            {!m.done && m.play}
            <span className="t3-pts-row">{m.pts}</span>
            {m.onUnstar && !m.done && (
              <button className="t3-star" aria-label={`Take ${m.text} out of the Top 3`} title="Take it out of the Top 3" onClick={m.onUnstar}>
                ★
              </button>
            )}
          </li>
        ))}
        {canAdd && (
          <li className="t3-add">
            <span className="t3-check ghost" aria-hidden="true" />
            <form
              onSubmit={(e) => {
                e.preventDefault()
                onAdd()
              }}
            >
              <input
                value={adding}
                onChange={(e) => setAdding(e.target.value)}
                placeholder={total === 0 ? 'What matters most today?' : 'Add a priority…'}
                maxLength={140}
                aria-label="Add a must-do"
              />
              {adding.trim() ? <button className="btn small primary">Add</button> : hasTodoist && <small className="t3-hint">or ☆ a task below</small>}
            </form>
          </li>
        )}
      </ul>
      {allDone && (
        <p className="t3-done">
          {total === 1 ? "Today's priority is done." : `All ${total} done.`} <small>Nice work.</small>
        </p>
      )}
    </div>
  )
}
