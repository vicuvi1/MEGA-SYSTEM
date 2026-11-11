// Today's score while the day is still going, and what each open thing
// would add to it: "Sport 25 min +11 · Start a focus block +11".
// Since the feature freeze (2026-11-11) this is the honest day score of the
// 3 numbers (core/threeNumbers.ts): sleep, focus blocks started, must-dos out
// of 3. An empty day is 0. Pure and tested.
import { FOCUS_GOAL, MUST_DOS, honestScore, type SleepNight } from './threeNumbers'

export interface LiveFacts {
  mustDone: number
  openMustDos: string[]
  /** Focus blocks started today (a running one counts). */
  focusBlocks: number
  /** Last night, or null when not logged. */
  sleep: SleepNight | null
}

export interface Gain {
  kind: 'mustdo' | 'focus'
  label: string
  points: number
}

export function liveScore(f: LiveFacts): { score: number; gains: Gain[] } {
  const total = f.mustDone + f.openMustDos.length
  const base = { sleep: f.sleep, focusBlocks: f.focusBlocks, mustDone: f.mustDone, mustTotal: total }
  const score = honestScore(base).score
  const gains: Gain[] = []
  let done = f.mustDone
  for (const m of f.openMustDos) {
    if (done >= MUST_DOS) break
    const g = honestScore({ ...base, mustDone: done + 1 }).score - honestScore({ ...base, mustDone: done }).score
    done++
    if (g > 0) gains.push({ kind: 'mustdo', label: m, points: g })
  }
  if (f.focusBlocks < FOCUS_GOAL) {
    const g = honestScore({ ...base, focusBlocks: f.focusBlocks + 1 }).score - score
    if (g > 0) gains.push({ kind: 'focus', label: 'Start a focus block', points: g })
  }
  return { score, gains: gains.sort((a, b) => b.points - a.points) }
}

/** Days in a row with at least `goal` minutes of focus, counting from today (or yesterday while today isn't there yet). */
export function focusStreak(week: { day: string; min: number }[], goal = 50): number {
  const days = [...week].sort((a, b) => b.day.localeCompare(a.day))
  let i = days[0] && days[0].min < goal ? 1 : 0
  let n = 0
  for (; i < days.length && days[i].min >= goal; i++) n++
  return n
}
