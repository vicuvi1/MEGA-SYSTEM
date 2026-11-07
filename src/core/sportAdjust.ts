// After every logged session Ben adjusts the next one, in code and at once
// (pure, tested): progression, a step back, a swap to an easier move, and more
// sets where a muscle is under 10 hard sets this week. The rules are in
// sportCoachRules.ts. Nothing here pays points.
import { moveOf } from './sportLadders'
import { coachFor } from './sportCoach'
import { BODY_PART, RULES, muscleLoad, overload, restFor, restText, type CoachCtx, type OverloadKind } from './sportCoachRules'
import { muscleOf, setsOn, shiftDay, type Muscle } from './sportSets'

export interface Adjustment {
  exId: string
  name: string
  kind: OverloadKind | 'swap'
  /** The move to do next time (differs from the exercise on a harder step or a swap). */
  toMove: string
  next: { sets: number; reps: number; kg: number }
  text: string
}

export interface Adjusted {
  adjustments: Adjustment[]
  /** One short line per change, for the reply and the toast. */
  lines: string[]
  /** Muscles still under 10 hard sets this week with the sets to add next time. */
  volume: { muscle: Muscle; have: number; add: number }[]
}

/** What to change for next time, from the sets logged today (`ctx.today`). Only exercises with sets today. */
export function adjustAfterSession(ctx: CoachCtx): Adjusted {
  const adjustments: Adjustment[] = []
  for (const ex of ctx.exercises) {
    const id = String(ex.id)
    if (!setsOn(ctx.sets, ctx.today, id).length) continue
    const mv = moveOf(ex)
    if (!mv || !coachFor({ ...ctx, exId: id })) continue
    // The next session: today's sets count, so ask as of tomorrow.
    const next = overload({ ...ctx, today: shiftDay(ctx.today, 1) }, id)
    if (!next) continue
    const kind = next.move.id !== mv.id && next.kind === 'back' ? 'swap' : next.kind
    adjustments.push({
      exId: id,
      name: ex.name,
      kind,
      toMove: next.move.id,
      next: { sets: next.sets, reps: next.reps, kg: next.kg },
      text: `${mv.name}: ${next.text} Rest ${restText(restFor(next.move, next.reps))}.`
    })
  }
  const volume: Adjusted['volume'] = muscleLoad(ctx)
    .filter((l) => l.status === 'low' && l.sets > 0 && !ctx.deload)
    .map((l) => ({ muscle: l.id, have: l.sets, add: Math.min(3, RULES.setsLo - l.sets) }))
  // Add a set to the first exercise of that muscle (max 5 sets).
  for (const v of volume) {
    const a = adjustments.find((x) => muscleOf(moveOf({ name: x.name, move: x.toMove })?.group) === v.muscle && x.next.sets < 5)
    if (a) {
      a.next.sets += 1
      a.text += ` +1 set: your ${BODY_PART[v.muscle].part} has ${v.have} of ${RULES.setsLo} hard sets this week.`
    }
  }
  return { adjustments, lines: adjustments.map((a) => a.text), volume }
}
