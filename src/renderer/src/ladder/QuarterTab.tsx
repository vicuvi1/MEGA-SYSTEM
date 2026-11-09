// Goals → This quarter: the goal ladder. Up to 3 critical goals for the
// 12-week quarter (the Season), each with this month's milestone, this week's
// actions and a traffic light (from actions, never results), one plain fix
// when behind, the week's steps placed as drafts, and a 12-week strip.
// Below: the Sunday and monthly reviews when due, and "Not now" (one tap to swap).
import { useState } from 'react'
import { life } from '../bridge'
import { useAction } from '../ui'
import { METRICS, MAX_ACTIVE, templateOf, type LadderCard, type LadderMilestone, type Light, type TemplateId } from '@core/goalLadder'
import { dayLabel } from '@core/planDeadlines'
import { useLadder } from './useLadder'
import { MonthReview, SundayReview } from './Reviews'
import type { LadderScreen } from '../web/ladderApi'
import './ladder.css'

export const LIGHT_WORD: Record<Light, string> = { green: 'On track', yellow: 'Close', red: 'Needs a step', none: 'New week' }

export function QuarterTab({ onSeason }: { onSeason?: () => void }) {
  const { v, reload, error } = useLadder()
  const [review, setReview] = useState<'week' | 'month' | null>(null)
  if (error) return <p className="hint">{error}</p>
  if (!v) return <p className="hint">Loading your quarter…</p>
  const q = v.quarter
  const lastWeek = q.week >= q.weeks
  return (
    <div className="ql">
      <header className="ql-head">
        <div>
          <span className="ql-kicker">{q.season ? `Season: ${q.season}` : 'Your quarter'}</span>
          <h3>
            Week {Math.max(1, q.week)} of {q.weeks} · month {Math.max(1, q.month)} of {q.months}
          </h3>
          <small>Up to {MAX_ACTIVE} critical goals. Scored on what you do, not on the scale or the result.</small>
        </div>
        <div className="ql-head-act">
          <button type="button" className={`btn small${v.weeklyDue ? ' primary' : ' ghost'}`} onClick={() => setReview('week')}>
            {v.weeklyDue ? 'Sunday review (3 min)' : 'Week review'}
          </button>
          {v.monthly && !v.monthly.done && (
            <button type="button" className="btn small primary" onClick={() => setReview('month')}>
              Month {v.monthly.month} review (5 min)
            </button>
          )}
        </div>
      </header>
      {lastWeek && (
        <section className="ql-recap" aria-label="Quarter recap">
          <b>Last week of the quarter.</b> See the Season recap, rate your life wheel, then choose the next {MAX_ACTIVE} critical goals below.
          {onSeason && (
            <button type="button" className="btn small" onClick={onSeason}>
              Open the Season recap
            </button>
          )}
        </section>
      )}
      {v.cards.length === 0 && <p className="hint">No critical goals right now. Pick up to {MAX_ACTIVE} from "Not now" below.</p>}
      <div className="ql-cards">
        {v.cards.map((c) => (
          <QuarterCard key={c.goal.id} c={c} v={v} onChanged={reload} />
        ))}
      </div>
      <NotNow v={v} onChanged={reload} />
      {review === 'week' && <SundayReview v={v} onClose={() => setReview(null)} onDone={reload} />}
      {review === 'month' && v.monthly && <MonthReview v={v} onClose={() => setReview(null)} onDone={reload} />}
    </div>
  )
}

function Strip({ c }: { c: LadderCard }) {
  return (
    <ol className="ql-strip" aria-label={`${c.goal.title}: 12-week progress`}>
      {c.timeline.map((w) => (
        <li key={w.week} className={`l-${w.light}`} title={`Week ${w.week}: ${w.light === 'future' ? 'to come' : LIGHT_WORD[w.light]}`} aria-label={`Week ${w.week}: ${w.light === 'future' ? 'to come' : LIGHT_WORD[w.light]}`} />
      ))}
    </ol>
  )
}

function QuarterCard({ c, v, onChanged }: { c: LadderCard; v: LadderScreen; onChanged: () => void }) {
  const act = useAction()
  const [editMs, setEditMs] = useState(false)
  const api = life.saga!.ladder
  const steps = stepsFor(c.goal.id, v)
  return (
    <article className={`ql-card l-${c.week.light}`} data-goal={c.goal.id}>
      <header>
        <span className="ql-emoji" aria-hidden>
          {c.emoji}
        </span>
        <h4>{c.goal.title}</h4>
        <span className={`ql-light l-${c.week.light}`} role="status">
          <i aria-hidden />
          {LIGHT_WORD[c.week.light]}
        </span>
      </header>
      <p className="ql-ms">
        <span className="ql-kicker">This month</span> {c.milestone ? c.milestone.text.replace(/^Month \d+: /, '') : 'No milestone yet'}
        {c.suggested && <em className="ql-sug"> suggested</em>}
        <button type="button" className="btn ghost small" onClick={() => setEditMs((x) => !x)}>
          {c.suggested ? 'Confirm' : 'Edit'}
        </button>
      </p>
      {editMs && (
        <MilestoneEdit
          ms={v.milestones[c.goal.id] ?? []}
          onSave={async (ms) => {
            if (await act(() => api.confirmMilestones(c.goal.id, ms), 'Milestones saved')) {
              setEditMs(false)
              onChanged()
            }
          }}
        />
      )}
      <ul className="ql-acts" aria-label="This week">
        {c.week.actions.map((a) => (
          <li key={a.metric} className={a.ratio == null ? 'off' : a.ratio >= 0.8 ? 'ok' : a.ratio >= 0.5 ? 'mid' : 'low'}>
            {a.text}
          </li>
        ))}
      </ul>
      {c.fix && <p className="ql-fix">Next step: {c.fix}</p>}
      <p className="ql-result">
        <span className="ql-kicker">Result</span> {c.result.line}
      </p>
      {steps && <p className="ql-steps">{steps}</p>}
      <Strip c={c} />
      <details className="ql-more">
        <summary>Targets</summary>
        <Targets c={c} onChanged={onChanged} />
      </details>
    </article>
  )
}

