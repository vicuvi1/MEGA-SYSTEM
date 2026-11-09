// Meal photos on Telegram and meal reminders (core/foodBen.ts), made-up data, pinned clocks.
import { describe, expect, it } from 'vitest'
import {
  cleanFoodBen,
  decideFoodNudge,
  decideMealReminder,
  mealDue,
  mealKindOf,
  mealKindOfKey,
  mealTimes,
  photoDraft,
  photoDraftKeyboard,
  photoDraftText,
  photoIsMeal,
  pickPhotoSize,
  readPhotoEdit,
  setPhotoQty,
  stepPhoto,
  swapChoices,
  swapKeyboard,
  swapPhoto,
  type MealReminderIn,
  type MealSlotIn
} from './foodBen'
import { answerPush, claim, cleanPushLog, cleanPushPrefs, pushTelegram, type PushLog } from './benPushes'
import { fromSaved, validateVision, type SavedFoodRef } from './foodVision'

const SAVED: SavedFoodRef[] = [
  { id: 'sf-egg', name: 'Egg', portion: '1 large (50 g)', kcal: 72, protein: 6.3, carbs: 0.4, fat: 4.8 },
  { id: 'sf-bread', name: 'Rye bread', portion: '1 slice (33 g)', kcal: 80, protein: 2.7, carbs: 15, fat: 1 },
  { id: 'sf-buckwheat', name: 'Buckwheat, cooked', portion: '1 container (300 g)', kcal: 280, protein: 10, carbs: 60, fat: 2 }
]
const AI = {
  items: [
    { name: 'eggs', matchedSavedFoodId: 'sf-egg', qty: 3, unit: 'eggs', grams: 150, kcal: 999, protein: 99, confidence: 'high' },
    { name: 'bread', matchedSavedFoodId: 'sf-bread', qty: 2, unit: 'slices', grams: 66, kcal: 1, protein: 1, confidence: 'medium' },
    { name: 'sauce', matchedSavedFoodId: null, qty: 1, unit: 'serving', grams: 30, kcal: 90, protein: 0, carbs: 3, fat: 9, confidence: 'low' }
  ],
  totals: { kcal: 1, protein: 1 },
  message: 'A good breakfast.'
}
const check = validateVision(AI, SAVED)
if (!check.ok) throw new Error('fixture')
const D = photoDraft('ph1', Date.parse('2030-03-12T08:00:00'), check.result.items, check.result.message)

