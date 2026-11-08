// "Too easy means harder, now" (Sport Track): the rank and level strip, an
// automatic harder variation when your target is above the rep range, the
// "Too easy" / "Too hard" buttons, a best-set entry, Strength mode and a
// balanced set for a thin routine. Pure and tested; nothing here pays points.
import { FAMILIES, moveById, type Move } from './sportMoves'
import { moveOf, nextStep, type SportEx } from './sportLadders'
import { muscleOf, type Muscle } from './sportSets'
import { coachFor, type CoachInput } from './sportCoach'
import { placeFamily, trackOf, transferReps, WORKING_OF_MAX, type Level, type Placement, type Rank } from './sportLevels'
import { rangeFor } from './sportProgress'

export type Effort = 'easy' | 'good' | 'hard'
const u = (m: Move) => (m.unit === 'sec' ? ' s' : '')
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
const stepOf = (m: Move) => (FAMILIES[m.family]?.steps ?? []).indexOf(m.id)

// ------------------------------------------------------------ the hero strip

/** "Trainee → Fighter, 8 pts" */
export function rankLine(r: Rank): string {
  return r.next ? `${r.rank.name} → ${r.next.name}, ${r.need} ${r.need === 1 ? 'pt' : 'pts'}` : `${r.rank.name}, the top rank`
}

export interface LevelBadge {
  level: number
  of: number
  name: string
  /** "Push-ups · Level 8 of 15 · Machine" */
  title: string
  /** 0–1 towards the next level. */
  frac: number
  /** "Next: Level 9 Wide Wings, 3×15 wide push-ups" or "Top of the ladder". */
  nextLine: string
}

export function levelBadge(p: Placement, label: string): LevelBadge {
  const name = p.lv?.name ?? ''
  return {
    level: p.level,
    of: p.of,
    name,
    title: `${label} · Level ${p.level} of ${p.of} · ${name}`,
    frac: p.next ? p.frac : 1,
    nextLine: p.next ? `Next: Level ${p.next.n} ${p.next.name}, ${p.next.req}` : 'Top of the ladder'
  }
}

// ------------------------------------------------------------ the automatic harder variation

export interface BoostInput extends CoachInput {
  /** A declared best set per family (see sportLevels `best`). */
  best?: Record<string, { move: string; reps: number; day: string }> | null
}

export interface Variation {
  exId: string
  from: Move
  to: Move
  sets: number
  reps: number
  /** "Level up: Diamond push-ups 3×8 (your 3×21 regular push-ups are now your warm-up)" */
  text: string
  /** What comes after: "Archer push-ups after 3×8". */
  after: string
  /** When there is no harder step: slow it down instead. */
  tempo: string | null
}

/** Slow tempo and pauses: the difficulty you can add when the ladder has no harder step. */
export function tempoAdvice(move: Move): string {
  return move.unit === 'sec' ? 'Add a second hand or foot lift, or hold 10 s longer with a squeeze.' : `Lower for 3 seconds, pause 1 second at the bottom, then press up fast. Same ${move.name.toLowerCase()}, much harder.`
}

/**
 * The next harder variation to switch Today to, or null. It fires when the target is above the move's range
 * (more reps would only be endurance), when Strength mode hits 3×8, or when your best set says the move is far too easy.
 * It picks the hardest variation you could still do at the bottom of its range (about 70% of the reps per step).
 */
export function autoVariation(input: BoostInput): Variation | null {
  const ex = input.exercises.find((e) => String(e.id) === String(input.exId))
  const move = ex && moveOf(ex)
  if (!ex || !move || move.unit !== 'reps') return null
  const c = coachFor(input)
  if (!c) return null
  const strength = !!input.strength
  const lastMin = c.last && !c.last.est ? Math.min(...c.last.reps.slice(0, c.sets)) : 0
  if (c.last && c.last.reps.length >= 3 && input.efforts?.[c.last.day] === 'hard') return null
  // What you can do per set on this move: the target, last time, and 60% of a declared max set.
  const b = input.best?.[move.family]
  const bm = b && moveById(b.move)
  const bestRef = b && bm && stepOf(bm) <= stepOf(move) ? transferReps(Math.round(b.reps * WORKING_OF_MAX), stepOf(move) - stepOf(bm)) : 0
  const ref = Math.max(c.goal, lastMin, Math.round(bestRef))
  const over = c.goal > c.hi || lastMin > c.hi || bestRef > c.hi
  const hitTop = strength && !!c.last && c.last.reps.length >= 3 && c.last.reps.slice(0, 3).every((r) => r >= c.hi)
  if (!over && !hitTop) return null
  const free = (m: Move | null) => m && !(input.notYet?.[m.id] && input.notYet[m.id] > input.today) && !input.exercises.some((e) => e.active !== false && e.id !== ex.id && moveOf(e)?.id === m.id)
  const need = strength ? 6 : 8
  const maxSteps = bestRef > c.hi ? 4 : 2
  let to: Move | null = null
  let steps = 0
  let m: Move | null = move
  for (let k = 1; k <= maxSteps; k++) {
    m = m && nextStep(m)
    if (!m) break
    if (k > 1 && transferReps(ref, k) < need) break
    if (free(m)) { to = m; steps = k }
  }
  if (!to) return null
  const r = rangeFor(to)
  const eq = transferReps(ref, steps)
  const sets = strength ? 4 : 3
  const reps = strength ? clamp(Math.round(eq * 0.7), 5, 8) : clamp(Math.floor(eq * 0.8), r.lo, r.hi)
  const was = `${c.sets}×${Math.max(c.goal, lastMin)}`
  const nxt = nextStep(to)
  return {
    exId: String(ex.id),
    from: move,
    to,
    sets,
    reps,
    text: `Level up: ${to.name} ${sets}×${reps} (your ${was} ${move.name.toLowerCase()} are now your warm-up)`,
    after: nxt ? `${nxt.name} after ${strength ? '3×8' : `${sets}×${r.hi}`}` : 'No harder step after this one: slow the tempo',
    tempo: nxt ? null : tempoAdvice(to)
  }
}

