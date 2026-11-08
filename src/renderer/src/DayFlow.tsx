// Today's core: the morning plan / evening shut-down cards, the "Now" card
// (one next step, a live timer while focusing), habit chips, and one list:
// must-dos, the week's big 3 and today's Todoist, grouped by area.
import { askConfirm } from './confirmSheet'
import { appHour } from '@core/dates'
import { bookMinutes, bookTask as bookIntoCalendar } from './booking'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { capture } from './capture'
import { nowActions, type NowAction } from '@core/nextAction'
import { decideNow, type DoNow } from '@core/doNow'
import { publishNow } from './nowStore'
import { TODAY_LABEL, areaKey, deadlineRadar, defaultAreaColor, isStarred, plainName, sortToday, toApiPriority, whenText, type Area, type TodoTask } from '@core/todoist'
import type { FocusTask } from '@shared/api'
import { life } from './bridge'
import { Icon } from './Icon'
import { useFocus } from './pages/Focus'
import { LABEL as WEEK_LABEL, useWeekPlan } from './WeekPlanner'
import { Skeleton } from './blocks'
import { useSwipeRows } from './swipe'
import { TodayTaskRow, withToday } from './TodayTaskRow'
import { calendarToday, reloadToday, useTodayEvents } from './todayEvents'
import { nextSlot, planMustDos } from '@core/benActs'
import { blockSubject, isFocusBlock } from '@core/dayTime'
import { activePlan } from '@core/weekPlan'
import { play, soundCoin, soundSuccess } from './soundKit'
import { useAction, useToast } from './ui'
import { useLive } from './live'
import { addDays, dayKey } from '@core/dates'
import { PLAN_ITEM_COINS, isPlanFor, type PlanItem } from '@core/focus'
import { BIG3_POINTS } from '../../main/points'
import { MissTwiceNote, useMyHabits } from './MyHabits'
import { HabitBoard } from './habits/HabitBoard'
import { MustDos, type TopItem } from './habits/MustDos'
import { OtherTasks, type OtherItem } from './dayflow/OtherTasks'
import { moveBefore } from '@core/habitBoard'
import { useLifeMode } from './LifeMode'
import { modeTarget } from '@core/lifeMode'
import { type DayFlowProps, useTodoist, useHabits } from './dayflow/hooks'
import { subjectOf, todoSubject, clock, tomorrowOf, storeGet, storeSet } from './dayflow/util'
import { ShutDown } from './dayflow/ShutDown'
import { AreaAdd, type TodoTab, TabList, RunningClock, useSlowTick } from './dayflow/parts'
import { celebrate } from './fx'
import { MoneyPill } from './MoneyQuick'
import { Tick } from './motionKit'


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

