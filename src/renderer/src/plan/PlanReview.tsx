// The end-of-day check (core/planReview.ts): a short sheet with today's plan
// blocks, one tap each: Done / Partly (how many minutes) / Tomorrow / Drop.
// Opened from the plan card (after the last block, or its ⋯ menu any time)
// and from "Shut down my day". The focus timer's minutes are filled in when
// you used it. Done ticks the block (its Todoist task closes the usual way);
// Tomorrow uses the usual Move to tomorrow. The check pays no points.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { fromMin } from '@core/rhythm'
import { markLabel, reviewRows, type Outcome, type ReviewRow, type TimerSession } from '@core/planReview'
import { dayScore } from '@core/planScore'
import { life } from '../bridge'
import { useToast } from '../ui'
import { attach, reviewBlock, subscribe, type PlanSnap } from './planStore'
import { useReview } from './planReviewStore'
import './planEditor.css'

const nowHm = () => {
  const d = new Date()
  return fromMin(d.getHours() * 60 + d.getMinutes())
}
const BUTTONS: { o: Outcome; label: string; title: string }[] = [
  { o: 'done', label: 'Done', title: 'Done: its Todoist task is closed' },
  { o: 'part', label: 'Partly', title: 'Partly done: say how many minutes' },
  { o: 'slip', label: 'Tomorrow', title: 'Slipped: its task moves to tomorrow' },
  { o: 'drop', label: 'Drop', title: 'Not doing it: only noted, nothing is deleted' }
]

function Minutes({ row, outcome, value, onSave }: { row: ReviewRow; outcome: 'done' | 'part'; value: number; onSave: (m: number) => void }) {
  const [v, setV] = useState(String(value))
  useEffect(() => setV(String(value)), [value])
  const save = () => {
    const n = Math.round(Number(v))
    if (Number.isFinite(n) && n >= 0 && n <= 900 && n !== value) onSave(n)
    else setV(String(value))
  }
  return (
    <label className="prv-min">
      <span>{outcome === 'done' ? 'took' : 'did'}</span>
      <input type="number" inputMode="numeric" min={0} max={900} step={5} value={v} aria-label={`Minutes spent on ${row.title}`} onChange={(e) => setV(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()} />
      <span>min</span>
    </label>
  )
}

export function PlanReview({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const [s, setS] = useState<PlanSnap | null>(null)
  const [sessions, setSessions] = useState<TimerSession[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const store = useReview()
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => subscribe(setS), [])
  // Opened from the shutdown with no plan card on screen: today's plan is read here.
  useEffect(() => {
    if (s) return
    void life.coach
      ?.rhythm?.('state')
      .then((r) => r?.state && attach(r.state))
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    void life.focus
      ?.state?.()
      .then((f) => setSessions(f?.todaySessions ?? []))
      .catch(() => {})
  }, [])
  useEffect(() => box.current?.focus(), [])
  const rows = useMemo(() => (s ? reviewRows(s.plan, { now: nowHm(), sessions, store }) : []), [s, sessions, store])
  // Blocks you already ticked count as done: noted once, so the score sees them.
  const noted = useRef(new Set<string>())
  useEffect(() => {
    for (const r of rows)
      if (r.ticked && !r.mark && !noted.current.has(r.id)) {
        noted.current.add(r.id)
        void reviewBlock(r, 'done').catch(() => {})
      }
  }, [rows])

  const mark = async (r: ReviewRow, o: Outcome, minutes?: number) => {
    if (busy) return
    setBusy(r.id)
    try {
      const it = await reviewBlock(r, o, { minutes })
      if (!it) toast("Couldn't find today's plan", 'bad')
    } catch (e) {
      toast(`Couldn't save that: ${(e as Error)?.message ?? 'try again'}`, 'bad')
    } finally {
      setBusy(null)
    }
  }
  const score = s ? dayScore(store, s.plan.day) : null
  const left = rows.filter((r) => !r.mark).length

  // On the page itself (not inside the card): a card's own effects must not clip or move the sheet.
  return createPortal(
    <div className="sheet prv-wrap" role="dialog" aria-modal="true" aria-label="End-of-day check" onKeyDown={(e) => e.key === 'Escape' && onClose()} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet-card prv" ref={box} tabIndex={-1} data-plan-review>
        <header className="prv-head">
          <b>End-of-day check</b>
          <small>{rows.length ? (left ? `How did today's blocks go? ${left} left · one tap each` : 'All checked. Thanks!') : 'No blocks have started today'}</small>
        </header>
        <ol className="prv-list">
          {rows.map((r) => (
            <li key={r.id} className={`prv-row${r.mark ? ` ${r.mark.outcome}` : ''}`} data-review-row={r.id}>
              <div className="prv-name">
                <b>{r.title}</b>
                <small>
                  {r.start} · {r.minutes} min planned{r.timer ? ` · timer ${r.timer} min` : ''}
                  {r.mark ? ` · ${markLabel(r.mark)}` : ''}
                </small>
              </div>
              <div className="prv-acts" role="group" aria-label={`How ${r.title} went`}>
                {BUTTONS.map((b) => (
                  <button key={b.o} type="button" className={`prv-btn ${b.o}`} aria-pressed={r.mark?.outcome === b.o} disabled={busy === r.id} title={b.title} data-review={b.o} onClick={() => r.mark?.outcome !== b.o && void mark(r, b.o)}>
                    {b.label}
                  </button>
                ))}
                {(r.mark?.outcome === 'done' || r.mark?.outcome === 'part') && (
                  <Minutes row={r} outcome={r.mark.outcome} value={r.mark.actual ?? (r.mark.outcome === 'done' ? r.minutes : Math.round(r.minutes / 2))} onSave={(m) => void mark(r, r.mark!.outcome, m)} />
                )}
              </div>
            </li>
          ))}
        </ol>
        <footer className="prv-foot">
          <span className="prv-score" data-review-score>
            {score ? `Today's plan: ${score.score}% realistic` : 'The score shows once a block is checked'}
          </span>
          <button type="button" className="pe-btn" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>,
    document.body
  )
}
