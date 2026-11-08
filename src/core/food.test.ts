// Food counter, pure parts. Made-up meals only.
import { describe, expect, it } from 'vitest'
import { FOOD_FIELDS, FOOD_PROMPT } from './foodPrompt'
import { numberOf, parseFoodReply } from './foodParse'
import { addMeal, cleanFoodLog, dayLine, foodWeek, isFav, kcalOf, kcalOfDay, liveMealIds, mealName, mealOfRow, mealTypeAt, mealsOfDay, proteinSince, scaleItem, sportFoodLine, stepGrams, sumItems, toggleFav, yesterdayMeals, type FoodItem, type FoodLog, type FoodMeal } from './food'
import { DEFAULT_GOALS, GOAL_LABEL, LEAN_GPK, cleanGoals, foodTargets, maintenance } from './foodGoals'
import { BUILTIN, ownFoods, portionFor, whatToEatNext } from './foodNext'
import { proteinOfDay } from './protein'
import type { BodyEvent } from './bodyLog'

const item = (p: Partial<FoodItem> = {}): FoodItem => ({ name: 'chicken breast', grams: 150, protein: 46, carbs: 0, fat: 5, kcal: 230, confidence: 'roughly', ...p })
const ev = (id: string, day: string, kind: string, amount: number, at = `${day}T12:00:00.000Z`, undoes: string | null = null): BodyEvent => ({ id, at, day, kind, amount, source: 'web', undoes })
const meal = (id: string, day: string, items: FoodItem[], at = `${day}T12:00:00.000Z`): FoodMeal => ({ id, at, day, name: mealName(items), type: 'lunch', items })

