// Calisthenics skill paths (pure): each path is a ladder of moves; a move
// unlocks the next one when you pass its test (best set in a session, from
// your logged workouts). E.g. 3 sets of 12 push-ups unlocks diamond push-ups.
import type { Workout } from './body'

export interface Step { name: string; match: RegExp; sets: number; reps: number }
export interface SkillPath { id: string; title: string; steps: Step[] }

export const PATHS: SkillPath[] = [
  {
    id: 'push',
    title: 'Push',
    steps: [
      { name: 'Incline push-ups', match: /incline push/i, sets: 3, reps: 15 },
      { name: 'Push-ups', match: /^push.?ups?$/i, sets: 3, reps: 12 },
      { name: 'Diamond push-ups', match: /diamond/i, sets: 3, reps: 10 },
      { name: 'Archer push-ups', match: /archer push/i, sets: 3, reps: 6 },
      { name: 'One-arm push-up', match: /one.?arm push/i, sets: 1, reps: 1 }
    ]
  },
  {
    id: 'pull',
    title: 'Pull',
    steps: [
      { name: 'Australian rows', match: /australian|inverted row/i, sets: 3, reps: 12 },
      { name: 'Negative pull-ups', match: /negative pull/i, sets: 3, reps: 5 },
      { name: 'Pull-ups', match: /^pull.?ups?$/i, sets: 3, reps: 8 },
      { name: 'Archer pull-ups', match: /archer pull/i, sets: 3, reps: 4 },
      { name: 'One-arm pull-up', match: /one.?arm pull/i, sets: 1, reps: 1 }
    ]
  },
  {
    id: 'legs',
    title: 'Legs',
    steps: [
      { name: 'Squats', match: /^squats?$/i, sets: 3, reps: 20 },
      { name: 'Split squats', match: /split squat|bulgarian/i, sets: 3, reps: 10 },
      { name: 'Shrimp squats', match: /shrimp/i, sets: 3, reps: 5 },
      { name: 'Pistol squat', match: /pistol/i, sets: 3, reps: 3 }
    ]
  }
]

/** Did one session pass the step's test (sets × reps)? Rep-only logs count as one set of the total. */
const passed = (w: Workout, s: Step) =>
  w.items.some((it) => {
    if (!s.match.test(it.name.trim())) return false
    const sets = it.sets?.length ? it.sets : [{ reps: Number(it.amount) || 0 }]
    return sets.filter((x) => x.reps >= s.reps).length >= s.sets
  })

export interface PathStatus { id: string; title: string; level: number; total: number; current: Step; next: Step | null; done: boolean }

/** Where you are on each path: the first move whose test you haven't passed. */
export function skillStatus(workouts: Workout[], paths = PATHS): PathStatus[] {
  return paths.map((p) => {
    let level = 0
    while (level < p.steps.length && workouts.some((w) => passed(w, p.steps[level]))) level++
    const done = level >= p.steps.length
    const at = Math.min(level, p.steps.length - 1)
    return { id: p.id, title: p.title, level, total: p.steps.length, current: p.steps[at], next: done ? null : p.steps[at + 1] ?? null, done }
  })
}
