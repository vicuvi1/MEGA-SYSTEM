import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FOOD_PASTE_PROMPT, isPasteBlock, parseFoodPaste, pasteId, pasteNumber, pasteToLog } from './foodPaste'

// Made-up meals only.
const TODAY = '2030-03-12'
const CLEAN = `LIFE-FOOD v1
MEAL | Breakfast | 2030-03-12 08:10 | Eggs and toast
- Eggs | 150 g | P 19 | C 1.1 | F 15 | FIB 0 | KCAL 215 | CONF high | 3 eggs
- Rye bread | 60 g | P 5 | C 28 | F 1.5 | FIB 3.5 | KCAL 150 | CONF medium | -
TOTAL | P 24 | C 29.1 | F 16.5 | KCAL 365
MEAL | Lunch | now | Rice and chicken
- Boiled rice | 200 g | P 5 | C 56 | F 0.6 | FIB 0.8 | KCAL 250 | CONF medium | -
- Chicken breast | 150 g | P 46 | C 0 | F 5.4 | FIB 0 | KCAL 233 | CONF low | cooked in 1 tsp oil
TOTAL | P 51 | C 56 | F 6 | KCAL 483
END`

describe('the paste prompt', () => {
  it('is the fixed text with the block format', () => {
    expect(FOOD_PASTE_PROMPT.startsWith('You are a precise nutrition analyst.')).toBe(true)
    expect(FOOD_PASTE_PROMPT).toContain('LIFE-FOOD v1\nMEAL | <Breakfast/Lunch/Dinner/Snack> | <YYYY-MM-DD HH:MM or "now"> | <short meal name>')
    expect(FOOD_PASTE_PROMPT.endsWith('never skip a food.')).toBe(true)
  })
})

describe('reading a pasted block', () => {
  it('reads two meals with every field', () => {
    const r = parseFoodPaste(CLEAN, TODAY)
    expect(r.warnings).toEqual([])
    expect(r.meals.map((m) => [m.type, m.at, m.name, m.items.length])).toEqual([
      ['breakfast', '2030-03-12T08:10', 'Eggs and toast', 2],
      ['lunch', null, 'Rice and chicken', 2]
    ])
    expect(r.meals[0].items[0]).toMatchObject({ name: 'Eggs', grams: 150, protein: 19, carbs: 1.1, fat: 15, fiber: 0, kcal: 215, confidence: 'high', note: '3 eggs', line: 3 })
    expect(r.meals[0].items[1].note).toBe('')
    expect(r.meals[1].items[1]).toMatchObject({ confidence: 'low', note: 'cooked in 1 tsp oil' })
    expect(r.meals[0].total).toEqual({ protein: 24, carbs: 29.1, fat: 16.5, kcal: 365 })
  })
  it('tolerates fences, bullets, bold, blank lines, chatter, lower case, commas, ~, ranges and tabs', () => {
    const messy = `Sure! Here is your log:

\`\`\`text
**LIFE-FOOD v1**

* **meal** | dinner | 19:30 | Pasta night

  • pasta bolognese | ~350 g | p 22,5 | c 70 | f 14 | kcal ≈ 520 | conf: Medium | -
1. salad\t150-200 g\tP 2\tC 6\tF 7\tFIB 3\tKCAL 95\tCONF high
- water | 300 ml
end
\`\`\`
Enjoy your meal!`
    const r = parseFoodPaste(messy, TODAY)
    expect(r.meals).toHaveLength(1)
    const m = r.meals[0]
    expect([m.type, m.at, m.name]).toEqual(['dinner', '2030-03-12T19:30', 'Pasta night'])
    expect(m.items.map((i) => [i.name, i.grams, i.protein, i.kcal, i.confidence])).toEqual([
      ['pasta bolognese', 350, 22.5, 520, 'medium'],
      ['salad', 175, 2, 95, 'high'],
      ['water', 300, 0, 0, 'medium']
    ])
    expect(m.items[1].fiber).toBe(3)
    expect(r.warnings).toEqual([])
  })
  it('missing optional fields: kcal from macros (said), no type or time, items before any MEAL line', () => {
    const r = parseFoodPaste('- Skyr | 200 g | P 22 | C 8 | F 0.4', TODAY)
    expect(r.meals[0]).toMatchObject({ type: null, at: null, name: '' })
    expect(r.meals[0].items[0]).toMatchObject({ kcal: 124, kcalCalc: 124, fiber: null, confidence: 'medium' })
    expect(r.warnings).toEqual(['Line 1: Skyr had no kcal; worked out from P/C/F (124 kcal).'])
  })
  it('warns, never drops: kcal far from 4P+4C+9F, no grams, an unreadable line, a total that disagrees, an empty meal', () => {
    const r = parseFoodPaste(
      `MEAL | Snack | now | Bar
- Protein bar | 60 g | P 20 | C 20 | F 8 | KCAL 600
- Banana | P 1 | C 27 | F 0.3 | KCAL 105
- ??? | ??? | ???
TOTAL | P 21 | C 47 | F 8 | KCAL 300
MEAL | Dinner | now | Nothing here`,
      TODAY
    )
    expect(r.meals).toHaveLength(1)
    expect(r.meals[0].items.map((i) => [i.name, i.grams, i.noGrams ?? false])).toEqual([
      ['Protein bar', 60, false],
      ['Banana', 0, true]
    ])
    expect(r.warnings).toEqual([
      'Line 2: Protein bar says 600 kcal but P/C/F give about 232. Check it.',
      'Line 3: Banana has no grams. Fill them in before logging.',
      'Line 4 could not be read: "??? | ??? | ???"',
      'The meal "Nothing here" has no foods.',
      'Bar: its TOTAL says 300 kcal, the foods add up to 705. The foods are used.'
    ])
  })
  it('reads numbers the way people write them', () => {
    expect(pasteNumber('12,5')).toBe(12.5)
    expect(pasteNumber('~150')).toBe(150)
    expect(pasteNumber('≈ 200 g')).toBe(200)
    expect(pasteNumber('150-200')).toBe(175)
    expect(pasteNumber('150 to 250')).toBe(200)
    expect(pasteNumber('x')).toBeNull()
  })
  it('knows a block when it sees one', () => {
    expect(isPasteBlock('LIFE-FOOD v1\nMEAL | …')).toBe(true)
    expect(isPasteBlock('```\nLIFE-FOOD v1')).toBe(true)
    expect(isPasteBlock('**LIFE-FOOD v1**')).toBe(true)
    expect(isPasteBlock('my life food plan')).toBe(false)
    expect(pasteId(CLEAN, 0)).toMatch(/^fd-t[a-z0-9]+0$/)
    expect(pasteId(CLEAN, 0)).toBe(pasteId(`  ${CLEAN}  `, 0))
  })
})

