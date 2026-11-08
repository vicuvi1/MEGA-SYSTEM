// Food counter extras, pure parts: words, label prompt, macro targets, the weekly
// weight check, protein per leu, shopping list, meal prep, the header basis,
// rings and the week chart. Made-up data, pinned dates.
import { describe, expect, it } from 'vitest'
import { FOOD_FIELDS, LABEL_PROMPT } from './foodPrompt'
import { parseFoodReply } from './foodParse'
import { parseFoodWords } from './foodWords'
import { FOOD_TABLE, ownPer100 } from './foodTable'
import { DEFAULT_GOALS, cleanGoals, foodTargets } from './foodGoals'
import { adjustCheck, applyDelta } from './foodAdjust'
import { cheapMap, cheapProtein, proteinPerLei } from './foodCheap'
import { prepPlan, shoppingList } from './foodPlan'
import { dayRings, foodHeader, weekChart } from './foodDisplay'
import { whatToEatNext } from './foodNext'
import { sumItems, type FoodItem, type FoodMeal } from './food'

const TODAY = '2026-11-08'
const item = (p: Partial<FoodItem> = {}): FoodItem => ({ name: 'chicken breast', grams: 150, protein: 46, carbs: 0, fat: 5, kcal: 230, confidence: 'roughly', ...p })
const meal = (id: string, day: string, items: FoodItem[]): FoodMeal => ({ id, at: `${day}T12:00:00.000Z`, day, name: 'm', type: 'lunch', items })

describe('quick add in words', () => {
  it('reads grams, counts and units from the built-in table', () => {
    const r = parseFoodWords('200g chicken, 150g rice, 2 eggs, 1 banana')
    expect(r.say).toBe('')
    expect(r.items.map((i) => [i.name, i.grams])).toEqual([
      ['chicken breast', 200],
      ['rice', 150],
      ['egg', 100],
      ['banana', 120]
    ])
    expect(r.items[0]).toMatchObject({ protein: 62, kcal: 330 })
    expect(r.items[2]).toMatchObject({ protein: 12.5 })
  })
  it('units: slices, scoops, cups, "a", "half", "and", amount after the name, decimal comma', () => {
    const r = parseFoodWords('2 slices bread and a scoop of whey, 1,5 cup rice\nchicken 250 g, half a banana, 1 shake')
    expect(r.items.map((i) => [i.name, i.grams])).toEqual([
      ['bread', 60],
      ['whey protein', 30],
      ['rice', 240],
      ['chicken breast', 250],
      ['banana', 60],
      ['whey protein', 30]
    ])
    expect(parseFoodWords('2 scoops').items[0]).toMatchObject({ name: 'whey protein', grams: 60 })
  })
  it('own foods win over the table, with their own macros', () => {
    const own = ownPer100([meal('fd-a', '2026-11-05', [item({ name: 'Chicken breast', grams: 100, protein: 20, carbs: 0, fat: 10, kcal: 170 })])], TODAY)
    const r = parseFoodWords('200g chicken breast', own)
    expect(r.items[0]).toMatchObject({ grams: 200, protein: 40, kcal: 340 })
  })
  it('unknown words and missing grams are asked about, never guessed', () => {
    const r = parseFoodWords('150g dragon fruit, chicken, 2 eggs')
    expect(r.unknown).toEqual(['dragon fruit'])
    expect(r.needGrams).toEqual(['chicken breast'])
    expect(r.items.map((i) => i.name)).toEqual(['egg'])
    expect(r.say).toMatch(/How many grams of chicken breast/)
    expect(r.say).toMatch(/"dragon fruit"/)
    expect(r.say).toMatch(/photo|label prompt/)
    expect(parseFoodWords('').say).toMatch(/Write what you ate/)
    expect(parseFoodWords('1 cup chicken').needGrams).toEqual([]) // a generic cup is used, still a rough guess
  })
  it('the table is sane: kcal near 4/4/9 and every unit is positive', () => {
    for (const f of FOOD_TABLE) {
      expect(Math.abs(f.k - (4 * f.p + 4 * f.c + 9 * f.f)) / Math.max(50, f.k)).toBeLessThan(0.2)
      for (const g of Object.values(f.units ?? {})) expect(g).toBeGreaterThan(0)
    }
  })
})

