// Food photo logging: the AI's answer is never trusted as is. Made-up foods only.
import { describe, expect, it } from 'vitest'
import { fromSaved, gramsOfPortion, photoReplyLine, readVisionJson, savedFromFavs, savedRefs, scaleVisionItem, stepQty, toFoodItems, validateVision, visionTotals, type SavedFoodRef } from './foodVision'
import { seedSaved } from './foodSaved'

describe('the real saved foods (food_saved)', () => {
  it('lists saved foods and meals with their own ids and portions, then starred meals not already there', () => {
    const refs = savedRefs(seedSaved(), [
      { id: 'f1', name: 'Kefir or milk 2.5%', items: [] },
      { id: 'f2', name: 'Pasta night', items: [{ name: 'Pasta', grams: 300, protein: 15, carbs: 90, fat: 3, kcal: 450, confidence: 'roughly' }] }
    ])
    expect(refs.find((r) => r.id === 'sf-bulgur')).toMatchObject({ name: 'Bulgur salad with vegetables', portion: '1 container (300 g)', kcal: 400, protein: 10 })
    expect(refs.find((r) => r.id === 'sf-branza')!.portion).toBe('250 g')
    expect(refs.find((r) => r.id === 'sm-breakfast')!.portion).toMatch(/^1 meal \(\d+ g\)$/)
    expect(refs.filter((r) => r.name === 'Kefir or milk 2.5%')).toHaveLength(1)
    expect(refs.some((r) => r.id === 'fav:f2')).toBe(true)
  })
  it('a match to a saved food uses its macros × qty, not the AI numbers', () => {
    const refs = savedRefs(seedSaved())
    const r = validateVision({ items: [{ name: 'bulgur container', matchedSavedFoodId: 'sf-bulgur', qty: 2, unit: 'container', grams: 999, kcal: 9999, protein: 1, confidence: 'high' }] }, refs)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.result.items[0]).toMatchObject({ matchedSavedFoodId: 'sf-bulgur', qty: 2, grams: 600, kcal: 800, protein: 20 })
    expect(r.result.totals.kcal).toBe(800)
    expect(toFoodItems(r.result.items)[0]).toMatchObject({ kcal: 800, protein: 20, qty: 2 })
  })
})

const saved: SavedFoodRef[] = [
  { id: 'sv-bulgur', name: 'Bulgur container', portion: '1 container (350 g)', kcal: 520, protein: 38, carbs: 60, fat: 12 },
  { id: 'sv-cottage', name: 'Cottage cheese', portion: '200 g', kcal: 200, protein: 34 }
]
const good = {
  items: [
    { name: 'Eggs', matchedSavedFoodId: null, qty: 3, unit: 'egg', grams: 150, kcal: 215, protein: 19, carbs: 1, fat: 15, confidence: 'high' },
    { name: 'Bread', matchedSavedFoodId: null, qty: 2, unit: 'slice', grams: 60, kcal: 160, protein: 5, carbs: 30, fat: 2, confidence: 'medium' }
  ],
  totals: { kcal: 375, protein: 24 },
  message: 'Eggs on toast, a solid breakfast.'
}

describe('validateVision', () => {
  it('reads a good answer and adds the totals up again', () => {
    const r = validateVision(good)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.result.items).toHaveLength(2)
    expect(r.result.totals).toEqual({ kcal: 375, protein: 24, carbs: 31, fat: 17 })
    expect(r.result.message).toBe('Eggs on toast, a solid breakfast.')
  })

  it('reads JSON inside fences and chatter', () => {
    const r = validateVision('Sure! Here it is:\n```json\n' + JSON.stringify(good) + '\n```\nEnjoy.')
    expect(r.ok && r.result.items[0].name).toBe('Eggs')
    expect(readVisionJson('no json here')).toBeNull()
  })

  it('ignores the AI totals and recomputes them, even when missing or wrong', () => {
    const r = validateVision({ ...good, totals: { kcal: 9999, protein: -4 } })
    expect(r.ok && r.result.totals.kcal).toBe(375)
    const { totals, ...noTotals } = good
    void totals
    const r2 = validateVision(noTotals)
    expect(r2.ok && r2.result.totals.protein).toBe(24)
  })

  it('fixes wrong types and negative numbers', () => {
    const r = validateVision({ items: [{ name: 'Rice', qty: '1', unit: 7, grams: '200 g', kcal: -50, protein: '5,2', carbs: 56, fat: 'x', confidence: 'very' }], message: 42 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const it = r.result.items[0]
    expect(it.grams).toBe(200)
    expect(it.protein).toBe(5.2)
    expect(it.fat).toBe(0)
    // kcal below 0 → from the macros (4·5.2 + 4·56)
    expect(it.kcal).toBe(245)
    expect(it.confidence).toBe('medium')
    expect(it.unit).toBe('serving')
    expect(r.result.message).toBe('')
  })

  it('clamps silly numbers', () => {
    const r = validateVision({ items: [{ name: 'Pizza', grams: 99999, kcal: 1e9, protein: 5000, confidence: 'low' }] })
    expect(r.ok && r.result.items[0]).toMatchObject({ grams: 3000, kcal: 8000, protein: 400, confidence: 'low' })
  })

  it('uses the saved food’s own numbers × qty when matched', () => {
    const r = validateVision({ items: [{ name: 'grain box', matchedSavedFoodId: 'sv-bulgur', qty: 2, unit: 'container', grams: 300, kcal: 100, protein: 1, confidence: 'high' }] }, saved)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.result.items[0]).toMatchObject({ name: 'Bulgur container', matchedSavedFoodId: 'sv-bulgur', qty: 2, grams: 700, kcal: 1040, protein: 76, carbs: 120, fat: 24, unit: 'container' })
  })

  it('treats an unknown saved id as a plain guess', () => {
    const r = validateVision({ items: [{ name: 'Soup', matchedSavedFoodId: 'sv-nope', qty: 1, grams: 300, kcal: 180, protein: 9 }] }, saved)
    expect(r.ok && r.result.items[0].matchedSavedFoodId).toBeNull()
    expect(r.ok && r.result.items[0].kcal).toBe(180)
  })

  it('keeps the low-confidence flag', () => {
    const r = validateVision({ items: [{ name: 'Pasta', grams: 250, kcal: 400, protein: 14, confidence: 'low' }] })
    expect(r.ok && r.result.items[0].confidence).toBe('low')
  })

  it('refuses garbage with a plain message', () => {
    expect(validateVision('I cannot see a photo.')).toEqual({ ok: false, error: expect.stringMatching(/could not be read/) })
    expect(validateVision({ foods: [] })).toEqual({ ok: false, error: expect.stringMatching(/no list of foods/) })
    expect(validateVision({ items: [{ name: '' }, { kcal: 5 }, null, 'egg'] })).toEqual({ ok: false, error: expect.stringMatching(/No food was found/) })
    expect(validateVision([1, 2])).toMatchObject({ ok: false })
  })

  it('keeps at most 12 items', () => {
    const r = validateVision({ items: Array.from({ length: 20 }, (_, i) => ({ name: `Food ${i}`, grams: 10, kcal: 10 })) })
    expect(r.ok && r.result.items.length).toBe(12)
  })
})

