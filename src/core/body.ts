import { addDays, daysBetween } from './dates'
import { bestDayStreak, dayStreak } from './streaks'

export type ExerciseCategory = 'calisthenics' | 'cardio' | 'gym' | 'other'

export interface Exercise {
  id: string
  name: string
  unit: string
  target: number
  category: ExerciseCategory
  sort: number
  archived?: boolean
}

export interface WorkoutSet {
  reps: number
  weight?: number
}

export interface WorkoutExerciseItem {
  exerciseId: string
  name: string
  unit: string
  amount: number
  sets?: WorkoutSet[]
}

export interface Workout {
  id: number
  day: string
  ts: string
  title: string
  items: WorkoutExerciseItem[]
  note?: string
  ledgerId?: number | null
}

export interface WorkoutInput {
  day?: string
  title: string
  items: WorkoutExerciseItem[]
  note?: string
}

export interface BodyMetric {
  day: string
  weight?: number | null
  waist?: number | null
  note?: string | null
  updatedAt: string
}

export interface BodyMetricInput {
  day?: string
  weight?: number | null
  waist?: number | null
  note?: string | null
}

export interface BodySummary {
  today: string
  streak: number
  bestStreak: number
  totalWorkouts: number
  workoutsThisWeek: number
  workoutDoneToday: boolean
  latestWeight: number | null
  previousWeight: number | null
  latestWaist: number | null
  previousWaist: number | null
  weeklyAverages: { week: string; avg: number; count: number }[]
  recentWorkouts: Workout[]
  metrics: BodyMetric[]
  exercises: Exercise[]
}

export const DEFAULT_EXERCISES: Exercise[] = [
  { id: 'pushups', name: 'Push-ups', unit: 'reps', target: 20, category: 'calisthenics', sort: 0 },
  { id: 'pullups', name: 'Pull-ups', unit: 'reps', target: 8, category: 'calisthenics', sort: 1 },
  { id: 'squats', name: 'Squats', unit: 'reps', target: 25, category: 'calisthenics', sort: 2 },
  { id: 'dips', name: 'Dips', unit: 'reps', target: 12, category: 'calisthenics', sort: 3 },
  { id: 'plank', name: 'Plank', unit: 'sec', target: 60, category: 'calisthenics', sort: 4 },
  { id: 'running', name: 'Running', unit: 'min', target: 20, category: 'cardio', sort: 5 }
]

export const WEIGHT_RANGE = [25, 300] as const
export const WAIST_RANGE = [40, 200] as const

export function validateWeight(w?: number | null): string | null {
  if (w == null) return null
  if (Number.isNaN(w) || w < WEIGHT_RANGE[0] || w > WEIGHT_RANGE[1]) {
    return `Weight must be between ${WEIGHT_RANGE[0]} and ${WEIGHT_RANGE[1]} kg`
  }
  return null
}

export function validateWaist(w?: number | null): string | null {
  if (w == null) return null
  if (Number.isNaN(w) || w < WAIST_RANGE[0] || w > WAIST_RANGE[1]) {
    return `Waist measurement must be between ${WAIST_RANGE[0]} and ${WAIST_RANGE[1]} cm`
  }
  return null
}

export function validateWorkout(input: WorkoutInput): string | null {
  if (!input.title || !input.title.trim()) {
    return 'Workout title is required'
  }
  if (!input.items || input.items.length === 0) {
    return 'At least one exercise is required'
  }
  for (const it of input.items) {
    if (!it.name || !it.name.trim()) return 'Exercise name cannot be empty'
    if (it.amount <= 0 || Number.isNaN(it.amount)) return `Amount for ${it.name} must be greater than 0`
  }
  return null
}

/** Compute Monday of the week for a given YYYY-MM-DD */
export function weekMonday(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  const dayOfWeek = dt.getUTCDay()
  // 0 is Sunday, 1 is Monday ... 6 is Saturday
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  return addDays(day, diff)
}

export function computeWorkoutStats(workouts: Workout[], today: string) {
  const workoutDays = Array.from(new Set(workouts.filter((w) => w.day <= today).map((w) => w.day))).sort()
  const streak = dayStreak(workoutDays, today)
  const bestStreak = bestDayStreak(workoutDays)
  const totalWorkouts = workouts.length
  const workoutDoneToday = workoutDays.includes(today)

  const thisMonday = weekMonday(today)
  const nextMonday = addDays(thisMonday, 7)
  const workoutsThisWeek = workouts.filter((w) => w.day >= thisMonday && w.day < nextMonday).length

  return {
    streak,
    bestStreak,
    totalWorkouts,
    workoutsThisWeek,
    workoutDoneToday
  }
}

export function computeWeeklyAverages(metrics: BodyMetric[], weeks = 12): { week: string; avg: number; count: number }[] {
  const withWeight = metrics.filter((m) => m.weight != null && !Number.isNaN(m.weight))
  if (withWeight.length === 0) return []

  const groups = new Map<string, number[]>()
  for (const m of withWeight) {
    const monday = weekMonday(m.day)
    const list = groups.get(monday) ?? []
    list.push(m.weight!)
    groups.set(monday, list)
  }

  const sortedMondays = Array.from(groups.keys()).sort().slice(-weeks)
  return sortedMondays.map((monday) => {
    const weights = groups.get(monday)!
    const sum = weights.reduce((a, b) => a + b, 0)
    const avg = Math.round((sum / weights.length) * 10) / 10
    return {
      week: monday,
      avg,
      count: weights.length
    }
  })
}