describe('the label prompt', () => {
  it('has the same fields and reply format, asks for the portion, and its example parses', () => {
    for (const f of FOOD_FIELDS) expect(LABEL_PROMPT).toContain(`"${f}"`)
    expect(LABEL_PROMPT).toMatch(/per 100 g/)
    expect(LABEL_PROMPT).toMatch(/My portion/)
    expect(LABEL_PROMPT).toMatch(/Reply ONLY with this block/)
    const r = parseFoodReply(LABEL_PROMPT)
    expect(r.ok && r.items[0]).toMatchObject({ name: 'protein bar', grams: 60, protein: 20 })
  })
})

describe('carbs and fat targets (lean plan)', () => {
  it('fat 0.8 g/kg, carbs are the rest of the kcal after protein and fat', () => {
    const t = foodTargets(75, 2, DEFAULT_GOALS, false)
    expect(t.protein).toBe(150)
    expect(t.fat).toBe(60)
    expect(t.carbs).toBe(Math.round((t.kcal - 4 * 150 - 9 * 60) / 4))
    expect(t.carbs).toBeGreaterThan(200)
    // kcal = protein 4 + carbs 4 + fat 9 gives back the goal (within rounding)
    expect(Math.abs(4 * t.protein + 4 * t.carbs + 9 * t.fat - t.kcal)).toBeLessThanOrEqual(2)
  })
  it('the weight check adjustment moves kcal (not with your own kcal goal) and carbs follow', () => {
    const base = foodTargets(75, 2, DEFAULT_GOALS, false)
    const up = foodTargets(75, 2, cleanGoals({ kcalAdj: 100 }), false)
    expect(up.kcal).toBe(base.kcal + 100)
    expect(up.carbs).toBe(base.carbs + 25)
    expect(foodTargets(75, 2, cleanGoals({ kcalAdj: 100, kcalOwn: 2500 }), false).kcal).toBe(2500)
    expect(cleanGoals({ kcalAdj: 9999 }).kcalAdj).toBe(300)
    expect(cleanGoals({ kcalAdj: -9999 }).kcalAdj).toBe(-300)
  })
})

describe('auto-adjust from weight', () => {
  const w = (a: number[], b: number[]) => [...b.map((x, i) => ({ day: `2026-10-${String(26 + i).padStart(2, '0')}`, weight: x })), ...a.map((x, i) => ({ day: `2026-11-0${2 + i}`, weight: x }))]
  // 26 Oct–1 Nov = the week before, 2–8 Nov = the last 7 days
  const flat = w([75.1, 75, 75.2, 75], [75, 75.1, 75, 75.2])
  const fast = w([76, 76.1, 76.2, 76], [75, 75.1, 75, 75.2])
  const good = w([75.2, 75.3, 75.2, 75.3], [75, 75.1, 75, 75.1])
  it('flat and the goal is gain: suggest +100', () => {
    const r = adjustCheck({ weights: flat, today: TODAY, adj: 0, adjAt: '' })
    expect(r.state).toBe('suggest')
    if (r.state === 'suggest') expect(r.suggestion).toMatchObject({ delta: 100, after: 100 })
  })
  it('gaining more than 0.25 kg a week: suggest −100', () => {
    const r = adjustCheck({ weights: fast, today: TODAY, adj: 0, adjAt: '' })
    expect(r.state === 'suggest' && r.suggestion.delta).toBe(-100)
  })
  it('on track: no change', () => {
    const r = adjustCheck({ weights: good, today: TODAY, adj: 0, adjAt: '' })
    expect(r.state).toBe('none')
    expect(r.state === 'none' && r.why).toMatch(/On track/)
  })
  it('bounded at ±300 and once a week, and needs data', () => {
    expect(adjustCheck({ weights: flat, today: TODAY, adj: 300, adjAt: '' }).state).toBe('none')
    expect(adjustCheck({ weights: fast, today: TODAY, adj: -300, adjAt: '' }).state).toBe('none')
    expect(adjustCheck({ weights: flat, today: TODAY, adj: 0, adjAt: '2026-11-05' }).state).toBe('none')
    expect(adjustCheck({ weights: flat, today: TODAY, adj: 0, adjAt: '2026-11-01' }).state).toBe('suggest')
    const few = adjustCheck({ weights: [{ day: '2026-11-07', weight: 75 }], today: TODAY, adj: 0, adjAt: '' })
    expect(few.state === 'none' && few.why).toMatch(/at least twice a week/)
    expect(applyDelta(250, 100)).toBe(300)
    expect(applyDelta(-250, -100)).toBe(-300)
  })
  it('a maintain goal never adds for flat weight', () => {
    expect(adjustCheck({ weights: flat, today: TODAY, adj: 0, adjAt: '', goal: 'maintain' }).state).toBe('none')
  })
})

