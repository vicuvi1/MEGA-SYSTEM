// Sport Track's gear: what you can really train with (a sturdy table, a chair,
// a pull-up bar…). The plan only picks moves your gear allows: a wobbly desk is
// never used for rows (a pull-up bar first, then bands, a towel on a door, a
// backpack, then floor pulls). Moves that need something you don't own are
// hidden, never greyed out. Kept inside Sport Track's state (`trainGear`, synced
// with it through settings.sport_tracker_json, the newer device wins). Not set
// yet (null) means nothing is ruled out, as before gear existed. Pure and tested
// (trainGear.test.ts). Nothing here pays points.
import type { Level, Ladder, LadderId } from './trainLadders'

export type TableKind = 'sturdy' | 'weak' | 'none'
export type GearKey = 'table' | 'chair' | 'bed' | 'wall' | 'towel' | 'backpack' | 'bar' | 'bands' | 'dumbbells' | 'rings'
export type GearFlag = Exclude<GearKey, 'table'>

export interface Gear {
  table: TableKind
  chair: boolean
  bed: boolean
  wall: boolean
  towel: boolean
  backpack: boolean
  bar: boolean
  bands: boolean
  dumbbells: boolean
  rings: boolean
  /** When it was last changed (ms): the newer device wins. */
  at: number
}

export const GEAR_FLAGS: GearFlag[] = ['chair', 'bed', 'wall', 'towel', 'backpack', 'bar', 'bands', 'dumbbells', 'rings']

/** Everything allowed: what a plan assumed before gear existed. */
export const ALL_GEAR: Gear = { table: 'sturdy', chair: true, bed: true, wall: true, towel: true, backpack: true, bar: true, bands: true, dumbbells: true, rings: true, at: 0 }

/** The words for the Gear page: [name, what it is for]. */
export const GEAR_TEXT: Record<GearFlag, [string, string]> = {
  chair: ['Sturdy chair', 'Dips, step-ups, Bulgarian squats'],
  bed: ['Bed or sofa', 'Decline push-ups, hip thrusts'],
  wall: ['Free wall', 'Wall sits, handstand work'],
  towel: ['Towel + door', 'Door towel rows (door must close and lock)'],
  backpack: ['Backpack', 'Fill with books: rows, squats, extra weight'],
  bar: ['Pull-up bar', 'Pull-ups, hanging leg raises'],
  bands: ['Resistance bands', 'Rows, face pulls, assisted pull-ups'],
  dumbbells: ['Dumbbells', 'Rows, presses, goblet squats'],
  rings: ['Gym rings', 'Ring rows, dips']
}
export const TABLE_TEXT: Record<TableKind, [string, string]> = {
  sturdy: ['Sturdy table', 'Holds my full weight: table rows'],
  weak: ['Desk too weak', 'Wobbles or is light: no rows on it'],
  none: ['No table', 'Use other pull moves']
}

/** A stored value into valid gear; null when none was ever saved. */
export function cleanGear(x: unknown): Gear | null {
  if (!x || typeof x !== 'object') return null
  const o = x as Record<string, unknown>
  const g: Gear = { ...ALL_GEAR, table: o.table === 'weak' || o.table === 'none' ? o.table : 'sturdy', at: Number(o.at) || 0 }
  for (const k of GEAR_FLAGS) g[k] = o[k] == null ? ALL_GEAR[k] : !!o[k]
  return g
}

export const hasGear = (g: Gear | null | undefined, k: GearKey): boolean => (!g ? true : k === 'table' ? g.table === 'sturdy' : !!g[k])

/** What a move needs: any one of these sets of gear (every key in a set is needed). No entry: the floor is enough. */
export const NEEDS: Record<string, GearKey[][]> = {
  decline_pushup: [['chair'], ['bed']],
  incline_pushup: [['chair'], ['bed'], ['table']],
  chair_dip: [['chair']],
  table_row: [['table']],
  feet_row: [['table']],
  neg_pullup: [['bar']],
  band_pullup: [['bar', 'bands']],
  pullup: [['bar']],
  weighted_chinup: [['bar', 'backpack']],
  archer_pullup: [['bar']],
  elevated_pike: [['chair'], ['bed']],
  wall_hs_hold: [['wall']],
  wall_hspu_neg: [['wall']],
  wall_hspu: [['wall']],
  bulgarian_squat: [['chair'], ['bed']],
  bss_load: [['chair', 'backpack']],
  box_pistol: [['chair'], ['bed']],
  hip_thrust_load: [['bed', 'backpack'], ['chair', 'backpack']],
  nordic_neg: [['bed']],
  hanging_leg_raise: [['bar']],
  band_row: [['bands']],
  towel_row: [['towel']],
  backpack_row: [['backpack']],
  dumbbell_row: [['dumbbells']],
  ring_row: [['rings']]
}

/** Can you do this move with this gear? (null gear: yes.) */
export const allowed = (move: string, g: Gear | null | undefined): boolean => {
  const n = NEEDS[move]
  return !g || !n || n.some((set) => set.every((k) => hasGear(g, k)))
}

