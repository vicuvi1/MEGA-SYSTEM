// Today's core, in the calm style: the "Now" card (one next step, one button)
// and one daily list (must-dos, habits and Todoist together).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { nowActions, type NowAction } from '@core/nextAction'
import { deadlineRadar, pLabel, sortToday, whenText, type TodoTask } from '@core/todoist'
import type { BodyState, ConnectionsState, DisciplineState, FocusTask, Rule, Summary } from '@shared/api'
import { life } from './bridge'
import { Icon } from './Icon'
import type { PageId } from './modules'
import { useFocus } from './pages/Focus'
import { WeekCard, useWeekPlan } from './WeekPlanner'
import { activePlan } from '@core/weekPlan'
import { soundCoin, soundSuccess } from './sound'
import { useAction } from './ui'

interface Props {
  summary: Summary
  discipline: DisciplineState | null
  connections: ConnectionsState | null
  body: BodyState | null
  onChange: (s?: Summary) => void
  onGo: (p: PageId) => void
  onOpenApp: (p: PageId) => void
  /** The point rules, so each habit shows what it really pays. */
  rules?: Rule[]
}

interface Habit {
  id: string
  label: string
  hint: string
  done: boolean
  run: () => void | Promise<void>
}

/** A short subject for the focus stats: the first words of a must-do. */
const subjectOf = (text: string) => text.split(/\s+/).slice(0, 3).join(' ').slice(0, 40)
/** A Todoist task's area (its section or project, without the emoji), else its first words. */
const todoSubject = (t: TodoTask) => {
  const area = (t.section || (t.project !== 'Inbox' ? t.project : '') || '').replace(/[^\p{L}\p{N}&\s-]/gu, '').trim()
  return area || subjectOf(t.content)
}

/** Today's Todoist list shows this many first (late and P1 on top). */
const TODO_SHOWN = 5