describe('the prompt', () => {
  it('asks for the fixed JSON block with every field, and only that', () => {
    for (const f of FOOD_FIELDS) expect(FOOD_PROMPT).toContain(`"${f}"`)
    expect(FOOD_PROMPT).toContain('"items"')
    expect(FOOD_PROMPT).toContain('"question"')
    expect(FOOD_PROMPT).toMatch(/```json/)
    expect(FOOD_PROMPT).toMatch(/Reply ONLY with this block/)
    expect(FOOD_PROMPT).toMatch(/each food separately/i)
    expect(FOOD_PROMPT).toMatch(/plate|hand/)
    expect(FOOD_PROMPT).toMatch(/sure.*roughly.*guess/)
    // Its own example parses.
    const r = parseFoodReply(FOOD_PROMPT)
    expect(r.ok && r.items[0].name).toBe('chicken breast')
  })
})

describe('reading the reply', () => {
  const good = '{"items":[{"name":"rice","grams":200,"protein_g":5,"carbs_g":56,"fat_g":1,"kcal":260,"confidence":"sure"},{"name":"chicken breast","grams":150,"protein_g":46,"carbs_g":0,"fat_g":5,"kcal":230,"confidence":"roughly"}],"question":"Was it cooked in oil?"}'
  it('a clean block', () => {
    const r = parseFoodReply(good)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.items.map((i) => [i.name, i.grams, i.protein, i.kcal, i.confidence])).toEqual([
      ['rice', 200, 5, 260, 'sure'],
      ['chicken breast', 150, 46, 230, 'roughly']
    ])
    expect(r.question).toBe('Was it cooked in oil?')
  })
  it('with fences and chatter around it', () => {
    const r = parseFoodReply(`Sure! Here is my estimate:\n\n\`\`\`json\n${good}\n\`\`\`\n\nLet me know if you want more detail.`)
    expect(r.ok && r.items.length).toBe(2)
  })
  it('fences without a language, extra text, and a {…} in the chatter before it', () => {
    const r = parseFoodReply(`I looked at it {roughly}.\n\`\`\`\n${good}\n\`\`\``)
    expect(r.ok && r.items.length).toBe(2)
  })
  it('decimal commas, numbers as text with units, trailing commas, single quotes, unquoted keys', () => {
    const r = parseFoodReply("{items: [{name: 'skyr', grams: '250 g', protein_g: 27,5, carbs_g: 10, fat_g: 0,5, kcal: 160,},],}")
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.items[0]).toMatchObject({ name: 'skyr', grams: 250, protein: 27.5, fat: 0.5, kcal: 160 })
  })
  it('missing kcal: worked out as 4/4/9', () => {
    const r = parseFoodReply('{"items":[{"name":"oats","grams":50,"protein_g":"6,5","carbs_g":30,"fat_g":3}]}')
    expect(r.ok && r.items[0].kcal).toBe(Math.round(4 * 6.5 + 4 * 30 + 9 * 3))
    expect(kcalOf(10, 10, 10)).toBe(170)
  })
  it('other field names and a bare list', () => {
    const r = parseFoodReply('[{"food":"Eggs","weight":"100g","protein":13,"carbohydrates":1,"fats":10,"calories":"143 kcal","confidence":"high"}]')
    expect(r.ok && r.items[0]).toMatchObject({ name: 'Eggs', grams: 100, protein: 13, carbs: 1, fat: 10, kcal: 143, confidence: 'sure' })
  })
  it('curly quotes from a phone keyboard', () => {
    const r = parseFoodReply('{“items”:[{“name”:“tuna”,“grams”:120,“protein_g”:31,“carbs_g”:0,“fat_g”:1,“kcal”:140}]}')
    expect(r.ok && r.items[0].name).toBe('tuna')
  })
  it('a reply cut off at the end', () => {
    const r = parseFoodReply('```json\n{"items":[{"name":"rice","grams":200,"protein_g":5,"carbs_g":56,"fat_g":1,"kcal":260}')
    expect(r.ok && r.items[0].name).toBe('rice')
  })
  it('plain lines when there is no JSON', () => {
    const r = parseFoodReply('- Chicken breast: 150 g, 46 g protein, 5 g fat, 230 kcal\n- Rice: 200 g, 5 g protein, 56 g carbs, 260 kcal')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.items.map((i) => [i.name, i.grams, i.protein, i.kcal])).toEqual([
      ['Chicken breast', 150, 46, 230],
      ['Rice', 200, 5, 260]
    ])
  })
  it('one item on its own, with a question list', () => {
    const r = parseFoodReply('{"name":"banana","grams":120,"protein_g":1,"carbs_g":27,"fat_g":0,"kcal":105,"questions":["Was it big?"]}')
    expect(r.ok && r.items[0].name).toBe('banana')
  })
  it('a reply it cannot read says so in plain words', () => {
    for (const bad of ['', 'I cannot see the photo, sorry.', '{"items":[]}', '{"items":[{"name":"","grams":0}]}']) {
      const r = parseFoodReply(bad)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.why.length).toBeGreaterThan(10)
    }
    const r = parseFoodReply('nope')
    expect(!r.ok && r.why).toMatch(/Copy the prompt again/)
  })
  it('numbers from text', () => {
    expect(numberOf('about 150 g')).toBe(150)
    expect(numberOf('12,5')).toBe(12.5)
    expect(numberOf('~46g')).toBe(46)
    expect(numberOf('none')).toBeNull()
  })
  it('clamps silly numbers and keeps at most 20 items', () => {
    const many = JSON.stringify({ items: Array.from({ length: 30 }, (_, i) => ({ name: `f${i}`, grams: 99999, protein_g: -5, kcal: 100 })) })
    const r = parseFoodReply(many)
    expect(r.ok && r.items.length).toBe(20)
    if (r.ok) expect(r.items[0]).toMatchObject({ grams: 3000, protein: 0 })
  })
})

