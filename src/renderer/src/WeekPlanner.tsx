// The Sunday plan in about 15 minutes: look back (score, weakest area), pick
// ONE area to focus on, pick your 3 big tasks. The coach checks that focus
// all week; the big 3 sit on Today with ▶ focus buttons.
import { dayLabel } from '@core/dates'
import { useCallback, useEffect, useState } from 'react'
import type { MetricId, ProgressReport } from '@core/progress'
import type { TodoTask } from '@core/todoist'
import { activePlan, planWeek, shouldPlan, suggestFocus, type WeekPlan } from '@core/weekPlan'
import { life } from './bridge'
import { Icon } from './Icon'
import { soundSuccess } from './sound'
import { useAction } from './ui'

export function useWeekPlan(): [WeekPlan | null | undefined, () => void] {
  const [p, setP] = useState<WeekPlan | null | undefined>(undefined)
  const load = useCallback(() => {
    if (!life.weekPlan) return setP(null)
    life.weekPlan.saved().then(setP).catch(() => setP(null))
  }, [])
  useEffect(() => {
    load()
    window.addEventListener('life-week-changed', load)
    return () => window.removeEventListener('life-week-changed', load)
  }, [load])
  return [p, load]
}

const HINT: Record<MetricId, string> = {
  focus: 'e.g. two 50-minute blocks every weekday, before noon',
  wake: 'e.g. up at 07:00 every day, phone outside the bedroom',
  sport: 'e.g. 4 workouts: Mon, Wed, Fri, Sun',
  clean: 'e.g. same evening routine, no phone in bed',
  todoist: 'e.g. clear the late tasks first, 3 a day',
  mustdo: 'e.g. write 1–3 must-dos every morning at breakfast',
  spend: 'e.g. under 600 lei this week, cook at home'
}

export const LABEL: Record<MetricId, string> = { focus: 'Focus time', wake: 'On-time wake-ups', sport: 'Workouts', clean: 'Clean days', todoist: 'Todoist tasks done', mustdo: 'Must-dos done', spend: 'Spending' }


