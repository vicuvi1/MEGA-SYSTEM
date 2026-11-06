// Today's data hooks (LT11: split out of DayFlow.tsx): Todoist's today and the habit chips.
import { useCallback, useEffect, useState } from 'react'
import type { TodoTask } from '@core/todoist'
import type { BodyState, ConnectionsState, DisciplineState, Rule, Summary } from '@shared/api'
import { life } from '../bridge'
import type { PageId } from '../modules'
import { play } from '../soundKit'
import { useAction } from '../ui'
import { useLive } from '../live'
import { useTapHabit } from '../MyHabits'
import type { HabitsView } from '../web/lifeExtras'

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
}

export interface Habit {
  id: string
  label: string
  hint: string
  done: boolean
  run: () => void | Promise<void>
}

export function useTodoist() {
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

export function useHabits({ summary, discipline, connections, body, onChange, onGo, rules }: DayFlowProps, focusMin: number, onSpend: () => void, own: HabitsView | null, reloadOwn: () => void, focusTarget = 50): Habit[] {
  const act = useAction()
  const tapOwn = useTapHabit(() => {
    reloadOwn()
    onChange()
  })
  const r = summary.todayRules ?? []
  const pts = (id: string, fallback: number) => `+${rules?.find((x) => x.id === id)?.coins ?? fallback}`
  // A soft pluck that climbs with each habit done today.
  let doneToday = 0
  const pluck = () => play('habit', { step: doneToday })
  const done = async (p: Promise<unknown> | undefined) => {
    if (await p) {
      pluck()
      onChange()
    }
  }
  const list: Habit[] = [
    { id: 'oath', label: 'Morning oath', hint: pts('discipline.oath', 1), done: !!(discipline?.oathToday || r.includes('discipline.oath')), run: () => done(act(() => life.discipline.oath(), 'Oath taken')) },
    { id: 'clean', label: 'Clean day check-in', hint: discipline?.setup ? `day ${discipline.day ?? discipline.current} · ${pts('discipline.clean_day', 3)}` : pts('discipline.clean_day', 3), done: !!(discipline?.checkedInToday || r.includes('discipline.clean_day')), run: () => done(act(() => life.discipline.checkIn(), 'Checked in')) },
    { id: 'workout', label: 'Workout', hint: pts('body.workout_done', 3), done: !!(body?.workoutDoneToday || body?.restToday || r.includes('body.workout_done')), run: () => onGo('body') },
    { id: 'focus', label: `${focusTarget} minutes of focus`, hint: focusMin ? `${focusMin} min so far · +3 per 10 min` : '+3 per 10 min', done: focusMin >= focusTarget || r.includes('study.block_done'), run: () => done(act(() => life.focus.start('Focus', Math.min(90, focusTarget)), `Focus started: ${Math.min(90, focusTarget)} minutes`)) },
    { id: 'skincare', label: 'Skincare', hint: pts('face.routine_done', 2), done: r.includes('face.routine_done'), run: () => done(act(() => life.wallet.award('face.routine_done'), 'Skincare done')) },
    { id: 'spending', label: "Log today's spending", hint: pts('money.logged', 1), done: !!(connections?.finance.today?.logged || r.includes('money.logged')), run: onSpend },
    // Your own habits (FT1): +2 only for the tap, once a day each.
    ...(own?.rows ?? []).map((h) => ({ id: `own:${h.id}`, label: h.name, hint: `${own?.pays ? `+${own.pays}` : ''}${h.streak ? ` · 🔥${h.streak}` : ''}`.replace(/^ · /, '') || 'tap when done', done: h.done, run: () => void tapOwn(h.id, h.name).then((ok) => ok && pluck()) }))
  ]
  doneToday = list.filter((h) => h.done).length
  return list
}
