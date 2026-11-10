import { describe, expect, it } from 'vitest'
import { AFTER_MS, eatenFrom, isAfterNote, leftLine, recentPhotoMeal } from './foodLeftovers'
import { validateVision } from './foodVision'
import type { FoodItem } from './food'

const f = (name: string, grams: number, protein: number, kcal: number): FoodItem => ({ name, grams, protein, carbs: 10, fat: 5, kcal, confidence: 'roughly', lo: grams - 20, hi: grams + 20 })

describe('before and after photos', () => {
  it('reads "after" captions', () => {
    for (const t of ['after', 'Leftovers', "what's left", "didn't finish it", 'rest of it']) expect(isAfterNote(t)).toBe(true)
    for (const t of ['', 'lunch', '2 containers, one buckwheat']) expect(isAfterNote(t)).toBe(false)
  })
  it('logs only what was eaten', () => {
    const before = [f('Boiled white rice', 250, 6, 325), f('Grilled chicken breast', 200, 62, 330), f('Salad', 100, 1, 20)]
    const r = eatenFrom(before, [{ name: 'rice', grams: 100 }, { name: 'salad', grams: 100 }, { name: 'bread crust', grams: 20 }])
    expect(r.eaten.map((x) => [x.name, x.grams, x.kcal])).toEqual([
      ['Boiled white rice', 150, 195],
      ['Grilled chicken breast', 200, 330]
    ])
    expect(r.eaten[0].lo).toBeUndefined()
    expect(r.unmatched).toEqual(['bread crust'])
    expect(leftLine(r)).toBe('Left: 100 g boiled white rice, 100 g salad (not in the meal: bread crust).')
  })
  it('a lone food and a lone leftover match; a clean plate leaves all of it', () => {
    expect(eatenFrom([f('Pasta bolognese', 400, 30, 600)], [{ name: 'some noodles', grams: 100 }]).eaten[0].grams).toBe(300)
    const clean = eatenFrom([f('Pasta', 400, 30, 600)], [])
    expect(clean.eaten[0].grams).toBe(400)
    expect(leftLine(clean)).toMatch(/Nothing left/)
  })
  it('an empty after photo is a valid read (everything eaten)', () => {
    const r = validateVision({ items: [], message: 'Clean plate', leftovers: true })
    expect(r.ok && r.result.leftovers && r.result.items.length).toBe(0)
    expect(validateVision({ items: [], message: '' }).ok).toBe(false)
  })
  it('finds the photo meal of the last 90 minutes', () => {
    const now = Date.parse('2030-03-12T13:30:00Z')
    const meals = [
      { id: 'fd-a', at: '2030-03-12T12:10:00Z', source: 'photo' as const },
      { id: 'fd-b', at: '2030-03-12T13:00:00Z', source: 'saved' as const },
      { id: 'fd-c', at: '2030-03-12T10:00:00Z', source: 'photo' as const }
    ]
    expect(recentPhotoMeal(meals, now)?.id).toBe('fd-a')
    expect(recentPhotoMeal(meals, now + AFTER_MS)).toBeNull()
    expect(recentPhotoMeal(meals, now, new Set(['fd-c-p']))).toBeNull()
  })
})
