// Saved foods, saved meals and the standard day: generic made-up foods, no owner data.
import { describe, expect, it } from 'vitest'
import {
  FOODS_MAX, SEED_DAY, SEED_FOODS, cleanQty, cleanSaved, dayTotals, itemOf, itemsOf, itemsText, matchSaved, moveIn, newId, removeFood, savedMealFrom, seedSaved, slotItems, stepQty, totalsOf, withQty
} from './foodSaved'
import { cleanFoodLog, mealSource } from './food'

const s = seedSaved()
const egg = s.foods.find((f) => f.id === 'sf-egg')!

describe('the seed', () => {
  it('has the 9 generic foods, the 5-slot day and saved meals made from it', () => {
    expect(SEED_FOODS.map((f) => f.name)).toEqual(['Egg', 'Rye bread', 'Bulgur salad with vegetables', 'Buckwheat, cooked', 'Banana', 'Brânză de vaci 5%', 'Kefir or milk 2.5%', 'Coffee, black', 'Brânzică glazurată'])
    expect(egg).toMatchObject({ portionLabel: '1 large', grams: 50, kcal: 72, protein: 6.3 })
    expect(s.day.slots.map((x) => x.label)).toEqual(['Morning', 'Lunch', 'Afternoon', 'Evening', 'Anytime'])
    expect(s.meals[0].name).toBe('Breakfast: 3 eggs + 2 bread + banana')
    expect(cleanSaved(null)).toEqual(s) // nothing saved: the seed
    expect(cleanSaved(JSON.parse(JSON.stringify(s)))).toEqual(s) // clean is stable
    // A fresh copy each time (editing one never changes the seed).
    seedSaved().foods[0].kcal = 1
    expect(SEED_FOODS[0].kcal).toBe(72)
  })
  it('the standard day as listed adds up to about 2,330 kcal and 118 g protein', () => {
    // Morning 486 + Lunch 480 + Afternoon 481 + Evening 585 + Anytime 300.
    expect(dayTotals(s)).toMatchObject({ kcal: 2332, protein: 118 })
    // With the alternatives: buckwheat + 2 eggs in the evening, kefir instead of brânză.
    expect(dayTotals(s, { 'ds-evening': 'alt', 'ds-anytime': 'alt' })).toMatchObject({ kcal: 2326, protein: 105 })
    expect(dayTotals(s, { 'ds-anytime': 'skip' })).toMatchObject({ kcal: 2032 })
    expect(slotItems(SEED_DAY[0], 'alt')).toBe(SEED_DAY[0].items) // no alternative: the usual items
  })
})

describe('quantities', () => {
  it('scale grams, macros and kcal; halves under 1, whole portions above', () => {
    expect(itemOf(egg, 3)).toMatchObject({ name: 'Egg', grams: 150, kcal: 216, protein: 18.9, qty: 3, unit: '1 large', confidence: 'sure' })
    expect(itemOf(egg, 0.5)).toMatchObject({ grams: 25, kcal: 36 })
    expect(cleanQty(0)).toBe(0.5)
    expect(cleanQty(99)).toBe(20)
    expect(cleanQty(1.3)).toBe(1.5)
    expect([stepQty(3, -1), stepQty(1, -1), stepQty(0.5, -1), stepQty(0.5, 1), stepQty(1.5, 1), stepQty(20, 1)]).toEqual([2, 0.5, 0.5, 1, 2, 20])
  })
  it('a meal with eggs ×2 instead of ×3', () => {
    const m = s.meals[0]
    const two = withQty(m.items, { 'sf-egg': 2 })
    expect(two.find((x) => x.foodId === 'sf-egg')!.qty).toBe(2)
    expect(totalsOf(s, m.items).kcal - totalsOf(s, two).kcal).toBe(72)
    expect(withQty(m.items, null)).toBe(m.items)
    expect(itemsText(s, two)).toBe('2 × Egg + 2 × Rye bread + Banana + Coffee, black')
  })
  it('a saved food with no grams logs 100 g a portion and null macros count as 0', () => {
    const f = { id: 'sf-x', name: 'Soup', portionLabel: '1 bowl', grams: null, kcal: 200, protein: 8, carbs: null, fat: null }
    expect(itemOf(f, 2)).toMatchObject({ grams: 200, carbs: 0, fat: 0, kcal: 400, protein: 16 })
  })
})

