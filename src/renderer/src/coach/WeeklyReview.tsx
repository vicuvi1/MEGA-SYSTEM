// The ONE weekly review: the coach's body and training step first, then the
// goal ladder's steps (actions per goal, next week's top 3) when the ladder
// is there; the coach's step alone otherwise.
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useLadder } from '../ladder/useLadder'
import { SundayReview } from '../ladder/Reviews'
import { CoachWeekStep } from './CoachWeek'
import '../ladder/ladder.css'

/** The one weekly review: the coach's step, then the goal ladder's steps (when the ladder is there). */
export function WeeklyReviewFlow({ onClose }: { onClose: () => void }) {
  const { v, reload, error } = useLadder()
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  // On document.body, so a tab's transform can't trap the sheet.
  if (v) return createPortal(<SundayReview v={v} onClose={onClose} onDone={reload} />, document.body)
  if (!error) return null
  return createPortal(
    <div className="sheet ql-sheet" role="dialog" aria-modal="true" aria-label="Weekly review" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet-card ql-review">
        <header>
          <span className="ql-kicker">Weekly review</span>
          <h3>Body and training</h3>
        </header>
        <CoachWeekStep />
        <div className="sheet-actions">
          <button type="button" className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
