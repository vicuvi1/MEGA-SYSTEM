// Logging saved foods teaches "your own foods" (per 100 g); counts like "2 eggs" must still work.
import { describe, expect, it } from 'vitest'
import { parseFoodWords } from './foodWords'
import { ownPer100 } from './foodTable'
import { itemsOf, setQty, seedSaved } from './foodSaved'

describe('saved foods and words', () => {
  it('after a saved breakfast, "2 eggs, 1 banana" still knows one egg and one banana', () => {
    const s = seedSaved()
    const meals = [{ id: 'fd-a', at: '2026-11-09T08:00:00Z', day: '2026-11-09', name: 'B', type: 'breakfast', items: itemsOf(s, s.meals[0].items) }] as any
    const r = parseFoodWords('200g chicken, 2 eggs, 1 banana', ownPer100(meals, '2026-11-09'))
    expect(r.needGrams).toEqual([])
    expect(r.items.map((i) => [i.name, i.grams])).toEqual([['chicken breast', 200], ['egg', 100], ['banana', 120]])
  })
  it('setQty scales a logged item from its own portions', () => {
    const egg = itemsOf(seedSaved(), [{ foodId: 'sf-egg', qty: 3 }])[0]
    expect(setQty(egg, 2)).toMatchObject({ qty: 2, grams: 100, kcal: 144, protein: 12.6 })
  })
})