describe('review screen numbers', () => {
  it('a qty change scales grams and macros from the AI’s base', () => {
    const r = validateVision(good)
    if (!r.ok) throw new Error('bad')
    const eggs = r.result.items[0]
    const four = scaleVisionItem(eggs, 4 / 3)
    expect(four).toMatchObject({ qty: 4, grams: 200, kcal: 287, protein: 25.3 })
  })

  it('a saved food scales as its own numbers × qty', () => {
    const it = fromSaved(saved[0], 1)
    expect(scaleVisionItem(it, 0.5, saved)).toMatchObject({ qty: 0.5, kcal: 260, protein: 19, grams: 175 })
  })

  it('the qty stepper goes in whole steps, halves under 1', () => {
    expect(stepQty(3, 1)).toBe(4)
    expect(stepQty(3, -1)).toBe(2)
    expect(stepQty(1, -1)).toBe(0.5)
    expect(stepQty(0.5, -1)).toBe(0.5)
    expect(stepQty(0.5, 1)).toBe(1)
    expect(stepQty(2.5, 1)).toBe(3)
    expect(stepQty(2.5, -1)).toBe(2)
  })

  it('becomes the food counter’s items (confidence words mapped)', () => {
    const r = validateVision(good)
    if (!r.ok) throw new Error('bad')
    const items = toFoodItems(r.result.items)
    expect(items[0]).toEqual({ name: 'Eggs', grams: 150, protein: 19, carbs: 1, fat: 15, kcal: 215, confidence: 'sure' })
    expect(items[1].confidence).toBe('roughly')
    expect(visionTotals(r.result.items).kcal).toBe(375)
  })

  it('starred meals become saved foods with their totals', () => {
    const s = savedFromFavs([{ id: 'f1', name: 'Lunch box', items: [{ name: 'chicken', grams: 150, protein: 46, carbs: 0, fat: 5, kcal: 230, confidence: 'sure' }, { name: 'rice', grams: 200, protein: 5, carbs: 56, fat: 1, kcal: 250, confidence: 'sure' }] }])
    expect(s[0]).toEqual({ id: 'fav:f1', name: 'Lunch box', portion: '1 portion (350 g)', kcal: 480, protein: 51, carbs: 56, fat: 6 })
    expect(gramsOfPortion(s[0].portion)).toBe(350)
    expect(gramsOfPortion('2 eggs')).toBe(0)
  })
})

describe('photoReplyLine', () => {
  it('builds every number from data', () => {
    const line = photoReplyLine({
      items: [
        { name: 'eggs', qty: 3, unit: 'egg' },
        { name: 'bread', qty: 2, unit: 'slice' }
      ],
      meal: { kcal: 375, protein: 24 },
      day: { kcal: 1400, protein: 60, kcalGoal: 2700, proteinGoal: 130 },
      idea: '200 g chicken breast'
    })
    expect(line).toBe('3 eggs + 2 bread: ~375 kcal, 24 g protein. Today: 1,400 / 2,700 kcal, 60 / 130 g. ~1,300 kcal left, 70 g protein; next: 200 g chicken breast.')
  })

  it('says when the goals are done or kcal is over', () => {
    const base = { items: [{ name: 'Steak', qty: 1, unit: 'serving' }], meal: { kcal: 600, protein: 50 } }
    expect(photoReplyLine({ ...base, day: { kcal: 2800, protein: 140, kcalGoal: 2700, proteinGoal: 130 } })).toMatch(/Both goals done for today\.$/)
    expect(photoReplyLine({ ...base, day: { kcal: 2800, protein: 100, kcalGoal: 2700, proteinGoal: 130 } })).toMatch(/Over the kcal goal by 100; 30 g protein left\.$/)
    expect(photoReplyLine({ ...base, day: { kcal: 2000, protein: 140, kcalGoal: 2700, proteinGoal: 130 } })).toMatch(/^Steak: ~600 kcal.*~700 kcal left\.$/)
  })
})