// ------------------------------------------------------------ "Too easy" / "Too hard"

export interface Shift {
  level: Level
  to: Move
  sets: number
  reps: number
  sameMove: boolean
  text: string
}

/** One tap on "Too easy" jumps a level (`taps` ≥ 2 in a week: two); "Too hard" steps one back. */
export function shiftLevel(input: CoachInput, dir: 'easy' | 'hard', taps = 1): Shift | null {
  const ex = input.exercises.find((e) => String(e.id) === String(input.exId))
  const move = ex && moveOf(ex)
  const track = move && trackOf(move.family)
  if (!ex || !move || !track) return null
  const lv = track.levels
  const first = lv.findIndex((l) => l.move === move.id) + 1
  let last = 0
  lv.forEach((l) => { if (l.move === move.id) last = l.n })
  const placed = placeFamily(input, move.family)?.level ?? 0
  const cur = dir === 'easy' ? Math.max(placed, first) : last && last < placed ? last : first > placed ? first : placed
  const n = clamp(dir === 'easy' ? cur + (taps >= 2 ? 2 : 1) : cur - 1, 1, lv.length)
  if (n === cur && cur > 0) return null
  const level = lv[n - 1]
  const to = moveById(level.move)!
  const strength = !!input.strength && to.unit === 'reps'
  const sets = strength ? 4 : level.sets
  const reps = strength ? clamp(level.reps, 5, 8) : level.reps
  return {
    level,
    to,
    sets,
    reps,
    sameMove: to.id === move.id,
    text: `${dir === 'easy' ? (taps >= 2 ? 'Two levels up' : 'Level up') : 'One level back'}: Level ${n} ${level.name}, ${sets}×${reps}${u(to)} ${to.name.toLowerCase()}.`
  }
}

// ------------------------------------------------------------ a thin routine

export interface Suggest {
  move: Move
  sets: number
  reps: number
  why: string
}

/** Three moves or fewer: a balanced 5–6 move set (push, pull with doorway rows, legs, core, a harder finisher). Empty when the routine is fine. */
export function balancedSet(exercises: SportEx[], strength = false): Suggest[] {
  const active = exercises.filter((e) => e.active !== false)
  if (active.length > 3) return []
  const have = new Set<Muscle>()
  const ids = new Set<string>()
  let best: Move | null = null
  for (const e of active) {
    const m = moveOf(e)
    if (!m) continue
    ids.add(m.id)
    const mu = muscleOf(m.group)
    if (mu) have.add(mu)
    if (!best || m.diff > best.diff) best = m
  }
  const slots: { mu: Muscle | null; id: string; why: string }[] = [
    { mu: 'push', id: 'pushup', why: 'Push: chest, shoulders and arms.' },
    { mu: 'pull', id: 'door_row', why: 'Pull: your back (a towel round a doorknob works).' },
    { mu: 'legs', id: 'split_squat', why: 'Legs: one leg at a time is harder than squats.' },
    { mu: 'core', id: 'plank', why: 'Core: a strong middle holds everything together.' },
    { mu: null, id: 'hollow_hold', why: 'A second core move: the hollow hold is tough.' },
    { mu: null, id: (best && nextStep(best)?.id) || 'pike_pushup', why: `A harder finisher${best && nextStep(best) ? ` (one step past your ${best.name.toLowerCase()})` : ''}.` }
  ]
  const out: Suggest[] = []
  for (const s of slots) {
    if (s.mu ? have.has(s.mu) : active.length + out.length >= 5) continue
    const m = moveById(s.id)
    if (!m || ids.has(m.id)) continue
    const r = rangeFor(m)
    out.push({ move: m, sets: strength ? 4 : r.sets, reps: strength && m.unit === 'reps' ? 5 : r.lo, why: s.why })
    ids.add(m.id)
    if (active.length + out.length >= 6) break
  }
  return out
}