describe('a meal photo', () => {
  it('picks the largest Telegram size up to 1280 px and 1 MB (no resizing)', () => {
    const sizes = [
      { file_id: 'a', width: 90, height: 67, file_size: 1500 },
      { file_id: 'b', width: 320, height: 240, file_size: 20000 },
      { file_id: 'c', width: 1280, height: 960, file_size: 180000 },
      { file_id: 'd', width: 2560, height: 1920, file_size: 900000 }
    ]
    expect(pickPhotoSize(sizes)?.file_id).toBe('c')
    expect(pickPhotoSize([{ file_id: 'big', width: 1280, height: 960, file_size: 2_000_000 }, { file_id: 'small', width: 800, height: 600, file_size: 90000 }])?.file_id).toBe('small')
    expect(pickPhotoSize([{ file_id: 'huge', width: 4000, height: 3000 }])?.file_id).toBe('huge')
    expect(pickPhotoSize([])).toBeNull()
  })

  it('a caption with a question (or "Ben …") goes to the coach, a note goes to the food log', () => {
    expect(photoIsMeal('')).toBe(true)
    expect(photoIsMeal('2 containers, one buckwheat')).toBe(true)
    expect(photoIsMeal('is this healthy?')).toBe(false)
    expect(photoIsMeal('Ben, look at my desk')).toBe(false)
  })

  it('previews how many, kcal and protein per food (saved numbers win), marks low confidence, buttons fit in 64 bytes', () => {
    const t = photoDraftText(D)
    expect(t).toMatch(/1\. Egg · 3 eggs · 150 g · 216 kcal · 19 g protein/)
    expect(t).toMatch(/2\. Rye bread · 2 slices · 66 g · 160 kcal · 5 g protein/)
    expect(t).toMatch(/3\. Sauce · 30 g · 90 kcal · 0 g protein\n {3}⚠️ not sure, check the portion/)
    expect(t).toMatch(/Total: ~466 kcal · 24 g protein/)
    expect(t).toMatch(/A good breakfast\./)
    const k = photoDraftKeyboard(D).inline_keyboard
    expect(k[0].map((b) => b.callback_data)).toEqual(['fd|-|ph1|0', 'fd|+|ph1|0', 'fd|w|ph1|0'])
    expect(k[k.length - 1].map((b) => b.callback_data)).toEqual(['fd|s|ph1', 'fd|x|ph1'])
    for (const row of k) for (const b of row) expect(b.callback_data.length).toBeLessThanOrEqual(64)
    expect(D.items.map((i) => i.kcal)).toEqual([216, 160, 90])
  })

  it('−/+ change how many (saved numbers × qty); "eggs 2" sets how many, "sauce 60" grams', () => {
    const up = stepPhoto(D, 0, 1, SAVED)
    expect(up.photo!.now[0]).toMatchObject({ qty: 4, kcal: 288, grams: 200 })
    expect(up.items[0].kcal).toBe(288)
    const down = stepPhoto(D, 1, -1, SAVED)
    expect(down.photo!.now[1]).toMatchObject({ qty: 1, kcal: 80 })
    expect(readPhotoEdit('eggs 2', D)).toEqual({ index: 0, qty: 2 })
    expect(readPhotoEdit('type: bread 1', D)).toEqual({ index: 1, qty: 1 })
    expect(readPhotoEdit('sauce 60', D)).toEqual({ index: 2, grams: 60 })
    expect(readPhotoEdit('3 15 g', D)).toEqual({ index: 2, grams: 15 })
    expect(readPhotoEdit('pizza 2', D)).toBeNull()
    expect(setPhotoQty(D, 0, 2, SAVED).photo!.now[0]).toMatchObject({ qty: 2, kcal: 144 })
  })

  it('swap: the closest saved foods first; the swapped food takes the saved numbers', () => {
    expect(swapChoices({ name: 'buckwheat with sauce' }, SAVED)[0].ref.id).toBe('sf-buckwheat')
    const k = swapKeyboard(D, 2, SAVED).inline_keyboard
    expect(k[k.length - 1][0].callback_data).toBe('fd|b|ph1')
    expect(k[0][0].callback_data).toMatch(/^fd\|W\|ph1\|2\|\d$/)
    const s = swapPhoto(D, 2, fromSaved(SAVED[2], 1))
    expect(s.photo!.now[2]).toMatchObject({ name: 'Buckwheat, cooked', kcal: 280, matchedSavedFoodId: 'sf-buckwheat' })
    expect(stepPhoto(s, 2, 1, SAVED).photo!.now[2].kcal).toBe(560)
  })

  it('a photo draft survives the synced setting; junk is dropped', () => {
    const back = cleanFoodBen(JSON.parse(JSON.stringify({ draft: D, muteUntil: null, undo: { id: 'u1', ids: ['fd-a1', 'nope'], at: 1 } })))
    expect(back.draft!.photo!.now).toHaveLength(3)
    expect(back.undo).toEqual({ id: 'u1', ids: ['fd-a1'], at: 1 })
    expect(cleanFoodBen({ draft: { ...D, photo: { base: [], now: 'x' } } }).draft!.photo).toBeUndefined()
  })
})

const LOG: PushLog = cleanPushLog(null, '2030-03-12')
const SLOTS: MealSlotIn[] = [
  { kind: 'morning', label: 'Morning', items: '3 × Egg + 2 × Rye bread', alt: null, logged: false },
  { kind: 'lunch', label: 'Lunch', items: 'Bulgur salad + Rye bread', alt: null, logged: false },
  { kind: 'afternoon', label: 'Afternoon', items: '3 × Egg + Banana', alt: null, logged: false },
  { kind: 'evening', label: 'Evening', items: 'Bulgur salad + Banana', alt: 'Buckwheat + 2 × Egg', logged: false }
]
const mr = (o: Partial<MealReminderIn> = {}): MealReminderIn => ({ now: new Date('2030-03-12T13:05:00'), day: '2030-03-12', on: true, wake: '07:00', bed: '23:30', slots: SLOTS, lastLogAt: Date.parse('2030-03-12T08:00:00'), log: LOG, here: false, meeting: false, quiet: false, muted: false, ...o })