describe('protein per leu', () => {
  it('grams of protein per leu from price per kg', () => {
    expect(proteinPerLei(31, 95)).toBe(3.3)
    expect(proteinPerLei(0, 95)).toBe(0)
    expect(proteinPerLei(10, 0)).toBe(0)
  })
  it('ranks best value first and follows your own prices', () => {
    const list = cheapProtein()
    expect(list.length).toBeGreaterThan(8)
    for (let i = 1; i < list.length; i++) expect(list[i - 1].gPerLei).toBeGreaterThanOrEqual(list[i].gPerLei)
    const chicken = list.find((r) => r.name === 'chicken breast')!
    expect(chicken.edited).toBe(false)
    const cheaper = cheapProtein({ 'chicken breast': 40 }).find((r) => r.name === 'chicken breast')!
    expect(cheaper).toMatchObject({ edited: true, mdlKg: 40 })
    expect(cheaper.gPerLei).toBeGreaterThan(chicken.gPerLei)
    const own = ownPer100([meal('fd-a', '2026-11-05', [item({ name: 'turkey ham', grams: 100, protein: 18, carbs: 1, fat: 5, kcal: 120 })])], TODAY)
    expect(cheapProtein({}, own).some((r) => r.name === 'turkey ham')).toBe(false) // no price yet
    expect(cheapProtein({ 'turkey ham': 100 }, own).find((r) => r.name === 'turkey ham')).toMatchObject({ own: true, gPerLei: 1.8 })
  })
  it('is the tie-breaker in what to eat next: cheapest built-in food first, your own foods keep their place', () => {
    const plain = whatToEatNext({ proteinLeft: 40, kcalLeft: 2000 })
    const cheap = whatToEatNext({ proteinLeft: 40, kcalLeft: 2000, cheap: cheapMap(cheapProtein({ skyr: 20, 'chicken breast': 400 })) })
    expect(plain.ideas[0].text).toMatch(/chicken/)
    expect(cheap.ideas[0].text).toMatch(/skyr/)
    const own = [{ name: 'tuna', pPerG: 0.26, kPerG: 1.16, own: true }]
    expect(whatToEatNext({ proteinLeft: 40, kcalLeft: 2000, own, cheap: cheapMap(cheapProtein({ skyr: 20 })) }).ideas[0].text).toMatch(/tuna/)
  })
})

describe('shopping list and meal prep', () => {
  const own = ownPer100([meal('fd-a', '2026-11-05', [item({ name: 'chicken breast', grams: 200, protein: 62, kcal: 330 }), item({ name: 'rice', grams: 200, protein: 5, carbs: 56, fat: 1, kcal: 260 })]), meal('fd-b', '2026-11-06', [item({ name: 'chicken breast', grams: 200, protein: 62, kcal: 330 })])], TODAY)
  it('buys about 80% of the week protein from 4 foods (your own first), raw meat and dry rice', () => {
    const s = shoppingList({ proteinGoal: 150, carbsGoal: 300, own })
    const proteinLines = s.lines.slice(0, 4)
    expect(proteinLines[0].name).toBe('chicken breast')
    expect(proteinLines[0].own).toBe(true)
    const got = proteinLines.reduce((t, l) => t + l.protein, 0)
    expect(got).toBeGreaterThan(150 * 7 * 0.7)
    expect(got).toBeLessThan(150 * 7 * 0.95)
    expect(s.lines.map((l) => l.name)).toContain('rice (dry)')
    expect(s.text).toMatch(/^Shopping list for 7 days/)
    expect(s.text).toMatch(/Protein goal 150 g a day, 1,050 g for the week/)
    expect(s.text).toMatch(/- Chicken breast: [\d.]+ (kg|g) \(about \d+ MDL\)/)
    expect(s.mdl).toBeGreaterThan(0)
    expect(s.lines.every((l) => l.buy)).toBe(true)
  })
  it('counts eggs and works with no history', () => {
    const s = shoppingList({ proteinGoal: 150, carbsGoal: 300, own: [], prices: { 'chicken breast': 400 } })
    expect(s.lines.length).toBe(6)
    expect(s.lines[0].name).not.toBe('chicken breast') // too expensive now
    const eggs = shoppingList({ proteinGoal: 150, carbsGoal: 300 }).lines.find((l) => l.name === 'eggs')
    if (eggs) expect(eggs.buy).toMatch(/^\d+ eggs$/)
  })
  it('a 3-day prep: 6 boxes, grams per box, macros, copyable text', () => {
    const p = prepPlan({ proteinGoal: 150, kcalGoal: 2600, own })
    expect(p.boxes).toBe(6)
    expect(p.box.protein.name).toBe('chicken breast')
    expect(p.box.protein.grams).toBe(120) // a quarter of 150 g protein
    expect(p.box.macros.protein).toBeGreaterThan(36)
    expect(p.box.macros.kcal).toBeGreaterThan(400)
    expect(p.box.macros.kcal).toBeLessThan(800)
    expect(p.total[0].cooked).toBe(120 * 6)
    expect(p.text).toMatch(/^Sunday meal prep: 3 days, 6 boxes/)
    expect(p.text).toMatch(/Each box: 120 g chicken breast \+ \d+ g rice \+ 100 g vegetables/)
    expect(p.text).toMatch(/Buy raw or dry/)
  })
})

