// Today's data hooks (LT11: split out of DayFlow.tsx): Todoist's today and the habit chips.
import { useCallback, useEffect, useState } from 'react'
import type { TodoTask } from '@core/todoist'
import type { BodyState, ConnectionsState, DisciplineState, Rule, Summary } from '@shared/api'
import { life } from '../bridge'
import { createTodayList } from '../web/todoRefresh'
import type { PageId } from '../modules'
import { play } from '../soundKit'
import { useAction } from '../ui'
import { useLive } from '../live'
import { useTapHabit } from '../MyHabits'
import type { HabitsView } from '../web/lifeExtras'
import { GROOMING_OPEN, useGrooming } from '../habits/GroomingSheet'

export interface DayFlowProps {
  summary: Summary
  discipline: DisciplineState | null
  connections: ConnectionsState | null
  body: BodyState | null
  onChange: (s?: Summary) => void
  onGo: (p: PageId) => void
  onOpenApp: (p: PageId) => void
  /** The point rules, so each habit shows what it really pays. */
  rules?: Rule[]
  /** Today's tabs: where the rest of today's tasks (and coming up) go, and the week focus line. */
  tasksSlot?: HTMLElement | null
  weekSlot?: HTMLElement | null
  /** Today's tabs show small counts. */
  onCounts?: (c: { tasks: number; late: number; mustDone: number; mustTotal: number }) => void
  /** Habits shown elsewhere on the page (the coach card's workout), folded out of the list. */
  fold?: string[]
}

const todayList = createTodayList(() => life.todoist!.today())

