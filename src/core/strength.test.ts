import { describe, expect, it } from 'vitest'
import { e1rm, parseSets, strengthSummary } from './strength'

const w = (day: string, name: string, reps: number, kg: number) => ({ id: 1, day, ts: day, title: name, items: [{ exerciseId: name, name, unit: 'kg', amount: reps * 3, sets: [{ reps, weight: kg }, { reps, weight: kg }, { reps, weight: kg }] }], note: null }) as any

describe('strength', () => {
  it('reads sets × reps × kg in the usual ways', () => {
    expect(parseSets('bench 3x8x60')).toEqual({ name: 'Bench', sets: [{ reps: 8, weight: 60 }, { reps: 8, weight: 60 }, { reps: 8, weight: 60 }] })
    expect(parseSets('squat 5x5 @100')?.sets[0]).toEqual({ reps: 5, weight: 100 })
    expect(parseSets('deadlift 102,5kg 3x5')?.sets[0]).toEqual({ reps: 5, weight: 102.5 })
    expect(parseSets('pull-ups 4x8')).toEqual({ name: 'Pull-ups', sets: Array(4).fill({ reps: 8 }) })
    expect(parseSets('call mom')).toBeNull()
  })
  it('estimates the max (Epley, 1–12 reps)', () => {
    expect(e1rm(5, 100)).toBe(116.7)
    expect(e1rm(20, 100)).toBe(0)
  })
  it('finds records and a new PR on the latest day', () => {
    const s = strengthSummary([w('2026-11-01', 'Bench', 8, 60), w('2026-11-04', 'Bench', 8, 62.5)])
    expect(s[0]).toMatchObject({ name: 'Bench', bestWeight: 62.5, newPr: true, lastDay: '2026-11-04' })
    expect(s[0].points.map((p) => p.day)).toEqual(['2026-11-01', '2026-11-04'])
    expect(strengthSummary([w('2026-11-01', 'Bench', 8, 60), w('2026-11-04', 'Bench', 5, 55)])[0].newPr).toBe(false)
  })
})

import { musclesOf, volumeZone, weeklyMuscleSets } from './strength'
describe('volume per muscle group', () => {
  it('maps exercises to muscles and counts the week’s hard sets', () => {
    expect(musclesOf('Bench')).toEqual(['Chest', 'Arms'])
    expect(musclesOf('Squats')).toEqual(['Legs'])
    const ws = [w('2026-11-04', 'Bench', 8, 60), w('2026-10-20', 'Bench', 8, 60), { id: 2, day: '2026-11-05', ts: '', title: 'x', items: [{ exerciseId: 'p', name: 'Push-ups', unit: 'reps', amount: 100 }], note: null } as any]
    const v = weeklyMuscleSets(ws, '2026-11-05')
    expect(v.Chest).toBe(3 + 6) // 3 sets of bench + 100 push-ups ≈ 6 sets; the old session doesn't count
    expect(v.Legs).toBe(0)
    expect([volumeZone(0), volumeZone(9), volumeZone(15), volumeZone(25)]).toEqual(['none', 'low', 'good', 'high'])
  })
})