describe('cleaning and caps', () => {
  it('drops bad ids, unknown foods, empty meals; caps foods; keeps nulls', () => {
    const raw = {
      v: 1,
      foods: [egg, { id: 'bad id', name: 'x', kcal: 1 }, { id: 'sf-y', name: '', kcal: 5 }, { id: 'sf-z', name: 'Z', kcal: 'lots' }, { id: 'sf-oil', name: 'Oil', kcal: 120, protein: 0, carbs: null, fat: 14 }],
      meals: [
        { id: 'sm-a', name: 'A', slot: 'nope', items: [{ foodId: 'sf-egg', qty: 2 }, { foodId: 'sf-gone', qty: 1 }] },
        { id: 'sm-b', name: 'B', slot: 'lunch', items: [{ foodId: 'sf-gone', qty: 1 }] }
      ],
      day: { slots: [{ id: 'ds-a', slot: 'breakfast', label: 'Morning', items: [{ foodId: 'sf-egg', qty: 3 }], alternative: [] }] }
    }
    const c = cleanSaved(raw)
    expect(c.foods.map((f) => f.id)).toEqual(['sf-egg', 'sf-oil'])
    expect(c.foods[1]).toMatchObject({ carbs: null, fat: 14, portionLabel: '1 portion', grams: null })
    expect(c.meals).toEqual([{ id: 'sm-a', name: 'A', slot: 'snack', items: [{ foodId: 'sf-egg', qty: 2 }] }])
    expect(c.day.slots[0].alternative).toBeNull()
    const many = { foods: Array.from({ length: 80 }, (_, i) => ({ id: `sf-f${i}`, name: `F${i}`, kcal: 10 })) }
    expect(cleanSaved(many).foods.length).toBe(FOODS_MAX)
    expect(JSON.stringify(cleanSaved(many)).length).toBeLessThan(16000)
  })
  it('removing a food takes it out of meals and slots (an alternative left empty goes too)', () => {
    const c = removeFood(s, 'sf-kefir')
    expect(c.foods.some((f) => f.id === 'sf-kefir')).toBe(false)
    expect(c.meals.some((m) => m.id === 'sm-kefir')).toBe(false)
    expect(c.day.slots.find((x) => x.id === 'ds-anytime')!.alternative).toBeNull()
    const d = removeFood(s, 'sf-branza')
    expect(d.day.slots.map((x) => x.id)).toEqual(['ds-morning', 'ds-lunch', 'ds-afternoon', 'ds-evening'])
  })
  it('new ids never clash; moving reorders', () => {
    expect(newId('sf', 'Brânză', ['sf-branza'])).toBe('sf-branza-2')
    expect(newId('sm', 'My lunch!', [])).toBe('sm-my-lunch')
    expect(moveIn([1, 2, 3], 2, -1)).toEqual([1, 3, 2])
    expect(moveIn([1, 2, 3], 0, -1)).toEqual([1, 2, 3])
  })
  it('"Save as meal": known foods are matched by name with a qty, others become new saved foods', () => {
    const items = [itemOf(egg, 2), { name: 'Chicken soup', grams: 350, protein: 20, carbs: 15, fat: 8, kcal: 210, confidence: 'roughly' as const }]
    const c = savedMealFrom(s, { name: 'Soup and eggs', type: 'lunch', items })
    const m = c.meals.find((x) => x.name === 'Soup and eggs')!
    expect(m.slot).toBe('lunch')
    expect(m.items[0]).toEqual({ foodId: 'sf-egg', qty: 2 })
    const soup = c.foods.find((f) => f.id === m.items[1].foodId)!
    expect(soup).toMatchObject({ name: 'Chicken soup', portionLabel: '350 g', grams: 350, kcal: 210 })
    expect(totalsOf(c, m.items).kcal).toBe(144 + 210)
  })
})

describe('quick add words', () => {
  it('"standard day", a meal by name or slot word, "2 eggs", plurals and accents', () => {
    expect(matchSaved('standard day', s)).toEqual({ kind: 'day' })
    expect(matchSaved('my usual day', s)).toEqual({ kind: 'day' })
    expect(matchSaved('breakfast', s)).toMatchObject({ kind: 'meal', meal: { id: 'sm-breakfast' } })
    expect(matchSaved('Lunch', s)).toMatchObject({ kind: 'meal', meal: { id: 'sm-lunch' } })
    expect(matchSaved('2 eggs', s)).toMatchObject({ kind: 'food', food: { id: 'sf-egg' }, qty: 2 })
    expect(matchSaved('ate two eggs', s)).toMatchObject({ kind: 'food', qty: 2 })
    expect(matchSaved('banana', s)).toMatchObject({ kind: 'food', food: { id: 'sf-banana' }, qty: 1 })
    expect(matchSaved('1 bread', s)).toMatchObject({ kind: 'food', food: { id: 'sf-bread' } })
    expect(matchSaved('branza de vaci', s)).toMatchObject({ kind: 'food', food: { id: 'sf-branza' } })
  })
  it('no match for other lines, and money-like numbers stay money', () => {
    expect(matchSaved('50 pushups', s)).toBeNull()
    expect(matchSaved('45 coffee', s)).toBeNull()
    expect(matchSaved('call mom', s)).toBeNull()
    expect(matchSaved('', s)).toBeNull()
  })
})

describe('meal sources', () => {
  it('old entries read as manual and are kept as they are; a valid source and slot are kept', () => {
    const log = cleanFoodLog(
      {
        meals: [
          { id: 'fd-old', at: '2026-11-08T08:00:00Z', day: '2026-11-08', name: 'Old', type: 'breakfast', items: [itemOf(egg, 1)] },
          { id: 'fd-new', at: '2026-11-08T09:00:00Z', day: '2026-11-08', name: 'New', type: 'breakfast', items: itemsOf(s, s.meals[0].items), source: 'saved', slot: 'ds-morning' },
          { id: 'fd-odd', at: '2026-11-08T10:00:00Z', day: '2026-11-08', name: 'Odd', type: 'snack', items: [itemOf(egg, 1)], source: 'robot', slot: 'nope' }
        ]
      },
      '2026-11-08'
    )
    const by = Object.fromEntries(log.meals.map((m) => [m.id, m]))
    expect(mealSource(by['fd-old'])).toBe('manual')
    expect('source' in by['fd-old']).toBe(false)
    expect(by['fd-new']).toMatchObject({ source: 'saved', slot: 'ds-morning' })
    expect(by['fd-new'].items[0]).toMatchObject({ qty: 3, unit: '1 large' })
    expect(mealSource(by['fd-odd'])).toBe('manual')
    expect('slot' in by['fd-odd']).toBe(false)
  })
})