export function useTodoist() {
  const [tasks, setTasks] = useState<TodoTask[] | null>(null)
  const load = useCallback(async () => {
    if (!life.todoist || !(await life.todoist.status()).connected) return setTasks(null)
    // Every load asks Todoist again; a failed read keeps the last list instead of emptying it.
    setTasks(await todayList.refresh().catch(() => []))
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  // Live: tasks added or done on Telegram or in Todoist itself show up by themselves.
  useLive(() => void load(), { external: true })
  return [tasks, load, setTasks] as const
}


export interface Habit {
  id: string
  label: string
  hint: string
  done: boolean
  /**
   * Does the habit's own thing: a tap habit logs it (and pays it once, by its
   * rule); an auto habit opens or starts what really counts (Sport Track, the
   * focus timer, the spending line) and never ticks itself. Resolves true when
   * something was logged.
   */
  run: () => void | Promise<boolean | void>
  /** What it pays when done, from the real rule ("+3", "+3 per 10 min"); '' when it pays nothing. */
  pays: string
  /** Ticks itself from another app; a tap only opens that app (never pays). */
  auto?: boolean
  /** Where it's logged from ("Sport Track", "Focus timer", "Finance", "Discipline"). */
  source?: string
  /** What a tap does on an auto habit ("Start 50 min", "Open Sport Track"). */
  action?: string
  /** Live progress for an auto habit (32 of 50 minutes). */
  progress?: { value: number; target: number; unit: string }
  /** Your own habit's id (own:<id> is its board id). */
  ownId?: string
  /** A shorter name for the tile ("Focus 50 min"). */
  short?: string
  /** A tap opens its checklist (Grooming), done or not; the steps pay, never the tap. */
  sheet?: boolean
}

export function useHabits({ summary, discipline, connections, body, onChange, onGo, rules }: DayFlowProps, focusMin: number, onSpend: () => void, own: HabitsView | null, reloadOwn: () => void, focusTarget = 50): Habit[] {
  const act = useAction()
  const groom = useGrooming()
  const tapOwn = useTapHabit(() => {
    reloadOwn()
    onChange()
  })
  const r = summary.todayRules ?? []
  const coins = (id: string, fallback: number) => rules?.find((x) => x.id === id)?.coins ?? fallback
  const pts = (id: string, fallback: number) => `+${coins(id, fallback)}`
  // A soft pluck that climbs with each habit done today.
  let doneToday = 0
  const pluck = () => play('habit', { step: doneToday })
  const done = async (p: Promise<unknown> | undefined): Promise<boolean> => {
    if (await p) {
      pluck()
      onChange()
      return true
    }
    return false
  }
  const focusMins = Math.min(90, focusTarget)
  const list: Habit[] = [
    { id: 'oath', label: 'Morning oath', hint: pts('discipline.oath', 1), pays: pts('discipline.oath', 1), source: 'Discipline', done: !!(discipline?.oathToday || r.includes('discipline.oath')), run: () => done(act(() => life.discipline.oath(), 'Oath taken')) },
    { id: 'clean', label: 'Clean day check-in', short: 'Clean day', hint: discipline?.setup ? `day ${discipline.day ?? discipline.current} · ${pts('discipline.clean_day', 3)}` : pts('discipline.clean_day', 3), pays: pts('discipline.clean_day', 3), source: discipline?.setup ? `Discipline · day ${discipline.day ?? discipline.current}` : 'Discipline', done: !!(discipline?.checkedInToday || r.includes('discipline.clean_day')), run: () => done(act(() => life.discipline.checkIn(), 'Checked in')) },
    { id: 'workout', label: 'Workout', hint: pts('body.workout_done', 3), pays: pts('body.workout_done', 3), auto: true, source: 'Sport Track', action: 'Open Sport Track', done: !!(body?.workoutDoneToday || body?.restToday || r.includes('body.workout_done')), run: () => onGo('body') },
    { id: 'focus', label: `${focusTarget} minutes of focus`, short: `Focus ${focusTarget} min`, hint: focusMin ? `${focusMin} min so far · +3 per 10 min` : '+3 per 10 min', pays: '+3 / 10 min', auto: true, source: 'Focus timer', action: `Start ${focusMins} min`, progress: { value: Math.min(focusMin, focusTarget), target: focusTarget, unit: 'min' }, done: focusMin >= focusTarget || r.includes('study.block_done'), run: () => void act(() => life.focus.start('Focus', focusMins), `Focus started: ${focusMins} minutes`).then((ok) => ok && onChange()) },
    // BD15: one habit with steps (morning and night, weekly nails and haircut); it pays once, when every step is ticked.
    life.care
      ? { id: 'skincare', label: 'Grooming', hint: pts('face.routine_done', 2), pays: pts('face.routine_done', 2), source: 'Morning and night steps', sheet: true, ...(groom ? { progress: { value: groom.day.done, target: groom.day.total, unit: 'steps' } } : {}), done: r.includes('face.routine_done') || !!groom?.day.complete, run: () => (window.dispatchEvent(new CustomEvent(GROOMING_OPEN)), Promise.resolve(false)) }
      : { id: 'skincare', label: 'Skincare', hint: pts('face.routine_done', 2), pays: pts('face.routine_done', 2), done: r.includes('face.routine_done'), run: () => done(act(() => life.wallet.award('face.routine_done'), 'Skincare done')) },
    { id: 'spending', label: "Log today's spending", short: 'Log spending', hint: pts('money.logged', 1), pays: pts('money.logged', 1), auto: true, source: 'Finance', action: 'Log spending', done: !!(connections?.finance.today?.logged || r.includes('money.logged')), run: onSpend },
    // Your own habits (FT1): +2 only for the tap, once a day each.
    ...(own?.rows ?? []).map((h) => ({ id: `own:${h.id}`, ownId: h.id, label: h.name, hint: `${own?.pays ? `+${own.pays}` : ''}${h.streak ? ` · 🔥${h.streak}` : ''}`.replace(/^ · /, '') || 'tap when done', pays: own?.pays ? `+${own.pays}` : '', source: 'Your habit', done: h.done, run: () => tapOwn(h.id, h.name).then((ok) => (ok && pluck(), ok)) }))
  ]
  doneToday = list.filter((h) => h.done).length
  return list
}
