import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Body } from './body'
import { openDb, type DB } from './db'
import { Wallet } from './wallet'

let dir: string
let db: DB
let wallet: Wallet
let body: Body

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'life-body-test-'))
  db = openDb(join(dir, 'life.db'))
  wallet = new Wallet(db, 'UTC')
  body = new Body(db, wallet)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('Body module backend', () => {
  it('seeds default exercises on database open', () => {
    const exercises = body.exercises()
    expect(exercises.length).toBeGreaterThanOrEqual(6)
    expect(exercises.some((e) => e.name === 'Push-ups')).toBe(true)
  })

  it('allows adding and updating custom exercises', () => {
    body.saveExercise({
      id: 'burpees',
      name: 'Burpees',
      unit: 'reps',
      target: 15,
      category: 'calisthenics'
    })
    const exercises = body.exercises()
    const burpee = exercises.find((e) => e.id === 'burpees')
    expect(burpee).toBeDefined()
    expect(burpee?.target).toBe(15)
  })

  it('logs a workout and awards coins & XP via the wallet', () => {
    const now = new Date('2026-10-27T10:00:00Z')
    const res = body.logWorkout(
      {
        title: 'Calisthenics Session',
        items: [
          { exerciseId: 'pushups', name: 'Push-ups', amount: 50, unit: 'reps' },
          { exerciseId: 'pullups', name: 'Pull-ups', amount: 15, unit: 'reps' }
        ]
      },
      now
    )
    expect(res.awarded).toBe(true)
    expect(res.workout.id).toBeGreaterThan(0)
    expect(res.state.totalWorkouts).toBe(1)
    expect(res.state.streak).toBe(1)
    expect(res.state.workoutDoneToday).toBe(true)

    const summary = wallet.summary(now)
    // body.workout_done rule awards 10 coins, 25 XP
    expect(summary.balance).toBe(10)
    expect(summary.totalXp).toBe(25)
  })

  it('undoes the award when a workout is deleted', () => {
    const now = new Date('2026-10-27T10:00:00Z')
    const res = body.logWorkout(
      {
        title: 'Calisthenics Session',
        items: [{ exerciseId: 'pushups', name: 'Push-ups', amount: 30, unit: 'reps' }]
      },
      now
    )
    expect(wallet.summary(now).balance).toBe(10)

    body.deleteWorkout(res.workout.id, now)
    expect(wallet.summary(now).balance).toBe(0)
    expect(body.workouts()).toHaveLength(0)
  })

  it('records body metrics and computes weekly averages', () => {
    const now = new Date('2026-10-27T08:00:00Z')
    body.logMetric({ weight: 78.4, waist: 82.5, note: 'Morning weigh-in' }, now)

    const state = body.state(now)
    expect(state.latestWeight).toBe(78.4)
    expect(state.latestWaist).toBe(82.5)
    expect(state.weeklyAverages.length).toBeGreaterThan(0)
    expect(state.weeklyAverages[state.weeklyAverages.length - 1].avg).toBe(78.4)
  })
})
