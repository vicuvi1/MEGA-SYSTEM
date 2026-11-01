// Today's core: the morning plan / evening shut-down cards, the "Now" card
// (one next step, a live timer while focusing), habit chips, and one list:
// must-dos, the week's big 3 and today's Todoist, grouped by area.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { nowActions, type NowAction } from '@core/nextAction'
import { areaKey, deadlineRadar, defaultAreaColor, pLabel, sortToday, whenText, type TodoTask } from '@core/todoist'
import type { BodyState, ConnectionsState, DisciplineState, FocusTask, Rule, Summary } from '@shared/api'
import { life } from './bridge'
import { Icon } from './Icon'
import type { PageId } from './modules'
import { useFocus } from './pages/Focus'
import { LABEL as WEEK_LABEL, useWeekPlan } from './WeekPlanner'
import { useTicker } from './useTicker'
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

/** Ask "Your day" to suggest blocks in your free time (DayTimeline listens). */
export const planDayInCalendar = () => window.dispatchEvent(new Event('life-plan-day'))

const pad = (n: number) => String(n).padStart(2, '0')
const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${pad(s % 60)}`
}
const tomorrowOf = (day: string) => {
  const d = new Date(`${day}T12:00:00`)
  d.setDate(d.getDate() + 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const storeGet = (k: string) => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const storeSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v)
  } catch {
    // private window: the mode just shows again
  }
}

type Mode = 'morning' | 'evening' | null
/** Morning until noon while today has no must-dos; evening from 20:00 until the review is written. */
export function autoMode(hour: number, hasPlan: boolean, reviewed: boolean, closed: string | null, today: string): Mode {
  if (closed === today) return null
  if (hour >= 5 && hour < 12 && !hasPlan) return 'morning'
  if (hour >= 20 && !reviewed) return 'evening'
  return null
}

interface Group {
  key: string
  name: string
  color: string
  items: TodoTask[]
}

export function DayFlow(props: Props) {
  const { summary, connections, onChange, onGo } = props
  const act = useAction()
  const [st, loadFocus] = useFocus()
  const [todo, loadTodo, setTodo] = useTodoist()
  const [weekPlan, loadWeek] = useWeekPlan()
  const [colors, setColors] = useState<Record<string, string>>({})
  const [upcoming, setUpcoming] = useState<TodoTask[]>([])
  useEffect(() => {
    life.todoist?.upcoming?.().then(setUpcoming).catch(() => {})
    life.todoist?.colors?.().then(setColors).catch(() => {})
  }, [])
  const today = summary.today
  const radar = deadlineRadar(upcoming, today)
  const habits = useHabits(props, st?.todayMin ?? 0)
  const [skipped, setSkipped] = useState<string[]>([])
  const [adding, setAdding] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [closed, setClosed] = useState(() => storeGet('ls.modeClosed'))
  const [forced, setForced] = useState<Mode | undefined>(undefined)
  const tick = useTicker(!!st?.running)

  const week = weekPlan ? activePlan(weekPlan, today) : null
  const reviewed = !!st && (!!st.plan.review || st.plan.reasons.length > 0)
  const mode: Mode = forced !== undefined ? forced : st ? autoMode(new Date().getHours(), st.plan.items.length > 0, reviewed, closed, today) : null
  const closeMode = () => {
    storeSet('ls.modeClosed', today)
    setClosed(today)
    setForced(null)
  }

  const actions = useMemo(() => {
    if (!st) return []
    return nowActions({
      hour: new Date().getHours(),
      running: st.running,
      wakeLogged: !!connections?.waky.today?.time,
      plan: st.plan.items,
      reviewDone: reviewed,
      goalsBehind: st.goals.filter((g) => g.aheadH < 0),
      todo: todo ?? [],
      habits,
      today
    })
  }, [st, todo, habits, connections, today, reviewed])
  const key = (a: NowAction) => `${a.kind}:${a.title}`
  // The morning/evening card already covers planning and the review.
  const hiddenKinds = mode === 'morning' ? ['plan', 'log-wake'] : mode === 'evening' ? ['review'] : []
  const shown = actions.filter((a) => !hiddenKinds.includes(a.kind))
  const now = shown.find((a) => !skipped.includes(key(a))) ?? shown[0]

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
  const toggleBig = async (i: number) => {
    if (await act(() => life.weekPlan!.toggle(i))) {
      soundSuccess()
      loadWeek()
      onChange()
    }
  }
  const startFocus = async (subject: string, task: FocusTask | null = null) => {
    if (await act(() => life.focus.start(subject, 50, task), `Focus started: ${task?.title ?? subject}`)) loadFocus()
  }
  const addMustDo = async (text = adding) => {
    const t = text.trim()
    if (!t || !st || st.plan.items.some((p) => p.text.toLowerCase() === t.toLowerCase())) return
    if (await act(() => life.focus.setPlan([...st.plan.items.map((i) => i.text), t]))) {
      setAdding('')
      loadFocus()
    }
  }
  const toTomorrow = async (t: TodoTask) => {
    setTodo((cur) => (cur ?? []).filter((x) => x.id !== t.id))
    await act(() => life.todoist!.update!(t.id, { due: tomorrowOf(today) }).then(() => true), `Moved to tomorrow: ${t.content}`)
  }
  const mustDoToTomorrow = async (text: string) => {
    if (!life.todoist) return
    await act(() => life.todoist!.quickAdd(`${text} tomorrow`).then(() => true), `In Todoist for tomorrow: ${text}`)
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
        return setForced('morning')
      case 'review':
        return setForced('evening')
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
    plan: 'Plan my day',
    review: 'Shut down my day',
    mustdo: 'Start 50 min focus',
    'focus-goal': 'Start 50 min focus',
    todo: 'Mark done',
    habit: 'Do it now',
    done: 'Open Focus'
  }

  const todoList = useMemo(() => (todo ? sortToday(todo, today) : null), [todo, today])
  // Today's Todoist, grouped by area (its section, else its project), urgent groups first.
  const groups: Group[] = useMemo(() => {
    const out: Group[] = []
    for (const t of todoList ?? []) {
      const k = areaKey(t)
      const name = t.section || (t.project && t.project !== 'Inbox' ? t.project : 'Inbox')
      let g = out.find((x) => x.key === k)
      if (!g) out.push((g = { key: k, name, color: colors[k] ?? defaultAreaColor({ name }), items: [] }))
      g.items.push(t)
    }
    return out
  }, [todoList, colors])

  if (!st) return null
  const plan = st.plan.items
  const bigOpen = week?.big3.map((b, i) => ({ ...b, i })).filter((b) => b.text) ?? []
  const doneCount = plan.filter((p) => p.done).length + bigOpen.filter((b) => b.done).length
  const total = plan.length + bigOpen.length + (todoList?.length ?? 0)
  const running = st.running
  const elapsed = running ? tick - new Date(running.startedAt).getTime() : 0
  const leftMs = running ? running.planned * 60000 - elapsed : 0
  const playBtn = (label: string, subject: string, task: FocusTask | null) =>
    !running && (
      <button className="dl-play" aria-label={`Focus 50 minutes on ${label}`} title="Focus 50 min on this" onClick={() => void startFocus(subject, task)}>
        ▶
      </button>
    )

  // Morning suggestions: late and important Todoist tasks, then the week's big 3.
  const suggestions = [
    ...(todoList ?? []).filter((t) => (t.due && t.due < today) || t.priority >= 3).map((t) => t.content),
    ...bigOpen.filter((b) => !b.done).map((b) => b.text),
    ...radar.map((r) => r.task.content)
  ]
    .filter((x, i, all) => all.indexOf(x) === i && !plan.some((p) => p.text === x))
    .slice(0, 6)
  const openLeft = [...plan.map((p, i) => ({ p, i })).filter((x) => !x.p.done)]
  const doneToday = plan.filter((p) => p.done).length

  // Today's Todoist shows this many first (late and P1 on top).
  let shown_ = 0
  const LIMIT = 8

  return (
    <div className="cmd-day">
      {mode === 'morning' && (
        <section className="mode-card morning" aria-label="Plan your day">
          <header>
            <span className="mode-label">
              <Icon name="sun" size={14} /> Morning · plan in 2 minutes
            </span>
            <button className="btn small ghost" onClick={closeMode}>
              Later
            </button>
          </header>
          <ol className="mode-steps">
            <li className={connections?.waky.today?.time ? 'done' : ''}>
              <b>1. You're up</b>
              {connections?.waky.today?.time ? (
                <span className="hint">Logged at {connections.waky.today.time}</span>
              ) : (
                <button className="btn small" onClick={() => void runNow({ kind: 'log-wake', title: '', detail: '' })}>
                  I'm up
                </button>
              )}
            </li>
            <li className={plan.length ? 'done' : ''}>
              <b>2. Your 1–3 must-dos</b>
              <span className="hint">What makes today a win? Tap a suggestion or type one.</span>
              {suggestions.length > 0 && (
                <div className="chips">
                  {suggestions.map((s) => (
                    <button key={s} type="button" className="chip" onClick={() => void addMustDo(s)} title="Make it a must-do">
                      ＋ {s.length > 48 ? `${s.slice(0, 46)}…` : s}
                    </button>
                  ))}
                </div>
              )}
              {plan.length > 0 && (
                <div className="chips">
                  {plan.map((p) => (
                    <span key={p.text} className="chip on">
                      ★ {p.text}
                    </span>
                  ))}
                </div>
              )}
              {plan.length < 5 && (
                <form
                  className="dl-add"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void addMustDo()
                  }}
                >
                  <input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Type a must-do and press Enter" maxLength={140} />
                </form>
              )}
            </li>
            <li>
              <b>3. Put them in your calendar</b>
              <span className="hint">Blocks in your free time; you approve them.</span>
              <button className="btn small" disabled={!plan.length} onClick={planDayInCalendar}>
                <Icon name="calendar" size={13} /> Plan my day
              </button>
            </li>
          </ol>
          <div className="row">
            <button className="btn primary" disabled={!plan.length} onClick={closeMode}>
              <Icon name="check" size={13} /> Start my day
            </button>
          </div>
        </section>
      )}

      {mode === 'evening' && <ShutDown today={today} focusMin={st.todayMin} doneToday={doneToday} planLen={plan.length} todoDone={0} openMustDos={openLeft.map((x) => x.p.text)} openTodo={(todoList ?? []).filter((t) => t.due && t.due <= today)} onTomorrow={toTomorrow} onMustDoTomorrow={mustDoToTomorrow} onClose={closeMode} onSaved={() => { loadFocus(); closeMode() }} />}

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
        <section className={`now-card ${running ? 'running' : ''}`} aria-label="What to do now">
          <span className="now-label">{running ? 'Focusing' : 'Now'}</span>
          <div className="now-main">
            <div>
              <h2>{running ? running.task?.title ?? running.subject : now.title}</h2>
              <p>{running ? (leftMs > 0 ? `${clock(leftMs)} left of ${running.planned} min` : `${running.planned} min done — stop to log it`) : now.detail}</p>
            </div>
            {running && <span className="now-clock">{clock(elapsed)}</span>}
          </div>
          {running && <div className="now-bar"><i style={{ width: `${Math.min(100, (elapsed / (running.planned * 60000)) * 100)}%` }} /></div>}
          <div className="row">
            <button className="btn primary now-go" onClick={() => void runNow(now)}>
              {BUTTON[now.kind]}
            </button>
            {now.kind === 'mustdo' && (
              <button className="btn ghost" onClick={() => void tickMustDo(now.index)}>
                <Icon name="check" size={13} /> It's done
              </button>
            )}
            {running && (
              <button className="btn ghost" onClick={() => void act(() => life.focus.cancel(), 'Session cancelled').then(refresh)}>
                Cancel
              </button>
            )}
            {shown.length > 1 && !running && (
              <button className="btn ghost" onClick={() => setSkipped((s) => [...s, key(now)])}>
                Skip
              </button>
            )}
          </div>
        </section>
      )}

      <section className="card day-list" aria-label="Today's list">
        <header className="card-head">
          <h2>Today</h2>
          <div className="actions">
            <span className="hint">
              {doneCount}/{total} done
            </span>
            {mode !== 'morning' && (
              <button className="btn small ghost" onClick={() => setForced('morning')} title="Plan your day in 2 minutes">
                <Icon name="sun" size={13} /> Plan
              </button>
            )}
            {mode !== 'evening' && (
              <button className="btn small ghost" onClick={() => setForced('evening')} title="Shut down your day in 2 minutes">
                <Icon name="moon" size={13} /> Shut down
              </button>
            )}
          </div>
        </header>

        <div className="habit-chips" aria-label="Habits">
          {habits.map((h) => (
            <button key={h.id} type="button" className={`chip habit ${h.done ? 'on' : ''}`} disabled={h.done} onClick={() => void h.run()} title={h.done ? `${h.label}: done` : `${h.label} · ${h.hint}`}>
              <span className="hc-check">{h.done ? '✓' : ''}</span>
              {h.label}
              {!h.done && <small>{h.hint}</small>}
            </button>
          ))}
        </div>

        <div className="dl-group" style={{ ['--c' as string]: 'var(--accent)' }}>
          <h3 className="dl-head">
            <i /> Must-dos <small>+10 each</small>
          </h3>
          <ul className="dl">
            {plan.map((p, i) => (
              <li key={`m${i}`} className={p.done ? 'done' : ''}>
                <button className="dl-check" aria-label={p.done ? `Untick ${p.text}` : `Tick ${p.text}`} onClick={() => void tickMustDo(i)}>
                  {p.done ? '✓' : ''}
                </button>
                <span className="dl-text">{p.text}</span>
                {!p.done && playBtn(p.text, subjectOf(p.text), { kind: 'mustdo', ref: p.text, title: p.text })}
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
        </div>

        {bigOpen.length > 0 && (
          <div className="dl-group" style={{ ['--c' as string]: 'var(--gold)' }}>
            <h3 className="dl-head">
              <i /> This week's big 3 <small>+25 each</small>
            </h3>
            <ul className="dl">
              {bigOpen.map((b) => (
                <li key={`b${b.i}`} className={b.done ? 'done' : ''}>
                  <button className="dl-check" aria-label={b.done ? `Untick ${b.text}` : `Tick ${b.text}`} onClick={() => void toggleBig(b.i)}>
                    {b.done ? '✓' : ''}
                  </button>
                  <span className="dl-text">{b.text}</span>
                  {!b.done && playBtn(b.text, subjectOf(b.text), null)}
                </li>
              ))}
            </ul>
          </div>
        )}

        {groups.map((g) => {
          const items = showAll ? g.items : g.items.filter(() => shown_++ < LIMIT)
          if (!items.length) return null
          return (
            <div key={g.key} className="dl-group" style={{ ['--c' as string]: g.color }}>
              <h3 className="dl-head">
                <i /> {g.name} <small>{g.items.length}</small>
              </h3>
              <ul className="dl">
                {items.map((t) => (
                  <li key={t.id}>
                    <button className="dl-check" aria-label={`Complete ${t.content}`} onClick={() => void doneTodo(t)} />
                    <span className="dl-text">
                      {t.content}
                      {t.due && t.due < today && <em className="dl-late"> late</em>}
                    </span>
                    {playBtn(t.content, todoSubject(t), { kind: 'todoist', ref: t.id, title: t.content })}
                    <span className="dl-hint">
                      {t.dueTime ?? ''}
                      {t.priority > 1 ? ` ${pLabel(t.priority)}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
        {todoList && todoList.length > LIMIT && (
          <button className="btn ghost dl-more" onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Show fewer' : `Show all ${todoList.length} (the most urgent are on top)`}
          </button>
        )}
        {todoList && todoList.length === 0 && <p className="hint dl-empty">Nothing due in Todoist today.</p>}

        {radar.length > 0 && (
          <div className="dl-group radar-group" style={{ ['--c' as string]: 'var(--orange)' }}>
            <h3 className="dl-head">
              <i /> Coming up
            </h3>
            <ul className="dl">
              {radar.slice(0, 3).map((x) => (
                <li key={x.task.id} className={x.daysLeft === 1 ? 'soon' : ''}>
                  <span className="radar-when">⏳ {whenText(x.daysLeft, x.date)}</span>
                  <span className="dl-text">{x.task.content}</span>
                  {playBtn(x.task.content, todoSubject(x.task), { kind: 'todoist', ref: x.task.id, title: x.task.content })}
                </li>
              ))}
            </ul>
          </div>
        )}
        {week?.focus && (
          <p className="hint dl-week" onClick={() => onGo('progress')}>
            <Icon name="trophy" size={13} /> Week focus: <b>{week.note || WEEK_LABEL[week.focus] || week.focus}</b>
          </p>
        )}
      </section>
    </div>
  )
}

