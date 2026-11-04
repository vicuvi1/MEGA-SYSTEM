import { describe, expect, it } from 'vitest'
import {
  computeWeeklyAverages,
  computeWorkoutStats,
  validateWaist,
  validateWeight,
  validateWorkout,
  weekMonday,
  type BodyMetric,
  type Workout
} from './body'

describe('body metrics validation', () => {
  it('validates weight ranges', () => {
    expect(validateWeight(null)).toBeNull()
    expect(validateWeight(undefined)).toBeNull()
    expect(validateWeight(75.5)).toBeNull()
    expect(validateWeight(20)).toContain('must be between')
    expect(validateWeight(350)).toContain('must be between')
  })

  it('validates waist ranges', () => {
    expect(validateWaist(null)).toBeNull()
    expect(validateWaist(undefined)).toBeNull()
    expect(validateWaist(82)).toBeNull()
    expect(validateWaist(30)).toContain('must be between')
    expect(validateWaist(220)).toContain('must be between')
  })

  it('validates workout input', () => {
    expect(validateWorkout({ title: '', items: [] })).toBe('Workout title is required')
    expect(validateWorkout({ title: 'Morning Calisthenics', items: [] })).toBe('At least one exercise is required')
    expect(
      validateWorkout({
        title: 'Morning Calisthenics',
        items: [{ exerciseId: 'pushups', name: '', amount: 20, unit: 'reps' }]
      })
    ).toBe('Exercise name cannot be empty')
    expect(
      validateWorkout({
        title: 'Morning Calisthenics',
        items: [{ exerciseId: 'pushups', name: 'Push-ups', amount: 0, unit: 'reps' }]
      })
    ).toBe('Amount for Push-ups must be greater than 0')
    expect(
      validateWorkout({
        title: 'Morning Calisthenics',
        items: [{ exerciseId: 'pushups', name: 'Push-ups', amount: 25, unit: 'reps' }]
      })
    ).toBeNull()
  })
})

describe('weekMonday and weekly averages', () => {
  it('finds Monday for various dates', () => {
    expect(weekMonday('2026-10-26')).toBe('2026-10-26') // Monday
    expect(weekMonday('2026-10-27')).toBe('2026-10-26') // Tuesday
    expect(weekMonday('2026-10-31')).toBe('2026-10-26') // Saturday
    expect(weekMonday('2026-11-01')).toBe('2026-10-26') // Sunday
    expect(weekMonday('2026-11-02')).toBe('2026-11-02') // Next Monday
  })

  it('computes weekly average weights correctly', () => {
    const metrics: BodyMetric[] = [
      { day: '2026-10-19', weight: 80.0, updatedAt: '' },
      { day: '2026-10-21', weight: 81.0, updatedAt: '' },
      { day: '2026-10-26', weight: 79.5, updatedAt: '' },
      { day: '2026-10-27', weight: 79.1, updatedAt: '' }
    ]
    const avgs = computeWeeklyAverages(metrics)
    expect(avgs).toHaveLength(2)
    expect(avgs[0]).toEqual({ week: '2026-10-19', avg: 80.5, count: 2 })
    expect(avgs[1]).toEqual({ week: '2026-10-26', avg: 79.3, count: 2 })
  })
})

describe('workout stats and streaks', () => {
  it('computes workout streaks and weekly count', () => {
    const workouts: Workout[] = [
      { id: 1, day: '2026-10-25', ts: '', title: 'Upper Body', items: [] },
      { id: 2, day: '2026-10-26', ts: '', title: 'Lower Body', items: [] },
      { id: 3, day: '2026-10-27', ts: '', title: 'Core & Cardio', items: [] }
    ]
    const stats = computeWorkoutStats(workouts, '2026-10-27')
    expect(stats.totalWorkouts).toBe(3)
    expect(stats.streak).toBe(3)
    expect(stats.bestStreak).toBe(3)
    expect(stats.workoutDoneToday).toBe(true)
    // 2026-10-26 is Monday, 2026-10-27 is Tuesday -> 2 workouts this week
    expect(stats.workoutsThisWeek).toBe(2)
  })

  it('maintains streak if yesterday was done but not yet today', () => {
    const workouts: Workout[] = [
      { id: 1, day: '2026-10-25', ts: '', title: 'Upper', items: [] },
      { id: 2, day: '2026-10-26', ts: '', title: 'Lower', items: [] }
    ]
    const stats = computeWorkoutStats(workouts, '2026-10-27')
    expect(stats.streak).toBe(2)
    expect(stats.workoutDoneToday).toBe(false)
  })
})

describe('rest days', () => {
  it("a rest day keeps the streak alive but doesn't add to it", async () => {
    const { computeWorkoutStats } = await import('./body')
    const w = (day: string) => ({ id: 1, day, title: 'x', items: [], note: null, createdAt: day }) as any
    const workouts = [w('2026-11-01'), w('2026-11-02'), w('2026-11-04')]
    expect(computeWorkoutStats(workouts, '2026-11-04').streak).toBe(1)
    const s = computeWorkoutStats(workouts, '2026-11-04', ['2026-11-03'])
    expect(s.streak).toBe(3)
    expect(s.bestStreak).toBe(3)
    const r = computeWorkoutStats(workouts.slice(0, 2), '2026-11-03', ['2026-11-03'])
    expect(r.streak).toBe(2)
    expect(r.restToday).toBe(true)
    expect(r.workoutDoneToday).toBe(false)
  })
})
