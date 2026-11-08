// The food counter in Ben and on Telegram (core/foodBen.ts), made-up data, pinned clocks.
import { describe, expect, it } from 'vitest'
import { asksFood, cleanFoodBen, decideFoodNudge, draftKeyboard, draftText, foodAnswer, foodNudgeDue, foodReport, foodWindows, isMuted, liveDraft, looksLikeFoodReply, readGramEdit, stepDraft, weekWeight, type FoodDraft, type FoodNudgeInput } from './foodBen'
import { askKind } from './benAsk'
import { cleanPushLog, pushTelegram, type PushLog } from './benPushes'
import { cleanItem, type FoodItem, type FoodWeek } from './food'

const item = (raw: object) => cleanItem(raw) as FoodItem
const DRAFT: FoodDraft = {
  id: 'abc123',
  at: Date.parse('2030-03-12T13:00:00'),
  items: [item({ name: 'chicken breast', grams: 150, protein: 46, carbs: 0, fat: 5, kcal: 230 }), item({ name: 'rice', grams: 200, protein: 5, carbs: 56, fat: 1, kcal: 260 })],
  question: 'Was it cooked in oil?'
}

describe('a pasted AI reply', () => {
  it('spots a reply (fenced, bare, with chatter, or plain lines) and not a quick log', () => {
    expect(looksLikeFoodReply('```json\n{"items":[{"name":"egg","grams":100,"protein_g":13,"kcal":155}]}\n```')).toBe(true)
    expect(looksLikeFoodReply('Sure! Here it is: {"items":[{"name":"skyr","grams":200,"protein":22,"calories":120}]} Enjoy')).toBe(true)
    expect(looksLikeFoodReply('Chicken breast 150 g, 46 g protein, 230 kcal')).toBe(true)
    expect(looksLikeFoodReply('protein 30')).toBe(false)
    expect(looksLikeFoodReply('chicken 150g')).toBe(false)
    expect(looksLikeFoodReply('/food')).toBe(false)
    expect(looksLikeFoodReply('what should I eat now?')).toBe(false)
  })

  it('previews each food, the total and the question, with −/+25 g, Save, Edit grams and Cancel', () => {
    const t = draftText(DRAFT)
    expect(t).toMatch(/1\. Chicken breast · 150 g · 46 g protein · 230 kcal/)
    expect(t).toMatch(/Total: 51 g protein · 490 kcal/)
    expect(t).toMatch(/Was it cooked in oil\?/)
    const k = draftKeyboard(DRAFT).inline_keyboard
    expect(k[0].map((b) => b.callback_data)).toEqual(['fd|-|abc123|0', 'fd|+|abc123|0'])
    expect(k[k.length - 1].map((b) => b.callback_data)).toEqual(['fd|s|abc123', 'fd|e|abc123', 'fd|x|abc123'])
    for (const row of k) for (const b of row) expect(b.callback_data.length).toBeLessThanOrEqual(64)
  })

  it('+25 g scales the macros; "chicken 175", "type: rice 150" and "1 175" set grams', () => {
    const up = stepDraft(DRAFT, 0, 1)
    expect(up.items[0]).toMatchObject({ grams: 175, protein: 53.7, kcal: 268 })
    expect(stepDraft(DRAFT, 1, -1).items[1].grams).toBe(175)
    expect(readGramEdit('chicken 175', DRAFT)).toEqual({ index: 0, grams: 175 })
    expect(readGramEdit('type: rice 150g', DRAFT)).toEqual({ index: 1, grams: 150 })
    expect(readGramEdit('1 175', DRAFT)).toEqual({ index: 0, grams: 175 })
    expect(readGramEdit('salmon 120', DRAFT)).toBeNull()
    expect(readGramEdit('3 100', DRAFT)).toBeNull()
  })

  it('a draft stays open 2 hours; the mute lasts until its time', () => {
    const fb = cleanFoodBen({ draft: DRAFT, muteUntil: Date.parse('2030-03-19T21:00:00') })
    expect(liveDraft(fb, DRAFT.at + 3600_000)?.id).toBe('abc123')
    expect(liveDraft(fb, DRAFT.at + 3 * 3600_000)).toBeNull()
    expect(isMuted(fb, Date.parse('2030-03-15T21:00:00'))).toBe(true)
    expect(isMuted(fb, Date.parse('2030-03-20T21:00:00'))).toBe(false)
    expect(cleanFoodBen({ draft: { id: 'BAD ID', at: 1, items: [] } }).draft).toBeNull()
  })
})