const REASONS = ['Phone', 'Tired', 'Unclear task', 'Too much planned', 'Interrupted', 'Good day']

function ShutDown({ today, focusMin, doneToday, planLen, openMustDos, openTodo, onTomorrow, onMustDoTomorrow, onClose, onSaved }: {
  today: string
  focusMin: number
  doneToday: number
  planLen: number
  todoDone: number
  openMustDos: string[]
  openTodo: TodoTask[]
  onTomorrow: (t: TodoTask) => Promise<void>
  onMustDoTomorrow: (text: string) => Promise<void>
  onClose: () => void
  onSaved: () => void
}) {
  const act = useAction()
  const [text, setText] = useState('')
  const [reasons, setReasons] = useState<string[]>([])
  const [moved, setMoved] = useState<string[]>([])
  const save = async () => {
    if (await act(() => life.focus.review(text || null, reasons.length ? reasons : ['Reviewed']), 'Day closed. Sleep well.')) {
      soundSuccess()
      onSaved()
    }
  }
  const left = [...openMustDos.map((m) => ({ id: `m:${m}`, title: m, todo: null as TodoTask | null })), ...openTodo.map((t) => ({ id: t.id, title: t.content, todo: t }))].filter((x) => !moved.includes(x.id))
  return (
    <section className="mode-card evening" aria-label="Shut down your day">
      <header>
        <span className="mode-label">
          <Icon name="moon" size={14} /> Evening · shut down in 2 minutes
        </span>
        <button className="btn small ghost" onClick={onClose}>
          Later
        </button>
      </header>
      <p className="mode-sum">
        <b>{doneToday}/{planLen || 0}</b> must-dos · <b>{focusMin >= 60 ? `${Math.floor(focusMin / 60)}h ${focusMin % 60}m` : `${focusMin}m`}</b> focus today
      </p>
      <ol className="mode-steps">
        <li className={left.length ? '' : 'done'}>
          <b>1. What's left</b>
          {left.length ? (
            <ul className="mode-left">
              {left.slice(0, 6).map((x) => (
                <li key={x.id}>
                  <span>{x.title}</span>
                  <button
                    className="btn small ghost"
                    onClick={async () => {
                      setMoved((m) => [...m, x.id])
                      await (x.todo ? onTomorrow(x.todo) : onMustDoTomorrow(x.title))
                    }}
                  >
                    → Tomorrow
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <span className="hint">Nothing left for {today === new Date().toISOString().slice(0, 10) ? 'today' : 'the day'}. Clean finish.</span>
          )}
        </li>
        <li>
          <b>2. How did it go?</b>
          <div className="chips">
            {REASONS.map((r) => (
              <button key={r} type="button" className={`chip ${reasons.includes(r) ? 'on' : ''}`} onClick={() => setReasons((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]))}>
                {r}
              </button>
            ))}
          </div>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="One line about today (optional)" maxLength={300} />
        </li>
      </ol>
      <div className="row">
        <button className="btn primary" onClick={() => void save()}>
          <Icon name="check" size={13} /> Close my day
        </button>
      </div>
    </section>
  )
}
