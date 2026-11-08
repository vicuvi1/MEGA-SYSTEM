// Food counter on the database: made-up meals and weights, pinned dates.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb, type DB } from './db'
import { bodyPlusView, logProtein, readPrefs, savePrefs, sportInsightNow } from './bodyPlus'
import { addFoodMeal, addFoodSupp, addFoodWater, adjustNow, answerAdjust, editFoodMeal, foodDayTotals, foodView, foodWeekNow, leanDefaultOnce, readFoodGoals, readFoodLog, saveFoodPrices, sportFoodLineNow, waterNow, toggleFoodFav, toggleFoodMeal, whatNextNow } from './food'
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
  it('a meal sent twice with the same id (a quick-add retry) is saved once', () => {
    const a = addFoodMeal(db, { items: [chicken], id: 'fd-quick1' }, 'web', now)!
    const b = addFoodMeal(db, { items: [chicken], id: 'fd-quick1' }, 'web', later(1))!
    expect(a.id).toBe('fd-quick1')
    expect(b.id).toBe('fd-quick1')
    expect(foodDayTotals(db, later(2)).protein).toBe(46)
    expect(readFoodLog(db).meals.filter((m) => m.id === 'fd-quick1')).toHaveLength(1)
    // A bad id is ignored (a fresh one is made).
    expect(addFoodMeal(db, { items: [rice], id: 'nope; DROP' }, 'web', later(3))!.id).toMatch(/^fd-/)
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

describe('food counter extras on the database', () => {
  it('water goes into the one water log (no second counter); a past day has no water buttons', () => {
    expect(waterNow(db, now).ml).toBe(0)
    addFoodWater(db, 250, 'web', now)
    const w = addFoodWater(db, 500, 'web', later(1))
    expect(w.ml).toBe(750)
    expect(waterNow(db, later(2)).ml).toBe(750)
    expect(db.prepare("SELECT COUNT(*) AS n, SUM(amount) AS ml FROM body_log WHERE kind = 'water'").get()).toEqual({ n: 2, ml: 750 })
    expect(addFoodWater(db, 99999, 'web', later(3)).ml).toBe(750) // out of range: nothing
    expect(foodView(db, later(3)).water?.ml).toBe(750)
    expect(foodView(db, later(3), '2026-11-07').water).toBeNull()
  })
  it('a shake is a supplement entry with protein; creatine ticks its streak; vitamins have no macros; no points', () => {
    const before = db.prepare('SELECT COUNT(*) AS n FROM ledger').get()
    addFoodSupp(db, 'shake', 'web', now)
    addFoodSupp(db, 'creatine', 'web', later(1))
    addFoodSupp(db, 'vitamins', 'web', later(2))
    expect(addFoodSupp(db, 'nope', 'web', later(3))).toBeNull()
    const v = foodView(db, later(4))
    expect(v.meals.filter((m) => m.supp).length).toBe(3)
    expect(foodDayTotals(db, later(4)).protein).toBe(24)
    expect(db.prepare("SELECT COUNT(*) AS n FROM body_log WHERE kind = 'supp:creatine'").get()).toEqual({ n: 1 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM ledger').get()).toEqual(before)
    // Supplements are not "your foods".
    expect(v.own.some((o) => /shake|creatine|vitamin/.test(o.name))).toBe(false)
  })
  it('editing a meal replaces it on the same day and time; totals follow; the old one is gone', () => {
    const m = addFoodMeal(db, { items: [chicken, rice] }, 'web', now)!
    const e = editFoodMeal(db, m.id, { items: [{ ...chicken, grams: 300, protein: 92, kcal: 460 }], type: 'dinner' }, 'web', later(5))!
    expect(e.totals.protein).toBe(92)
    const t = foodDayTotals(db, later(6))
    expect([t.protein, t.kcal]).toEqual([92, 460])
    const meals = foodView(db, later(6)).meals
    expect(meals.length).toBe(1)
    expect(meals[0]).toMatchObject({ type: 'dinner', at: now.toISOString() })
    expect(editFoodMeal(db, m.id, { items: [chicken] }, 'web', later(7))).toBeNull() // already replaced
  })
  it('carbs and fat targets are in the view and add up to the kcal goal', () => {
    const t = foodView(db, now).totals.targets
    expect(t.fat).toBe(60)
    expect(Math.abs(4 * t.protein + 4 * t.carbs + 9 * t.fat - t.kcal)).toBeLessThanOrEqual(2)
  })
  it('the header, "Next" and the macros are all on saved meals', () => {
    const m = addFoodMeal(db, { items: [chicken] }, 'web', now)!
    const v = foodView(db, later(1))
    expect(v.totals.protein).toBe(46)
    expect(v.carbs).toBe(0)
    expect(v.fat).toBe(5)
    expect(v.next.proteinLeft).toBe(v.totals.targets.protein - 46)
    toggleFoodMeal(db, m.id, 'web', later(2))
    const w = foodView(db, later(3))
    expect([w.totals.protein, w.carbs, w.fat]).toEqual([0, 0, 0])
    expect(w.next.proteinLeft).toBe(w.totals.targets.protein)
  })
  it('the weekly weight check: flat weight offers +100, Apply changes the goal once, never silently', () => {
    const ins = db.prepare("INSERT OR REPLACE INTO body_metrics (day, weight, waist, note, updated_at) VALUES (?, ?, NULL, NULL, 'x')")
    for (const [d, w] of [['2026-10-27', 75], ['2026-10-29', 75.1], ['2026-11-01', 75], ['2026-11-03', 75.1], ['2026-11-05', 75], ['2026-11-07', 75.1]] as const) ins.run(d, w)
    const base = foodView(db, now).totals.targets.kcal
    expect(adjustNow(db, now).state).toBe('suggest')
    expect(foodView(db, now).totals.targets.kcal).toBe(base) // nothing changes by itself
    answerAdjust(db, true, now)
    expect(readFoodGoals(db)).toMatchObject({ kcalAdj: 100, adjAt: '2026-11-08' })
    expect(foodView(db, now).totals.targets.kcal).toBe(base + 100)
    expect(adjustNow(db, now).state).toBe('none') // once a week
    answerAdjust(db, true, now) // nothing to apply: no double change
    expect(readFoodGoals(db).kcalAdj).toBe(100)
  })
  it('"Not now" only marks the week; prices are saved, cleaned and change the cheap list', () => {
    const ins = db.prepare("INSERT OR REPLACE INTO body_metrics (day, weight, waist, note, updated_at) VALUES (?, ?, NULL, NULL, 'x')")
    for (const [d, w] of [['2026-10-27', 75], ['2026-10-29', 75.1], ['2026-11-01', 75], ['2026-11-03', 75.1], ['2026-11-05', 75], ['2026-11-07', 75.1]] as const) ins.run(d, w)
    answerAdjust(db, false, now)
    expect(readFoodGoals(db)).toMatchObject({ kcalAdj: 0, adjAt: '2026-11-08' })
    const first = foodView(db, now).cheap.find((r) => r.name === 'chicken breast')!
    saveFoodPrices(db, { 'Chicken  Breast': 50, '': 5, bad: -3 })
    const after = foodView(db, now).cheap.find((r) => r.name === 'chicken breast')!
    expect(after).toMatchObject({ edited: true, mdlKg: 50 })
    expect(after.gPerLei).toBeGreaterThan(first.gPerLei)
    expect(Object.keys(readFoodGoals(db).prices)).toEqual(['chicken breast'])
    saveFoodPrices(db, { 'chicken breast': null })
    expect(readFoodGoals(db).prices).toEqual({})
  })
  it('the view has a 7-day chart with the weight line and a shopping list and prep that use the goals', () => {
    addFoodMeal(db, { items: [chicken, rice] }, 'web', now)
    const v = foodView(db, later(1))
    expect(v.chart.days.length).toBe(7)
    expect(v.chart.days[6].protein).toBe(51)
    expect(v.chart.days.find((d) => d.day === '2026-11-07')?.weight).toBe(75)
    expect(v.shopping.text).toMatch(/Protein goal 135 g a day/)
    expect(v.prep.boxes).toBe(6)
  })
})