describe('a pasted meal for the food counter', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(`${TODAY}T13:30:00`))
  })
  afterEach(() => vi.useRealTimers())
  it('uses the block time and type, else now and a type from the time', () => {
    const r = parseFoodPaste(CLEAN, TODAY)
    const a = pasteToLog(r.meals[0], new Date(), TODAY)!
    expect([a.type, a.day, a.at, a.name]).toEqual(['breakfast', TODAY, new Date(`${TODAY}T08:10`).toISOString(), 'Eggs and toast'])
    expect(a.items[1]).toMatchObject({ name: 'Rye bread', grams: 60, confidence: 'roughly', fiber: 3.5 })
    const b = pasteToLog({ ...r.meals[1], type: null }, new Date(), TODAY)!
    expect([b.type, b.day, b.at]).toEqual(['lunch', TODAY, new Date().toISOString()])
  })
  it('a future time or one over 14 days back becomes now, said; a food without grams is left out until fixed', () => {
    const warns: string[] = []
    const r = parseFoodPaste(CLEAN, TODAY)
    expect(pasteToLog({ ...r.meals[0], at: `${TODAY}T20:00` }, new Date(), TODAY, (w) => warns.push(w))!.at).toBe(new Date().toISOString())
    expect(pasteToLog({ ...r.meals[0], at: '2030-02-01T08:00' }, new Date(), TODAY, (w) => warns.push(w))!.day).toBe(TODAY)
    expect(warns).toEqual(['Eggs and toast: 2030-03-12 20:00 is in the future, so now is used.', 'Eggs and toast: 2030-02-01 is more than 14 days ago, so today is used.'])
    const y = pasteToLog({ ...r.meals[0], at: '2030-03-11T19:00' }, new Date(), TODAY)!
    expect(y.day).toBe('2030-03-11')
    expect(pasteToLog({ ...r.meals[0], items: [{ ...r.meals[0].items[0], grams: 0, noGrams: true }] }, new Date(), TODAY)).toBeNull()
  })
})