describe('Ask Ben: what should I eat now?', () => {
  it('reads the question and its variants as a food question', () => {
    for (const q of ['what should I eat now?', 'What to eat', 'how much protein left', 'how much protein do I still need today?', 'ce sa mananc', 'Ce să mănânc acum?', 'что мне съесть'])
      expect(askKind(q, '2030-03-12'), q).toEqual({ kind: 'food' })
    expect(asksFood('protein 30')).toBe(false)
    expect(asksFood('what should I cook tonight, a recipe?')).toBe(false)
    expect(askKind('how much do I sleep on average', '2030-03-12')?.kind).toBe('sleep')
  })

  it('answers with what to eat first, then today’s totals (numbers from the data handed in)', () => {
    const a = foodAnswer({ dayLine: 'Protein 92 / 150 g · 1,850 / 2,700 kcal today', next: { line: '58 g protein left: 200 g chicken breast, or 3 eggs + 300 g skyr' } })
    expect(a.reply).toBe('58 g protein left: 200 g chicken breast, or 3 eggs + 300 g skyr.\nSo far: Protein 92 / 150 g · 1,850 / 2,700 kcal today.')
  })
})

const LOG: PushLog = cleanPushLog(null, '2030-03-12')
const base = (over: Partial<FoodNudgeInput> = {}): FoodNudgeInput => ({
  now: new Date('2030-03-12T20:35:00'),
  day: '2030-03-12',
  bed: '23:30',
  protein: 110,
  proteinGoal: 150,
  loggedToday: true,
  lateMeal: true,
  yesterday: true,
  next: { line: '40 g protein left', ideas: [{ text: 'a shake + 100 g skyr' }, { text: '170 g chicken breast' }] },
  log: LOG,
  here: false,
  meeting: false,
  quiet: false,
  muted: false,
  ...over
})

describe('the evening nudge and the dinner reminder', () => {
  it('evening nudge: from 20:30, 25 g+ short, once a day (one key), on Telegram when away', () => {
    expect(decideFoodNudge(base({ now: new Date('2030-03-12T20:20:00') }))).toBeNull()
    const p = decideFoodNudge(base())!
    expect(p.key).toBe('food:evening:2030-03-12')
    expect(p.text).toBe('40 g protein short today: a shake + 100 g skyr or 170 g chicken breast fixes it.')
    expect(p.channel).toBe('telegram')
    expect(p.buttons.map((b) => b.op)).toEqual(['ok', 'mute'])
    expect(decideFoodNudge(base({ here: true }))!.channel).toBe('island')
    expect(decideFoodNudge(base({ protein: 130 }))).toBeNull() // 20 g short: fine
    const sent = { ...LOG, recs: { [p.key]: { at: 1, via: 'telegram' as const } } }
    expect(decideFoodNudge(base({ log: sent }))).toBeNull()
    expect(decideFoodNudge(base({ log: sent, now: new Date('2030-03-12T21:05:00'), lateMeal: false }))).toBeNull() // one food push a day
  })

  it('never in a meeting, in quiet hours or after bed, or while muted', () => {
    expect(decideFoodNudge(base({ meeting: true }))).toBeNull()
    expect(decideFoodNudge(base({ quiet: true }))).toBeNull()
    expect(decideFoodNudge(base({ muted: true }))).toBeNull()
  })

  it('evening nudge stops an hour before bed; an early bed moves it earlier', () => {
    expect(decideFoodNudge(base({ bed: '21:30', now: new Date('2030-03-12T20:35:00') }))).toBeNull()
    expect(foodWindows('21:30').evening).toEqual([20 * 60, 20 * 60 + 30])
    expect(decideFoodNudge(base({ bed: '21:30', now: new Date('2030-03-12T20:10:00') }))?.key).toBe('food:evening:2030-03-12')
    expect(foodWindows('00:30')).toEqual({ evening: [20 * 60 + 30, 23 * 60 + 30], dinner: [21 * 60, 24 * 60] })
  })

  it('nothing logged at all: no evening nudge, the dinner reminder from 21:00 instead', () => {
    const none = base({ protein: 0, loggedToday: false, lateMeal: false })
    expect(decideFoodNudge({ ...none, now: new Date('2030-03-12T20:40:00') })).toBeNull()
    const d = decideFoodNudge({ ...none, now: new Date('2030-03-12T21:05:00') })!
    expect(d.key).toBe('food:dinner:2030-03-12')
    expect(d.text).toBe('Log dinner? Copy the prompt or Same as yesterday.')
    expect(d.buttons.map((b) => b.op)).toEqual(['prompt', 'yesterday', 'mute'])
    expect(decideFoodNudge({ ...none, yesterday: false, now: new Date('2030-03-12T21:05:00') })!.buttons.map((b) => b.op)).toEqual(['prompt', 'mute'])
    // Lunch logged, nothing since 17:00: the dinner reminder covers it (the evening nudge waits for dinner).
    expect(decideFoodNudge(base({ lateMeal: false, now: new Date('2030-03-12T20:40:00') }))).toBeNull()
    expect(decideFoodNudge(base({ lateMeal: false, now: new Date('2030-03-12T21:10:00') }))?.key).toBe('food:dinner:2030-03-12')
    // Dinner logged: no reminder.
    expect(decideFoodNudge(base({ protein: 140, now: new Date('2030-03-12T21:10:00') }))).toBeNull()
    expect(decideFoodNudge({ ...none, now: new Date('2030-03-12T23:05:00') })).toBeNull() // 30 min before bed
  })

  it('the window check before any database read', () => {
    expect(foodNudgeDue(new Date('2030-03-12T15:00:00'), '23:30')).toBe(false)
    expect(foodNudgeDue(new Date('2030-03-12T20:31:00'), '23:30')).toBe(true)
    expect(foodNudgeDue(new Date('2030-03-12T23:10:00'), '23:30')).toBe(false)
  })

  it('on Telegram the food buttons are fd| buttons (the prompt, Same as yesterday, the mute)', () => {
    const d = decideFoodNudge(base({ lateMeal: false, now: new Date('2030-03-12T21:10:00') }))!
    const m = pushTelegram(d)
    expect(m.text).toMatch(/Log dinner\?/)
    expect(m.keyboard.inline_keyboard.map((r) => r[0].callback_data)).toEqual(['fd|p|food:dinner:2030-03-12', 'fd|y|food:dinner:2030-03-12', 'fd|m|food:dinner:2030-03-12'])
  })
})