describe('grams and totals', () => {
  it('macros scale with the grams', () => {
    const s = scaleItem(item(), 300)
    expect(s).toMatchObject({ grams: 300, protein: 92, fat: 10, kcal: 460 })
    expect(scaleItem(item(), 75)).toMatchObject({ protein: 23, kcal: 115 })
    expect(scaleItem(item(), 0).grams).toBe(5)
  })
  it('the −/+ step', () => {
    expect(stepGrams(150, 1)).toBe(175)
    expect(stepGrams(150, -1)).toBe(125)
    expect(stepGrams(95, 1)).toBe(100)
    expect(stepGrams(100, -1)).toBe(90)
    expect(stepGrams(300, 1)).toBe(350)
    expect(stepGrams(300, -1)).toBe(275)
    expect(stepGrams(10, -1)).toBe(5)
  })
  it('sums and names', () => {
    expect(sumItems([item(), item({ name: 'rice', grams: 200, protein: 5, carbs: 56, fat: 1, kcal: 260 })])).toEqual({ protein: 51, carbs: 56, fat: 6, kcal: 490 })
    expect(mealName([item(), item({ name: 'rice' }), item({ name: 'salad' }), item({ name: 'sauce' })])).toBe('Chicken breast, Rice +2')
  })
  it('the live line and the Sport Track line', () => {
    expect(dayLine({ protein: 92, proteinGoal: 150, kcal: 1850, kcalGoal: 2700 })).toBe('Protein 92 / 150 g · 1,850 / 2,700 kcal today')
    expect(sportFoodLine({ protein: 92, proteinGoal: 150, trainedAt: '2026-11-08T15:00:00Z', afterTrain: 30 })).toBe('Protein 92 / 150 g today · trained: +30 g')
    expect(sportFoodLine({ protein: 92, proteinGoal: 150, trainedAt: null, afterTrain: 0 })).toBe('Protein 92 / 150 g today')
  })
  it('meal types from the time', () => {
    expect([mealTypeAt('07:30'), mealTypeAt('12:10'), mealTypeAt('19:00'), mealTypeAt('16:30'), mealTypeAt('23:40')]).toEqual(['breakfast', 'lunch', 'dinner', 'snack', 'snack'])
  })
})

describe('one protein number (no double counting)', () => {
  const day = '2026-11-08'
  const events = [
    ev('q1', day, 'protein:egg', 12), // an older quick log
    ev('fd-a-p', day, 'protein:food', 46), // a food counter meal
    ev('fd-a-k', day, 'kcal:food', 230),
    ev('fd-b-p', day, 'protein:food', 20),
    ev('fd-b-k', day, 'kcal:food', 400),
    ev('x1', day, 'protein:food', 0, `${day}T13:00:00.000Z`, 'fd-b-p'), // meal b removed: both rows
    ev('x2', day, 'kcal:food', 0, `${day}T13:00:00.000Z`, 'fd-b-k')
  ]
  it('quick logs and meals each count once; a removed meal counts for nothing', () => {
    expect(proteinOfDay(events, day)).toBe(58)
    expect(kcalOfDay(events, day)).toBe(230)
    const { live, removed } = liveMealIds(events)
    expect([...live]).toEqual(['fd-a'])
    expect([...removed]).toEqual(['fd-b'])
    expect(mealOfRow('fd-a-p')).toBe('fd-a')
    expect(mealOfRow('q1')).toBe('')
  })
  it('protein since a workout', () => {
    const e = [ev('a', day, 'protein:egg', 12, `${day}T08:00:00.000Z`), ev('b', day, 'protein:food', 30, `${day}T16:00:00.000Z`)]
    expect(proteinSince(e, day, `${day}T15:00:00.000Z`)).toBe(30)
  })
})