describe('one basis for the header, macros and rings', () => {
  const goals = { protein: 120, kcal: 2500, carbs: 300, fat: 60 }
  it('saved meals only; the unsaved draft is shown apart', () => {
    const saved = { protein: 0, kcal: 0, carbs: 0, fat: 0 }
    const draft = sumItems([item({ grams: 175, protein: 54, carbs: 0, fat: 6, kcal: 270 }), item({ name: 'rice', grams: 200, protein: 5, carbs: 56, fat: 1, kcal: 260 })])
    const h = foodHeader(saved, goals, draft)
    expect(h.line).toBe('Protein 0 / 120 g · 0 / 2,500 kcal today')
    expect(h.macros).toBe('Carbs 0 / 300 g · Fat 0 / 60 g')
    expect(h.preview).toBe(`+59 g protein · 530 kcal · carbs 56 g · fat 7 g if you save`)
    // the header, the macros and the rings agree
    const rings = dayRings(saved, goals)
    expect(rings.map((r) => r.value)).toEqual([0, 0, 0, 0])
    expect(foodHeader(saved, goals, null).preview).toBe('')
    expect(foodHeader({ protein: 92, kcal: 1850, carbs: 120, fat: 40 }, goals, null, 'on 2026-11-07').line).toBe('Protein 92 / 120 g · 1,850 / 2,500 kcal on 2026-11-07')
  })
  it('rings: fraction of the goal, capped at 1, red past 110%', () => {
    const r = dayRings({ protein: 60, kcal: 2800, carbs: 300, fat: 0 }, goals)
    expect(r.map((x) => [x.id, x.frac])).toEqual([
      ['protein', 0.5],
      ['kcal', 1],
      ['carbs', 1],
      ['fat', 0]
    ])
    expect(r[1].over).toBe(true)
    expect(r[2].over).toBe(false)
  })
})

describe('the week chart', () => {
  const perDay = Array.from({ length: 7 }, (_, i) => ({ day: `2026-11-0${2 + i}`, protein: i === 3 ? 120 : 60, kcal: i === 3 ? 2500 : 1250 }))
  it('bars are in % of the goal on one scale, the goal line is at 100%', () => {
    const c = weekChart(perDay, { protein: 120, kcal: 2500 }, [])
    expect(c.topPct).toBe(125)
    expect(c.goalY).toBeCloseTo(0.8)
    expect(c.days[3].pH).toBeCloseTo(0.8) // at the goal line
    expect(c.days[0].pH).toBeCloseTo(0.4) // half the goal = half as tall
    expect(c.days[0].kH).toBeCloseTo(0.4)
    expect(c.days.map((d) => d.label)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
    expect(c.days.every((d) => d.weight == null && d.wY == null)).toBe(true)
  })
  it('the top grows to fit a big day (up to the next 25%)', () => {
    const c = weekChart([{ day: '2026-11-08', protein: 200, kcal: 100 }], { protein: 120, kcal: 2500 }, [])
    expect(c.topPct).toBe(175)
    expect(c.days[0].pH).toBeCloseTo(200 / 120 / 1.75)
  })
  it('the weight line has its own range (lowest 0, highest 1) and skips days without a weigh-in', () => {
    const c = weekChart(perDay, { protein: 120, kcal: 2500 }, [
      { day: '2026-11-02', weight: 75 },
      { day: '2026-11-05', weight: 75.6 },
      { day: '2026-11-08', weight: 75.3 },
      { day: '2026-10-01', weight: 99 }
    ])
    expect(c.weightMin).toBe(75)
    expect(c.weightMax).toBe(75.6)
    expect(c.days[0].wY).toBe(0)
    expect(c.days[3].wY).toBe(1)
    expect(c.days[6].wY).toBeCloseTo(0.5)
    expect(c.days[1].wY).toBeNull()
  })
})