const SHORT: Record<GearKey, string> = { table: 'sturdy table', chair: 'chair', bed: 'bed', wall: 'wall', towel: 'towel + door', backpack: 'backpack', bar: 'pull-up bar', bands: 'bands', dumbbells: 'dumbbells', rings: 'rings' }
/** "floor", "chair or bed", "bar + bands": what a move needs, in words. */
export function needText(move: string): string {
  const n = NEEDS[move]
  if (!n) return 'floor'
  return n.map((set) => set.map((k) => SHORT[k]).join(' + ')).join(' or ')
}
/** The gear a move would use with this gear (the first way you can do it), or null (floor only). */
export function gearUsed(move: string, g: Gear | null | undefined): string | null {
  const n = NEEDS[move]
  if (!n) return null
  const set = n.find((s) => s.every((k) => hasGear(g, k))) ?? n[0]
  return set.map((k) => SHORT[k]).join(' + ')
}

const L = (move: string, lo: number, hi: number, unit: 'reps' | 'sec' = 'reps'): Level => ({ move, lo, hi, unit })

/**
 * What a chain falls back to when its step needs gear you don't have, best first. The pull chain starts on a
 * table, so a weak desk or no table means a bar first, then bands, a towel on a door, a backpack, floor pulls
 * (dumbbells and rings, if you own them, come right after the bands).
 */
export const ALT_LEVELS: Partial<Record<LadderId, Level[]>> = {
  pull: [L('neg_pullup', 3, 6), L('band_row', 8, 15), L('dumbbell_row', 8, 15), L('ring_row', 8, 15), L('towel_row', 8, 15), L('backpack_row', 8, 15), L('floor_pull', 8, 15)]
}

/** A same-level option for the swap sheet (not a step up or down): "more chest, less triceps". */
export const SIDE_LEVELS: Partial<Record<LadderId, { level: Level; note: string }>> = {
  push: { level: L('wide_pushup', 8, 12), note: 'more chest, less triceps' },
  single: { level: L('lunge', 8, 12), note: 'one leg at a time, moving' },
  core: { level: L('side_plank', 20, 45, 'sec'), note: 'the sides of your trunk' }
}

export interface Effective {
  /** The step on the chain (a move not on the chain keeps your step's index). */
  index: number
  level: Level
  /** Your step needs gear you don't have, so another move is used. */
  swapped: boolean
  /** The move is not a step of the chain at all (a floor pull on the pull chain). */
  alt: boolean
}

/** The step the plan really uses: yours when your gear allows it, else the nearest easier one, else a fallback. */
export function effectiveLevel(ladder: Ladder, index: number, g: Gear | null | undefined): Effective {
  const lv = ladder.levels[index]
  if (!g || allowed(lv.move, g)) return { index, level: lv, swapped: false, alt: false }
  for (let i = index - 1; i >= 0; i--) if (allowed(ladder.levels[i].move, g)) return { index: i, level: ladder.levels[i], swapped: true, alt: false }
  for (const alt of ALT_LEVELS[ladder.id] ?? []) {
    if (!allowed(alt.move, g)) continue
    const at = ladder.levels.findIndex((x) => x.move === alt.move)
    return at >= 0 ? { index: at, level: ladder.levels[at], swapped: true, alt: false } : { index, level: alt, swapped: true, alt: true }
  }
  for (let i = index + 1; i < ladder.levels.length; i++) if (allowed(ladder.levels[i].move, g)) return { index: i, level: ladder.levels[i], swapped: true, alt: false }
  return { index, level: lv, swapped: false, alt: false }
}

/** The first step you can do at or after `from` (going `dir`), or null. */
export function stepFrom(ladder: Ladder, from: number, dir: 1 | -1, g: Gear | null | undefined): number | null {
  for (let i = from; i >= 0 && i < ladder.levels.length; i += dir) if (allowed(ladder.levels[i].move, g)) return i
  return null
}

// ---------- changing the state (in place, inside saveTraining) ----------

/** Saves what you can train with (the plan follows at once). */
export function setGear(st: any, gear: Omit<Gear, 'at'>, now: number): Gear {
  const g = cleanGear({ ...gear, at: now }) as Gear
  st.trainGear = g
  return g
}

/** Today's move on a chain, chosen for today only (the swap sheet's "Use … today"). Your step and every log stay. */
export function pickToday(st: any, input: { day: string; ladder: LadderId; level: Level; now: number }): void {
  const old = st.trainPicks && st.trainPicks.day === input.day ? st.trainPicks.moves : {}
  st.trainPicks = { day: input.day, at: input.now, moves: { ...old, [input.ladder]: { move: input.level.move, lo: input.level.lo, hi: input.level.hi, unit: input.level.unit } } }
}

/** "floor, table, chair": the gear a plan can use, for a short line (null gear: any). */
export function gearSummary(g: Gear | null | undefined, max = 3): string {
  if (!g) return 'any gear'
  const own: string[] = ['floor']
  if (g.table === 'sturdy') own.push('table')
  for (const k of GEAR_FLAGS) if (g[k]) own.push(SHORT[k])
  return own.slice(0, max).join(', ')
}

/** Back to your step for today. */
export function clearPick(st: any, input: { day: string; ladder: LadderId; now: number }): void {
  if (!st.trainPicks || st.trainPicks.day !== input.day) return
  const moves = { ...st.trainPicks.moves }
  delete moves[input.ladder]
  st.trainPicks = { day: input.day, at: input.now, moves }
}