describe('meal reminders', () => {
  it('slot kinds from the standard day; times from the wake time', () => {
    expect(mealKindOf({ label: 'Afternoon', slot: 'snack' })).toBe('afternoon')
    expect(mealKindOf({ label: 'Anytime', slot: 'snack' })).toBeNull()
    expect(mealKindOf({ label: 'Big meal', slot: 'dinner' })).toBe('evening')
    expect(mealTimes('07:00')).toEqual({ morning: 465, lunch: 780, afternoon: 990, evening: 1170 })
    expect(mealTimes(null).morning).toBe(510)
    expect(mealKindOfKey('meal:2030-03-12:lunch:again')).toBe('lunch')
  })

  it('at the slot time, when nothing was logged since the slot before: one gentle nudge with Log it / 30 min / Skip', () => {
    const p = decideMealReminder(mr())!
    expect(p.key).toBe('meal:2030-03-12:lunch')
    expect(p.text).toBe('Lunch time: log your bulgur salad + Rye bread?')
    expect(p.buttons.map((b) => b.op)).toEqual(['log', 'later', 'skip'])
    expect(p.channel).toBe('telegram')
    const tg = pushTelegram(p)
    expect(tg.keyboard.inline_keyboard[0].map((b) => b.callback_data)).toEqual(['fd|l|meal:2030-03-12:lunch|0', 'fd|z|meal:2030-03-12:lunch', 'fd|k|meal:2030-03-12:lunch'])
    // The evening one offers the swap too.
    const e = decideMealReminder(mr({ now: new Date('2030-03-12T19:40:00'), lastLogAt: Date.parse('2030-03-12T13:10:00') }))!
    expect(e.key).toBe('meal:2030-03-12:evening')
    expect(pushTelegram(e).keyboard.inline_keyboard[0][1].callback_data).toBe('fd|l|meal:2030-03-12:evening|1')
    expect(decideMealReminder(mr({ here: true }))!.channel).toBe('island')
  })

  it('not before the slot, not after its window, not when something was logged since the slot before or as this slot', () => {
    expect(decideMealReminder(mr({ now: new Date('2030-03-12T12:55:00') }))).toBeNull()
    expect(decideMealReminder(mr({ now: new Date('2030-03-12T14:31:00') }))).toBeNull()
    expect(decideMealReminder(mr({ lastLogAt: Date.parse('2030-03-12T12:40:00') }))).toBeNull()
    expect(decideMealReminder(mr({ slots: SLOTS.map((s) => (s.kind === 'lunch' ? { ...s, logged: true } : s)) }))).toBeNull()
    // The first slot counts from 04:00.
    expect(decideMealReminder(mr({ now: new Date('2030-03-12T07:50:00'), lastLogAt: null }))!.key).toBe('meal:2030-03-12:morning')
    expect(decideMealReminder(mr({ now: new Date('2030-03-12T07:50:00'), lastLogAt: Date.parse('2030-03-12T07:30:00') }))).toBeNull()
  })

  it('once per slot, 3 a day, never in a meeting, quiet hours, after bed, while muted or switched off', () => {
    const shown = claim(LOG, 'meal:2030-03-12:lunch', 'telegram', 1).log
    expect(decideMealReminder(mr({ log: shown }))).toBeNull()
    let three = LOG
    for (const k of ['morning', 'lunch', 'afternoon']) three = claim(three, `meal:2030-03-12:${k}`, 'telegram', 1).log
    expect(decideMealReminder(mr({ now: new Date('2030-03-12T19:40:00'), lastLogAt: null, log: three }))).toBeNull()
    expect(decideMealReminder(mr({ meeting: true }))).toBeNull()
    expect(decideMealReminder(mr({ quiet: true }))).toBeNull()
    expect(decideMealReminder(mr({ muted: true }))).toBeNull()
    expect(decideMealReminder(mr({ on: false }))).toBeNull()
    expect(decideMealReminder(mr({ bed: '20:00', now: new Date('2030-03-12T19:40:00'), lastLogAt: null }))).toBeNull()
    expect(cleanPushPrefs({}).meals).toBe(true)
    expect(cleanPushPrefs({ meals: false }).meals).toBe(false)
  })

  it('30 min later: asked once more when the time is up (unless you logged since), then never again', () => {
    const t0 = Date.parse('2030-03-12T13:05:00')
    const snoozed = answerPush(claim(LOG, 'meal:2030-03-12:lunch', 'telegram', t0).log, 'meal:2030-03-12:lunch', 'later', t0, 30)
    expect(decideMealReminder(mr({ now: new Date('2030-03-12T13:20:00'), log: snoozed }))).toBeNull()
    const again = decideMealReminder(mr({ now: new Date('2030-03-12T13:36:00'), log: snoozed }))!
    expect(again.key).toBe('meal:2030-03-12:lunch:again')
    expect(again.text).toMatch(/^Still time to log lunch/)
    expect(again.buttons.map((b) => b.op)).toEqual(['log', 'skip'])
    expect(decideMealReminder(mr({ now: new Date('2030-03-12T13:36:00'), log: snoozed, lastLogAt: Date.parse('2030-03-12T13:30:00') }))).toBeNull()
    const done = claim(snoozed, 'meal:2030-03-12:lunch:again', 'telegram', t0).log
    expect(decideMealReminder(mr({ now: new Date('2030-03-12T13:40:00'), log: done }))).toBeNull()
    expect(mealDue(new Date('2030-03-12T15:00:00'), '07:00', snoozed)).toBe(true)
    expect(mealDue(new Date('2030-03-12T15:00:00'), '07:00', LOG)).toBe(false)
  })

  it('after the evening meal reminder, the dinner reminder does not ask again', () => {
    const asked = claim(LOG, 'meal:2030-03-12:evening', 'telegram', 1).log
    const base = { now: new Date('2030-03-12T21:05:00'), day: '2030-03-12', bed: '23:30', protein: 40, proteinGoal: 150, loggedToday: true, lateMeal: false, yesterday: false, next: { line: '', ideas: [] }, here: false, meeting: false, quiet: false, muted: false }
    expect(decideFoodNudge({ ...base, log: LOG })?.key).toBe('food:dinner:2030-03-12')
    expect(decideFoodNudge({ ...base, log: asked })).toBeNull()
  })
})
