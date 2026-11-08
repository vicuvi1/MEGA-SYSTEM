// Sport Track's data for Body → Today (this device's copy, readSport): the
// strength rank, today's workout (the plan's session when you follow the plan,
// else your own routine), the next harder move, hard sets per muscle this week
// (the body map) and yesterday's load. Read only: nothing here writes or pays.
import { useEffect, useState } from 'react'
import { dayKey } from '@core/dates'
import { overallRank, placeAll, type Rank } from '@core/sportLevels'
import { weekPlan, type PlanSession, type ProgramPrefs } from '@core/sportProgram'
import { moveOf, nextStep, suggestHarder, type SportEx } from '@core/sportLadders'
import { hardSetsByMuscle, mondayOf, shiftDay, type Muscle } from '@core/sportSets'
import type { Move } from '@core/sportMoves'
import { readSport, SPORT_KEY } from '../../sportTrack'

export interface RoutineItem {
  id: string
  name: string
  done: number
  target: number
  unit: string
}

export interface SportToday {
  today: string
  exercises: SportEx[]
  rank: Rank | null
  /** Following the week plan (opt-in in Sport Track). */
  planOn: boolean
  /** Today's plan session (null: no session today, or not following the plan). */
  session: PlanSession | null
  /** The week plan has no session today (only when following the plan). */
  plannedRest: boolean
  planMinutes: number
  routine: RoutineItem[]
  /** The next harder move: a ladder step you are ready for, else the next step of your main move. */
  harder: { from: string; to: Move; ready: boolean } | null
  /** Hard sets per muscle this week (Monday to Sunday). */
  week: Record<Muscle, number>
  ydaySets: number
  /** Sport Track sets logged today. */
  setsToday: boolean
}

const nice = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

export function sportToday(st: any, today = dayKey(new Date())): SportToday | null {
  if (!st || !Array.isArray(st.exercises)) return null
  const exercises: SportEx[] = st.exercises
  const active = exercises.filter((e: any) => e.active !== false)
  const ss = st.sportySettings ?? {}
  const planMinutes = [20, 30, 45].includes(Number(ss.planMinutes)) ? Number(ss.planMinutes) : 30
  const prefs: ProgramPrefs = { minutes: planMinutes, perWeek: ss.planPerWeek === 4 ? 4 : 3, coolDown: !!ss.planCool }
  const planOn = ss.planFollow === true
  let session: PlanSession | null = null
  let plannedRest = false
  if (planOn) {
    try {
      session = weekPlan(exercises, prefs, today).find((d) => d.day === today)?.session ?? null
      plannedRest = !session
    } catch {
      session = null
    }
  }
  let rank: Rank | null = null
  try {
    const places = placeAll({ exercises, days: st.days || {}, sets: st.sets || {}, today, best: st.bestSets || {}, imported: st.importedDays || {} })
    rank = overallRank(places)
  } catch {
    rank = null
  }
  const routine: RoutineItem[] = active.map((e: any) => ({ id: String(e.id), name: nice(String(e.name || '')), done: Math.max(0, Number(e.doneToday) || 0), target: Math.max(0, Number(e.target) || 0), unit: String(e.unit || 'reps') }))
  let harder: SportToday['harder'] = null
  try {
    const s = suggestHarder({ exercises: active, days: st.days || {}, today, notYet: st.notYet || {} })[0]
    if (s) harder = { from: s.from.name, to: s.to, ready: true }
  } catch {
    /* no suggestion */
  }
  if (!harder) {
    for (const e of active) {
      const m = moveOf(e)
      const n = m ? nextStep(m) : null
      if (m && n) {
        harder = { from: m.name, to: n, ready: false }
        break
      }
    }
  }
  const mon = mondayOf(today)
  const yday = shiftDay(today, -1)
  const sum = (r: Record<Muscle, number>) => r.push + r.pull + r.core + r.legs
  return {
    today,
    exercises,
    rank,
    planOn,
    session,
    plannedRest,
    planMinutes,
    routine,
    harder,
    week: hardSetsByMuscle(st.sets, exercises, mon, shiftDay(mon, 6)),
    ydaySets: sum(hardSetsByMuscle(st.sets, exercises, yday, yday)),
    setsToday: Object.keys(st.sets?.[today] ?? {}).length > 0
  }
}

export function useSportToday(): SportToday | null {
  const [data, setData] = useState<SportToday | null>(() => sportToday(readSport()))
  useEffect(() => {
    const re = () => setData(sportToday(readSport()))
    re()
    const onStorage = (e: StorageEvent) => (e.key == null || e.key === SPORT_KEY) && re()
    window.addEventListener('storage', onStorage)
    window.addEventListener('life-sport-changed', re)
    window.addEventListener('life-body-changed', re)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('life-sport-changed', re)
      window.removeEventListener('life-body-changed', re)
    }
  }, [])
  return data
}
