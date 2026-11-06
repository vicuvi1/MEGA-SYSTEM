// Today's must-dos: three numbered slots (the first three pay), a slot to
// type the next one, the ⭐-from-tasks hint, and a short strip when they're
// all done. The rows themselves (ticking, focus, Todoist) stay in DayFlow.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Tick } from '../motionKit'

export interface MustItem {
  key: string
  text: string
  done: boolean
  onTick: () => void
  /** The ▶ focus button (or nothing). */
  play?: ReactNode
}

const ORD = ['first', 'second', 'third']

export function MustDos({
  starred,
  items,
  done,
  total,
  coins,
  canAdd,
  adding,
  setAdding,
  onAdd,
  hasTodoist,
  bigDone
}: {
  /** Starred Todoist tasks, already rendered as rows (<li>). */
  starred: ReactNode[]
  items: MustItem[]
  done: number
  total: number
  coins: number
  canAdd: boolean
  adding: string
  setAdding: (v: string) => void
  onAdd: () => void
  hasTodoist: boolean
  /** This week's big 3 are all done. */
  bigDone: boolean
}) {
  // Just ticked: the number turns into a check and the line strikes through.
  const prev = useRef(new Map<string, boolean>())
  const [just, setJust] = useState<string[]>([])
  useEffect(() => {
    const now = items.filter((i) => i.done && prev.current.get(i.key) === false).map((i) => i.key)
    prev.current = new Map(items.map((i) => [i.key, i.done]))
    if (!now.length) return
    setJust((j) => [...j, ...now])
    const t = setTimeout(() => setJust((j) => j.filter((k) => !now.includes(k))), 700)
    return () => clearTimeout(t)
  }, [items])
  const rows = starred.length + items.length
  const allDone = total > 0 && done === total
  const ghosts = Math.max(0, 3 - rows - (canAdd ? 1 : 0))
  return (
    <div className="md" aria-label="Must-dos">
      <div className="md-head">
        <h3>Must-dos</h3>
        {total > 0 && (
          <span className="md-count">
            {done}/{total} done
          </span>
        )}
        <span className="md-chip" title={`Each of your first 3 must-dos pays +${coins} when it's done`}>
          +{coins} each
        </span>
        <span className="md-tip" title={hasTodoist ? 'Tap ☆ on any task in Tasks to make it a must-do, or type one here' : 'Type up to three things that make today a win'}>
          {hasTodoist ? (
            <>
              <b>☆</b> a task in Tasks, or type one
            </>
          ) : (
            'What makes today a win?'
          )}
        </span>
      </div>
      <ul className="md-list dl">
        {starred}
        {items.map((m, k) => (
          <li key={m.key} className={`md-item ${m.done ? 'done' : ''} ${just.includes(m.key) ? 'just' : ''} ${starred.length + k >= 3 ? 'md-extra' : ''}`} data-swipe={m.done ? undefined : `must:${m.key.slice(1)}`}>
            <button className="dl-check" aria-label={m.done ? `Untick ${m.text}` : `Tick ${m.text}`} onClick={m.onTick}>
              {m.done ? <Tick /> : starred.length + k + 1}
            </button>
            <span className="dl-text">
              <span className="md-t">{m.text}</span>
            </span>
            <span className="tt-pts">{starred.length + k < 3 ? `+${coins}` : 'no points'}</span>
            {!m.done && m.play}
          </li>
        ))}
        {canAdd && (
          <li className="md-slot">
            <form
              className="dl-add"
              onSubmit={(e) => {
                e.preventDefault()
                onAdd()
              }}
            >
              <input
                value={adding}
                onChange={(e) => setAdding(e.target.value)}
                placeholder={rows === 0 ? 'What are your 1–3 must-dos today?' : rows < 3 ? `Add a ${ORD[rows]} must-do…` : 'Add another must-do…'}
                maxLength={140}
                aria-label="Add a must-do"
              />
              {adding.trim() && <button className="btn small primary">Add</button>}
            </form>
          </li>
        )}
        {Array.from({ length: ghosts }, (_, k) => (
          <li key={`g${k}`} className="md-slot md-ghost" aria-hidden="true">
            optional
          </li>
        ))}
      </ul>
      {allDone && (
        <p className="md-strip mine">
          <i>✓</i> {total === 1 ? "Today's must-do is done" : `All ${total} must-dos done`}
          <small>nice work</small>
        </p>
      )}
      {bigDone && (
        <p className="md-strip dl-bigdone">
          <i>✓</i> This week's big 3 are done
          <small>this week</small>
        </p>
      )}
    </div>
  )
}