export function DayFlow(props: DayFlowProps) {
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
  const [lifeMode] = useLifeMode()
  const focusTarget = modeTarget(50, lifeMode?.current ?? null)
  const habits = useHabits(props, st?.todayMin ?? 0, () => setSpendOpen(true), own, reloadOwn, focusTarget)
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
  // A free day: "No spending today" ticks Log spending once (same pay as a spend), today only.
  const [freeToday, setFreeToday] = useState(false)
  useEffect(() => {
    if (!spendOpen) return
    life.finance?.freeDays().then((d) => setFreeToday(d.includes(summary.today))).catch(() => {})
  }, [spendOpen, summary.today])
  const markFree = async () => {
    if (!life.finance || spendBusy) return
    const r = await spendAct(() => life.finance!.freeDay(), 'No spending today. Nice.')
    if (r) {
      setFreeToday(true)
      if (r.paid > 0) soundCoin()
      window.dispatchEvent(new CustomEvent('life-wallet-changed'))
      props.onChange()
    }
  }
  const undoFree = async () => {
    const r = life.finance ? await spendAct(() => life.finance!.undoFreeDay(), 'Free day taken back') : null
    if (r) {
      setFreeToday(false)
      window.dispatchEvent(new CustomEvent('life-wallet-changed'))
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
    // "Plan my day" in the ⋯ on Today's top line opens the morning card.
    const plan = () => setForced('morning')
    window.addEventListener('life-close-day', on)
    window.addEventListener('life-plan-day', plan)
    return () => {
      window.removeEventListener('life-close-day', on)
      window.removeEventListener('life-plan-day', plan)
    }
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
    if (r.plan.items[i]?.done) celebrate(null, 'mustdo')
    // Two notes up; the coin after them when it paid.
    play('mustDo')
    if (r.coins) setTimeout(() => play('coin'), 260)
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
      if (b && !b.done) celebrate(null, 'mustdo')
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
  // Today's tabs: the rest of today's tasks live on the Tasks tab (one DayFlow, shown in two places).
  const tasksRef = useRef<HTMLElement>(null)
  useSwipeRows(tasksRef, onSwipe)
  const slotted = props.tasksSlot !== undefined

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
    const p = toApiPriority(Number(e.key))
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

  // Today's tab counts (Tasks 11, Now 1/3), told to the page when they change.
  const countsNow = useRef<{ tasks: number; late: number; mustDone: number; mustTotal: number } | null>(null)
  const countsSent = useRef('')
  useEffect(() => {
    const c = countsNow.current
    const key = JSON.stringify(c)
    if (!c || key === countsSent.current) return
    countsSent.current = key
    props.onCounts?.(c)
  })
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
  countsNow.current = { tasks: loose.length, late: lateCount, mustDone, mustTotal }
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

  // Small muted text on a task row: its time, how long, its area.
  const taskMeta = (t: TodoTask) => {
    const parts: string[] = []
    if (t.dueTime) parts.push(t.dueTime)
    if (t.duration) parts.push(t.duration >= 60 ? `${Math.floor(t.duration / 60)}h${t.duration % 60 ? ` ${t.duration % 60}m` : ''}` : `${t.duration} min`)
    const area = plainName(t.section || (t.project && t.project !== 'Inbox' ? t.project : '') || '')
    if (area) parts.push(area)
    return parts.join(' · ')
  }
  /** Drag in the Top 3: the day plan in its new order (done ones stay done). */
  const reorderTop = async (key: string, before: string | null) => {
    const ids = plan.map((_, i) => `p${i}`)
    if (!ids.includes(key)) return
    const next = moveBefore(ids, key, before && ids.includes(before) ? before : null).map((k) => plan[Number(k.slice(1))])
    if (await act(() => life.focus.setPlan(keepPlan(next)))) refresh()
  }
  const removeTop = async (i: number) => {
    if (await act(() => life.focus.setPlan(keepPlan(plan.filter((_, k) => k !== i))), `Out of the Top 3: ${plan[i].text}`)) refresh()
  }
  // The Top 3 are the day plan's must-dos (Ben, the island and Telegram read the same list);
  // a ⭐ Todoist task is ticked in Todoist too. Starred tasks not in the plan yet come after.
  const linked = (p: PlanItem) => (todo ?? []).find((t) => isPlanFor(p, t))
  const topItems: TopItem[] = [
    ...plan.map((p, i): TopItem => {
      const t = p.done ? undefined : linked(p)
      return {
        key: `p${i}`,
        text: p.text,
        done: p.done,
        pts: i < 3 ? `+${PLAN_ITEM_COINS}` : '',
        meta: t ? taskMeta(t) : undefined,
        swipe: t ? `star:${t.id}` : `must:${i}`,
        movable: true,
        onTick: () => void (t ? doneStarred(t) : tickMustDo(i)),
        onUnstar: t ? () => void unstar(t) : plan.length > 1 ? () => void removeTop(i) : undefined,
        play: playBtn(p.text, t ? todoSubject(t) : subjectOf(p.text), t ? { kind: 'todoist', ref: t.id, title: t.content } : { kind: 'mustdo', ref: p.text, title: p.text })
      }
    }),
    ...starred
      .filter((t) => !plan.some((p) => isPlanFor(p, t)))
      .map((t): TopItem => ({
        key: `s${t.id}`,
        text: t.content,
        done: false,
        pts: `+${taskPts}`,
        meta: taskMeta(t),
        swipe: `star:${t.id}`,
        onTick: () => void doneStarred(t),
        onUnstar: () => void unstar(t),
        play: playBtn(t.content, todoSubject(t), { kind: 'todoist', ref: t.id, title: t.content })
      }))
  ]
  const bigNamed = bigOpen.filter((b) => b.text)
  const mustDos = (
    <MustDos
      items={topItems}
      coins={PLAN_ITEM_COINS}
      canAdd={topItems.length < 3}
      adding={adding}
      setAdding={setAdding}
      onAdd={() => void addMustDo()}
      hasTodoist={!!life.todoist && todo !== null}
      week={bigNamed.length ? { done: bigNamed.filter((b) => b.done).length, total: bigNamed.length, names: bigNamed.map((b) => b.text) } : null}
      onReorder={(k, b) => void reorderTop(k, b)}
    />
  )
  // Everything else due today in one list: the week's open big 3, then Todoist (late and urgent first).
  const otherItems: OtherItem[] = [
    ...bigNamed
      .filter((b) => !b.done)
      .map((b): OtherItem => ({ key: `b${b.i}`, text: b.text, tag: 'This week', pts: `+${BIG3_POINTS}`, swipe: `big:${b.i}`, onDone: () => void toggleBig(b.i), play: playBtn(b.text, subjectOf(b.text), null) })),
    ...loose.map(
      (t): OtherItem => ({
        key: t.id,
        text: t.content,
        meta: taskMeta(t),
        late: !!t.due && t.due < today,
        pts: `+${taskPts}`,
        swipe: `todo:${t.id}`,
        leaving: leaving.includes(t.id),
        onDone: () => void doneTodo(t),
        onStar: () => void star(t),
        play: playBtn(t.content, todoSubject(t), { kind: 'todoist', ref: t.id, title: t.content })
      })
    )
  ]
  const addTask = async (v: string) => {
    if (!life.todoist) return false
    const ok = await act(() => life.todoist!.quickAdd(withToday(v)).then(() => true), `Added for today: ${v}`)
    if (ok) {
      void loadTodo()
      void loadAll()
    }
    return !!ok
  }
  const habitBoard = (
    <HabitBoard habits={habits} own={own} reloadOwn={reloadOwn} onChange={() => props.onChange()} focusTarget={focusTarget} actions={slotted ? <MoneyPill /> : undefined}>
      <MissTwiceNote v={own} />
      {spendOpen && (
        <form
          className="spend-line"
          onSubmit={(e) => {
            e.preventDefault()
            void saveSpend()
          }}
        >
          <input autoFocus value={spendText} onChange={(e) => setSpendText(e.target.value)} placeholder="45 lunch · 120 groceries · 30 taxi" aria-label="What you spent" onKeyDown={(e) => e.key === 'Escape' && setSpendOpen(false)} />
          <button className="btn primary small" disabled={!spendText.trim() || spendBusy}>{spendBusy ? 'Saving…' : 'Log'}</button>
          {life.finance && (freeToday ? (
            <button type="button" className="btn ghost small" data-testid="free-day" onClick={() => void undoFree()} title="Take the free day back">✓ No spending today · Undo</button>
          ) : (
            <button type="button" className="btn small" data-testid="free-day" onClick={() => void markFree()} title="Spent nothing today? Count it as done">No spending today</button>
          ))}
          <button type="button" className="btn ghost small" onClick={() => props.onOpenApp('money')} title="Open Finance Helper">Finance Helper</button>
          <button type="button" className="btn ghost small" onClick={() => setSpendOpen(false)} aria-label="Close">✕</button>
        </form>
      )}
    </HabitBoard>
  )

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
                    if (ok) {
                      window.dispatchEvent(new CustomEvent('life-external-changed'))
                      window.dispatchEvent(new CustomEvent('life-show-plan'))
                    }
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

      {slotted ? (
        <section className="now-grid" aria-label="Today's list" ref={listRef}>
          <div className="card now-list">
            {mustDos}
            <OtherTasks
              items={otherItems}
              canAdd={!!life.todoist && todo !== null}
              onAdd={addTask}
              starFull={topItems.length >= 3}
              empty={todo === null ? 'Connect Todoist in Settings to see your tasks here.' : todoList && todoList.length === 0 ? 'Nothing else due today.' : 'All your tasks for today are in the Top 3.'}
            />
          </div>
          <div className="card now-habits">{habitBoard}</div>
        </section>
      ) : (
      <section className="card day-list" aria-label="Today's list" ref={listRef}>
        {habitBoard}
          <>
        <div className="dl-tabs" role="tablist" aria-label="Which tasks">
          {TODO_TABS.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
              {label}
              {!(slotted && id === 'today') && <i>{id === 'today' ? (todoList?.length ?? 0) + planOnly.length : tabTasks(id).length}</i>}
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
        {mustDos}
        {bigOpen.length > 0 && !bigOpen.every((b) => b.done) && (
          <div className="dl-group" style={{ ['--c' as string]: 'var(--gold)' }}>
            <h3 className="dl-head">
              <i /> This week's big 3 <small>+25 each</small>
            </h3>
            <ul className="dl">
              {bigOpen.map((b) => (
                <li key={`b${b.i}`} className={b.done ? 'done' : ''} data-swipe={b.done ? undefined : `big:${b.i}`}>
                  <button className="dl-check" aria-label={b.done ? `Untick ${b.text}` : `Tick ${b.text}`} onClick={() => void toggleBig(b.i)}>
                    {b.done ? <Tick /> : ''}
                  </button>
                  <span className="dl-text">{b.text}</span>
                  <span className="tt-pts">+{BIG3_POINTS} ⭐</span>
                  {!b.done && playBtn(b.text, subjectOf(b.text), null)}
                </li>
              ))}
            </ul>
          </div>
        )}
        {bigOpen.length > 0 && !!week?.parked?.length && (
          <p className="dl-parked" title="You picked these for later this week: still here, Ben won't push them">
            Parked: {week.parked.join(' · ')}
          </p>
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
          </>
      </section>
      )}
      {slotted && props.tasksSlot && createPortal(
        <section className="card day-list dl-tasks" aria-label="Today's tasks" ref={tasksRef}>
        <div className="dl-tabs" role="tablist" aria-label="Which tasks">
          {TODO_TABS.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
              {label}
              {!(slotted && id === 'today') && <i>{id === 'today' ? (todoList?.length ?? 0) + planOnly.length : tabTasks(id).length}</i>}
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
          {tab === 'today' && (
            <>
              {loose.length > 0 && (
                <div className="dl-rest-open">
                  <h3 className="dl-sec">
                    Everything else today
                    <small>
                      {loose.length} task{loose.length === 1 ? '' : 's'}
                      {lateCount ? ` · ${lateCount} late` : ''}
                    </small>
                  </h3>
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

                </div>
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
            </>
          )}
        </section>,
        props.tasksSlot
      )}
      {slotted && props.weekSlot && week?.focus && createPortal(
        <p className="hint dl-week" onClick={() => onGo('progress')}>
          <Icon name="trophy" size={13} /> Week focus: <b>{week.note || WEEK_LABEL[week.focus] || week.focus}</b>
        </p>,
        props.weekSlot
      )}
    </div>
  )
}

const TODO_TABS: [TodoTab, string][] = [
  ['today', 'Today'],
  ['tomorrow', 'Tomorrow'],
  ['nodate', 'No date'],
  ['week', 'Next 7 days'],
  ['all', 'All']
]
