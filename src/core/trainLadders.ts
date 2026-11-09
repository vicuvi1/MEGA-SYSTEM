// Body → Training: the progression ladders, as plain data you can edit. Each
// ladder is a list of levels (a move + a rep range, or seconds for a hold),
// easiest first. Moves come from Sport Track's library (sportMoves.ts, with a
// drawn demo) or, when the library has none, from TRAIN_MOVES below (how-to
// text only, no picture). Pure and tested (trainLadders.test.ts).
import { moveById, type Group, type Move } from './sportMoves'
import type { SessionType } from './trainWeek'

export type LadderId = 'push' | 'pull' | 'shoulders' | 'single' | 'hinge' | 'core'

export interface Level {
  /** A library move id (sportMoves) or a TRAIN_MOVES id. */
  move: string
  lo: number
  hi: number
  unit: 'reps' | 'sec'
}

export interface Ladder {
  id: LadderId
  name: string
  /** The session it belongs to. */
  type: SessionType
  levels: Level[]
}

/** A move the library has no demo for: honest how-to text only. */
export interface TrainMove {
  id: string
  name: string
  group: Group
  unit: 'reps' | 'sec'
  diff: 1 | 2 | 3 | 4 | 5
  muscles: string[]
  steps: string[]
  mistake: string
  /** What it needs ("a pull-up bar", "a backpack with books"). */
  needs?: string
}

