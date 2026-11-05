// Today's core: the morning plan / evening shut-down cards, the "Now" card
// (one next step, a live timer while focusing), habit chips, and one list:
// must-dos, the week's big 3 and today's Todoist, grouped by area.
import { askConfirm } from './confirmSheet'
import { appHour } from '@core/dates'
import { bookMinutes, bookTask as bookIntoCalendar } from './booking'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { capture } from './capture'
import { nowActions, type NowAction } from '@core/nextAction'
import { decideNow, type DoNow } from '@core/doNow'
import { publishNow } from './nowStore'
import { TODAY_LABEL, areaKey, deadlineRadar, defaultAreaColor, isStarred, plainName, sortToday, whenText, type Area, type TodoTask } from '@core/todoist'
import type { BodyState, ConnectionsState, DisciplineState, FocusTask, Rule, Summary } from '@shared/api'
import { life } from './bridge'
import { Icon } from './Icon'
import type { PageId } from './modules'
import { useFocus } from './pages/Focus'
import { LABEL as WEEK_LABEL, useWeekPlan } from './WeekPlanner'
import { useTicker } from './useTicker'
import { Skeleton } from './blocks'
import { useSwipeRows } from './swipe'
import { TodayTaskRow, withToday } from './TodayTaskRow'
import { calendarToday, localToday, reloadToday, useTodayEvents } from './todayEvents'
import { nextSlot, planMustDos } from '@core/benActs'
import { blockSubject, isFocusBlock, localDay } from '@core/dayTime'
import { focusCoins } from '@core/focus'
import { activePlan } from '@core/weekPlan'
import { soundCoin, soundSuccess } from './sound'
import { useAction, useToast } from './ui'
import { useLive } from './live'
import { addDays, dayKey } from '@core/dates'
import { PLAN_ITEM_COINS, isPlanFor, type PlanItem } from '@core/focus'
import { BIG3_POINTS } from '../../main/points'
import { HabitEditor, MissTwiceNote, useMyHabits, useTapHabit } from './MyHabits'
import { useLifeMode } from './LifeMode'
import { modeTarget } from '@core/lifeMode'
import type { HabitsView } from './web/lifeExtras'

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
  // Live: tasks added or done on Telegram or in Todoist itself show up by themselves.
  useLive(() => void load(), { external: true })
  return [tasks, load, setTasks] as const
}

