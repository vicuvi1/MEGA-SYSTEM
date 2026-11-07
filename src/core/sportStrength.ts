// How strong you are getting, from the sets you log. A set's strength score
// combines how hard the move is (its step on the ladder: each step up counts
// about 20% more) with the reps you did in one go (more reps, more strength,
// the way gyms estimate a one-rep max). So moving from 15 push-ups to 8
// decline push-ups still counts as growth. Day totals without sets are
// volume only: they never make a strength score. Pure and tested.
import { FAMILIES, moveById, type Move } from './sportMoves'
import { moveOf, type SportEx } from './sportLadders'
import { muscleOf, sessionsOf, shiftDay, type Muscle, type SetLog } from './sportSets'

/** How hard a move is compared with the first step of its ladder. */
export function loadOf(move: Pick<Move, 'id' | 'family'>): number {
  const steps = FAMILIES[move.family]?.steps ?? []
  const i = Math.max(0, steps.indexOf(move.id))
  return Math.pow(1.2, i)
}

/** One set's strength score: 100 × load × (1 + reps / 30). Holds count 3 seconds as a rep. */
export function setScore(move: Pick<Move, 'id' | 'family' | 'unit'>, reps: number): number {
  const r = move.unit === 'sec' ? reps / 3 : reps
  return Math.round(100 * loadOf(move) * (1 + Math.max(0, r) / 30))
}

export interface StrengthPoint {
  day: string
  /** The best set that day (reps or seconds), its move and its score. */
  reps: number
  move: string
  score: number
}

/** Exercises (by id) grouped by ladder family, from the library move each one is. */
function byFamily(exercises: SportEx[]): Map<string, { ex: SportEx; move: Move }[]> {
  const out = new Map<string, { ex: SportEx; move: Move }[]>()
  for (const ex of exercises) {
    const move = moveOf(ex)
    if (!move) continue
    const l = out.get(move.family) ?? []
    l.push({ ex, move })
    out.set(move.family, l)
  }
  return out
}

/** The best set per session day for one ladder family (every step of it), oldest first. */
export function familySeries(log: SetLog | null | undefined, exercises: SportEx[], family: string, until?: string): StrengthPoint[] {
  const list = byFamily(exercises).get(family) ?? []
  const best = new Map<string, StrengthPoint>()
  for (const { ex, move } of list) {
    for (const s of sessionsOf(log, String(ex.id), until)) {
      const top = Math.max(...s.reps)
      const score = setScore(move, top)
      const was = best.get(s.day)
      if (!was || score > was.score) best.set(s.day, { day: s.day, reps: top, move: move.id, score })
    }
  }
  return [...best.values()].sort((a, b) => a.day.localeCompare(b.day))
}

/** The ladder families you have sets for. */
export function familiesWithSets(log: SetLog | null | undefined, exercises: SportEx[]): string[] {
  return [...byFamily(exercises).keys()].filter((f) => familySeries(log, exercises, f).length > 0)
}

const bestIn = (pts: StrengthPoint[], from: string, to: string) => pts.filter((p) => p.day >= from && p.day <= to).reduce<StrengthPoint | null>((b, p) => (!b || p.score > b.score ? p : b), null)

export interface StrengthChange {
  /** Average change across families with data then and now, in % (null: not enough data yet). */
  pct: number | null
  /** The day "then" is (about 4 weeks ago, or your first sets if they're newer). */
  since: string | null
  families: { family: string; name: string; then: StrengthPoint; now: StrengthPoint; pct: number }[]
}

/**
 * "You're 12% stronger than 4 weeks ago": per family, your best set in the
 * last 2 weeks against your best in the 2 weeks around 4 weeks ago (or your
 * first week of sets, when that's newer but at least a week old).
 */
export function strengthChange(log: SetLog | null | undefined, exercises: SportEx[], today: string, weeks = 4): StrengthChange {
  const nowFrom = shiftDay(today, -13)
  const fams: StrengthChange['families'] = []
  let since: string | null = null
  for (const f of familiesWithSets(log, exercises)) {
    const pts = familySeries(log, exercises, f, today)
    const now = bestIn(pts, nowFrom, today)
    if (!now) continue
    const thenTo = shiftDay(today, -7 * weeks + 7)
    const thenFrom = shiftDay(today, -7 * weeks - 7)
    let then = bestIn(pts, thenFrom, thenTo)
    if (!then) {
      const first = pts[0]
      if (!first || first.day > shiftDay(today, -7)) continue
      then = bestIn(pts, first.day, shiftDay(first.day, 6))
    }
    if (!then || then.day >= now.day) continue
    if (!since || then.day < (since as string)) since = then.day
    fams.push({ family: f, name: FAMILIES[f]?.name ?? f, then, now, pct: Math.round((now.score / then.score - 1) * 100) })
  }
  const pct = fams.length ? Math.round(fams.reduce((t, x) => t + x.pct, 0) / fams.length) : null
  return { pct, since, families: fams.sort((a, b) => b.pct - a.pct) }
}

/** Your strength score per muscle group (the best family's best set in the last 4 weeks) and in all. */
export function strengthScore(log: SetLog | null | undefined, exercises: SportEx[], today: string): { total: number; by: Record<Muscle, number> } {
  const by: Record<Muscle, number> = { push: 0, pull: 0, core: 0, legs: 0 }
  const from = shiftDay(today, -27)
  for (const f of familiesWithSets(log, exercises)) {
    const best = bestIn(familySeries(log, exercises, f, today), from, today)
    const mv = best && moveById(best.move)
    const mu = muscleOf(mv?.group)
    if (best && mu) by[mu] = Math.max(by[mu], best.score)
  }
  return { total: by.push + by.pull + by.core + by.legs, by }
}

/**
 * A new record: a set (not logged yet) that beats every set logged before it
 * in the same family, by score. The very first set isn't a record.
 */
export function isRecord(log: SetLog | null | undefined, exercises: SportEx[], move: Move, reps: number, day: string): boolean {
  const prevBest = Math.max(0, ...familySeries(log, exercises, move.family, day).map((p) => p.score))
  return prevBest > 0 && setScore(move, reps) > prevBest
}