const X = (m: TrainMove): TrainMove => m
export const TRAIN_MOVES: Record<string, TrainMove> = Object.fromEntries(
  [
    X({ id: 'oap_neg', name: 'One-arm push-up negatives', group: 'push', unit: 'reps', diff: 5, muscles: ['chest', 'triceps', 'core'], steps: ['Feet wide, one hand under your chest, the other behind your back.', 'Lower yourself slowly for 3–5 seconds, body straight.', 'At the bottom, put the other hand down and push back up with both.'], mistake: 'Twisting the hips: squeeze your glutes and keep the body one line.' }),
    X({ id: 'oap', name: 'One-arm push-ups', group: 'push', unit: 'reps', diff: 5, muscles: ['chest', 'triceps', 'core'], steps: ['Feet wider than your shoulders, one hand under your chest.', 'Lower until your chest is a fist above the floor.', 'Press back up without turning your body.'], mistake: 'Going only halfway: a slow full rep beats three short ones.' }),
    X({ id: 'neg_pullup', name: 'Slow negative pull-ups', group: 'pull', unit: 'reps', diff: 3, needs: 'a pull-up bar', muscles: ['back', 'biceps', 'grip'], steps: ['Step or jump so your chin is over the bar.', 'Lower yourself for a full 5 seconds until your arms are straight.', 'Step down, reset, repeat.'], mistake: 'Dropping the last half: control it all the way to straight arms.' }),
    X({ id: 'band_pullup', name: 'Band-assisted pull-ups', group: 'pull', unit: 'reps', diff: 3, needs: 'a pull-up bar and a band', muscles: ['back', 'biceps'], steps: ['Loop a band over the bar and put one knee or foot in it.', 'From straight arms, pull your chest towards the bar.', 'Lower all the way down each rep. Use a lighter band as you get stronger.'], mistake: 'Bouncing out of the bottom: start each rep from a still hang.' }),
    X({ id: 'pullup', name: 'Pull-ups', group: 'pull', unit: 'reps', diff: 4, needs: 'a pull-up bar', muscles: ['back', 'biceps', 'grip'], steps: ['Hang with palms facing away, hands a bit wider than your shoulders.', 'Pull until your chin is over the bar.', 'Lower to straight arms every rep.'], mistake: 'Kicking the legs: keep them still and squeeze your glutes.' }),
    X({ id: 'weighted_chinup', name: 'Weighted chin-ups (backpack)', group: 'pull', unit: 'reps', diff: 4, needs: 'a pull-up bar and a loaded backpack', muscles: ['back', 'biceps'], steps: ['Wear a backpack with books or water bottles.', 'Palms facing you, pull your chin over the bar.', 'Lower to straight arms. Log the backpack weight as added kg.'], mistake: 'Too much weight too soon: add 2–3 kg at a time.' }),
    X({ id: 'archer_pullup', name: 'Archer pull-ups', group: 'pull', unit: 'reps', diff: 5, needs: 'a pull-up bar', muscles: ['back', 'biceps'], steps: ['Wide grip. Pull up towards one hand while the other arm goes straight.', 'Lower slowly, then switch sides.', 'Count reps per side.'], mistake: 'Bending the straight arm: it only helps, it should not pull.' }),
    X({ id: 'wall_hs_hold', name: 'Wall handstand hold', group: 'push', unit: 'sec', diff: 4, needs: 'a clear wall', muscles: ['shoulders', 'triceps', 'core'], steps: ['Hands a hand-width from the wall, kick up with your belly or back to the wall.', 'Push the floor away, arms straight, ribs in.', 'Come down before your form breaks.'], mistake: 'A banana back: squeeze glutes and pull the ribs in.' }),
    X({ id: 'wall_hspu_neg', name: 'Wall handstand press negatives', group: 'push', unit: 'reps', diff: 5, needs: 'a clear wall and a cushion', muscles: ['shoulders', 'triceps'], steps: ['From a wall handstand, lower your head slowly for 3–5 seconds to a cushion.', 'Come down from the wall, kick up again.', 'Keep elbows a bit in front, not flared wide.'], mistake: 'Falling the last part: stop at the cushion with control.' }),
    X({ id: 'wall_hspu', name: 'Wall handstand press', group: 'push', unit: 'reps', diff: 5, needs: 'a clear wall and a cushion', muscles: ['shoulders', 'triceps'], steps: ['From a wall handstand, lower your head to a cushion.', 'Press back up to straight arms.', 'Keep the body tight the whole way.'], mistake: 'Short reps: the head touches the cushion every time.' }),
    X({ id: 'bss_load', name: 'Backpack Bulgarian splits', group: 'legs', unit: 'reps', diff: 4, needs: 'a chair and a loaded backpack', muscles: ['quads', 'glutes'], steps: ['Wear the backpack. Back foot on a chair, front foot a big step ahead.', 'Lower the back knee towards the floor, chest tall.', 'Drive up through the front heel. Count reps per leg; log the backpack as added kg.'], mistake: 'The front heel lifting: step the front foot further forward.' }),
    X({ id: 'hip_thrust_load', name: 'Backpack hip thrusts', group: 'legs', unit: 'reps', diff: 3, needs: 'a sofa or bed edge and a loaded backpack', muscles: ['glutes', 'hamstrings'], steps: ['Upper back on the sofa edge, backpack on your hips, feet flat.', 'Drive the hips up until your body is flat from knees to shoulders.', 'Hold 1 second at the top, lower with control.'], mistake: 'Arching the low back at the top: tuck the chin and ribs, squeeze glutes.' }),
    X({ id: 'sl_rdl', name: 'Single-leg Romanian deadlifts', group: 'legs', unit: 'reps', diff: 3, needs: 'a loaded backpack (optional)', muscles: ['hamstrings', 'glutes', 'balance'], steps: ['Stand on one leg, soft knee, backpack in the opposite hand.', 'Hinge forward, the free leg goes back, back flat, until you feel the hamstring.', 'Stand tall by squeezing the glute. Count reps per leg.'], mistake: 'Rounding the back to reach lower: stop where your back stays flat.' }),
    X({ id: 'nordic_neg', name: 'Nordic curl negatives', group: 'legs', unit: 'reps', diff: 5, needs: 'a sofa or bed to hook your heels under', muscles: ['hamstrings'], steps: ['Kneel on a cushion, heels hooked under something heavy.', 'Body straight from knees to head, lower forward as slowly as you can.', 'Catch yourself with your hands and push back up.'], mistake: 'Bending at the hips: keep hips straight so the hamstrings do the work.' }),
    X({ id: 'knee_raise', name: 'Lying knee raises', group: 'core', unit: 'reps', diff: 1, muscles: ['abs', 'hip flexors'], steps: ['Lie on your back, hands under your hips, legs a bit off the floor.', 'Bring the knees to your chest and lift the hips slightly.', 'Lower slowly without touching the floor.'], mistake: 'Swinging fast: 2 seconds down every rep.' }),
    X({ id: 'hanging_leg_raise', name: 'Hanging leg raises', group: 'core', unit: 'reps', diff: 4, needs: 'a pull-up bar', muscles: ['abs', 'hip flexors', 'grip'], steps: ['Hang from the bar, shoulders active.', 'Raise straight (or slightly bent) legs to hip height or higher.', 'Lower slowly without swinging.'], mistake: 'Swinging: pause in the hang between reps.' })
  ].map((m) => [m.id, m])
)

const L = (move: string, lo: number, hi: number, unit: 'reps' | 'sec' = 'reps'): Level => ({ move, lo, hi, unit })

