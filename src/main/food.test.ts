// Food counter on the database: made-up meals and weights, pinned dates.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb, type DB } from './db'
import { bodyPlusView, logProtein, readPrefs, savePrefs, sportInsightNow } from './bodyPlus'
import { addFoodMeal, foodDayTotals, foodView, foodWeekNow, leanDefaultOnce, readFoodLog, sportFoodLineNow, toggleFoodFav, toggleFoodMeal, whatNextNow } from './food'
import { writeSetting } from './settings'

let dir: string
let db: DB
const now = new Date('2026-11-08T13:00:00')
const later = (min: number) => new Date(now.getTime() + min * 60_000)
const chicken = { name: 'chicken breast', grams: 150, protein: 46, carbs: 0, fat: 5, kcal: 230, confidence: 'roughly' }
const rice = { name: 'rice', grams: 200, protein: 5, carbs: 56, fat: 1, kcal: 260, confidence: 'sure' }

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'life-food-test-'))
  db = openDb(join(dir, 'life.db'))
  db.prepare("INSERT INTO body_metrics (day, weight, waist, note, updated_at) VALUES ('2026-11-07', 75, NULL, NULL, 'x')").run()
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('food counter on the database', () => {
  it('a meal adds to the one protein number (with quick logs), kcal from meals; removing takes both rows back', () => {
    logProtein(db, { food: 'egg', g: 12 }, 'web', { now })
    const m = addFoodMeal(db, { items: [chicken, rice] }, 'web', later(1))!
    expect(m.totals).toMatchObject({ protein: 51, kcal: 490 })
    expect(bodyPlusView(db, later(2)).today).toBe(63) // the protein ring shows the same number
    let t = foodDayTotals(db, later(2))
    expect([t.protein, t.kcal]).toEqual([63, 490])
    expect(toggleFoodMeal(db, m.id, 'web', later(3))).toBe(true)
    t = foodDayTotals(db, later(4))
    expect([t.protein, t.kcal]).toEqual([12, 0])
    expect(foodView(db, later(4)).meals[0].removed).toBe(true)
    toggleFoodMeal(db, m.id, 'web', later(5))
    expect(foodDayTotals(db, later(6)).protein).toBe(63)
  })
  it('pays no points', () => {
    const before = db.prepare('SELECT COUNT(*) AS n FROM ledger').get()
    addFoodMeal(db, { items: [chicken] }, 'web', now)
    expect(db.prepare('SELECT COUNT(*) AS n FROM ledger').get()).toEqual(before)
  })
  it('a past day is marked "added later"; a day too far back or in the future goes on today', () => {
    const a = addFoodMeal(db, { items: [chicken], day: '2026-11-06' }, 'web', now)!
    expect(a.day).toBe('2026-11-06')
    expect(readFoodLog(db, '2026-11-08').meals[0]).toMatchObject({ day: '2026-11-06', late: true })
    expect(addFoodMeal(db, { items: [chicken], day: '2026-10-01' }, 'web', now)!.day).toBe('2026-11-08')
    expect(addFoodMeal(db, { items: [chicken], day: '2026-11-09' }, 'web', now)!.day).toBe('2026-11-08')
    expect(addFoodMeal(db, { items: [] }, 'web', now)).toBeNull()
  })
  it('lean goals: 2.0 g/kg once from the old 1.8 default; kcal +150 only once you train', () => {
    savePrefs(db, { gPerKg: 1.8 })
    expect(leanDefaultOnce(db)).toBe(true)
    expect(readPrefs(db).gPerKg).toBe(2)
    savePrefs(db, { gPerKg: 1.8 }) // your later pick stays
    expect(leanDefaultOnce(db)).toBe(false)
    expect(readPrefs(db).gPerKg).toBe(1.8)
    savePrefs(db, { gPerKg: 2 })
    let t = foodDayTotals(db, now).targets
    expect(t).toMatchObject({ protein: 150, kcal: 2650, training: false })
    db.prepare("INSERT INTO workouts (day, ts, title, items_json) VALUES ('2026-11-08', 'x', 'Push-ups', '[]')").run()
    t = foodDayTotals(db, now).targets
    expect(t).toMatchObject({ kcal: 2800, training: true })
  })
  it('what to eat next, same as yesterday, a star, the Sport Track line, the week', () => {
    savePrefs(db, { gPerKg: 2 })
    addFoodMeal(db, { items: [chicken, rice] }, 'web', new Date('2026-11-07T13:00:00'))
    addFoodMeal(db, { items: [chicken] }, 'web', now)
    expect(whatNextNow(db, now).line).toMatch(/^104 g protein left today. Next meal, about 50 g: /)
    const v = foodView(db, now)
    expect(v.yesterday.map((m) => m.name)).toEqual(['Chicken breast, Rice'])
    toggleFoodFav(db, { name: 'Lunch', items: v.yesterday[0].items })
    expect(foodView(db, now).favs.map((f) => f.name)).toEqual(['Lunch'])
    expect(sportFoodLineNow(db, now)).toBe('Protein 46 / 150 g today')
    writeSetting(db, 'sport_tracker_json', { data: { sets: { '2026-11-08': { pushups: [{ reps: 15, at: new Date('2026-11-08T12:00:00').toISOString(), id: 's1' }] } } } } as any)
    expect(sportFoodLineNow(db, now)).toBe('Protein 46 / 150 g today · trained: +46 g')
    expect(foodWeekNow(db, now)).toMatchObject({ days: 2, avgProtein: 49 })
  })
  it('"why it stalled" reads the food counter protein', () => {
    // No stalled move: nothing to explain, but the week's protein comes from the same log.
    addFoodMeal(db, { items: [chicken] }, 'web', now)
    expect(bodyPlusView(db, now).week.avg).toBe(46)
    expect(sportInsightNow(db, now)).toBeNull()
  })
})
