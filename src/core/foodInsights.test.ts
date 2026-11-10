import { describe, expect, it } from 'vitest'
import { accuracyCheck, daySummary, foodCharts, galleryDays, weightTrend } from './foodInsights'
import type { DayMeal, FoodItem, MealType } from './food'
import { addDays } from './dates'

// Made-up data only.
const item = (name: string, grams: number, protein: number, kcal: number): FoodItem => ({ name, grams, protein, carbs: 20, fat: 8, kcal, confidence: 'roughly' })
let n = 0
const meal = (day: string, hhmm: string, type: MealType, items: FoodItem[], extra: Partial<DayMeal> = {}): DayMeal => {
  const totals = items.reduce((a, i) => ({ protein: a.protein + i.protein, carbs: a.carbs + i.carbs, fat: a.fat + i.fat, kcal: a.kcal + i.kcal }), { protein: 0, carbs: 0, fat: 0, kcal: 0 })
  return { id: `fd-t${++n}`, at: new Date(`${day}T${hhmm}:00`).toISOString(), day, name: items.map((i) => i.name).join(' + '), type, items, totals, removed: false, ...extra }
}
const TODAY = '2030-03-20'

describe('accuracy check', () => {
  const weights = (perWeek: number) => Array.from({ length: 6 }, (_, k) => ({ day: addDays(TODAY, -18 + k * 3), weight: 70 + (perWeek / 7) * (k * 3) }))
  const days = (kcal: number, count = 12) => Array.from({ length: count }, (_, k) => ({ day: addDays(TODAY, -1 - k), kcal }))
  it('finds the trend in kg a week', () => {
    expect(weightTrend(weights(0.4))).toBeCloseTo(0.4, 1)
    expect(weightTrend(weights(0.4).slice(0, 3))).toBeNull()
  })
  it('says the logs seem low when the weight rises faster than they allow', () => {
    const r = accuracyCheck({ today: TODAY, days: days(2000), weights: weights(0.5), maintenance: 2500, rough: false })
    expect(r.state).toBe('low')
    if (r.state === 'low') {
      expect(r.implied).toBe(3050)
      expect(r.line).toMatch(/^Your logs seem low: about 2,000 kcal a day logged, but your weight \(\+0\.5 kg a week\) fits about 3,050\./)
    }
  })
  it('matches when they agree, and needs enough data', () => {
    expect(accuracyCheck({ today: TODAY, days: days(2800), weights: weights(0.3), maintenance: 2500, rough: false }).state).toBe('ok')
    expect(accuracyCheck({ today: TODAY, days: days(2800, 5), weights: weights(0.3), maintenance: 2500, rough: false })).toMatchObject({ state: 'none', why: expect.stringMatching(/8 of the last 14 days/) })
    expect(accuracyCheck({ today: TODAY, days: days(2800), weights: [], maintenance: 2500, rough: false }).state).toBe('none')
  })
})

describe('gallery and charts', () => {
  const meals = [
    meal(TODAY, '08:10', 'breakfast', [item('Eggs', 150, 19, 215), item('Rye bread', 60, 5, 150)], { photos: ['fpabn1'], source: 'photo' }),
    meal(TODAY, '13:00', 'lunch', [item('Chicken breast', 200, 62, 330), item('Rice', 200, 5, 260)]),
    meal(addDays(TODAY, -1), '19:30', 'dinner', [item('Chicken breast', 150, 46, 250)]),
    meal(addDays(TODAY, -1), '20:00', 'snack', [item('Creatine', 5, 0, 0)], { supp: true }),
    meal(addDays(TODAY, -2), '12:00', 'lunch', [item('Pizza', 300, 30, 800)], { removed: true })
  ]
  it('groups meals by day, newest first, with totals and scores', () => {
    const g = galleryDays(meals, TODAY)
    expect(g.map((d) => d.day)).toEqual([TODAY, addDays(TODAY, -1)])
    expect(g[0].label).toMatch(/^Today, Wed 20 Mar$/)
    expect(g[0].totals.kcal).toBe(955)
    expect(g[0].meals[0]).toMatchObject({ hm: '08:10', photos: ['fpabn1'], source: 'photo' })
    expect(g[0].meals[1].score?.grade).toMatch(/[A-D]/)
    expect(g[0].photoCount).toBe(1)
    expect(g[1].meals.length).toBe(1)
  })
  it('charts per meal type, by hour and the most eaten foods', () => {
    const c = foodCharts(meals, TODAY)
    expect(c.byType.find((t) => t.type === 'lunch')).toEqual({ type: 'lunch', meals: 1, kcal: 590, protein: 67 })
    expect(c.byHour.find((h) => h.hour === 8)).toEqual({ hour: 8, meals: 1, kcal: 365 })
    expect(c.top[0]).toMatchObject({ name: 'Chicken breast', times: 2, grams: 175, protein: 54 })
    expect(c.meals).toBe(3)
    expect(c.photoMeals).toBe(1)
  })
})

describe('the night summary', () => {
  it('totals, the best meal and one change', () => {
    const ms = [meal(TODAY, '08:10', 'breakfast', [item('White bread', 100, 8, 265)]), meal(TODAY, '13:00', 'lunch', [item('Chicken breast', 200, 62, 330), item('Broccoli', 300, 8, 100)])]
    const s = daySummary({ meals: ms, day: TODAY, protein: 70, kcal: 695, goals: { protein: 130, kcal: 2700 }, ideas: ['250 g brânză de vaci 5%'] })!
    expect(s.lines[0]).toBe('695 / 2,700 kcal · 70 / 130 g protein · 2 meals')
    expect(s.best?.type).toBe('lunch')
    expect(s.change).toMatch(/^Protein was 60 g short: add one protein snack in the afternoon \(250 g brânză de vaci 5%\)\.$/)
    expect(s.html).toMatch(/^🌙 <b>Food today<\/b>/)
  })
  it('nothing logged: no summary', () => {
    expect(daySummary({ meals: [], day: TODAY, protein: 0, kcal: 0, goals: { protein: 130, kcal: 2700 } })).toBeNull()
  })
})
