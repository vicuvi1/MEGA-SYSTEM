// What quick add just did, with Undo for 5 s. "Will sync" stays until it
// went through; "not sure it saved" stays until you close it. Nothing is
// dropped without you seeing it.
import { useEffect, useState } from 'react'
import { UNDO_MS, type QItem, type QStatus } from '@core/quickQueue'
import type { Route } from '@core/quickRoute'

const LABEL: Record<QStatus, string> = {
  saving: 'Saving',
  saved: 'Saved',
  'will-sync': 'Will sync',
  unsure: 'Not sure it saved',
  refused: 'Not saved',
  undone: 'Undone'
}

export interface QuickToastsProps {
  items: QItem<Route>[]
  canUndo: (r: Route) => boolean
  onUndo: (id: string) => void
  onRetry: (id: string) => void
  onDismiss: (id: string) => void
  /** Show only these ids (the desktop window shows only the line just sent). */
  only?: string[]
}

/** Items that still belong on screen at time `now`. */
export function visibleToasts(items: QItem<Route>[], now: number): QItem<Route>[] {
  return items.filter((i) => i.status === 'will-sync' || i.status === 'unsure' || now - i.at < (i.status === 'refused' ? UNDO_MS * 2 : UNDO_MS)).slice(-4)
}

export function QuickToasts({ items, canUndo, onUndo, onRetry, onDismiss, only }: QuickToastsProps) {
  const [now, setNow] = useState(() => Date.now())
  const shown = visibleToasts(only ? items.filter((i) => only.includes(i.id)) : items, now)
  const live = shown.length > 0
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [live])
  if (!shown.length) return null
  return (
    <div className="qa-toasts" role="status" aria-live="polite">
      {shown.map((i) => {
        const undoable = canUndo(i.route) && i.status !== 'undone' && i.status !== 'refused' && now - i.at < UNDO_MS
        return (
          <div key={i.id} className={`qa-toast qa-${i.status}`} data-status={i.status}>
            <span className="qa-said">{i.status === 'refused' ? i.error : i.said}</span>
            <span className="qa-state" title={i.status === 'will-sync' ? i.error : undefined}>
              {LABEL[i.status]}
            </span>
            {undoable && (
              <button type="button" className="qa-undo" onClick={() => onUndo(i.id)}>
                Undo
              </button>
            )}
            {i.status === 'will-sync' && (
              <button type="button" className="qa-undo" onClick={() => onRetry(i.id)}>
                Try now
              </button>
            )}
            {(i.status === 'unsure' || i.status === 'refused' || (i.status === 'will-sync' && now - i.at > UNDO_MS)) && (
              <button type="button" className="qa-x" aria-label={i.status === 'will-sync' ? 'Forget it (it will not be saved)' : 'Close'} onClick={() => onDismiss(i.id)}>
                ×
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