/** The default ladders. */
export const DEFAULT_LADDERS: Ladder[] = [
  { id: 'push', name: 'Push', type: 'upper', levels: [L('knee_pushup', 8, 15), L('pushup', 8, 15), L('diamond_pushup', 6, 12), L('decline_pushup', 6, 12), L('archer_pushup', 5, 10), L('planche_pushup', 5, 10), L('oap_neg', 3, 6), L('oap', 1, 5)] },
  { id: 'pull', name: 'Pull', type: 'upper', levels: [L('table_row', 8, 15), L('feet_row', 6, 12), L('neg_pullup', 3, 6), L('band_pullup', 5, 10), L('pullup', 5, 10), L('weighted_chinup', 5, 8), L('archer_pullup', 3, 6)] },
  { id: 'shoulders', name: 'Shoulders', type: 'upper', levels: [L('pike_pushup', 6, 12), L('elevated_pike', 6, 12), L('wall_hs_hold', 20, 45, 'sec'), L('wall_hspu_neg', 3, 6), L('wall_hspu', 3, 8)] },
  { id: 'single', name: 'Legs (single-leg)', type: 'legs', levels: [L('squat', 15, 25), L('split_squat', 8, 15), L('bulgarian_squat', 8, 12), L('bss_load', 8, 12), L('box_pistol', 5, 10), L('pistol_squat', 3, 8)] },
  { id: 'hinge', name: 'Hinge (hamstrings, glutes)', type: 'legs', levels: [L('glute_bridge', 12, 20), L('single_leg_bridge', 8, 15), L('hip_thrust_load', 8, 15), L('sl_rdl', 8, 12), L('nordic_neg', 3, 6)] },
  { id: 'core', name: 'Core', type: 'legs', levels: [L('plank', 30, 60, 'sec'), L('knee_raise', 10, 15), L('leg_raise', 8, 15), L('hanging_leg_raise', 6, 12), L('dragon_neg', 3, 6), L('dragon_flag', 3, 6)] }
]

export const LADDER_IDS: LadderId[] = DEFAULT_LADDERS.map((l) => l.id)

/** What a move is, for names and the how-to sheet: library moves carry a demo (`lib`). */
export interface MoveInfo {
  id: string
  name: string
  group: Group
  unit: 'reps' | 'sec'
  steps: string[]
  mistake: string
  muscles: string[]
  needs?: string
  lib: Move | null
}

export function moveInfo(id: string): MoveInfo | null {
  const m = moveById(id)
  if (m) return { id, name: m.name, group: m.group, unit: m.unit, steps: m.steps, mistake: m.mistake, muscles: m.muscles, lib: m }
  const t = TRAIN_MOVES[id]
  return t ? { id, name: t.name, group: t.group, unit: t.unit, steps: t.steps, mistake: t.mistake, muscles: t.muscles, needs: t.needs, lib: null } : null
}
export const moveName = (id: string) => moveInfo(id)?.name ?? id

/** Every move a ladder of this session type could use (for "add a level"). */
export function movesFor(type: SessionType): MoveInfo[] {
  const groups: Group[] = type === 'upper' ? ['push', 'pull'] : ['legs', 'core']
  const ids = new Set<string>()
  for (const l of DEFAULT_LADDERS) for (const v of l.levels) ids.add(v.move)
  const out: MoveInfo[] = []
  for (const id of ids) {
    const m = moveInfo(id)
    if (m && groups.includes(m.group)) out.push(m)
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** Stored ladders (yours, edited) into valid ones; a ladder that can't be read is the default. */
export function cleanLadders(x: unknown): Ladder[] {
  const list = Array.isArray(x) ? x : []
  return DEFAULT_LADDERS.map((def) => {
    const own = list.find((l: any) => l && l.id === def.id)
    if (!own || !Array.isArray(own.levels)) return def
    const levels: Level[] = own.levels
      .filter((v: any) => v && typeof v.move === 'string' && moveInfo(v.move))
      .map((v: any) => {
        const unit = moveInfo(v.move)!.unit
        const lo = Math.max(1, Math.min(300, Math.round(Number(v.lo) || 1)))
        const hi = Math.max(lo, Math.min(300, Math.round(Number(v.hi) || lo)))
        return { move: v.move, lo, hi, unit }
      })
    return levels.length ? { ...def, levels } : def
  })
}

/** The ladders a session uses, in order. */
export const laddersFor = (ladders: Ladder[], type: SessionType) => ladders.filter((l) => l.type === type)

/** "6–12" or "20–45 s". */
export const rangeText = (v: Pick<Level, 'lo' | 'hi' | 'unit'>) => `${v.lo}–${v.hi}${v.unit === 'sec' ? ' s' : ''}`