function useTodoist() {
  const [tasks, setTasks] = useState<TodoTask[] | null>(null)
  const load = useCallback(async () => {
    if (!life.todoist || !(await life.todoist.status()).connected) return setTasks(null)
    setTasks(await life.todoist.today().catch(() => []))
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  return [tasks, load, setTasks] as const
}

function useHabits({ summary, discipline, connections, body, onChange, onGo, onOpenApp, rules }: Props, focusMin: number): Habit[] {
  const act = useAction()
  const r = summary.todayRules ?? []
  const pts = (id: string, fallback: number) => `+${rules?.find((x) => x.id === id)?.coins ?? fallback}`
  const done = async (p: Promise<unknown> | undefined) => {
    if (await p) {
      soundSuccess()
      onChange()
    }
  }
  return [
    { id: 'oath', label: 'Morning oath', hint: pts('discipline.oath', 1), done: !!(discipline?.oathToday || r.includes('discipline.oath')), run: () => done(act(() => life.discipline.oath(), 'Oath taken')) },
    { id: 'clean', label: 'Clean day check-in', hint: discipline?.setup ? `day ${discipline.current} · ${pts('discipline.clean_day', 3)}` : pts('discipline.clean_day', 3), done: !!(discipline?.checkedInToday || r.includes('discipline.clean_day')), run: () => done(act(() => life.discipline.checkIn(), 'Checked in')) },
    { id: 'workout', label: 'Workout', hint: pts('body.workout_done', 3), done: !!(body?.workoutDoneToday || r.includes('body.workout_done')), run: () => onGo('body') },
    { id: 'focus', label: '50 minutes of focus', hint: focusMin ? `${focusMin} min so far` : 'points per session', done: focusMin >= 50 || r.includes('study.block_done'), run: () => onGo('focus') },
    { id: 'skincare', label: 'Skincare', hint: pts('face.routine_done', 2), done: r.includes('face.routine_done'), run: () => done(act(() => life.wallet.award('face.routine_done'), 'Skincare done')) },
    { id: 'spending', label: "Log today's spending", hint: pts('money.logged', 1), done: !!(connections?.finance.today?.logged || r.includes('money.logged')), run: () => onOpenApp('money') }
  ]
}

export function DayFlow(props: Props) {
  const { summary, connections, onChange, onGo } = props
  const act = useAction()
  const [st, loadFocus] = useFocus()
  const [todo, loadTodo, setTodo] = useTodoist()
  const [showAllTodo, setShowAllTodo] = useState(false)
  const [weekPlan] = useWeekPlan()
  // Deadline radar: important Todoist tasks due in the next 3 days.
  const [upcoming, setUpcoming] = useState<TodoTask[]>([])
  useEffect(() => {
    life.todoist?.upcoming?.().then(setUpcoming).catch(() => {})
  }, [])
  const radar = deadlineRadar(upcoming, summary.today)
  const habits = useHabits(props, st?.todayMin ?? 0)
  const [skipped, setSkipped] = useState<string[]>([])
  const [adding, setAdding] = useState('')
  const today = summary.today

  const actions = useMemo(() => {
    if (!st) return []
    return nowActions({
      hour: new Date().getHours(),
      running: st.running,
      wakeLogged: !!connections?.waky.today?.time,
      plan: st.plan.items,
      reviewDone: !!st.plan.review || st.plan.reasons.length > 0,
      goalsBehind: st.goals.filter((g) => g.aheadH < 0),
      todo: todo ?? [],
      habits,
      today
    })
  }, [st, todo, habits, connections, today])
  const key = (a: NowAction) => `${a.kind}:${a.title}`
  const now = actions.find((a) => !skipped.includes(key(a))) ?? actions[0]

  const refresh = () => {
    loadFocus()
    void loadTodo()
    onChange()
  }

  const tickMustDo = async (i: number) => {
    const r = await act(() => life.focus.togglePlan(i))
    if (!r) return
    r.coins ? soundCoin() : soundSuccess()
    refresh()
  }
  const doneTodo = async (t: TodoTask) => {
    setTodo((cur) => (cur ?? []).filter((x) => x.id !== t.id))
    const r = await act(() => life.todoist!.complete(t), 'Done in Todoist')
    if (r?.paid) soundCoin()
    refresh()
  }
  const startFocus = async (subject: string, task: FocusTask | null = null) => {
    if (await act(() => life.focus.start(subject, 50, task), `Focus started: ${task?.title ?? subject}`)) loadFocus()
  }
  // A session for a must-do or a Todoist task ended: ask whether it's done.
  const [ended, setEnded] = useState<{ task: FocusTask; minutes: number } | null>(null)
  useEffect(() => {
    const on = (e: Event) => setEnded((e as CustomEvent).detail)
    window.addEventListener('life-focus-ended', on)
    return () => window.removeEventListener('life-focus-ended', on)
  }, [])
  const finishEnded = async () => {
    if (!ended || !st) return
    const { task } = ended
    setEnded(null)
    if (task.kind === 'mustdo') {
      const i = st.plan.items.findIndex((p) => !p.done && p.text === task.ref)
      if (i >= 0) await tickMustDo(i)
    } else if (life.todoist) {
      await doneTodo({ id: task.ref, content: task.title, priority: 1, due: null, dueTime: null, project: null, recurring: false })
    }
  }
  const addMustDo = async () => {
    const text = adding.trim()
    if (!text || !st) return
    if (await act(() => life.focus.setPlan([...st.plan.items.map((i) => i.text), text]))) {
      setAdding('')
      loadFocus()
    }
  }

  async function runNow(a: NowAction) {
    switch (a.kind) {
      case 'stop-focus': {
        const r = await act(() => life.focus.stop())
        if (r) {
          r.coins ? soundCoin() : soundSuccess()
          refresh()
        }
        return
      }
      case 'log-wake': {
        const r = await act(() => life.sleep.logWake(), 'Wake-up logged')
        if (r) {
          r.awarded ? soundCoin() : soundSuccess()
          refresh()
        }
        return
      }
      case 'plan':
        document.querySelector<HTMLInputElement>('.dl-add input')?.focus()
        return
      case 'review':
        return onGo('focus')
      case 'mustdo':
        return startFocus(a.subject, { kind: 'mustdo', ref: a.title, title: a.title })
      case 'focus-goal':
        return startFocus(a.subject)
      case 'todo': {
        const t = todo?.find((x) => x.id === a.id)
        if (t) await doneTodo(t)
        return
      }
      case 'habit':
        return habits.find((h) => h.id === a.id)?.run()
      default:
        return onGo('focus')
    }
  }
  const BUTTON: Record<NowAction['kind'], string> = {
    'stop-focus': 'Stop & log',
    'log-wake': "I'm up",
    plan: 'Write my must-dos',
    review: 'Review my day',
    mustdo: 'Start 50 min focus',
    'focus-goal': 'Start 50 min focus',
    todo: 'Mark done',
    habit: 'Do it now',
    done: 'Open Focus'
  }

  if (!st) return null
  const plan = st.plan.items
  const todoList = todo ? sortToday(todo, today) : null
  const doneCount = plan.filter((p) => p.done).length + habits.filter((h) => h.done).length
  const total = plan.length + habits.length + (todoList?.length ?? 0)

  return (
    <>
      {ended && (
        <section className="now-card ended" aria-label="Session finished">
          <span className="now-label">Session done · {ended.minutes} min</span>
          <h2>Finished “{ended.task.title}”?</h2>
          <div className="row">
            <button className="btn primary" onClick={() => void finishEnded()}>
              <Icon name="check" size={13} /> Yes, tick it{ended.task.kind === 'todoist' ? ' in Todoist' : ''}
            </button>
            <button className="btn ghost" onClick={() => setEnded(null)}>
              Not yet
            </button>
          </div>
        </section>
      )}
      {now && !ended && (
        <section className="now-card" aria-label="What to do now">
          <span className="now-label">Now</span>
          <h2>{now.title}</h2>
          <p>{now.detail}</p>
          <div className="row">
            <button className="btn primary now-go" onClick={() => void runNow(now)}>
              {BUTTON[now.kind]}
            </button>
            {now.kind === 'mustdo' && (
              <button className="btn ghost" onClick={() => void tickMustDo(now.index)}>
                <Icon name="check" size={13} /> It's done
              </button>
            )}
            {actions.length > 1 && now.kind !== 'stop-focus' && (
              <button className="btn ghost" onClick={() => setSkipped((s) => [...s, key(now)])}>
                Skip
              </button>
            )}
          </div>
        </section>
      )}

      <section className="panel day-list" aria-label="Today's list">
        <header className="panel-head">
          <h2>Today</h2>
          <span className="hint">
            {doneCount}/{total} done
          </span>
        </header>

        <h3 className="dl-head">Must-dos</h3>
        <ul className="dl">
          {plan.map((p, i) => (
            <li key={`m${i}`} className={p.done ? 'done' : ''}>
              <button className="dl-check" aria-label={p.done ? `Untick ${p.text}` : `Tick ${p.text}`} onClick={() => void tickMustDo(i)}>
                {p.done ? '✓' : ''}
              </button>
              <span className="dl-text">{p.text}</span>
              {!p.done && !st.running && (
                <button className="dl-play" aria-label={`Focus 50 minutes on ${p.text}`} title="Focus 50 min on this" onClick={() => void startFocus(subjectOf(p.text), { kind: 'mustdo', ref: p.text, title: p.text })}>
                  ▶
                </button>
              )}
              <span className="dl-hint">+10</span>
            </li>
          ))}
        </ul>
        {plan.length < 5 && (
          <form
            className="dl-add"
            onSubmit={(e) => {
              e.preventDefault()
              void addMustDo()
            }}
          >
            <input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder={plan.length ? 'Add another must-do…' : 'What are your 1–3 must-dos today?'} maxLength={140} />
            {adding.trim() && <button className="btn small">Add</button>}
          </form>
        )}

        <h3 className="dl-head">Habits</h3>
        <ul className="dl">
          {habits.map((h) => (
            <li key={h.id} className={h.done ? 'done' : ''}>
              <button className="dl-check" aria-label={h.done ? `${h.label}: done` : h.label} disabled={h.done} onClick={() => void h.run()}>
                {h.done ? '✓' : ''}
              </button>
              <span className="dl-text">{h.label}</span>
              <span className="dl-hint">{h.hint}</span>
            </li>
          ))}
        </ul>

        {todoList && (
          <>
            <h3 className="dl-head">Todoist</h3>
            {radar.length > 0 && (
              <div className="radar" aria-label="Deadlines coming up">
                {radar.slice(0, 3).map((x) => (
                  <div key={x.task.id} className={`radar-item ${x.daysLeft === 1 ? 'soon' : ''}`}>
                    <span className="radar-when">⏳ {whenText(x.daysLeft, x.date)}</span>
                    <span className="radar-title">{x.task.content}</span>
                    {!st.running && (
                      <button className="dl-play" aria-label={`Focus 50 minutes on ${x.task.content}`} title="Get ahead: focus 50 min on this" onClick={() => void startFocus(todoSubject(x.task), { kind: 'todoist', ref: x.task.id, title: x.task.content })}>
                        ▶
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {todoList.length === 0 && <p className="hint">Nothing due in Todoist today.</p>}
            <ul className="dl">
              {(showAllTodo ? todoList : todoList.slice(0, TODO_SHOWN)).map((t) => (
                <li key={t.id}>
                  <button className="dl-check" aria-label={`Complete ${t.content}`} onClick={() => void doneTodo(t)} />
                  <span className="dl-text">
                    {t.content}
                    {t.due && t.due < today && <em className="dl-late"> late</em>}
                  </span>
                  {!st.running && (
                    <button className="dl-play" aria-label={`Focus 50 minutes on ${t.content}`} title="Focus 50 min on this" onClick={() => void startFocus(todoSubject(t), { kind: 'todoist', ref: t.id, title: t.content })}>
                      ▶
                    </button>
                  )}
                  <span className="dl-hint">
                    {t.section ? `${t.section} · ` : t.project && t.project !== 'Inbox' ? `${t.project} · ` : ''}
                    {t.dueTime ?? ''}
                    {t.priority > 1 ? ` ${pLabel(t.priority)}` : ''}
                  </span>
                </li>
              ))}
            </ul>
            {todoList.length > TODO_SHOWN && (
              <button className="btn ghost dl-more" onClick={() => setShowAllTodo(!showAllTodo)}>
                {showAllTodo ? 'Show fewer' : `Show all ${todoList.length} (the most urgent are on top)`}
              </button>
            )}
          </>
        )}
      </section>
      {weekPlan && activePlan(weekPlan, today) && <WeekCard plan={activePlan(weekPlan, today)!} compact onFocus={(text) => void startFocus(subjectOf(text))} />}
    </>
  )
}
