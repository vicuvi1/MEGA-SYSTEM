import { describe, expect, it } from 'vitest'
import { fiberOf, isUpf, mealScore, scoreLine } from './foodScore'
import type { FoodItem } from './food'

const it0 = (name: string, grams: number, protein: number, kcal: number, extra: Partial<FoodItem> = {}): FoodItem => ({ name, grams, protein, carbs: 0, fat: 0, kcal, confidence: 'roughly', ...extra })

describe('meal score', () => {
  it('gives A to a high-protein, high-fibre, whole meal', () => {
    const s = mealScore([it0('Grilled chicken breast', 200, 62, 330), it0('Buckwheat', 200, 7, 190), it0('Broccoli', 200, 6, 70)])!
    expect(s.grade).toBe('A')
    expect(s.parts).toEqual({ protein: 2, fiber: 2, whole: 2 })
    expect(s.tip).toMatch(/Great balance/)
  })
  it('gives D to sausage, white bread and soda, with a protein tip first', () => {
    const s = mealScore([it0('Sausages', 100, 10, 300), it0('White rice', 150, 4, 195), it0('Cola', 330, 0, 140)])!
    expect(s.grade).toBe('D')
    expect(s.parts.protein).toBe(0)
    expect(s.tip).toMatch(/Add 20–30 g protein/)
  })
  it('the processing tip names the most processed food', () => {
    const s = mealScore([it0('Eggs', 150, 19, 215), it0('Rye bread', 100, 9, 250), it0('Chips', 60, 4, 320)])!
    expect(s.parts.whole).toBe(1)
    expect(s.tip).toMatch(/fibre|chips/i)
  })
  it('uses the read’s fibre and processing when given', () => {
    expect(fiberOf({ name: 'Mystery bowl', grams: 300, fiber: 11 })).toBe(11)
    expect(isUpf({ name: 'Chicken', upf: true })).toBe(true)
    expect(isUpf({ name: 'Pizza' })).toBe(true)
    expect(fiberOf({ name: 'Bulgur salad', grams: 200 })).toBe(9)
  })
  it('judges a snack as a snack', () => {
    const s = mealScore([it0('Skyr', 200, 22, 130)])!
    expect(s.parts.protein).toBe(2)
    expect(scoreLine(s)).toMatch(/^[A-D] · 22 g protein/)
  })
  it('scores nothing for an empty meal', () => {
    expect(mealScore([])).toBeNull()
  })
})
