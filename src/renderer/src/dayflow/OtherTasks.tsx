// Today → Now: the rest of today's tasks in one plain list (Todoist's due
// today and overdue, plus the week's big 3), under the Top 3. A check
// completes it (Todoist too), ☆ moves it up to the Top 3, one line adds a
// task for today. Late ones are only marked softly. Full editing (dates,
// areas, priority) stays on the Tasks tab.
import { SyncButton } from '../plan/SyncButton'
import { useState, type ReactNode } from 'react'
import { Tick } from '../motionKit'

export interface OtherItem {
  key: string
  text: string
  /** Small muted text: time, how long, the area. */
  meta?: string
  late?: boolean
  /** A short tag before the meta ("This week"). */
  tag?: string
  pts: string
  swipe?: string
  leaving?: boolean
  onDone: () => void
  /** ☆: one of the Top 3. */
  onStar?: () => void
  play?: ReactNode
}

const LIMIT = 8

export function OtherTasks({ items, onAdd, canAdd, empty, starFull }: { items: OtherItem[]; onAdd?: (text: string) => Promise<boolean>; canAdd: boolean; empty: string; starFull: boolean }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [all, setAll] = useState(false)
  const shown = all ? items : items.slice(0, LIMIT)
  const more = items.length - shown.length
  const add = async () => {
    const v = text.trim()
    if (!v || busy || !onAdd) return
    setBusy(true)
    const ok = await onAdd(v)
    setBusy(false)
    if (ok) setText('')
  }
  return (
    <div className="ot" aria-label="Other tasks">
      <div className="ot-head">
        <h3>Other tasks</h3>
        {items.length > 0 && <span className="ot-count">{items.length}</span>}
        <SyncButton />
      </div>
      {items.length === 0 && <p className="ot-empty">{empty}</p>}
      <ul className="ot-list">
        {shown.map((t) => (
          <li key={t.key} className={`ot-item ${t.late ? 'late' : ''} ${t.leaving ? 'leaving' : ''}`} data-swipe={t.swipe}>
            <button className="ot-check" aria-label={`Done: ${t.text}`} onClick={t.onDone}>
              {t.leaving && <Tick />}
            </button>
            <span className="ot-text">
              <span className="ot-t">{t.text}</span>
              {(t.meta || t.tag || t.late) && (
                <small className="ot-meta">
                  {t.late && <span className="ot-late">overdue</span>}
                  {t.tag && <span className="ot-tag">{t.tag}</span>}
                  {t.meta && <span>{t.meta}</span>}
                </small>
              )}
            </span>
            {t.play}
            <span className="ot-pts">{t.pts}</span>
            {t.onStar && (
              <button className="ot-star" aria-label={`Make ${t.text} one of the Top 3`} title={starFull ? 'Your Top 3 is full: it joins as a 4th (no extra points)' : 'Make it one of your Top 3'} onClick={t.onStar}>
                ☆
              </button>
            )}
          </li>
        ))}
      </ul>
      {more > 0 && (
        <button type="button" className="ot-more" onClick={() => setAll(true)}>
          Show {more} more
        </button>
      )}
      {all && items.length > LIMIT && (
        <button type="button" className="ot-more" onClick={() => setAll(false)}>
          Show less
        </button>
      )}
      {canAdd && onAdd && (
        <form
          className="ot-add"
          onSubmit={(e) => {
            e.preventDefault()
            void add()
          }}
        >
          <span aria-hidden="true">+</span>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a task…" aria-label="Add a task for today" maxLength={300} disabled={busy} />
          {text.trim() && <button className="btn small">{busy ? 'Adding…' : 'Add'}</button>}
        </form>
      )}
    </div>
  )
}
