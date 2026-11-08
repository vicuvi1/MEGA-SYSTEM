// Body → Today: the body map. A drawn front and back body whose muscle groups
// light up by this week's hard sets (Sport Track's sets, the same count as
// "This week per muscle": sportSets.hardSetsByMuscle). 10–20 hard sets a week
// is the zone that grows a muscle. Tap a muscle: its sets and the moves that
// train it (your own first, then a few from the library). Pure and tested;
// nothing here pays points.
import { MOVES, type Move } from './sportMoves'
import { moveOf, type SportEx } from './sportLadders'
import { MUSCLES, WEEKLY_SETS, type Muscle } from './sportSets'

export type Zone = 'none' | 'low' | 'grow' | 'high'

/** 0: none, 1–9: under the zone, 10–20: the growth zone, over 20: more than it needs. */
export function setZone(sets: number): Zone {
  const n = Math.max(0, Math.round(Number(sets) || 0))
  return n === 0 ? 'none' : n < WEEKLY_SETS.lo ? 'low' : n <= WEEKLY_SETS.hi ? 'grow' : 'high'
}

/** How bright a muscle is drawn, 0–1 (full at the top of the zone). */
export const zoneHeat = (sets: number): number => Math.max(0, Math.min(1, (Number(sets) || 0) / WEEKLY_SETS.hi))

export const ZONE_LABEL: Record<Zone, string> = { none: 'Not trained yet', low: 'Under 10', grow: 'Growth zone', high: 'Over 20' }

export type Side = 'front' | 'back'

/** The drawn regions: each belongs to one of Sport Track's four muscle groups. */
export const REGIONS: { id: string; name: string; muscle: Muscle; side: Side }[] = [
  { id: 'chest', name: 'Chest', muscle: 'push', side: 'front' },
  { id: 'shoulders', name: 'Shoulders', muscle: 'push', side: 'front' },
  { id: 'biceps', name: 'Biceps', muscle: 'pull', side: 'front' },
  { id: 'abs', name: 'Abs', muscle: 'core', side: 'front' },
  { id: 'obliques', name: 'Sides', muscle: 'core', side: 'front' },
  { id: 'quads', name: 'Thighs', muscle: 'legs', side: 'front' },
  { id: 'calves-f', name: 'Calves', muscle: 'legs', side: 'front' },
  { id: 'upper-back', name: 'Upper back', muscle: 'pull', side: 'back' },
  { id: 'lats', name: 'Lats', muscle: 'pull', side: 'back' },
  { id: 'triceps', name: 'Triceps', muscle: 'push', side: 'back' },
  { id: 'lower-back', name: 'Lower back', muscle: 'core', side: 'back' },
  { id: 'glutes', name: 'Glutes', muscle: 'legs', side: 'back' },
  { id: 'hamstrings', name: 'Hamstrings', muscle: 'legs', side: 'back' },
  { id: 'calves-b', name: 'Calves', muscle: 'legs', side: 'back' }
]

const MUSCLE_PARTS: Record<Muscle, string> = {
  push: 'chest, shoulders and triceps',
  pull: 'back and biceps',
  core: 'abs, sides and lower back',
  legs: 'thighs, glutes and calves'
}

export interface MapGroup {
  muscle: Muscle
  name: string
  sets: number
  zone: Zone
  heat: number
}

/** The four groups with their sets this week, zone and brightness. */
export function bodyMap(byMuscle: Partial<Record<Muscle, number>>): MapGroup[] {
  return MUSCLES.map((m) => {
    const sets = Math.max(0, Math.round(Number(byMuscle[m.id]) || 0))
    return { muscle: m.id, name: m.short, sets, zone: setZone(sets), heat: zoneHeat(sets) }
  })
}

/** One line for a muscle: what the number means this week. */
export function zoneLine(sets: number): string {
  const n = Math.max(0, Math.round(Number(sets) || 0))
  const z = setZone(n)
  if (z === 'none') return `No hard sets yet this week. Aim for ${WEEKLY_SETS.lo}–${WEEKLY_SETS.hi}.`
  if (z === 'low') return `${n} hard set${n === 1 ? '' : 's'} this week: ${WEEKLY_SETS.lo - n} more to reach ${WEEKLY_SETS.lo}.`
  if (z === 'grow') return `${n} hard sets this week: in the growth zone (${WEEKLY_SETS.lo}–${WEEKLY_SETS.hi}).`
  return `${n} hard sets this week: over ${WEEKLY_SETS.hi}, more won't grow it faster.`
}

export interface MuscleDetail {
  muscle: Muscle
  name: string
  /** "chest, shoulders and triceps" */
  parts: string
  sets: number
  zone: Zone
  line: string
  /** Your own active exercises for this muscle. */
  yours: { id: string; name: string }[]
  /** A few library moves for it you don't do yet (easiest first). */
  ideas: Move[]
}

/** A tapped muscle: its sets and the moves that train it. */
export function muscleDetail(muscle: Muscle, sets: number, exercises: SportEx[], ideas = 3): MuscleDetail {
  const m = MUSCLES.find((x) => x.id === muscle) ?? MUSCLES[0]
  const yours: { id: string; name: string }[] = []
  const have = new Set<string>()
  for (const ex of exercises ?? []) {
    if (ex.active === false) continue
    const mv = moveOf(ex)
    if (mv?.group !== muscle) continue
    have.add(mv.id)
    yours.push({ id: String(ex.id), name: mv.name })
  }
  const more = MOVES.filter((x) => x.group === muscle && !have.has(x.id))
    .sort((a, b) => a.diff - b.diff || a.name.localeCompare(b.name))
    .slice(0, Math.max(0, ideas))
  const n = Math.max(0, Math.round(Number(sets) || 0))
  return { muscle: m.id, name: m.short, parts: MUSCLE_PARTS[m.id], sets: n, zone: setZone(n), line: zoneLine(n), yours, ideas: more }
}

/** A 5–10 minute mobility routine from the library (moves with demos), about 8 minutes. */
export function mobilityRoutine(): { move: Move; amount: string }[] {
  const ids = ['cat_cow', 'worlds_greatest', 'down_dog', 'cobra', 'childs_pose', 'arm_circles']
  return ids
    .map((id) => MOVES.find((x) => x.id === id))
    .filter((x): x is Move => !!x)
    .map((move) => ({ move, amount: move.unit === 'sec' ? `${move.set * 2} s` : `${move.set} reps` }))
}