describe('the Sunday food report', () => {
  const week = (perDay: { protein: number; kcal: number }[], hit: number): FoodWeek => {
    const days = perDay.filter((d) => d.kcal > 0)
    const pd = perDay.filter((d) => d.protein > 0)
    const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0)
    return { days: days.length, avgProtein: avg(pd.map((d) => d.protein)), avgKcal: avg(days.map((d) => d.kcal)), proteinHit: hit, kcalOnTarget: 0, perDay: perDay.map((d, i) => ({ day: `2030-03-${String(10 + i).padStart(2, '0')}`, ...d })), line: '' }
  }

  it('weight over the week: first → last weigh-in, or the last one before the week', () => {
    const ins = [{ day: '2030-03-05', weight: 75.0 }, { day: '2030-03-11', weight: 75.2 }, { day: '2030-03-16', weight: 75.5 }]
    expect(weekWeight(ins, '2030-03-16', '2030-03-10')).toMatchObject({ from: 75.2, to: 75.5, delta: 0.3 })
    expect(weekWeight([{ day: '2030-03-05', weight: 75.0 }, { day: '2030-03-14', weight: 74.8 }], '2030-03-16', '2030-03-10')).toMatchObject({ from: 75, to: 74.8, delta: -0.2 })
    expect(weekWeight([{ day: '2030-03-14', weight: 74.8 }], '2030-03-16', '2030-03-10')).toBeNull()
  })

  it('average protein and kcal vs goal, weight, days on goal and one tip, every number from the data', () => {
    const w = week([{ protein: 150, kcal: 2700 }, { protein: 120, kcal: 2500 }, { protein: 130, kcal: 0 }, { protein: 160, kcal: 2800 }, { protein: 0, kcal: 0 }, { protein: 110, kcal: 2400 }, { protein: 125, kcal: 2600 }], 2)
    const r = foodReport({ week: w, goals: { protein: 150, kcal: 2700 }, weight: { from: 75.2, to: 75.5, delta: 0.3, fromDay: '2030-03-11', toDay: '2030-03-16' } })!
    expect(r.lines).toEqual([
      'Protein: 133 g a day on average (goal 150 g), on the 6 days you logged it',
      'Calories: 2,600 kcal a day on the 5 days you logged meals (goal 2,700)',
      'Weight: 75.2 → 75.5 kg (+0.3 kg this week)',
      'Days on the protein goal: 2 of 7'
    ])
    expect(r.tip).toBe('Protein is 17 g a day short on average: add one protein snack a day (a shake or skyr).')
    expect(r.html).toMatch(/^🍽 <b>Food this week<\/b>/)
  })

  it('nothing logged all week: no report; few days logged: the tip asks for more logs', () => {
    expect(foodReport({ week: week(Array(7).fill({ protein: 0, kcal: 0 }), 0), goals: { protein: 150, kcal: 2700 }, weight: null })).toBeNull()
    const r = foodReport({ week: week([{ protein: 150, kcal: 2700 }, ...Array(6).fill({ protein: 0, kcal: 0 })], 1), goals: { protein: 150, kcal: 2700 }, weight: null })!
    expect(r.lines[2]).toBe('Weight: not enough weigh-ins this week')
    expect(r.tip).toMatch(/Log protein on more days/)
  })
})