function useHabits({ summary, discipline, connections, body, onChange, onGo, rules }: Props, focusMin: number, onSpend: () => void, own: HabitsView | null, reloadOwn: () => void, focusTarget = 50): Habit[] {
  const act = useAction()
  const tapOwn = useTapHabit(() => {
    reloadOwn()
    onChange()
  })
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
    { id: 'clean', label: 'Clean day check-in', hint: discipline?.setup ? `day ${discipline.day ?? discipline.current} · ${pts('discipline.clean_day', 3)}` : pts('discipline.clean_day', 3), done: !!(discipline?.checkedInToday || r.includes('discipline.clean_day')), run: () => done(act(() => life.discipline.checkIn(), 'Checked in')) },
    { id: 'workout', label: 'Workout', hint: pts('body.workout_done', 3), done: !!(body?.workoutDoneToday || body?.restToday || r.includes('body.workout_done')), run: () => onGo('body') },
    { id: 'focus', label: `${focusTarget} minutes of focus`, hint: focusMin ? `${focusMin} min so far · +3 per 10 min` : '+3 per 10 min', done: focusMin >= focusTarget || r.includes('study.block_done'), run: () => done(act(() => life.focus.start('Focus', Math.min(90, focusTarget)), `Focus started: ${Math.min(90, focusTarget)} minutes`)) },
    { id: 'skincare', label: 'Skincare', hint: pts('face.routine_done', 2), done: r.includes('face.routine_done'), run: () => done(act(() => life.wallet.award('face.routine_done'), 'Skincare done')) },
    { id: 'spending', label: "Log today's spending", hint: pts('money.logged', 1), done: !!(connections?.finance.today?.logged || r.includes('money.logged')), run: onSpend },
    // Your own habits (FT1): +2 only for the tap, once a day each.
    ...(own?.rows ?? []).map((h) => ({ id: `own:${h.id}`, label: h.name, hint: `${own?.pays ? `+${own.pays}` : ''}${h.streak ? ` · 🔥${h.streak}` : ''}`.replace(/^ · /, '') || 'tap when done', done: h.done, run: () => void tapOwn(h.id, h.name) }))
  ]
}


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
  if (hour >= 19 && !reviewed) return 'evening'
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
  const toast = useToast()
  const [st, loadFocus] = useFocus()
  const [todo, loadTodo, setTodo] = useTodoist()
  // Every open task (Tomorrow, No date, Next 7 days, All tabs): what you add in
  // Todoist in the evening shows here too.
  const [allTasks, setAllTasks] = useState<TodoTask[] | null>(null)
  const [syncedAt, setSyncedAt] = useState(0)
  const loadAll = useCallback(async () => {
    const r = await life.todoist?.everything?.().catch(() => null)
    if (r) {
      setAllTasks(r.tasks)
      setAreas(r.areas)
      setSyncedAt(Date.now())
    }
  }, [])
  useLive(() => void loadAll(), { external: true })
  const [tab, setTabRaw] = useState<TodoTab>(() => (storeGet('ls.todoTab') as TodoTab) || 'today')
  const setTab = (t: TodoTab) => {
    setTabRaw(t)
    storeSet('ls.todoTab', t)
  }
  const [syncing, setSyncing] = useState(false)
  const syncNow = async () => {
    setSyncing(true)
    await Promise.all([loadTodo(), loadAll(), life.todoist?.sync?.().catch(() => 0)])
    setSyncing(false)
  }
  const [weekPlan, loadWeek] = useWeekPlan()
  const [colors, setColors] = useState<Record<string, string>>({})
  const [upcoming, setUpcoming] = useState<TodoTask[]>([])
  const [areas, setAreas] = useState<Area[]>([])
  const [order, setOrder] = useState<string[]>([])
  useEffect(() => {
    life.todoist?.upcoming?.().then(setUpcoming).catch(() => {})
    life.todoist?.colors?.().then(setColors).catch(() => {})
    void loadAll()
    life.todoist?.order?.().then(setOrder).catch(() => {})
  }, [])
  const today = summary.today
  const radar = deadlineRadar(upcoming, today)
  // Spending in one line (D2): "45 lunch" right here, through the capture pipeline.
  const [spendOpen, setSpendOpen] = useState(false)
  const [spendText, setSpendText] = useState('')
  const [spendBusy, setSpendBusy] = useState(false)
  const spendAct = useAction()
  const [own, reloadOwn] = useMyHabits()
  const [habitEdit, setHabitEdit] = useState(false)
  const [lifeMode] = useLifeMode()
  const habits = useHabits(props, st?.todayMin ?? 0, () => setSpendOpen(true), own, reloadOwn, modeTarget(50, lifeMode?.current ?? null))
  // "Log spending" from a home-screen shortcut (FT15) opens the line here.
  useEffect(() => {
    const on = () => setSpendOpen(true)
    window.addEventListener('life-open-spend', on)
    return () => window.removeEventListener('life-open-spend', on)
  }, [])
  const saveSpend = async () => {
    const t = spendText.trim()
    if (!t || spendBusy) return
    // Just a number: "45" → "spent 45" so the money rules pick it up.
    const text = /^\d+([.,]\d+)?$/.test(t) ? `spent ${t}` : /^\d/.test(t) ? `spent ${t}` : t
    setSpendBusy(true)
    const r = await spendAct(async () => {
      const c = await capture(text)
      if (!c.ok) throw new Error(c.said)
      return c
    })
    setSpendBusy(false)
    if (r) {
      setSpendText('')
      setSpendOpen(false)
      props.onChange()
    }
  }
  // What one Todoist task pays (the real rule, shown on every row).
  const taskPts = props.rules?.find((x) => x.id === 'tasks.todoist_done')?.coins ?? 5
  // Skipped "Do this now" steps, remembered for the day (F3: the top row can skip too).
  const [skipped, setSkippedRaw] = useState<string[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem('ls.skippedNow') || 'null')
      return v && v.day === dayKey(new Date()) && Array.isArray(v.keys) ? v.keys : []
    } catch {
      return []
    }
  })
  const setSkipped = (f: (x: string[]) => string[]) =>
    setSkippedRaw((cur) => {
      const next = f(cur)
      try {
        localStorage.setItem('ls.skippedNow', JSON.stringify({ day: dayKey(new Date()), keys: next.slice(-30) }))
      } catch {
        /* this session only */
      }
      return next
    })
  const [adding, setAdding] = useState('')
  const [showAll, setShowAll] = useState(false)
  // A habit just ticked: the chip bursts and the ring pulses.
  const [burst, setBurst] = useState<string | null>(null)
  const [restPref, setRestPrefState] = useState<boolean | null>(() => {
    const v = storeGet('ls.todayRest')
    return v === '1' ? true : v === '0' ? false : null
  })
  const setRestOpen = (v: boolean) => {
    setRestPrefState(v)
    storeSet('ls.todayRest', v ? '1' : '0')
  }
  const [closed, setClosed] = useState(() => storeGet('ls.modeClosed'))
  const [forced, setForced] = useState<Mode | undefined>(undefined)
  const shutRef = useRef<HTMLDivElement>(null)
  // "Close my day" in the top card opens the shut-down here.
  useEffect(() => {
    const on = () => {
      setForced('evening')
      setTimeout(() => shutRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
    }
    window.addEventListener('life-close-day', on)
    return () => window.removeEventListener('life-close-day', on)
  }, [])
  // Only the clock redraws every second (RunningClock below); the list needs a slow tick.
  const tick = useSlowTick(!!st?.running)
  // A deep-work block in your calendar that's on right now becomes the Now card.
  const { events: calEvents } = useTodayEvents()
  const blockNow = useMemo(() => {
    if (st?.running) return null
    const t = Date.now()
    return calEvents.find((e) => !e.allDay && dayKey(e.start) === today && isFocusBlock(e) && Date.parse(e.start) <= t && Date.parse(e.end) - t >= 10 * 60000) ?? null
    // tick keeps it fresh while focusing; the 30 s live reload otherwise
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calEvents, st?.running, today, tick])

  const week = weekPlan ? activePlan(weekPlan, today) : null
  const reviewed = !!st && (!!st.plan.review || st.plan.reasons.length > 0)
  // The morning plan opens by itself before noon while today has no must-dos
  // and you haven't closed it today (F1); the evening shut-down opens when you
  // ask (Shut down here, Close my day in the top row).
  const auto = st ? autoMode(appHour(), st.plan.items.length > 0, reviewed, closed, today) : null
  // One morning card (D1): when Ben's plan for today is on Today (the card
  // above), this one doesn't open by itself; "Plan" still opens it.
  const [benPlan, setBenPlan] = useState(false)
  useEffect(() => {
    life.coach?.rhythm?.('state').then((r) => setBenPlan(!!r.prefs.on && r.state.day === today && !!r.state.briefing)).catch(() => setBenPlan(false))
  }, [today, tick])
  const mode: Mode = forced !== undefined ? forced : auto === 'morning' && !benPlan ? 'morning' : null
  const closeMode = () => {
    storeSet('ls.modeClosed', today)
    setClosed(today)
    setForced(null)
  }

  const actions = useMemo(() => {
    if (!st) return []
    return nowActions({
      hour: appHour(),
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
  // The morning/evening card already covers planning and the review.
  const hiddenKinds = mode === 'morning' ? ['plan', 'log-wake'] : mode === 'evening' ? ['review'] : []
  const shown = actions.filter((a) => !hiddenKinds.includes(a.kind))
  // Ben's side of "now": a promise he's waiting on, a plan to approve (shared, cached).
  const [coachNow, setCoachNow] = useState<{ awaiting: string | null; proposed: boolean }>({ awaiting: null, proposed: false })
  const loadCoachNow = useCallback(() => {
    life.coach?.status?.()
      .then((c) => setCoachNow({ awaiting: c.move.kind === 'answer' ? c.move.promise : null, proposed: c.move.kind === 'approve' }))
      .catch(() => {})
  }, [])
  useEffect(loadCoachNow, [loadCoachNow, st?.running, st?.plan.items.length])
  useLive(loadCoachNow)
  const nextBlock = useMemo(() => {
    const t = Date.now()
    return calEvents.filter((e) => !e.allDay && dayKey(e.start) === today && isFocusBlock(e) && Date.parse(e.start) > t).sort((a, b) => a.start.localeCompare(b.start))[0] ?? null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calEvents, today, tick])
  // THE one thing to do now (core/doNow), with why. The top row shows the same.
  const decision: DoNow | null = st
    ? decideNow({
        now: Date.now(),
        hour: appHour(),
        running: st.running ? { subject: st.running.subject, title: st.running.task?.title } : null,
        awaiting: coachNow.awaiting,
        planProposed: coachNow.proposed,
        blockNow: blockNow ? { id: blockNow.id, title: blockNow.title, start: blockNow.start, end: blockNow.end } : null,
        nextBlock: nextBlock ? { id: nextBlock.id, title: nextBlock.title, start: nextBlock.start, end: nextBlock.end } : null,
        // Closed on any device: the day's review is in the synced day plan (Z3).
        dayClosed: mode === 'evening' || storeGet('ls.dayClosed') === dayKey(new Date()) || (st.plan.reasons?.length ?? 0) > 0,
        actions: shown,
        skipped
      })
    : null
  useEffect(() => {
    publishNow(decision)
  })
  useEffect(() => () => publishNow(null), [])

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
  // A finished row plays a short "done" animation before it leaves.
  const [leaving, setLeaving] = useState<string[]>([])
  const fadeOut = (id: string) =>
    new Promise<void>((done) => {
      setLeaving((l) => [...l, id])
      setTimeout(done, 320)
    })
  const doneTodo = async (t: TodoTask) => {
    if (leaving.includes(t.id)) return
    soundSuccess()
    await fadeOut(t.id)
    setTodo((cur) => (cur ?? []).filter((x) => x.id !== t.id))
    setAllTasks((cur) => (cur ? cur.filter((x) => x.id !== t.id) : cur))
    setLeaving((l) => l.filter((x) => x !== t.id))
    const r = await act(() => life.todoist!.complete(t))
    if (r) toast(`Done: ${t.content}${r.paid ? ` · +${taskPts} points` : ''}`, 'good')
    if (r?.paid) soundCoin()
    refresh()
  }
  const toggleBig = async (i: number) => {
    const b = week?.big3[i]
    const linked = b && !b.done && b.todoistId ? todo?.find((x) => x.id === b.todoistId) : undefined
    if (linked) await doneTodo(linked)
    if (await act(() => life.weekPlan!.toggle(i))) {
      soundSuccess()
      loadWeek()
      onChange()
    }
  }
  // Swipe a row right to complete it (phone).
  const listRef = useRef<HTMLElement>(null)
  const swipeRef = useRef<(key: string) => void>(() => {})
  swipeRef.current = (key: string) => {
    const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)]
    const t = todo?.find((x) => x.id === id)
    if (kind === 'star' && t) void doneStarred(t)
    else if (kind === 'todo' && t) void doneTodo(t)
    else if (kind === 'must') void tickMustDo(Number(id))
    else if (kind === 'big') void toggleBig(Number(id))
  }
  const onSwipe = useCallback((key: string) => swipeRef.current(key), [])
  useSwipeRows(listRef, onSwipe)

  const startFocus = async (subject: string, task: FocusTask | null = null, minutes = 50) => {
    if (await act(() => life.focus.start(subject, minutes, task), `Focus started: ${task?.title ?? subject} · +3 per 10 min`)) loadFocus()
  }
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
  /** A must-do in the day plan (points, bots, Insights read it). */
  const keepPlan = (items: PlanItem[]) => items.map((i) => ({ text: i.text, todoistId: i.todoistId ?? null }))
  /** `task`: the Todoist task it is (linked by id: a rename in Todoist keeps the link). */
  const addPlanItem = async (t: string, task?: TodoTask) => {
    if (!st) return true
    const at = st.plan.items.findIndex((p) => (task ? isPlanFor(p, task) : same(p.text, t)))
    if (at >= 0) {
      // Already there by its words: link it to the task now.
      if (task && !st.plan.items[at].todoistId) await act(() => life.focus.setPlan(keepPlan(st.plan.items).map((x, k) => (k === at ? { ...x, todoistId: task.id } : x))))
      return true
    }
    return !!(await act(() => life.focus.setPlan([...keepPlan(st.plan.items), { text: t, todoistId: task?.id ?? null }])))
  }
  /** A typed must-do: in the plan and, with Todoist, a task due today starred ⭐. */
  const addMustDo = async (text = adding) => {
    const t = text.trim()
    if (!t || !st) return
    if (!(await addPlanItem(t))) return
    setAdding('')
    if (todo !== null && life.todoist) await life.todoist.quickAdd(`${t} today @${TODAY_LABEL}`).catch(() => null)
    refresh()
  }
  /** ⭐ a Todoist task: it becomes one of today's must-dos (label @today, due today). */
  const star = async (t: TodoTask) => {
    const labels = [...new Set([...(t.labels ?? []), TODAY_LABEL])]
    setTodo((cur) => (cur ?? []).map((x) => (x.id === t.id ? { ...x, labels } : x)))
    const ok = await act(() => life.todoist!.update!(t.id, { labels, ...(t.due && t.due <= today ? {} : { due: 'today' }) }).then(() => true), `⭐ Must-do: ${t.content}`)
    if (ok) await addPlanItem(t.content, t)
    refresh()
  }
  const unstar = async (t: TodoTask) => {
    const labels = (t.labels ?? []).filter((l) => l !== TODAY_LABEL)
    setTodo((cur) => (cur ?? []).map((x) => (x.id === t.id ? { ...x, labels } : x)))
    await act(() => life.todoist!.update!(t.id, { labels }).then(() => true))
    if (st) {
      const keep = keepPlan(st.plan.items.filter((p) => p.done || !isPlanFor(p, t)))
      if (keep.length !== st.plan.items.length) await act(() => life.focus.setPlan(keep))
    }
    refresh()
  }
  /** Done on a starred task: Todoist and the must-do (+10) together. */
  const doneStarred = async (t: TodoTask) => {
    const i = st ? st.plan.items.findIndex((p) => !p.done && isPlanFor(p, t)) : -1
    await doneTodo(t)
    if (i >= 0) await tickMustDo(i)
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
        return onGo('progress')
    }
  }
  /** Runs the one "Do this now" step (the card's button, or the top row's). */
  async function runDecision(d: DoNow) {
    if (d.kind === 'running') return runNow({ kind: 'stop-focus', title: d.title, detail: '' })
    if (d.kind === 'block') return startFocus(blockSubject(d.block.title), null, d.minutes)
    if (d.kind === 'close-day') return window.dispatchEvent(new CustomEvent('life-close-day'))
    if (d.kind === 'approve') {
      await act(() => life.coach!.rhythm!('approve'), 'Approved: blocks in your calendar, must-dos on Today')
      return refresh()
    }
    if (d.kind === 'answer') {
      const r = await act(() => life.coach!.chat(`Done: ${d.promise}`))
      if (r?.reply) await act(async () => r, r.reply.slice(0, 140))
      return loadCoachNow()
    }
    return runNow(d.action)
  }
  const decisionRef = useRef<DoNow | null>(null)
  decisionRef.current = decision
  useEffect(() => {
    const on = () => decisionRef.current && void runDecision(decisionRef.current)
    const skip = () => decisionRef.current && setSkipped((x) => [...x, decisionRef.current!.key])
    window.addEventListener('life-do-now', on)
    window.addEventListener('life-skip-now', skip)
    return () => {
      window.removeEventListener('life-do-now', on)
      window.removeEventListener('life-skip-now', skip)
    }
  })

  const todoList = useMemo(() => (todo ? sortToday(todo, today) : null), [todo, today])
  const bigIds = useMemo(() => new Set((week?.big3 ?? []).map((b) => b.todoistId).filter(Boolean) as string[]), [week])
  const starredRaw = useMemo(() => (todoList ?? []).filter(isStarred), [todoList])
  // Your own order first (dragged), the rest as Todoist sorts them (late and urgent on top).
  const rank = useCallback((list: TodoTask[]) => {
    const pos = new Map(order.map((id, i) => [id, i]))
    return list.map((t, i) => ({ t, k: pos.has(t.id) ? pos.get(t.id)! : 10_000 + i })).sort((a, b) => a.k - b.k).map((x) => x.t)
  }, [order])
  const starred = useMemo(() => rank(starredRaw), [starredRaw, rank])
  const loose = useMemo(() => rank((todoList ?? []).filter((t) => !isStarred(t) && !bigIds.has(t.id))), [todoList, bigIds, rank])
  const colorOf = (t: TodoTask) => {
    const k = areaKey(t)
    return colors[k] ?? defaultAreaColor({ name: t.section || (t.project && t.project !== 'Inbox' ? t.project : 'Inbox') })
  }
  // Today's Todoist, grouped by area (its section, else its project), urgent groups first.
  const groups: Group[] = useMemo(() => {
    const out: Group[] = []
    for (const t of loose) {
      const k = areaKey(t)
      const name = t.section || (t.project && t.project !== 'Inbox' ? t.project : 'Inbox')
      let g = out.find((x) => x.key === k)
      if (!g) out.push((g = { key: k, name, color: colors[k] ?? defaultAreaColor({ name }), items: [] }))
      g.items.push(t)
    }
    return out
  }, [loose, colors])

  const tabTasks = (t: TodoTab): TodoTask[] => {
    const all = allTasks ?? []
    const tom = addDays(today, 1)
    const wk = addDays(today, 7)
    const list = t === 'tomorrow' ? all.filter((x) => x.due === tom) : t === 'nodate' ? all.filter((x) => !x.due) : t === 'week' ? all.filter((x) => !!x.due && x.due > today && x.due <= wk) : t === 'all' ? all : todoList ?? []
    return sortToday(list, today)
  }

  // ---- Editing tasks in place -------------------------------------------
  const patchTask = async (t: TodoTask, patch: { content?: string; priority?: number; due?: string; description?: string; duration?: number | null }, local: Partial<TodoTask>, msg?: string) => {
    setTodo((cur) => (cur ?? []).map((x) => (x.id === t.id ? { ...x, ...local } : x)))
    const ok = await act(() => life.todoist!.update!(t.id, patch).then(() => true), msg)
    // Moved out of today, or a date Todoist worked out: reload to see where it went.
    setAllTasks((cur) => (cur ? cur.map((x) => (x.id === t.id ? { ...x, ...local } : x)) : cur))
    if (!ok || patch.due) {
      void loadTodo()
      void loadAll()
    }
  }
  /** 📅 Book: the task goes into your next free time today (calendar block + its time in Todoist). */
  const bookTask = async (t: TodoTask) => {
    if (!life.google) return toast('Connect Google Calendar in Settings to book tasks', 'bad')
    const minutes = bookMinutes(t)
    const day = calendarToday()
    const n = new Date()
    const hm = `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`
    const slot = nextSlot(calEvents, day, hm, minutes)
    if (!slot) return toast(`No free ${minutes} min left today. Pick a day with the date chip.`, 'bad')
    setTodo((cur) => (cur ?? []).map((x) => (x.id === t.id ? { ...x, due: day, dueTime: slot.start, duration: minutes } : x)))
    const ok = await act(async () => {
      await bookIntoCalendar(t, day, slot.start, slot.end, 'Booked from Todoist with Life System')
      return true
    }, `Booked ${slot.start}–${slot.end}: ${t.content}`)
    if (ok) soundSuccess()
    void reloadToday()
    void loadTodo()
  }
  const moveTask = async (t: TodoTask, a: Area) => {
    setTodo((cur) => (cur ?? []).map((x) => (x.id === t.id ? { ...x, sectionId: a.kind === 'section' ? a.id : null, projectId: a.projectId, section: a.kind === 'section' ? a.name : null, project: a.kind === 'project' ? a.name : x.project } : x)))
    if (!(await act(() => life.todoist!.move!(t.id, a.key).then(() => true), `Moved to ${plainName(a.name) || a.name}`))) void loadTodo()
  }
  const deleteTask = async (t: TodoTask) => {
    setTodo((cur) => (cur ?? []).filter((x) => x.id !== t.id))
    if (!(await act(() => life.todoist!.remove!(t.id).then(() => true), `Deleted: ${t.content}`))) void loadTodo()
  }
  const addToArea = async (areaK: string, text: string) => {
    const v = text.trim()
    if (!v || !life.todoist) return false
    const ok = await act(() => life.todoist!.quickAdd(withToday(v), areaK).then(() => true), `Added: ${v}`)
    if (ok) void loadTodo()
    return !!ok
  }
  // Drag a task: onto another task (reorder, and move area if it's in another group).
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropOn, setDropOn] = useState<string | null>(null)
  const dropTask = (targetId: string | null, targetArea: string | null) => {
    const id = dragId
    setDragId(null)
    setDropOn(null)
    if (!id || id === targetId) return
    const t = (todo ?? []).find((x) => x.id === id)
    if (!t) return
    const ids = [...starred, ...loose].map((x) => x.id).filter((x) => x !== id)
    const at = targetId ? ids.indexOf(targetId) : -1
    const next = at >= 0 ? [...ids.slice(0, at), id, ...ids.slice(at)] : [...ids, id]
    setOrder(next)
    void life.todoist?.setOrder?.(next).catch(() => null)
    const area = targetArea ? areas.find((a) => a.key === targetArea) : undefined
    if (area && area.key !== areaKey(t)) void moveTask(t, area)
  }
  const rowDrag = (t: TodoTask, group: string | null) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      setDragId(t.id)
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/x-task', JSON.stringify({ id: t.id, title: t.content, minutes: bookMinutes(t) }))
    },
    onDragEnd: () => {
      setDragId(null)
      setDropOn(null)
    },
    onDragOver: (e: React.DragEvent) => {
      if (!dragId) return
      e.preventDefault()
      if (dropOn !== t.id) setDropOn(t.id)
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      dropTask(t.id, group)
    }
  })
  // Keys 1–4 on the task under the mouse: priority.
  const hotRef = useRef<string | null>(null)
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {})
  keyRef.current = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement | null
    if (e.ctrlKey || e.metaKey || e.altKey || (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)))) return
    if (!/^[1-4]$/.test(e.key) || !hotRef.current) return
    const t = (todo ?? []).find((x) => x.id === hotRef.current)
    if (!t) return
    const p = 5 - Number(e.key)
    void patchTask(t, { priority: p }, { priority: p }, `P${e.key}`)
  }
  useEffect(() => {
    const on = (e: KeyboardEvent) => keyRef.current(e)
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])
  const taskRow = (t: TodoTask, isStar: boolean, group: string | null, extra?: React.ReactNode) => (
    <TodayTaskRow
      extra={
        <>
          {extra}
          <span className="tt-pts" title={`Done = +${isStar ? 10 : taskPts} points`}>+{isStar ? 10 : taskPts} ⭐</span>
        </>
      }
      key={t.id}
      t={t}
      today={today}
      color={colorOf(t)}
      areas={areas}
      starred={isStar}
      running={!!st?.running}
      leaving={leaving.includes(t.id)}
      dropping={dropOn === t.id && dragId !== t.id}
      onDone={() => void (isStar ? doneStarred(t) : doneTodo(t))}
      onFocus={() => void startFocus(todoSubject(t), { kind: 'todoist', ref: t.id, title: t.content }, bookMinutes(t))}
      onBook={t.dueTime ? undefined : () => void bookTask(t)}
      onStar={() => void (isStar ? unstar(t) : star(t))}
      onPatch={(patch, local, msg) => void patchTask(t, patch, local, msg)}
      onMove={(a) => void moveTask(t, a)}
      onDelete={() => void deleteTask(t)}
      onHot={(id) => (hotRef.current = id)}
      dragHandlers={rowDrag(t, group)}
    />
  )

  if (!st)
    return (
      <div className="cmd-day">
        <section className="now-card">
          <Skeleton lines={2} />
        </section>
        <section className="card">
          <Skeleton lines={6} />
        </section>
      </div>
    )
  const plan = st.plan.items
  const bigOpen = week?.big3.map((b, i) => ({ ...b, i })).filter((b) => b.text) ?? []
  const doneCount = plan.filter((p) => p.done).length + bigOpen.filter((b) => b.done).length
  // Plan items shown on their own: those without a starred Todoist task.
  const planOnly = plan.map((p, i) => ({ p, i })).filter((x) => !starred.some((t) => isPlanFor(x.p, t)))
  // One number that matters, the same one Today's top card, the island and Ben
  // show (N6): today's must-do list, done of total.
  const mustTotal = plan.length
  const mustDone = plan.filter((p) => p.done).length
  const lateCount = loose.filter((t) => t.due && t.due < today).length
  // The rest of today's tasks fold away while you have must-dos (your choice is remembered).
  const restOpen = restPref ?? true
  const total = planOnly.length + starred.length + bigOpen.length + loose.length
  const running = st.running
  const playBtn = (label: string, subject: string, task: FocusTask | null) =>
    !running && (
      <button className="dl-play" aria-label={`Focus 50 minutes on ${label}`} title="Focus 50 min on this" onClick={() => void startFocus(subject, task)}>
        ▶
      </button>
    )

  // Morning suggestions: late and important Todoist tasks, then the week's big 3.
  const suggestions: { text: string; task?: TodoTask }[] = [
    ...loose.filter((t) => (t.due && t.due < today) || t.priority >= 3).map((t) => ({ text: t.content, task: t })),
    ...bigOpen.filter((b) => !b.done).map((b) => ({ text: b.text })),
    ...radar.filter((r) => !isStarred(r.task)).map((r) => ({ text: r.task.content, task: r.task }))
  ]
    .filter((x, i, all) => all.findIndex((y) => same(y.text, x.text)) === i && !plan.some((p) => same(p.text, x.text)))
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
                    <button key={s.text} type="button" className="chip" onClick={() => void (s.task && life.todoist ? star(s.task) : addMustDo(s.text))} title="Make it a must-do (⭐ in Todoist)">
                      ☆ {s.text.length > 48 ? `${s.text.slice(0, 46)}…` : s.text}
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
              <button
                className="btn small"
                disabled={!plan.length}
                onClick={async () => {
                  // One "Plan my day" (Z4): Ben's plan, which you approve (blocks + must-dos).
                  if (life.coach?.rhythm) {
                    const ok = await act(() => life.coach!.rhythm!('propose'), "Ben planned your day: check it and tap ✓ Approve")
                    if (ok) window.dispatchEvent(new CustomEvent('life-external-changed'))
                    return
                  }
                  // No Ben here (desktop without the coach): book the open must-dos into free time, after you see them.
                  if (!life.google) return props.onGo('settings')
                  const day = calendarToday()
                  const nowHm = new Date().toTimeString().slice(0, 5)
                  const todo = plan.filter((p) => !p.done).map((p) => p.text).filter((t) => !calEvents.some((e) => same(e.title, t)))
                  const slots = planMustDos(calEvents, day, nowHm, todo)
                  if (!todo.length) return void act(async () => true, 'Your must-dos are already in the calendar')
                  if (!slots.length) return void act(async () => true, 'No free time left today: move something or plan tomorrow')
                  if (!(await askConfirm(`Put these in your calendar?\n${slots.map((b) => `${b.start}–${b.end} ${b.title}`).join('\n')}`, { ok: 'Book them', danger: false }))) return
                  const at = (hm: string) => new Date(`${day}T${hm}:00`).toISOString()
                  const ok = await act(async () => {
                    for (const b of slots) await life.google!.create({ title: b.title, start: at(b.start), end: at(b.end), description: 'Must-do · planned in Life System' })
                    return true
                  }, `Booked ${slots.length} block${slots.length === 1 ? '' : 's'}: ${slots.map((b) => `${b.start} ${b.title}`).join(' · ')}`)
                  if (ok) void reloadToday()
                }}
              >
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

      {mode === 'evening' && <div ref={shutRef} />}
      {mode === 'evening' && <ShutDown today={today} focusMin={st.todayMin} doneToday={doneToday} planLen={plan.length} todoDone={0} openMustDos={openLeft.map((x) => x.p.text)} openTodo={(todoList ?? []).filter((t) => t.due && t.due <= today)} onTomorrow={toTomorrow} onMustDoTomorrow={mustDoToTomorrow} onClose={closeMode} onSaved={() => { loadFocus(); closeMode(); try { localStorage.setItem('ls.dayClosed', dayKey(new Date())) } catch { /* fine */ } window.dispatchEvent(new CustomEvent('life-day-closed')) }} />}

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
      {/* The top row (TodayHero) is the one "Do this now" on Today (D5); this card
          only shows while a session runs, with its clock and controls. */}
      {decision && !ended && running && (
        <section className={`now-card ${running ? 'running' : ''} ${decision.kind === 'block' ? 'block' : ''}`} aria-label="Do this now">
          <span className="now-label">{decision.tag}</span>
          <div className="now-main">
            <div>
              <h2>{decision.title}</h2>
              <p>{running ? <RunningClock run={running} part="left" /> : <span className="now-why">{decision.why}</span>}</p>
            </div>
            {running && <RunningClock run={running} part="clock" />}
          </div>
          {running && <RunningClock run={running} part="bar" />}
          <div className="row">
            <button className="btn primary now-go" onClick={() => void runDecision(decision)}>
              {decision.button}
            </button>
            {decision.kind === 'action' && decision.action.kind === 'mustdo' && (
              <button className="btn ghost" onClick={() => void tickMustDo((decision.action as Extract<NowAction, { kind: 'mustdo' }>).index)}>
                <Icon name="check" size={13} /> It's done
              </button>
            )}
            {running && (
              <button className="btn ghost" onClick={() => void act(() => life.focus.cancel(), 'Session cancelled').then(refresh)}>
                Cancel
              </button>
            )}
            {!running && decision.kind !== 'answer' && !(decision.kind === 'action' && decision.action.kind === 'done') && (
              <button className="btn ghost" onClick={() => setSkipped((x) => [...x, decision.key])}>
                {decision.kind === 'block' ? 'Not now' : 'Skip'}
              </button>
            )}
          </div>
        </section>
      )}

      <section className="card day-list" aria-label="Today's list" ref={listRef}>
        <header className="card-head">
          <h2>Today</h2>
          <div className="actions">
            <span className="hint" title={`${doneCount} of ${total} things on today's list done`}>
              {mustTotal ? `${mustDone}/${mustTotal} must-dos` : `${doneCount} done`}
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
          {habits.length > 0 && (
            <span className={`hb-ring ${burst ? 'pulse' : ''} ${habits.every((h) => h.done) ? 'all' : ''}`} style={{ ['--p' as string]: `${(habits.filter((h) => h.done).length / habits.length) * 100}%` }} title="Habits done today">
              <b>
                {habits.filter((h) => h.done).length}/{habits.length}
              </b>
            </span>
          )}
          {habits.map((h) => (
            <button
              key={h.id}
              type="button"
              className={`chip habit ${h.done ? 'on' : ''} ${burst === h.id ? 'burst' : ''}`}
              disabled={h.done}
              onClick={() =>
                void Promise.resolve(h.run()).then(() => {
                  setBurst(h.id)
                  setTimeout(() => setBurst(null), 1200)
                })
              }
              title={h.done ? `${h.label}: done` : `${h.label} · ${h.hint}`}
            >
              <span className="hc-check">{h.done ? '✓' : ''}</span>
              {h.label}
              {!h.done && <small>{h.hint}</small>}
            </button>
          ))}
          {life.extras && (
            <button type="button" className="chip habit mh-edit" onClick={() => setHabitEdit((x) => !x)} title="Add, rename or remove your own habits" aria-expanded={habitEdit}>
              {own?.rows.length ? '✎ Habits' : '+ Your habit'}
            </button>
          )}
        </div>
        <MissTwiceNote v={own} />
        {habitEdit && own && <HabitEditor v={own} onClose={() => setHabitEdit(false)} onChange={() => { reloadOwn(); props.onChange() }} />}

        {spendOpen && (
          <form
            className="spend-line"
            onSubmit={(e) => {
              e.preventDefault()
              void saveSpend()
            }}
          >
            <input autoFocus value={spendText} onChange={(e) => setSpendText(e.target.value)} placeholder="45 lunch · 120 groceries Linella · 30 taxi" aria-label="What you spent" onKeyDown={(e) => e.key === 'Escape' && setSpendOpen(false)} />
            <button className="btn primary small" disabled={!spendText.trim() || spendBusy}>{spendBusy ? 'Saving…' : 'Log'}</button>
            <button type="button" className="btn ghost small" onClick={() => props.onOpenApp('money')} title="Open Finance Helper">Finance Helper</button>
            <button type="button" className="btn ghost small" onClick={() => setSpendOpen(false)} aria-label="Close">✕</button>
          </form>
        )}

        <div className="dl-tabs" role="tablist" aria-label="Which tasks">
          {TODO_TABS.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
              {label}
              <i>{id === 'today' ? (todoList?.length ?? 0) + planOnly.length : tabTasks(id).length}</i>
            </button>
          ))}
          <button className={`dl-sync ${syncing ? 'busy' : ''}`} onClick={() => void syncNow()} title="Get the newest from Todoist now (it also checks by itself every few seconds)">
            ⟳ {syncing ? 'Syncing…' : syncedAt ? `Synced ${Date.now() - syncedAt < 15_000 ? 'just now' : `${Math.round((Date.now() - syncedAt) / 60_000) || '<1'} min ago`}` : 'Sync'}
          </button>
        </div>

        {tab !== 'today' && (
          <TabList
            tasks={tabTasks(tab)}
            empty={tab === 'nodate' ? 'Every task has a date. Nice.' : tab === 'tomorrow' ? 'Nothing for tomorrow yet.' : 'Nothing here.'}
            groupOf={(t) => ({ key: areaKey(t), name: t.section || (t.project && t.project !== 'Inbox' ? t.project : 'Inbox'), color: colorOf(t) })}
            row={(t, g, extra) => taskRow(t, isStarred(t), g, extra)}
            quick={(t) => (
              <span className="dl-quick">
                {t.due !== today && (
                  <button onClick={() => void patchTask(t, { due: 'today' }, { due: today }, `${t.content}: today`)}>Today</button>
                )}
                {t.due !== addDays(today, 1) && (
                  <button onClick={() => void patchTask(t, { due: 'tomorrow' }, { due: addDays(today, 1) }, `${t.content}: tomorrow`)}>Tomorrow</button>
                )}
              </span>
            )}
          />
        )}
        {tab === 'today' && (<>
        <div className="dl-group" style={{ ['--c' as string]: 'var(--accent)' }}>
          <h3 className="dl-head">
            <i /> Must-dos <small>+{PLAN_ITEM_COINS} each, first 3</small>
          </h3>
          <ul className="dl">
            {starred.map((t) => taskRow(t, true, null))}
            {planOnly.map(({ p, i }) => (
              <li key={`m${i}`} className={p.done ? 'done' : ''} data-swipe={p.done ? undefined : `must:${i}`}>
                <button className="dl-check" aria-label={p.done ? `Untick ${p.text}` : `Tick ${p.text}`} onClick={() => void tickMustDo(i)}>
                  {p.done ? '✓' : ''}
                </button>
                <span className="dl-text">{p.text}</span>
                <span className="tt-pts">+{PLAN_ITEM_COINS} ⭐</span>
                {!p.done && playBtn(p.text, subjectOf(p.text), { kind: 'mustdo', ref: p.text, title: p.text })}
              </li>
            ))}
          </ul>
          {!plan.length && !starred.length && <p className="hint dl-tip">Tap ☆ on any task below to make it a must-do, or type one.</p>}
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

        {bigOpen.length > 0 && bigOpen.every((b) => b.done) && (
          <p className="dl-bigdone">✓ This week's big 3 are done 🎉</p>
        )}
        {bigOpen.length > 0 && !bigOpen.every((b) => b.done) && (
          <div className="dl-group" style={{ ['--c' as string]: 'var(--gold)' }}>
            <h3 className="dl-head">
              <i /> This week's big 3 <small>+25 each</small>
            </h3>
            <ul className="dl">
              {bigOpen.map((b) => (
                <li key={`b${b.i}`} className={b.done ? 'done' : ''} data-swipe={b.done ? undefined : `big:${b.i}`}>
                  <button className="dl-check" aria-label={b.done ? `Untick ${b.text}` : `Tick ${b.text}`} onClick={() => void toggleBig(b.i)}>
                    {b.done ? '✓' : ''}
                  </button>
                  <span className="dl-text">{b.text}</span>
                  <span className="tt-pts">+{BIG3_POINTS} ⭐</span>
                  {!b.done && playBtn(b.text, subjectOf(b.text), null)}
                </li>
              ))}
            </ul>
          </div>
        )}

        {loose.length > 0 && (
          <details className="dl-rest" open={restOpen} onToggle={(e) => {
            // Only a real click counts (React also fires this when it sets `open`).
            const v = (e.target as HTMLDetailsElement).open
            if (v !== restOpen) setRestOpen(v)
          }}>
            <summary>
              <span>Everything else today</span>
              <small>
                {loose.length} task{loose.length === 1 ? '' : 's'}
                {lateCount ? ` · ${lateCount} late` : ''}
              </small>
            </summary>
        {groups.map((g) => {
          const items = g.items
          if (!items.length) return null
          return (
            <div key={g.key} className="dl-group" style={{ ['--c' as string]: g.color }}>
              <h3
                className={`dl-head ${dragId && dropOn === `g:${g.key}` ? 'drop' : ''}`}
                onDragOver={(e) => {
                  if (!dragId) return
                  e.preventDefault()
                  setDropOn(`g:${g.key}`)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  dropTask(items[0]?.id ?? null, g.key)
                }}
              >
                <i /> {g.name} <small>{g.items.length} · +{taskPts} each</small>
              </h3>
              <ul className="dl">{items.map((t) => taskRow(t, false, g.key))}</ul>
              <AreaAdd name={plainName(g.name) || g.name} onAdd={(v) => addToArea(g.key, v)} />
            </div>
          )
        })}

          </details>
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
        </>)}
        {tab === 'today' && week?.focus && (
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
  // Step 3 (D3): bedtime tonight and tomorrow's wake-up target.
  const tomorrow = tomorrowOf(today)
  const tomorrowWeekend = [0, 6].includes(new Date(`${tomorrow}T12:00:00Z`).getUTCDay())
  const [sleepT, setSleepT] = useState<{ weekday: string; weekend: string; bed: string } | null>(null)
  const [bed, setBed] = useState('')
  const [wake, setWake] = useState('')
  useEffect(() => {
    life.sleep
      .state()
      .then((st: any) => {
        const t = { weekday: st.weekdayTarget ?? '07:00', weekend: st.weekendTarget ?? '08:30', bed: st.bedTarget ?? '23:00' }
        setSleepT(t)
        setBed(t.bed)
        setWake(tomorrowWeekend ? t.weekend : t.weekday)
      })
      .catch(() => {})
  }, [tomorrowWeekend])
  const sleepHours = (() => {
    const m = (x: string) => (/^\d{2}:\d{2}$/.test(x) ? Number(x.slice(0, 2)) * 60 + Number(x.slice(3)) : null)
    const b = m(bed)
    const w = m(wake)
    if (b == null || w == null) return null
    const d = (w - b + 1440) % 1440
    return `${Math.floor(d / 60)}h${d % 60 ? ` ${d % 60}m` : ''}`
  })()
  const save = async () => {
    if (sleepT && (bed !== sleepT.bed || wake !== (tomorrowWeekend ? sleepT.weekend : sleepT.weekday))) {
      await life.sleep.setTargets(tomorrowWeekend ? sleepT.weekday : wake, tomorrowWeekend ? wake : sleepT.weekend, bed).catch(() => null)
    }
    if (await act(() => life.focus.review(text || null, reasons.length ? reasons : ['Reviewed']), `Day closed. Bed by ${bed || '23:00'}, up at ${wake || '07:00'}. Sleep well.`)) {
      soundSuccess()
      onSaved()
    }
  }
  const left = [...openMustDos.map((m) => ({ id: `m:${m}`, title: m, todo: null as TodoTask | null })), ...openTodo.map((t) => ({ id: t.id, title: t.content, todo: t }))].filter((x) => !moved.includes(x.id))
  // Ben's review of the day (score, lesson, tomorrow's top 3) sits in here, not in a card of its own.
  const [review, setReview] = useState<{ score: number; lesson?: string; top3: string[] } | null>(null)
  useEffect(() => {
    life.coach?.rhythm?.('state').then((d: any) => setReview(d?.state?.evening ?? null)).catch(() => {})
  }, [])
  const moveAll = async () => {
    const all = left
    setMoved((m) => [...m, ...all.map((x) => x.id)])
    for (const x of all) await (x.todo ? onTomorrow(x.todo) : onMustDoTomorrow(x.title)).catch(() => null)
  }
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
      {review && (
        <div className="mode-review">
          <span className={`mode-score ${review.score >= 70 ? 'good' : ''}`}>{review.score}</span>
          <div>
            <b>Ben's review</b>
            {review.lesson && <p>{review.lesson}</p>}
            {review.top3.length > 0 && <small>Tomorrow: {review.top3.join(' · ')}</small>}
          </div>
        </div>
      )}
      <ol className="mode-steps">
        <li className={left.length ? '' : 'done'}>
          <b>
            1. What's left{left.length > 1 && (
              <button className="btn small mode-all" onClick={() => void moveAll()}>
                Move all {left.length} to tomorrow
              </button>
            )}
          </b>
          {left.length ? (
            <ul className="mode-left">
              {left.map((x) => (
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
            <span className="hint">Nothing left for {today === localToday() ? 'today' : 'the day'}. Clean finish.</span>
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
        <li>
          <b>3. Bed and tomorrow</b>
          <div className="mode-sleep">
            <label>
              Bed by <input type="time" value={bed} onChange={(e) => setBed(e.target.value)} />
            </label>
            <label>
              Up at <input type="time" value={wake} onChange={(e) => setWake(e.target.value)} />
            </label>
            {sleepHours && <span className="hint">{sleepHours} of sleep</span>}
          </div>
          <span className="hint small">Changes your {tomorrowWeekend ? 'weekend' : 'weekday'} wake-up target and your bedtime target (Waky and reminders use them).</span>
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

/** A quick "+ Add to University" under each area (due today unless you say when). */
function AreaAdd({ name, onAdd }: { name: string; onAdd: (v: string) => Promise<boolean> }) {
  const [v, setV] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="dl-area-add"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!v.trim() || busy) return
        setBusy(true)
        if (await onAdd(v)) setV('')
        setBusy(false)
      }}
    >
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder={`+ Add to ${name} (today, or "fri 18:00")`} maxLength={300} disabled={busy} />
    </form>
  )
}


type TodoTab = 'today' | 'tomorrow' | 'nodate' | 'week' | 'all'
const TODO_TABS: [TodoTab, string][] = [
  ['today', 'Today'],
  ['tomorrow', 'Tomorrow'],
  ['nodate', 'No date'],
  ['week', 'Next 7 days'],
  ['all', 'All']
]

/** Every task of a tab, numbered and grouped by area (with a count per area). */
function TabList({ tasks, empty, groupOf, row, quick }: { tasks: TodoTask[]; empty: string; groupOf: (t: TodoTask) => { key: string; name: string; color: string }; row: (t: TodoTask, group: string, extra: React.ReactNode) => React.ReactNode; quick: (t: TodoTask) => React.ReactNode }) {
  if (!tasks.length) return <p className="hint dl-empty">{empty}</p>
  const groups: { key: string; name: string; color: string; items: TodoTask[] }[] = []
  for (const t of tasks) {
    const g = groupOf(t)
    let x = groups.find((y) => y.key === g.key)
    if (!x) groups.push((x = { ...g, items: [] }))
    x.items.push(t)
  }
  return (
    <div className="dl-tablist">
      {groups.map((g) => (
        <div key={g.key} className="dl-group" style={{ ['--c' as string]: g.color }}>
          <h3 className="dl-head">
            <i /> {g.name} <small>{g.items.length}</small>
          </h3>
          <ul className="dl">{g.items.map((t) => row(t, g.key, quick(t)))}</ul>
        </div>
      ))}
    </div>
  )
}

/** The running timer's moving parts, each redrawing itself every second (the list around them doesn't). */
function RunningClock({ run, part }: { run: { startedAt: string; planned: number }; part: 'left' | 'clock' | 'bar' }) {
  const tick = useTicker(true)
  const elapsed = tick - new Date(run.startedAt).getTime()
  const leftMs = run.planned * 60000 - elapsed
  if (part === 'clock') return <span className="now-clock">{clock(elapsed)}</span>
  if (part === 'bar')
    return (
      <div className="now-bar">
        <i style={{ width: `${Math.min(100, (elapsed / (run.planned * 60000)) * 100)}%` }} />
      </div>
    )
  return <>{leftMs > 0 ? `${clock(leftMs)} left of ${run.planned} min` : `${run.planned} min done — stop to log it`}</>
}

/** A tick every 30 s while `on` (enough for "which block is on now"). */
function useSlowTick(on: boolean): number {
  const [t, setT] = useState(Date.now())
  useEffect(() => {
    if (!on) return
    const id = setInterval(() => setT(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [on])
  return t
}
