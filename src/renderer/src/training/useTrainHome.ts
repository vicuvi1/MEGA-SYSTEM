// Data for Sport Track's sections: Sport Track's state (through the
// same store as Body → Training), today's readiness and dose, the food
// counter's day and the latest body composition. Only real data: anything
// not logged stays null and the card shows an empty state.
import { useCallback, useEffect, useState } from 'react'
import type { TrainReady } from '@core/trainReadiness'
import { nightMinutes } from '@core/readiness'
import type { DayProgress } from '@core/foodProgress'
import { life } from '../bridge'
import { readSoreness } from '../body/useBodyPlus'

/** Today's readiness (null: the bridge has none). `thin`: no sleep and no soreness logged, so no real score. */
export function useTrainReady(today: string): { tr: TrainReady | null; thin: boolean; setDose: (m: TrainReady['mode'] | null) => Promise<void> } {
  const [tr, setTr] = useState<TrainReady | null>(null)
  const [slept, setSlept] = useState<boolean>(false)
  const load = useCallback(() => {
    void life.coach?.bodyPlus
      ?.ready(readSoreness(today))
      .then(setTr)
      .catch(() => {})
    void life.sleep
      .state()
      .then((s) => setSlept(nightMinutes(s.todayLog) != null))
      .catch(() => {})
  }, [today])
  useEffect(() => {
    load()
    const ev = ['life-body-changed', 'life-sleep-changed']
    for (const e of ev) window.addEventListener(e, load)
    return () => {
      for (const e of ev) window.removeEventListener(e, load)
    }
  }, [load])
  const setDose = async (m: TrainReady['mode'] | null) => {
    const bp = life.coach?.bodyPlus
    if (!bp) return
    const next = await bp.setDose(m, readSoreness(today)).catch(() => null)
    if (next) setTr(next)
    window.dispatchEvent(new CustomEvent('life-body-changed'))
  }
  return { tr, thin: !slept && readSoreness(today) == null, setDose }
}

export interface TodayFood {
  progress: DayProgress
  carbs: { eaten: number; goal: number }
  fat: { eaten: number; goal: number }
  meals: number
}

/** The food counter's today (null: no food counter here). */
export function useTodayFood(): TodayFood | null {
  const [f, setF] = useState<TodayFood | null>(null)
  useEffect(() => {
    const api = life.coach?.food
    if (!api) return
    let live = true
    const load = () =>
      void api
        .view()
        .then((v) => {
          if (!live) return
          const t = v.totals.targets
          setF({ progress: v.progress, carbs: { eaten: v.carbs, goal: Math.round(t.carbs || 0) }, fat: { eaten: v.fat, goal: Math.round(t.fat || 0) }, meals: v.meals.filter((m) => !m.removed).length })
        })
        .catch(() => {})
    load()
    const ev = ['life-body-changed', 'life-food-changed', 'life-external-changed']
    for (const e of ev) window.addEventListener(e, load)
    return () => {
      live = false
      for (const e of ev) window.removeEventListener(e, load)
    }
  }, [])
  return f
}
