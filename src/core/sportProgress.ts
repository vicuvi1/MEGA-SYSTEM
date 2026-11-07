// Getting stronger, one move at a time ("double progression", for muscle):
// every move has a rep range (8–15 for pushing and pulling, 10–20 for legs
// and core, seconds for holds). Do 3 hard sets. Each session aim for one
// more rep per set; when every working set reaches the top of the range in
// 2 sessions, the next harder step of the ladder unlocks and you start it at
// the bottom of its range. Missing the bottom twice suggests the easier step
// (or more rest). After a long break you start at about 70% and ramp up fast.
// "Endurance" keeps the old way: daily totals that go up 5% after 3 full days.
// Pure and tested (sportkit.js for the page). Nothing here pays points.
import { nextStep, prevStep } from './sportLadders'
import type { Move } from './sportMoves'
import { sessionsOf, shiftDay, type SetLog, type Session } from './sportSets'

/** strength (default): 5–8 reps, 3–5 sets, 2–3 min rest. grow: 8–15 reps for muscle size. endurance: daily totals. */
export type ProgMode = 'strength' | 'grow' | 'endurance'

/** The mode from the saved settings: nothing saved means strength, a saved choice is kept. */
export function modeOf(settings?: { progressMode?: unknown } | null): ProgMode {
  const m = settings?.progressMode
  return m === 'grow' || m === 'endurance' || m === 'strength' ? m : 'strength'
}

/** Strength: a set of 5–8 reps; 3×8 clean sets unlock the next variation. */
export const STRENGTH_LO = 5
export const STRENGTH_HI = 8

export interface RepRange {
  lo: number
  hi: number
  /** Working sets per session. */
  sets: number
  unit: 'reps' | 'sec'
}

/** Holds: how long a set should last, by move. */
const HOLDS: Record<string, [number, number]> = {
  plank: [30, 60],
  side_plank: [20, 45],
  hollow_hold: [15, 40],
  wall_sit: [30, 75],
  down_dog: [30, 60],
  childs_pose: [30, 60]
}

/** The rep range for a move. */
export function rangeFor(move: Pick<Move, 'id' | 'group' | 'unit' | 'diff'> | null, mode: ProgMode = 'grow'): RepRange {
  if (mode === 'strength') {
    const base = rangeFor(move, 'grow')
    // Holds stay in seconds; cardio and mobility keep their own range.
    if (base.unit === 'sec' || !move || move.group === 'cardio' || move.group === 'mobility') return base
    return { lo: STRENGTH_LO, hi: STRENGTH_HI, sets: 3, unit: 'reps' }
  }
  if (!move) return { lo: 8, hi: 15, sets: 3, unit: 'reps' }
  if (move.unit === 'sec') {
    const [lo, hi] = HOLDS[move.id] ?? [20, 60]
    return { lo, hi, sets: 3, unit: 'sec' }
  }
  if (move.group === 'push' || move.group === 'pull') return { lo: move.diff >= 4 ? 5 : 8, hi: move.diff >= 4 ? 12 : 15, sets: 3, unit: 'reps' }
  if (move.group === 'legs' || move.group === 'core') return { lo: move.diff >= 4 ? 6 : 10, hi: move.diff >= 4 ? 15 : 20, sets: 3, unit: 'reps' }
  if (move.group === 'cardio') return { lo: 15, hi: 30, sets: 3, unit: 'reps' }
  return { lo: 8, hi: 12, sets: 2, unit: 'reps' }
}

export type ProgStatus = 'new' | 'building' | 'ready' | 'top' | 'stuck' | 'comeback'

export interface Progress {
  status: ProgStatus
  range: RepRange
  /** Today's aim: this many in each working set. */
  goal: number
  sets: number
  /** "Next level at 3×15" (or "3×60 s"). */
  nextAt: string
  /** The harder move to unlock (ready), the easier one to step back to (stuck), or null. */
  next: Move | null
  prev: Move | null
  /** Sessions in a row at the top of the range (of 2). */
  hits: number
  need: number
  /** Days since the last session (null: none yet). */
  daysSince: number | null
  /** The last session before today (its sets). */
  last: Session | null
  /** One line in plain words for the card. */
  line: string
  /** Today's sets so far. */
  today: number[]
}