export function WeekPlanner({ report, plan, today, onDone }: { report: ProgressReport; plan: WeekPlan | null; today: string; onDone?: () => void }) {
  const act = useAction()
  const editing = activePlan(plan, today) ?? (plan && plan.week === planWeek(today) ? plan : null)
  const suggested = suggestFocus(report)
  const [focus, setFocus] = useState<MetricId>(editing?.focus ?? suggested?.id ?? 'focus')
  const [note, setNote] = useState(editing?.note ?? '')
  const [big, setBig] = useState<{ text: string; todoistId?: string | null; done?: boolean }[]>(() => {
    const b = editing?.big3 ?? []
    return [0, 1, 2].map((i) => b[i] ?? { text: '' })
  })
  const [todo, setTodo] = useState<TodoTask[]>([])
  useEffect(() => {
    life.todoist
      ?.today()
      .then((t) => setTodo(t.slice().sort((a, b) => b.priority - a.priority)))
      .catch(() => {})
  }, [])
  const week = editing?.week ?? planWeek(today)
  const used = new Set(big.map((b) => b.todoistId).filter(Boolean))
  const fill = (t: TodoTask) =>
    setBig((cur) => {
      const i = cur.findIndex((b) => !b.text.trim())
      if (i < 0) return cur
      const next = cur.slice()
      next[i] = { text: t.content, todoistId: t.id }
      return next
    })
  const save = async () => {
    const r = await act(() => life.weekPlan!.save({ week, focus, note, big3: big.map((b) => ({ text: b.text, done: !!b.done, todoistId: b.todoistId ?? null })) }), 'Week planned. The coach will check your focus all week.')
    if (r) {
      soundSuccess()
      onDone?.()
    }
  }
  const focusMetric = report.metrics.find((m) => m.id === focus)

  return (
    <section className="panel wp">
      <header className="wp-head">
        <h2>
          <Icon name="calendar" /> Plan your week · from {dayLabel(week)}
        </h2>
        <span className="hint">about 15 minutes</span>
      </header>

      <div className="wp-step">
        <span className="wp-n">1</span>
        <div>
          <h3>Look back</h3>
          <p>
            Week score <b>{report.score}</b> ({report.score >= report.prevScore ? '+' : ''}
            {report.score - report.prevScore} on the week before). {report.verdict}
          </p>
          {suggested && (
            <p className="hint">
              Furthest from a good week: <b>{suggested.label.toLowerCase()}</b> ({suggested.text}, goal {suggested.targetText}).
            </p>
          )}
        </div>
      </div>

      <div className="wp-step">
        <span className="wp-n">2</span>
        <div>
          <h3>One focus for the week</h3>
          <p className="hint">Only one. Everything else just keeps going.</p>
          <div className="wp-chips">
            {report.metrics.map((m) => (
              <button key={m.id} className={`wp-chip ${focus === m.id ? 'on' : ''}`} onClick={() => setFocus(m.id)}>
                {m.label}
                {suggested?.id === m.id && <em> · suggested</em>}
              </button>
            ))}
          </div>
          <input className="wp-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={`How, exactly? ${HINT[focus]}`} maxLength={140} />
          {focusMetric?.target && (
            <p className="hint">
              Now {focusMetric.text} · a good week is {focusMetric.targetText}.
            </p>
          )}
        </div>
      </div>

      <div className="wp-step">
        <span className="wp-n">3</span>
        <div>
          <h3>Your 3 big tasks</h3>
          <p className="hint">If only these get done, the week was a win. Block time for them in your calendar.</p>
          {big.map((b, i) => (
            <input
              key={i}
              className="wp-big"
              value={b.text}
              onChange={(e) => setBig((cur) => cur.map((x, k) => (k === i ? { text: e.target.value, todoistId: null } : x)))}
              placeholder={['e.g. Finish the etica course', 'e.g. Fix the lab report', 'e.g. Simplify the CV website'][i]}
              maxLength={140}
            />
          ))}
          {todo.filter((t) => !used.has(t.id)).length > 0 && (
            <div className="wp-chips">
              <span className="hint">From Todoist:</span>
              {todo
                .filter((t) => !used.has(t.id))
                .slice(0, 6)
                .map((t) => (
                  <button key={t.id} className="wp-chip" onClick={() => fill(t)} disabled={big.every((x) => x.text.trim())}>
                    + {t.content.slice(0, 40)}
                  </button>
                ))}
            </div>
          )}
        </div>
      </div>

      <div className="row wp-actions">
        <button className="btn primary" disabled={!big.some((b) => b.text.trim())} onClick={() => void save()}>
          <Icon name="check" size={14} /> Save my week
        </button>
        {onDone && editing && (
          <button className="btn ghost" onClick={onDone}>
            Cancel
          </button>
        )}
      </div>
    </section>
  )
}

/** The plan in force: the focus and the big 3 with ticks (Progress page and Today). */
export function WeekCard({ plan, report, compact, onEdit, onFocus }: { plan: WeekPlan; report?: ProgressReport | null; compact?: boolean; onEdit?: () => void; onFocus?: (text: string) => void }) {
  const act = useAction()
  const m = report?.metrics.find((x) => x.id === plan.focus)
  const done = plan.big3.filter((b) => b.done).length
  const toggle = async (i: number) => {
    if (await act(() => life.weekPlan!.toggle(i))) soundSuccess()
  }
  return (
    <section className={`panel wk-card ${compact ? 'compact' : ''}`}>
      <header className="wk-head">
        <h3>
          <Icon name="calendar" size={16} /> This week
        </h3>
        <span className="hint">
          {done}/{plan.big3.length} big tasks
          {onEdit && (
            <button className="btn small ghost" onClick={onEdit}>
              Edit
            </button>
          )}
        </span>
      </header>
      <p className="wk-focus">
        Focus: <b>{m?.label ?? LABEL[plan.focus] ?? plan.focus}</b>
        {plan.note ? ` · ${plan.note}` : ''}
        {m?.target ? <span className="hint"> · now {m.text} of {m.targetText}</span> : null}
      </p>
      <ul className="dl">
        {plan.big3.map((b, i) => (
          <li key={i} className={b.done ? 'done' : ''}>
            <button className="dl-check" aria-label={b.done ? `Untick ${b.text}` : `Tick ${b.text}`} onClick={() => void toggle(i)}>
              {b.done ? '✓' : ''}
            </button>
            <span className="dl-text">{b.text}</span>
            {!b.done && onFocus && (
              <button className="dl-play" aria-label={`Focus 50 minutes on ${b.text}`} title="Focus 50 min on this" onClick={() => onFocus(b.text)}>
                ▶
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

export { shouldPlan }
