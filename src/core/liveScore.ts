// Today's score while the day is still going, and what each open thing
// would add to it: "Sport 20 min +13 · 25 min focus +15 · Workout +15".
// Same weights as Ben's evening review (dayScore): must-dos 40, focus 30,
// water 15, training 15. Pure and tested.
import { dayScore } from './rhythm'

export interface LiveFacts {
  mustDone: number
  openMustDos: string[]
  focusMin: number
  /** Focus planned or the daily goal (at least 50). */
  focusGoal: number
  waterMl: number
  waterTarget: number
  workoutDone: boolean
}

export interface Gain {
  kind: 'mustdo' | 'focus' | 'water' | 'workout'
  label: string
  points: number
}

export function liveScore(f: LiveFacts): { score: number; gains: Gain[] } {
  const total = f.mustDone + f.openMustDos.length
  const base = { mustdosDone: f.mustDone, mustdosTotal: total, focusMin: f.focusMin, plannedFocusMin: f.focusGoal, blocksDone: 0, blocksPlanned: 0, waterMl: f.waterMl, waterTarget: f.waterTarget, workoutDone: f.workoutDone, trainingPlanned: true }
  const score = dayScore(base)
  const gains: Gain[] = []
  for (const m of f.openMustDos) {
    const g = dayScore({ ...base, mustdosDone: base.mustdosDone + 1 }) - score
    if (g > 0) gains.push({ kind: 'mustdo', label: m, points: g })
  }
  const goal = Math.max(50, f.focusGoal)
  if (f.focusMin < goal) {
    const add = Math.min(25, goal - f.focusMin)
    const g = dayScore({ ...base, focusMin: f.focusMin + add }) - score
    if (g > 0) gains.push({ kind: 'focus', label: `${add} min focus`, points: g })
  }
  if (!f.workoutDone) gains.push({ kind: 'workout', label: 'Workout', points: dayScore({ ...base, workoutDone: true }) - score })
  if (f.waterTarget && f.waterMl < f.waterTarget) {
    const add = Math.min(500, f.waterTarget - f.waterMl)
    const g = dayScore({ ...base, waterMl: f.waterMl + add }) - score
    if (g > 0) gains.push({ kind: 'water', label: `${add} ml water`, points: g })
  }
  return { score, gains: gains.filter((g) => g.points > 0).sort((a, b) => b.points - a.points) }
}

/** Days in a row with at least `goal` minutes of focus, counting from today (or yesterday while today isn't there yet). */
export function focusStreak(week: { day: string; min: number }[], goal = 50): number {
  const days = [...week].sort((a, b) => b.day.localeCompare(a.day))
  let i = days[0] && days[0].min < goal ? 1 : 0
  let n = 0
  for (; i < days.length && days[i].min >= goal; i++) n++
  return n
}
