import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appMin, nextMeal, proteinLeftLine, usualMealTimes, usualTrainStart, workoutNote } from './foodTiming'
import { addDays } from './dates'

const TODAY = '2030-03-20'
const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00`)

describe('food and the clock', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(at(TODAY, '12:00'))
  })
  afterEach(() => vi.useRealTimers())

  it('learns his usual meal times from his logs (3+ days)', () => {
    const meals = [0, 1, 2, 3].flatMap((k) => [
      { day: addDays(TODAY, -1 - k), type: 'lunch' as const, at: at(addDays(TODAY, -1 - k), ['13:10', '13:40', '14:00', '13:20'][k]).toISOString() },
      ...(k < 2 ? [{ day: addDays(TODAY, -1 - k), type: 'breakfast' as const, at: at(addDays(TODAY, -1 - k), '09:00').toISOString() }] : [])
    ])
    const u = usualMealTimes(meals, TODAY)
    expect(u.lunch).toBe(13 * 60 + 30)
    expect(u.breakfast).toBeNull()
    expect(usualTrainStart([1, 2, 3].map((k) => ({ day: addDays(TODAY, -k), at: at(addDays(TODAY, -k), '18:00').toISOString() })), TODAY)).toBe(18 * 60)
  })
  it('splits what is left over the meals before bed', () => {
    const r = nextMeal({ now: new Date(), kcalLeft: 1800, proteinLeft: 90, bed: 23 * 60, trainAt: null, trainEnd: null, ideas: ['200 g chicken breast'] })
    expect(r.line).toBe('Next meal (3 meals left before bed): about 600 kcal and 30 g protein: 200 g chicken breast.')
  })
  it('plans around training and bed', () => {
    const base = { now: new Date(), kcalLeft: 1500, proteinLeft: 80, bed: 23 * 60, trainEnd: null, ideas: [] }
    expect(nextMeal({ ...base, trainAt: 14 * 60 }).why).toBe('pre')
    expect(nextMeal({ ...base, trainAt: 12 * 60 + 40 }).line).toMatch(/^Training at 12:40: only a small snack/)
    expect(nextMeal({ ...base, trainAt: null, trainEnd: 11 * 60 + 15 }).line).toMatch(/^After training \(11:15\): 40 g protein/)
    vi.setSystemTime(at(TODAY, '22:30'))
    expect(nextMeal({ ...base, now: new Date(), trainAt: null }).why).toBe('bed')
    expect(nextMeal({ ...base, kcalLeft: 50, proteinLeft: 0, trainAt: null }).why).toBe('done')
  })
  it('notes training without protein, while it still helps', () => {
    vi.setSystemTime(at(TODAY, '19:00'))
    const start = at(TODAY, '17:10')
    const end = at(TODAY, '18:00')
    expect(workoutNote({ now: new Date(), start, end, protein: [] })).toMatch(/^You trained at 17:10 with no protein in the 3 hours before or since/)
    expect(workoutNote({ now: new Date(), start, end, protein: [{ at: at(TODAY, '18:20'), g: 35 }] })).toBeNull()
    expect(workoutNote({ now: new Date(), start, end, protein: [{ at: at(TODAY, '15:00'), g: 30 }] })).toMatch(/^60 min since training/)
    vi.setSystemTime(at(TODAY, '22:00'))
    expect(workoutNote({ now: new Date(), start, end, protein: [] })).toBeNull()
    expect(workoutNote({ now: new Date(), start: null, end: null, protein: [] })).toBeNull()
  })
  it('says the protein left with real foods', () => {
    expect(proteinLeftLine({ protein: 72, goal: 130, ideas: ['200 g chicken breast', '3 eggs + 300 g skyr', 'a shake'] })).toBe('🥩 58 g protein left today: 200 g chicken breast, or 3 eggs + 300 g skyr.')
    expect(proteinLeftLine({ protein: 140, goal: 130, ideas: [] })).toBe('🥩 Protein done for today: 140 / 130 g.')
  })
  it('counts minutes into the app day', () => {
    expect(appMin(at(TODAY, '00:30'))).toBe(24 * 60 + 30)
  })
})