describe('the log, yesterday and favourites', () => {
  const today = '2026-11-08'
  it('cleans, sorts newest first and caps by days and count', () => {
    const raw = {
      meals: [meal('fd-old', '2026-09-01', [item()]), meal('fd-a', today, [item()], `${today}T08:00:00Z`), meal('fd-b', today, [item()], `${today}T19:00:00Z`), { id: 'bad', day: today, items: [item()] }, meal('fd-e', today, [])],
      favs: [{ id: 'fv-1', name: 'Lunch', items: [item()] }, { id: 'nope', items: [item()] }]
    }
    const log = cleanFoodLog(raw, today)
    expect(log.meals.map((m) => m.id)).toEqual(['fd-b', 'fd-a'])
    expect(log.favs.map((f) => f.id)).toEqual(['fv-1'])
    let big: FoodLog = { meals: [], favs: [] }
    for (let i = 0; i < 420; i++) big = addMeal(big, meal(`fd-${i.toString(36)}`, today, [item()], `${today}T${String(i % 24).padStart(2, '0')}:00:${String(i % 60).padStart(2, '0')}Z`), today)
    expect(big.meals.length).toBe(400)
  })
  it('same as yesterday lists only meals that still count', () => {
    const yd = '2026-11-07'
    const log = cleanFoodLog({ meals: [meal('fd-y1', yd, [item()]), meal('fd-y2', yd, [item({ name: 'rice' })]), meal('fd-t', today, [item()])] }, today)
    const events = [ev('fd-y2-p', yd, 'protein:food', 46), ev('c', yd, 'protein:food', 0, `${yd}T13:00:00Z`, 'fd-y2-p'), ev('fd-y2-k', yd, 'kcal:food', 230), ev('c2', yd, 'kcal:food', 0, `${yd}T13:00:00Z`, 'fd-y2-k')]
    expect(yesterdayMeals(log, events, today).map((m) => m.id)).toEqual(['fd-y1'])
    expect(mealsOfDay(log, events, yd).map((m) => [m.id, m.removed])).toEqual([
      ['fd-y1', false],
      ['fd-y2', true]
    ])
  })
  it('a star copies the foods; the same foods again unstar it', () => {
    let log: FoodLog = { meals: [], favs: [] }
    log = toggleFav(log, { name: 'Lunch', items: [item()] }, 'fv-a')
    expect(isFav(log, [item()])).toBe(true)
    log = toggleFav(log, { name: 'Lunch', items: [item()] }, 'fv-b')
    expect(log.favs).toEqual([])
  })
})

describe('lean goals', () => {
  it('protein 2.0 g/kg is the lean default, kcal = maintenance +150 on a training day, +0 on a rest day', () => {
    expect(LEAN_GPK).toBe(2)
    expect(GOAL_LABEL).toBe('Lean muscle (no fat gain)')
    const g = cleanGoals(null)
    expect(g).toEqual(DEFAULT_GOALS)
    expect(g.activity).toBe('moderate')
    // 75 kg, 178 cm, 30, male: BMR 10*75 + 6.25*178 - 150 + 5 = 1717.5; × 1.55 = 2662 → 2650
    expect(maintenance(75, g)).toBe(2650)
    const rest = foodTargets(75, 2, g, false)
    const train = foodTargets(75, 2, g, true)
    expect(rest).toMatchObject({ protein: 150, kcal: 2650, maintenance: 2650, training: false })
    expect(train).toMatchObject({ protein: 150, kcal: 2800, training: true })
    expect(train.why).toMatch(/\+150 on a training day/)
  })
  it('weight drives protein; g/kg stays 1.6–2.2; your own goals win', () => {
    const g = cleanGoals({})
    expect(foodTargets(80, 1.8, g).protein).toBe(145)
    expect(foodTargets(80, 3, g).protein).toBe(175)
    expect(foodTargets(80, 1, g).protein).toBe(130)
    expect(foodTargets(null, 2, g)).toMatchObject({ protein: 120, weight: null })
    expect(foodTargets(80, 2, cleanGoals({ kcalOwn: 2500, proteinOwn: 170 }))).toMatchObject({ kcal: 2500, protein: 170 })
    expect(cleanGoals({ heightCm: 999, age: 5, activity: 'wild', trainSurplus: 9999, restSurplus: '' })).toMatchObject({ heightCm: 230, age: 14, activity: 'moderate', trainSurplus: 600, restSurplus: 0 })
  })
})

