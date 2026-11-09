// One-tap logging on the database: made-up foods, pinned dates, no points.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb, type DB } from './db'
import { addFoodMeal, editFoodMeal, foodDayTotals, foodView, readFoodLog, readFoodSaved, saveFoodSaved, toggleFoodMeal } from './food'
import { logSavedFood, logSavedMeal, logStandardDay, saveLoggedAsMeal } from './foodSaved'
import { mealSource } from '../core/food'
import { writeSetting } from './settings'

let dir: string
let db: DB
const now = new Date('2026-11-08T08:30:00')
const later = (min: number) => new Date(now.getTime() + min * 60_000)

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'life-food-saved-'))
  db = openDb(join(dir, 'life.db'))
  db.prepare("INSERT INTO body_metrics (day, weight, waist, note, updated_at) VALUES ('2026-11-07', 73.5, NULL, NULL, 'x')").run()
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('one-tap food logging', () => {
  it('a saved meal is logged once as a normal meal (source saved); Undo takes it back', () => {
    const r = logSavedMeal(db, 'sm-breakfast', null, 'web', now)!
    expect(r.ids).toHaveLength(1)
    expect(r.totals).toMatchObject({ kcal: 486, protein: 26 })
    const m = readFoodLog(db).meals[0]
    expect(m).toMatchObject({ id: r.ids[0], name: 'Breakfast: 3 eggs + 2 bread + banana', type: 'breakfast', source: 'saved' })
    expect(m.items.find((i) => i.name === 'Egg')).toMatchObject({ qty: 3, grams: 150, unit: '1 large' })
    expect(foodDayTotals(db, later(1))).toMatchObject({ kcal: 486, protein: 26 })
    toggleFoodMeal(db, r.ids[0], 'web', later(2))
    expect(foodDayTotals(db, later(3))).toMatchObject({ kcal: 0, protein: 0 })
  })
  it('eggs ×2 instead of ×3 before logging; the name says what changed', () => {
    const r = logSavedMeal(db, 'sm-breakfast', { 'sf-egg': 2 }, 'web', now)!
    expect(r.totals.kcal).toBe(486 - 72)
    expect(readFoodLog(db).meals[0].name).toBe('2 × Egg + 2 × Rye bread + Banana + Coffee, black')
    expect(logSavedMeal(db, 'sm-nope', null, 'web', now)).toBeNull()
  })
  it('a saved food chip: +1 egg, +2 bread', () => {
    expect(logSavedFood(db, 'sf-egg', 1, 'web', now)!.totals).toMatchObject({ kcal: 72, protein: 6 })
    expect(logSavedFood(db, 'sf-bread', 2, 'web', later(1))!.totals.kcal).toBe(160)
    expect(readFoodLog(db).meals.map((m) => m.name)).toEqual(['2 × Rye bread', 'Egg'])
    expect(logSavedFood(db, 'sf-nope', 1, 'web', now)).toBeNull()
  })
  it('"Log my standard day": every slot as its own meal, about 2,330 kcal / 118 g; alternatives and skips', () => {
    const r = logStandardDay(db, {}, 'web', now)
    expect(r.ids).toHaveLength(5)
    expect(r.totals).toMatchObject({ kcal: 2332 })
    const t = foodDayTotals(db, later(1))
    expect(t.kcal).toBe(2332)
    expect(t.protein).toBeGreaterThanOrEqual(117)
    const meals = foodView(db, later(1)).meals
    expect(meals.map((m) => m.slot)).toEqual(['ds-morning', 'ds-lunch', 'ds-afternoon', 'ds-evening', 'ds-anytime'])
    expect(meals.map((m) => m.type)).toEqual(['breakfast', 'lunch', 'snack', 'dinner', 'snack'])
    expect(meals.every((m) => m.source === 'saved')).toBe(true)
    // Undo the whole day.
    for (const id of r.ids) toggleFoodMeal(db, id, 'web', later(2))
    expect(foodDayTotals(db, later(3)).kcal).toBe(0)
    const alt = logStandardDay(db, { 'ds-evening': 'alt', 'ds-anytime': 'skip' }, 'web', later(4))
    expect(alt.ids).toHaveLength(4)
    expect(readFoodLog(db).meals.find((m) => m.slot === 'ds-evening')!.items.map((i) => i.name)).toContain('Buckwheat, cooked')
  })
  it('the checklist: changing one item of a slot keeps its slot and source; swapping to the alternative', () => {
    logStandardDay(db, {}, 'web', now)
    const evening = readFoodLog(db).meals.find((m) => m.slot === 'ds-evening')!
    const e = editFoodMeal(db, evening.id, { items: evening.items.filter((i) => i.name !== 'Banana') }, 'web', later(1))!
    const fixed = readFoodLog(db).meals.find((m) => m.id === e.id)!
    expect(fixed).toMatchObject({ slot: 'ds-evening', source: 'saved', at: evening.at })
    expect(foodDayTotals(db, later(2)).kcal).toBe(2332 - 105)
  })
  it('old meals (no source) read as manual; typed meals stay manual; quick add says quick-add', () => {
    writeSetting(db, 'food_log', { meals: [{ id: 'fd-old1', at: '2026-11-08T07:00:00.000Z', day: '2026-11-08', name: 'Old', type: 'breakfast', items: [{ name: 'oats', grams: 80, protein: 10, carbs: 50, fat: 5, kcal: 300 }] }], favs: [] } as any)
    addFoodMeal(db, { items: [{ name: 'rice', grams: 200, protein: 5, carbs: 56, fat: 1, kcal: 260 }] }, 'web', now)
    addFoodMeal(db, { items: [{ name: 'egg', grams: 50, protein: 6, carbs: 0, fat: 5, kcal: 72 }], source: 'quick-add' }, 'web', later(1))
    const log = readFoodLog(db)
    expect(log.meals.map((m) => [m.name, mealSource(m)])).toEqual([
      ['Egg', 'quick-add'],
      ['Rice', 'manual'],
      ['Old', 'manual']
    ])
    expect('source' in log.meals.find((m) => m.id === 'fd-old1')!).toBe(false) // never rewritten
  })
  it('"Save as meal" turns a logged meal into a saved meal; the set is cleaned and capped', () => {
    const m = addFoodMeal(db, { items: [{ name: 'chicken soup', grams: 350, protein: 20, carbs: 15, fat: 8, kcal: 210 }], name: 'Soup', type: 'lunch' }, 'web', now)!
    const s = saveLoggedAsMeal(db, m.id)!
    expect(s.meals.at(-1)).toMatchObject({ name: 'Soup', slot: 'lunch' })
    expect(readFoodSaved(db).foods.some((f) => f.name === 'chicken soup')).toBe(true)
    expect(saveLoggedAsMeal(db, 'fd-nope')).toBeNull()
    saveFoodSaved(db, { foods: [{ id: 'sf-a', name: 'A', kcal: 10 }], meals: [], day: { slots: [] } })
    expect(readFoodSaved(db)).toMatchObject({ v: 1, foods: [{ id: 'sf-a' }], meals: [], day: { slots: [] } })
  })
  it('pays no points', () => {
    const before = db.prepare('SELECT COUNT(*) AS n FROM ledger').get()
    logStandardDay(db, {}, 'web', now)
    logSavedFood(db, 'sf-egg', 1, 'web', later(1))
    expect(db.prepare('SELECT COUNT(*) AS n FROM ledger').get()).toEqual(before)
  })
  it('the view has the big bars, the standard day total and the protein-behind flag', () => {
    const v = foodView(db, now)
    expect(v.standard).toMatchObject({ kcal: 2332, protein: 118 })
    expect(v.progress.kcalLine).toBe('0 / 2,700 kcal')
    expect(v.progress.proteinLine).toBe('0 / 130 g protein')
    expect(v.behind.behind).toBe(false) // 08:30: too early to tell
    const late = foodView(db, new Date('2026-11-08T17:00:00'))
    expect(late.behind).toMatchObject({ behind: true, hint: 'Behind on protein: 250 g brânză de vaci 5% = +40 g' })
    logSavedMeal(db, 'sm-breakfast', null, 'web', now)
    expect(foodView(db, later(1)).progress.leftLine).toBe('2,214 kcal · 104 g left')
  })
})