/** The week's steps the planner places (drafts): workouts on your split, study sessions in your room. */
function stepsFor(id: TemplateId, v: LadderScreen): string | null {
  const short = (d: string) => dayLabel(d).split(' ')[0].slice(0, 3)
  if ((id === 'gain' || id === 'strong') && v.steps.workouts.length && v.cards.find((c) => c.goal.id === 'gain' || c.goal.id === 'strong')?.goal.id === id)
    return `Planned (drafts): ${v.steps.workouts.map((w) => `${short(w.day)} ${w.type === 'upper' ? 'upper' : 'legs'}`).join(' · ')}`
  if (id === 'study' && v.steps.study?.sessions.length) return `Planned (drafts): ${v.steps.study.sessions.map((s) => `${short(s.day)} ${s.minutes} min`).join(' · ')}`
  return null
}

function MilestoneEdit({ ms, onSave }: { ms: LadderMilestone[]; onSave: (ms: LadderMilestone[]) => void }) {
  const [rows, setRows] = useState(ms.map((m) => ({ ...m })))
  return (
    <form
      className="ql-msedit"
      onSubmit={(e) => {
        e.preventDefault()
        onSave(rows)
      }}
    >
      <small>Worked backward from the quarter's target. Change any line, then confirm.</small>
      {rows.map((m, i) => (
        <label key={m.month}>
          <span>Month {m.month}</span>
          <input value={m.text} maxLength={120} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, text: e.target.value } : r)))} />
        </label>
      ))}
      <button type="submit" className="btn primary small">
        Confirm milestones
      </button>
    </form>
  )
}

function Targets({ c, onChanged }: { c: LadderCard; onChanged: () => void }) {
  const act = useAction()
  const api = life.saga!.ladder
  const t = templateOf(c.goal.id)
  const resultWord = t.result === 'weight' ? 'kg to gain this quarter' : t.result === 'moneyMonth' ? 'to save each month' : null
  return (
    <div className="ql-targets">
      {c.week.actions.map((a) => (
        <label key={a.metric}>
          <span>{METRICS[a.metric].short} a week</span>
          <input
            type="number"
            min={0}
            step={METRICS[a.metric].hours ? 0.5 : 1}
            defaultValue={a.target ?? ''}
            disabled={a.metric === 'moneySaved'}
            onBlur={async (e) => {
              const n = Number(e.target.value)
              if (e.target.value !== '' && n !== a.target && (await act(() => api.setTarget(c.goal.id, a.metric, n), 'Target saved'))) onChanged()
            }}
          />
        </label>
      ))}
      {resultWord && (
        <label>
          <span>{resultWord}</span>
          <input
            type="number"
            step={t.result === 'weight' ? 0.5 : 50}
            defaultValue={c.goal.resultTarget ?? t.resultTarget ?? ''}
            onBlur={async (e) => {
              const n = e.target.value === '' ? null : Number(e.target.value)
              if (n !== (c.goal.resultTarget ?? t.resultTarget) && (await act(() => api.setResultTarget(c.goal.id, n), 'Target saved'))) onChanged()
            }}
          />
        </label>
      )}
      <button
        type="button"
        className="btn ghost small"
        onClick={async () => {
          if (await act(() => api.park(c.goal.id), `${c.goal.title}: moved to "Not now"`)) onChanged()
        }}
      >
        Move to "Not now"
      </button>
    </div>
  )
}

function NotNow({ v, onChanged }: { v: LadderScreen; onChanged: () => void }) {
  const act = useAction()
  const [swapFor, setSwapFor] = useState<TemplateId | null>(null)
  const api = life.saga!.ladder
  const off = v.ladder.goals.filter((g) => !g.on)
  const on = v.ladder.goals.filter((g) => g.on)
  if (!off.length) return null
  return (
    <details className="ql-notnow" open={on.length < MAX_ACTIVE}>
      <summary>
        Not now <small>{off.length} ready when you are</small>
      </summary>
      <ul>
        {off.map((g) => (
          <li key={g.id}>
            <span aria-hidden>{templateOf(g.id).emoji}</span>
            <b>{g.title}</b>
            <small>{templateOf(g.id).actions.map((a) => METRICS[a.metric].short).join(', ')}</small>
            {on.length < MAX_ACTIVE ? (
              <button type="button" className="btn small" onClick={async () => (await act(() => api.activate(g.id), `${g.title}: now a critical goal`)) !== undefined && onChanged()}>
                Make critical
              </button>
            ) : swapFor === g.id ? (
              <span className="ql-swap" role="group" aria-label={`Swap ${g.title} in for`}>
                {on.map((x) => (
                  <button
                    key={x.id}
                    type="button"
                    className="btn small"
                    onClick={async () => {
                      if ((await act(() => api.swap(x.id, g.id), `${g.title} in, ${x.title} on "Not now"`)) !== undefined) {
                        setSwapFor(null)
                        onChanged()
                      }
                    }}
                  >
                    Instead of {templateOf(x.id).emoji} {x.title}
                  </button>
                ))}
              </span>
            ) : (
              <button type="button" className="btn small ghost" onClick={() => setSwapFor(g.id)}>
                Swap in
              </button>
            )}
          </li>
        ))}
      </ul>
    </details>
  )
}