/** A session's working sets: the first `n` (a warm-up isn't logged as a set here). */
const working = (s: Session, n: number) => s.reps.slice(0, n)
/** Every working set reached the top. */
const atTop = (s: Session, r: RepRange) => s.reps.length >= r.sets && working(s, r.sets).every((x) => x >= r.hi)
/** Not even one set reached the bottom. */
const belowBottom = (s: Session, r: RepRange) => Math.max(...s.reps) < r.lo

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000)

/** A long break: this many days without the move. */
export const BREAK_DAYS = 10
/** Sessions in a row at the top before the next step unlocks (strength: one session of 3×8 is enough). */
export const NEED = 2
export const needFor = (mode: ProgMode = 'grow') => (mode === 'strength' ? 1 : NEED)

/** Working sets for a strength session: 3 to start, 4 when the move is hard or you are at the top, up to 5. */
export function strengthSets(move: Pick<Move, 'diff'> | null, extra = 0): number {
  return clamp((move && move.diff >= 4 ? 4 : 3) + extra, 3, 5)
}

/** Rest between sets in seconds: strength 2–3 min (harder moves rest longer), grow 60–120 s, endurance 45 s. */
export function restFor(move: Pick<Move, 'diff' | 'unit'> | null, mode: ProgMode = 'strength'): number {
  const d = move?.diff ?? 2
  if (mode === 'endurance') return 45
  if (mode === 'grow') return d >= 4 ? 120 : d >= 3 ? 90 : 60
  return d >= 5 ? 180 : d >= 3 ? 150 : 120
}