describe('what to eat next', () => {
  it('58 g left: one food, two foods, a shake, all within the kcal left', () => {
    const w = whatToEatNext({ proteinLeft: 58, kcalLeft: 900 })
    expect(w.line.startsWith('58 g protein left: ')).toBe(true)
    expect(w.ideas.length).toBe(3)
    expect(w.ideas[0].text).toBe('200 g chicken breast')
    expect(w.ideas[1].text).toMatch(/^3 eggs \+ \d+ g skyr$/)
    expect(w.ideas[2].text).toMatch(/^a shake \+/)
    for (const i of w.ideas) expect(i.protein).toBeGreaterThanOrEqual(58 * 0.85)
    for (const i of w.ideas) expect(i.kcal).toBeLessThanOrEqual(1000)
  })
  it('your own most-logged high-protein food comes first; low-protein foods are not used', () => {
    const today = '2026-11-08'
    const meals = [
      meal('fd-1', today, [item({ name: 'Turkey mince', grams: 200, protein: 44, kcal: 300 }), item({ name: 'pasta', grams: 200, protein: 10, carbs: 60, kcal: 300 })]),
      meal('fd-2', '2026-11-07', [item({ name: 'turkey mince', grams: 150, protein: 33, kcal: 225 })]),
      meal('fd-3', '2026-11-06', [item({ name: 'skyr', grams: 300, protein: 33, kcal: 190 })]),
      meal('fd-4', '2026-09-01', [item({ name: 'old beef', grams: 200, protein: 52, kcal: 400 })])
    ]
    const own = ownFoods(meals, today)
    expect(own.map((f) => f.name)).toEqual(['turkey mince', 'skyr'])
    const w = whatToEatNext({ proteinLeft: 40, kcalLeft: 800, own })
    expect(w.ideas[0].text).toBe('200 g turkey mince')
  })
  it('a lot left: plans the next meal (about 50 g), not the whole day', () => {
    const w = whatToEatNext({ proteinLeft: 120, kcalLeft: 2000 })
    expect(w.line.startsWith('120 g protein left today. Next meal, about 50 g: ')).toBe(true)
    for (const i of w.ideas) expect(i.protein).toBeLessThan(70)
  })
  it('little kcal left: drops what does not fit, says pick something lean', () => {
    const w = whatToEatNext({ proteinLeft: 40, kcalLeft: 150 })
    for (const i of w.ideas) expect(i.kcal).toBeLessThanOrEqual(250)
    const none = whatToEatNext({ proteinLeft: 100, kcalLeft: 50 })
    expect(none.ideas).toEqual([])
    expect(none.line).toMatch(/lean/)
  })
  it('over kcal already: still the leanest way to finish protein', () => {
    const w = whatToEatNext({ proteinLeft: 30, kcalLeft: -200 })
    expect(w.ideas.length).toBeGreaterThan(0)
  })
  it('protein done', () => {
    expect(whatToEatNext({ proteinLeft: 0, kcalLeft: 400 }).line).toMatch(/Protein done for today. About 400 kcal left today/)
    expect(whatToEatNext({ proteinLeft: -5, kcalLeft: 0 }).line).toMatch(/done/)
  })
  it('portions', () => {
    const eggs = BUILTIN.find((f) => f.name === 'eggs')!
    expect(portionFor(eggs, 18).text).toBe('3 eggs')
    expect(portionFor(eggs, 1).text).toBe('1 egg')
    expect(portionFor(BUILTIN[0], 500).grams).toBe(400)
  })
})

describe('the week', () => {
  it('averages, goal days and a plain line', () => {
    const today = '2026-11-08'
    const events = [ev('fd-a-p', today, 'protein:food', 150), ev('fd-a-k', today, 'kcal:food', 2700), ev('fd-b-p', '2026-11-07', 'protein:food', 100), ev('fd-b-k', '2026-11-07', 'kcal:food', 2000), ev('q', '2026-11-06', 'protein:egg', 60)]
    const w = foodWeek(events, today, { protein: 150, kcal: 2700 }, (d) => proteinOfDay(events, d))
    expect(w).toMatchObject({ days: 2, avgProtein: 103, avgKcal: 2350, proteinHit: 1, kcalOnTarget: 1 })
    expect(w.line).toMatch(/^Protein 103 g a day on average \(goal 150 g\), reached on 1 of 7 days; 2,350 kcal a day/)
    expect(foodWeek([], today, { protein: 150, kcal: 2700 }, () => 0).line).toMatch(/No food logged/)
  })
})
