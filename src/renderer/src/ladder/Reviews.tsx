// The goal ladder's guided reviews, as app screens (no points for either):
// - Sunday review (about 3 minutes): this week's actions per critical goal,
//   then next week's top 3, pre-filled from the ladder (you can change them);
//   saving makes them the week plan's big 3 and parks the rest.
// - Monthly review (about 5 minutes): was each milestone hit, and next
//   month's milestone to keep or adjust.
import { useEffect, useState } from 'react'
import { life } from '../bridge'
import { useAction } from '../ui'
import { ladderPrefill, toggleChip } from '@core/weekPlan'
import type { LadderMilestone, TemplateId } from '@core/goalLadder'
import type { LadderScreen } from '../web/ladderApi'

const LIGHT: Record<string, string> = { green: 'On track', yellow: 'Close', red: 'Needs a step', none: 'Nothing to score yet' }
const fmtWeek = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

function useEscape(onClose: () => void) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
}

export function SundayReview({ v, onClose, onDone }: { v: LadderScreen; onClose: () => void; onDone: () => void }) {
  const act = useAction()
  const r = v.weekly
  const [step, setStep] = useState<1 | 2>(1)
  const [chips, setChips] = useState<string[]>(r.top3)
  const [picked, setPicked] = useState<string[]>(r.top3)
  useEscape(onClose)
  // Your goals and Todoist projects join the chips (the ladder's steps stay first and picked).
  useEffect(() => {
    let off = false
    void (async () => {
      const goals = await life.extras?.goals([]).catch(() => null)
      const all = await life.todoist?.everything?.().catch(() => null)
      const projects = [...new Set((all?.areas ?? []).filter((a) => a.kind === 'project').map((a) => a.name))]
      const p = ladderPrefill(r.top3, (goals?.measures ?? []).map((c) => c.goal.title), projects)
      if (!off) {
        setChips(p.chips)
        setPicked(p.picked)
      }
    })()
    return () => void (off = true)
  }, [r.top3])
  const save = async () => {
    const ok = await act(() => life.saga!.ladder.finishWeek(r.week, chips, picked), `Top ${picked.length} set for the week of ${fmtWeek(r.next)}.`)
    if (ok) {
      onDone()
      onClose()
    }
  }
  return (
    <div className="sheet ql-sheet" role="dialog" aria-modal="true" aria-label="Sunday review" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet-card ql-review">
        <header>
          <span className="ql-kicker">Sunday review · step {step} of 2</span>
          <h3>{step === 1 ? `Your week from ${fmtWeek(r.week)}` : `Top 3 for the week of ${fmtWeek(r.next)}`}</h3>
        </header>
        {step === 1 ? (
          <>
            <ul className="ql-rev-goals">
              {r.goals.map((g) => (
                <li key={g.id} className={`l-${g.light}`}>
                  <span className="ql-light">
                    <i aria-hidden />
                    {LIGHT[g.light]}
                  </span>
                  <b>
                    {g.emoji} {g.title}
                  </b>
                  <small>{g.actions.join(' · ')}</small>
                  {g.fix && <small className="ql-fix">For next week: {g.fix}</small>}
                </li>
              ))}
            </ul>
            <p className="hint">Only what you did counts here. No points for the review itself.</p>
            <div className="sheet-actions">
              <button type="button" className="btn ghost" onClick={onClose}>
                Later
              </button>
              <button type="button" className="btn primary" onClick={() => setStep(2)}>
                Next: pick the top 3
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="hint">Pre-filled from your quarter goals. Tap to change; up to 3. The rest stay parked and quiet.</p>
            <div className="wk3-chips ql-chips">
              {chips.map((c) => (
                <button key={c} type="button" className={picked.includes(c) ? 'on' : ''} aria-pressed={picked.includes(c)} onClick={() => setPicked(toggleChip(picked, c))}>
                  {picked.includes(c) ? '✓ ' : ''}
                  {c}
                </button>
              ))}
            </div>
            <div className="sheet-actions">
              <button type="button" className="btn ghost" onClick={() => setStep(1)}>
                Back
              </button>
              <button type="button" className="btn primary" disabled={!picked.length} onClick={() => void save()}>
                Save my top {picked.length || 3}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export function MonthReview({ v, onClose, onDone }: { v: LadderScreen; onClose: () => void; onDone: () => void }) {
  const act = useAction()
  const m = v.monthly!
  const [next, setNext] = useState<Record<string, string>>(() => Object.fromEntries(m.goals.map((g) => [g.id, g.next?.text ?? ''])))
  useEscape(onClose)
  const save = async () => {
    const api = life.saga!.ladder
    const ok = await act(async () => {
      for (const g of m.goals) {
        if (!g.next || next[g.id] === g.next.text) continue
        const all = (v.milestones[g.id as TemplateId] ?? []).map((x): LadderMilestone => (x.month === g.next!.month ? { ...x, text: next[g.id], value: null } : x))
        await api.confirmMilestones(g.id, all)
      }
      return api.finishMonth(m.month)
    }, 'Month reviewed')
    if (ok) {
      onDone()
      onClose()
    }
  }
  return (
    <div className="sheet ql-sheet" role="dialog" aria-modal="true" aria-label="Monthly review" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet-card ql-review">
        <header>
          <span className="ql-kicker">Monthly review · month {m.month}</span>
          <h3>Milestones</h3>
        </header>
        <ul className="ql-rev-goals">
          {m.goals.map((g) => (
            <li key={g.id} className={g.hit ? 'l-green' : g.hit === false ? 'l-yellow' : 'l-none'}>
              <b>
                {g.emoji} {g.title}
              </b>
              <small>
                {g.milestone.replace(/^Month \d+: /, '')}: {g.hit ? 'hit' : g.hit === false ? 'not yet: adjust next month if it was too much' : 'not judged yet'}
              </small>
              {g.next && (
                <label>
                  <span>Month {g.next.month}</span>
                  <input value={next[g.id] ?? ''} maxLength={120} onChange={(e) => setNext({ ...next, [g.id]: e.target.value })} />
                </label>
              )}
            </li>
          ))}
        </ul>
        <div className="sheet-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Later
          </button>
          <button type="button" className="btn primary" onClick={() => void save()}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
