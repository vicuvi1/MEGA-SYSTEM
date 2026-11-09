// "Try something harder": each family of moves is a ladder (sportMoves.ts
// FAMILIES). When you have hit your target comfortably a few sessions in a
// row, Sport Track suggests the next step: try one set of it, swap to it, or
// "not yet". Only your logged days count; nothing here pays points.
import { FAMILIES, moveById, matchMove, type Move } from './sportMoves'

export interface SportEx {
  id: string
  name: string
  target: number
  unit?: string
  active?: boolean
  /** The library move this exercise is (else it's guessed from the name). */
  move?: string
}
/** Reps per exercise per day: { 'YYYY-MM-DD': { exerciseId: count } }. */
export type DayLog = Record<string, Record<string, number>>

/** The library move an exercise is: the one it was added as, else by its name. A Body Training move
 *  the library doesn't have (`move: 't:<id>'`, trainLadders.ts) is none, never a guess from its name. */
export const moveOf = (ex: Pick<SportEx, 'name' | 'move'>): Move | null => (String(ex.move ?? '').startsWith('t:') ? null : moveById(ex.move) ?? matchMove(ex.name))

/** Where a move sits on its ladder: level 3 of 8. */
export function levelOf(move: Move): { level: number; of: number; family: string; familyName: string } {
  const f = FAMILIES[move.family]
  const i = f ? f.steps.indexOf(move.id) : -1
  return { level: i + 1, of: f ? f.steps.length : 1, family: move.family, familyName: f?.name ?? move.name }
}

export function nextStep(move: Move): Move | null {
  const f = FAMILIES[move.family]
  const i = f ? f.steps.indexOf(move.id) : -1
  return i >= 0 && i < f.steps.length - 1 ? moveById(f.steps[i + 1]) : null
}

export function prevStep(move: Move): Move | null {
  const f = FAMILIES[move.family]
  const i = f ? f.steps.indexOf(move.id) : -1
  return i > 0 ? moveById(f.steps[i - 1]) : null
}

const roundTo = (n: number, step: number) => Math.max(step, Math.round(n / step) * step)

/**
 * A fair daily target for the harder move: fewer reps the bigger the jump
 * (about 60% per difficulty point), never below one set or above its usual start.
 */
export function startTarget(from: Move | null, to: Move, currentTarget: number): number {
  if (!from || from.unit !== to.unit || !(currentTarget > 0)) return to.start
  const gap = Math.max(1, to.diff - from.diff)
  const scaled = currentTarget * Math.pow(0.6, gap)
  const step = to.unit === 'sec' ? 10 : scaled >= 20 ? 5 : 1
  return Math.min(Math.max(to.start, to.set), Math.max(to.set, roundTo(scaled, step)))
}

/**
 * Sessions in a row (newest first) where this exercise reached its target.
 * Days without that exercise are skipped; a session under 95% ends the run.
 */
export function targetRun(days: DayLog, exId: string, target: number, today: string): number {
  let run = 0
  for (const d of Object.keys(days).filter((d) => d <= today).sort().reverse()) {
    const v = Number(days[d]?.[exId]) || 0
    if (v <= 0) continue
    if (v >= target * 0.95) run++
    else break
  }
  return run
}

export interface Suggestion {
  exId: string
  from: Move
  to: Move
  /** Sessions in a row at target. */
  run: number
  /** One set to try, and the daily target if you swap. */
  trySet: number
  swapTarget: number
}

/**
 * The harder moves you're ready for: an active exercise at its target `need`
 * sessions in a row, whose next step isn't in your routine yet and isn't on
 * "not yet" (`notYet[moveId]` = the day it may come back).
 */
export function suggestHarder(input: { exercises: SportEx[]; days: DayLog; today: string; notYet?: Record<string, string>; need?: number }): Suggestion[] {
  const need = input.need ?? 3
  const inRoutine = new Set(input.exercises.filter((e) => e.active !== false).map((e) => moveOf(e)?.id).filter(Boolean) as string[])
  const out: Suggestion[] = []
  for (const ex of input.exercises) {
    if (ex.active === false) continue
    const from = moveOf(ex)
    const to = from && nextStep(from)
    if (!from || !to || inRoutine.has(to.id)) continue
    const back = input.notYet?.[to.id]
    if (back && back > input.today) continue
    const run = targetRun(input.days, ex.id, ex.target, input.today)
    if (run < need) continue
    out.push({ exId: ex.id, from, to, run, trySet: to.set, swapTarget: startTarget(from, to, ex.target) })
  }
  return out.sort((a, b) => b.run - a.run || a.to.diff - b.to.diff)
}

/** Library moves you have logged at least once (by the exercises they are). */
export function loggedMoves(days: DayLog, exercises: SportEx[]): Set<string> {
  const byEx = new Map(exercises.map((e) => [e.id, moveOf(e)?.id]))
  const out = new Set<string>()
  for (const m of Object.values(days)) for (const [id, v] of Object.entries(m ?? {})) if (Number(v) > 0 && byEx.get(id)) out.add(byEx.get(id)!)
  return out
}

export type StepState = 'done' | 'current' | 'next' | 'later'
/**
 * One family's ladder for you: the steps you've done (logged, or below
 * one you've logged), the one(s) in your routine, the next one, and later ones.
 */
export function ladderOf(family: string, logged: Set<string>, current: Set<string>): { move: Move; state: StepState }[] {
  const steps = (FAMILIES[family]?.steps ?? []).map((id) => moveById(id)!).filter(Boolean)
  const top = Math.max(-1, ...steps.map((m, i) => (logged.has(m.id) || current.has(m.id) ? i : -1)))
  return steps.map((move, i) => ({
    move,
    state: current.has(move.id) ? 'current' : i <= top ? 'done' : i === top + 1 ? 'next' : 'later'
  }))
}