/** The strength target for a move: "3×5–8" with how long to rest. */
export function strengthTarget(move: Pick<Move, 'id' | 'group' | 'unit' | 'diff'> | null): { sets: number; lo: number; hi: number; unit: 'reps' | 'sec'; rest: number; label: string } {
  const r = rangeFor(move, 'strength')
  const sets = strengthSets(move)
  const rest = restFor(move as Move | null, 'strength')
  const s = r.unit === 'sec' ? ' s' : ''
  return { sets, lo: r.lo, hi: r.hi, unit: r.unit, rest, label: `${sets}×${r.lo}–${r.hi}${s}` }
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
const u = (r: RepRange) => (r.unit === 'sec' ? ' s' : '')

/**
 * Where an exercise stands and what to aim for today. `log` is every set
 * logged; `exId` the exercise; sessions before `today` set today's goal, and
 * today's own sets count for "ready" as soon as they're logged.
 */
export function progressFor(input: { log: SetLog | null | undefined; exId: string; move: Move | null; today: string; mode?: ProgMode }): Progress {
  const { log, exId, move, today } = input
  const mode = input.mode ?? 'grow'
  const need = needFor(mode)
  const r = rangeFor(move, mode)
  const all = sessionsOf(log, exId, today)
  const past = all.filter((s) => s.day < today)
  const todays = all.find((s) => s.day === today) ?? null
  const last = past[past.length - 1] ?? null
  const daysSince = last ? daysBetween(last.day, today) : null
  const next = move ? nextStep(move) : null
  const prev = move ? prevStep(move) : null
  const nextAt = `${r.sets}×${r.hi}${u(r)}`
  const base = { range: r, sets: r.sets, nextAt, need, daysSince, last, today: todays?.reps ?? [], next: null as Move | null, prev: null as Move | null }

  // Ready: the top of the range in the last 2 sessions (today's counts once it has all its sets).
  const recent = [...past, ...(todays && todays.reps.length >= r.sets ? [todays] : [])]
  let hits = 0
  for (let i = recent.length - 1; i >= 0 && atTop(recent[i], r); i--) hits++
  // Way above the range on the very first try: this move is too easy, go up now.
  const first = recent.length === 1 && Math.max(...recent[0].reps) >= Math.ceil(r.hi * 1.5)
  if (hits >= need || first) {
    const n = Math.max(hits, first ? need : 0)
    return next
      ? { ...base, status: 'ready', goal: r.hi, hits: n, next, line: `Level up: ${next.name} is unlocked. Start it at ${r.sets}×${rangeFor(next, mode).lo}${u(rangeFor(next, mode))}.` }
      : { ...base, status: 'top', goal: r.hi, hits: n, line: `Top of the ladder. Add a 4th set, or go slower (3 seconds down).` }
  }

  if (!last) {
    return { ...base, status: 'new', goal: r.lo, hits, line: `First time: ${r.sets} sets of ${r.lo}–${r.hi}${u(r)}. Stop 1–2 reps before you can't do another.` }
  }

  const lastMin = Math.min(...working(last, r.sets))
  const peak = Math.max(...past.slice(-6).flatMap((s) => working(s, r.sets).length >= r.sets ? [Math.min(...working(s, r.sets))] : []), lastMin)

  // A long break: about 70% of where you were (or one step down if that's under the range).
  if (daysSince !== null && daysSince >= BREAK_DAYS) {
    const back = Math.round(peak * 0.7)
    if (back < r.lo && prev && daysSince >= 21) {
      return { ...base, status: 'comeback', goal: r.lo, hits: 0, prev, line: `Welcome back after ${daysSince} days. Start one step easier (${prev.name}) or ${r.sets}×${r.lo}${u(r)}, and build up fast.` }
    }
    return { ...base, status: 'comeback', goal: clamp(back, r.lo, r.hi), hits: 0, line: `Welcome back after ${daysSince} days: start at ${r.sets}×${clamp(back, r.lo, r.hi)}${u(r)} (about 70%), then build up fast.` }
  }

  // Missed the bottom twice in a row: an easier step, or more rest.
  const misses = past.slice(-2)
  if (misses.length === 2 && misses.every((s) => belowBottom(s, r))) {
    return prev
      ? { ...base, status: 'stuck', goal: r.lo, hits: 0, prev, line: `Under ${r.lo}${u(r)} twice: step back to ${prev.name} for a while, or rest 2–3 minutes between sets.` }
      : { ...base, status: 'stuck', goal: r.lo, hits: 0, line: `Under ${r.lo}${u(r)} twice: rest 2–3 minutes between sets and sleep well. You'll get there.` }
  }

  // Coming back from a break in the last few sessions: ramp up quickly (+3), else +1 per set.
  let breakAt = -1
  for (let j = Math.max(1, past.length - 3); j < past.length; j++) if (daysBetween(past[j - 1].day, past[j].day) >= BREAK_DAYS) breakAt = j
  const mins = (list: Session[]) => list.flatMap((s) => (working(s, r.sets).length >= r.sets ? [Math.min(...working(s, r.sets))] : []))
  const oldPeak = breakAt > 0 ? Math.max(0, ...mins(past.slice(0, breakAt))) : 0
  const step = r.unit === 'sec' ? 5 : 1
  const fast = breakAt > 0 && lastMin < oldPeak
  const goal = clamp(fast ? Math.min(oldPeak, lastMin + 3 * step) : lastMin + step, r.lo, r.hi)
  return { ...base, status: 'building', goal, hits, line: hits ? `${hits} of ${need} sessions at the top. One more and the next level unlocks.` : `Aim for ${r.sets}×${goal}${u(r)} today. Next level at ${nextAt}.` }
}

/** The day's total this plan asks for (sets × goal): what the card's bar fills to. */
export const growTarget = (p: Pick<Progress, 'sets' | 'goal'>) => p.sets * p.goal

/** "Endurance" (the old step-up): +5% to every target after 3 full days in a row. */
export function enduranceStep(targets: number[]): number[] {
  return targets.map((t) => Math.max(t + 1, Math.round(t * 1.05)))
}

/** A day `n` days before `day` (re-exported for the page). */
export const daysBefore = (day: string, n: number) => shiftDay(day, -n)
