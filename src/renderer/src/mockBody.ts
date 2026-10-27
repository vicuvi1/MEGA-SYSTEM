import {
  computeWeeklyAverages,
  computeWorkoutStats,
  DEFAULT_EXERCISES,
  validateWaist,
  validateWeight,
  validateWorkout,
  type BodyMetric,
  type BodyMetricInput,
  type Exercise,
  type Workout,
  type WorkoutInput
} from '@core/body'
import { dayKey } from '@core/dates'
import type { LedgerEntry, NewEntry } from '@core/ledger'
import { planAward, type Rule } from '@core/rules'
import type { BodyState, LifeApi } from '@shared/api'

interface Ctx {
  entries: LedgerEntry[]
  add: (e: NewEntry) => number
  rules: () => Rule[]
}

export function createMockBody(ctx: Ctx): Pick<LifeApi, 'body'> {
  const today = () => dayKey(new Date())
  let workouts: Workout[] = [
    {
      id: 1,
      day: today(),
      ts: new Date().toISOString(),
      title: 'Morning Push & Core',
      items: [
        { exerciseId: 'pushups', name: 'Push-ups', amount: 30, unit: 'reps' },
        { exerciseId: 'plank', name: 'Plank', amount: 60, unit: 'sec' }
      ],
      note: 'Felt strong, good form'
    }
  ]
  let metrics: BodyMetric[] = [
    { day: '2026-10-20', weight: 81.2, waist: 84.0, updatedAt: new Date().toISOString() },
    { day: '2026-10-25', weight: 80.5, waist: 83.0, updatedAt: new Date().toISOString() },
    { day: today(), weight: 79.8, waist: 82.5, updatedAt: new Date().toISOString() }
  ]
  let exercises: Exercise[] = [...DEFAULT_EXERCISES]
  let nextId = 2

  const getState = (): BodyState => {
    const t = today()
    const stats = computeWorkoutStats(workouts, t)
    const weeklyAverages = computeWeeklyAverages(metrics, 12)
    const withWeight = metrics.filter((m) => m.weight != null)
    const latestWeight = withWeight.length ? withWeight[withWeight.length - 1].weight! : null
    const previousWeight = withWeight.length > 1 ? withWeight[withWeight.length - 2].weight! : null

    const withWaist = metrics.filter((m) => m.waist != null)
    const latestWaist = withWaist.length ? withWaist[withWaist.length - 1].waist! : null
    const previousWaist = withWaist.length > 1 ? withWaist[withWaist.length - 2].waist! : null

    return {
      today: t,
      streak: stats.streak,
      bestStreak: stats.bestStreak,
      totalWorkouts: stats.totalWorkouts,
      workoutsThisWeek: stats.workoutsThisWeek,
      workoutDoneToday: stats.workoutDoneToday,
      latestWeight,
      previousWeight,
      latestWaist,
      previousWaist,
      weeklyAverages,
      recentWorkouts: [...workouts].reverse(),
      metrics,
      exercises
    }
  }

  return {
    body: {
      state: async () => getState(),
      logWorkout: async (input: WorkoutInput) => {
        const err = validateWorkout(input)
        if (err) throw new Error(err)
        const t = input.day ?? today()
        const ts = new Date().toISOString()
        let awarded = false
        const rule = ctx.rules().find((r) => r.id === 'body.workout_done')
        if (rule) {
          try {
            ctx.add(planAward(rule, ctx.entries, new Date(), t, input.title))
            awarded = true
          } catch {
            // over limit
          }
        }
        const workout: Workout = {
          id: nextId++,
          day: t,
          ts,
          title: input.title,
          items: input.items,
          note: input.note
        }
        workouts.push(workout)
        return { workout, state: getState(), awarded }
      },
      deleteWorkout: async (id: number) => {
        workouts = workouts.filter((w) => w.id !== id)
        return getState()
      },
      logMetric: async (input: BodyMetricInput) => {
        const wErr = validateWeight(input.weight)
        if (wErr) throw new Error(wErr)
        const waistErr = validateWaist(input.waist)
        if (waistErr) throw new Error(waistErr)
        if (input.weight == null && input.waist == null) throw new Error('Enter weight or waist')
        const t = input.day ?? today()
        const existingIdx = metrics.findIndex((m) => m.day === t)
        const item: BodyMetric = {
          day: t,
          weight: input.weight,
          waist: input.waist,
          note: input.note,
          updatedAt: new Date().toISOString()
        }
        if (existingIdx >= 0) {
          metrics[existingIdx] = {
            ...metrics[existingIdx],
            ...item,
            weight: input.weight ?? metrics[existingIdx].weight,
            waist: input.waist ?? metrics[existingIdx].waist
          }
        } else {
          metrics.push(item)
          metrics.sort((a, b) => a.day.localeCompare(b.day))
        }
        return getState()
      },
      saveExercise: async (ex: Omit<Exercise, 'id' | 'sort'> & { id?: string; sort?: number }) => {
        if (!ex.name?.trim()) throw new Error('Exercise name required')
        const id = ex.id || ex.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
        const idx = exercises.findIndex((e) => e.id === id)
        const entry: Exercise = {
          id,
          name: ex.name,
          unit: ex.unit || 'reps',
          target: ex.target || 10,
          category: ex.category || 'calisthenics',
          sort: ex.sort ?? 99
        }
        if (idx >= 0) exercises[idx] = entry
        else exercises.push(entry)
        return getState()
      }
    }
  }
}
