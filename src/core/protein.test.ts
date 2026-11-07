import { describe, expect, it } from 'vitest'
import { cleanMeals, fuelCard, mealGrams, mealText, parseProtein, proteinEntries, proteinGoal, proteinKind, proteinOfDay, proteinWeek, quickPicks } from './protein'
import type { BodyEvent } from './bodyLog'

const ev = (id: string, day: string, kind: string, amount: number, undoes: string | null = null, at = `${day}T12:00:00.000Z`): BodyEvent => ({ id, at, day, kind, amount, source: 'web', undoes })

describe('protein (BD1)', () => {
  it('sets the goal from body weight, 1.6–2.2 g per kg', () => {
    expect(proteinGoal(70)).toMatchObject({ g: 125, lo: 110, hi: 155, gPerKg: 1.8 })
    expect(proteinGoal(70, 3).gPerKg).toBe(2.2)
    expect(proteinGoal(70, 1).gPerKg).toBe(1.6)
    expect(proteinGoal(null)).toMatchObject({ g: 120, weight: null })
    expect(proteinGoal(500).weight).toBeNull()
  })
  it('reads quick logs and leaves money alone', () => {
    expect(parseProtein('protein 30')).toMatchObject({ food: 'other', g: 30 })
    expect(parseProtein('30g protein')).toMatchObject({ food: 'other', g: 30 })
    expect(parseProtein('2 eggs')).toMatchObject({ food: 'egg', qty: 2, g: 12, label: '2 eggs' })
    expect(parseProtein('ate two eggs')).toMatchObject({ food: 'egg', g: 12 })
    expect(parseProtein('eggs 3')).toMatchObject({ food: 'egg', qty: 3 })
    expect(parseProtein('chicken 150g')).toMatchObject({ food: 'chicken', g: 47 })
    expect(parseProtein('200 g brânză de vaci')).toMatchObject({ food: 'cottage', g: 28 })
    expect(parseProtein('a can of tuna')).toMatchObject({ food: 'tuna', g: 26, label: '1 can of tuna' })
    expect(parseProtein('whey')).toMatchObject({ food: 'whey', g: 24 })
    // Money and other talk stay out.
    expect(parseProtein('chicken 45')).toBeNull()
    expect(parseProtein('eggs 20')).toBeNull()
    expect(parseProtein('how much protein is in 2 eggs?')).toBeNull()
    expect(parseProtein('coffee 30')).toBeNull()
    expect(parseProtein('water 500')).toBeNull()
  })
  it('sums the day from the one log, with removed entries left out', () => {
    const d = '2026-11-07'
    const events = [ev('a', d, proteinKind('egg'), 12), ev('b', d, proteinKind('other'), 30), ev('x-b', d, proteinKind('other'), 0, 'b'), ev('c', d, 'water', 500), ev('d', '2026-11-06', proteinKind('whey'), 24)]
    expect(proteinOfDay(events, d)).toBe(12)
    const list = proteinEntries(events, d)
    expect(list.map((e) => [e.food, e.g, e.removed])).toEqual([
      ['egg', 12, false],
      ['other', 30, true]
    ])
    expect(proteinWeek(events, d, 120)).toMatchObject({ days: 2, avg: 18, hit: 0 })
  })
  it('saved meals: grams, text, cleaned; quick picks put favourites first', () => {
    const meals = cleanMeals([{ id: 'meal-a', name: 'Breakfast', items: [{ food: 'egg', qty: 3 }, { food: 'cottage', qty: 2 }, { food: 'nope', qty: 1 }] }, { name: '' }])
    expect(meals).toHaveLength(1)
    expect(mealGrams(meals[0])).toBe(46)
    expect(mealText(meals[0])).toBe('3 eggs, Cottage cheese (brânză de vaci) 200 g')
    const picks = quickPicks([ev('a', '2026-11-05', proteinKind('tuna'), 26)], ['lentils'], '2026-11-07', 3)
    expect(picks.map((f) => f.id)).toEqual(['lentils', 'tuna', 'egg'])
  })
  it('BD9: the pre-shift card in the hour before work, gone after a real meal; a soft late line', () => {
    const base = { shiftFrom: '17:00', workToday: true, logged: [] as { at: string; g: number }[] }
    expect(fuelCard({ ...base, now: '15:30' })).toBeNull()
    expect(fuelCard({ ...base, now: '16:10' })?.kind).toBe('before')
    expect(fuelCard({ ...base, now: '16:10' })?.snacks.length).toBeGreaterThan(2)
    expect(fuelCard({ ...base, now: '16:10', logged: [{ at: '15:40', g: 35 }] })).toBeNull()
    expect(fuelCard({ ...base, now: '16:10', workToday: false })).toBeNull()
    expect(fuelCard({ ...base, now: '22:45' })?.kind).toBe('late')
    expect(fuelCard({ ...base, now: '15:10', leadMin: 120 })?.kind).toBe('before')
  })
})
