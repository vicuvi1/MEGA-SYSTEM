// The coach talks (core/coachTalk.ts): the evening check-in, the nudges and
// their one daily cap, the chat's hard rules, the missed-session fast path and
// proposals. Made-up data only; times are given as minutes (no real clock).
import { describe, expect, it } from 'vitest'
import {
  NUDGE_CAP,
  applyFood,
  applyMove,
  capAllows,
  checkinLines,
  checkinReply,
  checkinWindow,
  ckKeyboard,
  coachKey,
  coachNote,
  decideCoachNudge,
  guardReply,
  isCoachAsk,
  langOf,
  missedAnswer,
  missedAsk,
  parseCheckinAi,
  proposalText,
  proteinFoods,
  readCkTap,
  readProposal,
  reservedFor,
  sleepChoices,
  type CheckinFacts,
  type CoachNudgeIn
} from './coachTalk'
import { redFlag } from './coachSafety'
import { cleanPushLog, pushTelegram, type PushLog } from './benPushes'
import { dayTotals, seedSaved } from './foodSaved'
import { telegramKeyboard, readButtons, readDo } from './coachButtons'
import type { TrainWeek } from './trainWeek'

const DAY = '2030-03-12' // a Tuesday
const facts = (o: Partial<CheckinFacts> = {}): CheckinFacts => ({
  date: DAY,
  kcal: 2450,
  kcalGoal: 2700,
  protein: 128,
  proteinGoal: 130,
  training: 'done',
  session: 'Upper body',
  weighed: true,
  weight: 61.4,
  sleepH: 7.5,
  low: false,
  tomorrow: { kind: 'session', title: 'Legs + core' },
  bed: '00:00',
  lang: 'en',
  ...o
})
const nums = (s: string) => (s.replace(/(\d),(\d{3})/g, '$1$2').match(/\d+(\.\d+)?/g) ?? []).map(Number)

describe('evening check-in', () => {
  it('auto-fills food vs goal, the workout, the weigh-in and last night’s sleep from the logs', () => {
    expect(checkinLines(facts())).toEqual(['Food: 2,450 / 2,700 kcal · 128 / 130 g protein', 'Workout: Upper body ✓', 'Weigh-in: 61.4 kg ✓', 'Sleep last night: 7.5 h (from your log)'])
    expect(checkinLines(facts({ training: 'missed', weighed: false, weight: null, sleepH: null }))).toEqual(['Food: 2,450 / 2,700 kcal · 128 / 130 g protein', 'Workout: Upper body not done', 'Weigh-in: not today'])
    expect(checkinLines(facts({ training: 'rest', session: null, lang: 'ro' }))[1]).toBe('Antrenament: zi de pauză')
    expect(sleepChoices(7.5)).toEqual([6, 7, 7.5, 8, 9])
    expect(sleepChoices(null)).toEqual([6, 7, 8, 9])
  })

  it('replies with what went well + one thing for tomorrow, numbers only from the data', () => {
    const r = checkinReply(facts(), { energy: 4, soreness: 2, sleep: 7.5 })
    expect(r.good).toBe('You did Upper body today, nice work.')
    expect(r.next).toBe("Tomorrow's Legs + core: beat last time by one rep.")
    // Food short: an add-on toward the goal, never a number under the floor.
    const short = checkinReply(facts({ training: 'missed', kcal: 1700, protein: 70 }), { energy: 3, soreness: 2, sleep: 8 })
    expect(short.next).toMatch(/^Tomorrow, add .+ to reach 2,700 kcal\.$/)
    for (const n of nums(short.text)) expect(n < 800 || n >= 2200 || [1700, 70].includes(n) || n <= 130).toBe(true)
    // Low intake on 3+ days: the gentle note with easy add-ons.
    const low = checkinReply(facts({ low: true, kcal: 1500 }), { energy: 3, soreness: 2, sleep: 8 })
    expect(low.next).toMatch(/^Tomorrow, add .+ to your meals: a little at a time\.$/)
    // Tired: sleep first. Very sore before a session: easy pace.
    expect(checkinReply(facts(), { energy: 2, soreness: 2, sleep: 6 }).next).toBe('Tonight, lights out by 00:00: sleep is part of the training.')
    expect(checkinReply(facts(), { energy: 4, soreness: 5, sleep: 8 }).next).toMatch(/easy pace/)
    // Romanian.
    expect(checkinReply(facts({ lang: 'ro' }), { energy: 4, soreness: 2, sleep: 8 }).text).toMatch(/^Ai făcut Upper body azi, bravo\. Mâine/)
  })

  it('the AI only rephrases: a new number, a third sentence or an unsafe sentence → the rule text', () => {
    const r = checkinReply(facts(), { energy: 4, soreness: 2, sleep: 7.5 })
    expect(parseCheckinAi('{"reply":"Great job on Upper body today. Tomorrow, beat last time by one rep on Legs + core."}', r)).toMatch(/^Great job/)
    expect(parseCheckinAi('{"reply":"Great job today. Eat 3,100 kcal tomorrow."}', r)).toBeNull()
    expect(parseCheckinAi('{"reply":"Nice. Good. Also more."}', r)).toBeNull()
    expect(parseCheckinAi('{"reply":"Nice work. Try fat burners tomorrow."}', r)).toBeNull()
    expect(parseCheckinAi('not json at all {', r)).toBeNull()
    expect(parseCheckinAi(null, r)).toBeNull()
  })

  it('Telegram taps: energy → soreness → sleep, each step’s buttons fit in 64 bytes', () => {
    expect(readCkTap('ck|e|4')).toEqual({ step: 'e', energy: 4 })
    expect(readCkTap('ck|s|42')).toEqual({ step: 's', energy: 4, soreness: 2 })
    expect(readCkTap('ck|h|42|15')).toEqual({ step: 'h', energy: 4, soreness: 2, sleep: 7.5 })
    expect(readCkTap('ck|h|42|x')).toEqual({ step: 'h', energy: 4, soreness: 2, sleep: null })
    for (const bad of ['ck|e|9', 'ck|s|4', 'ck|h|42', 'ck|x|1', 'ck|e|4|3']) expect(readCkTap(bad)).toBeNull()
    const kb = ckKeyboard({ step: 's', energy: 4, soreness: 2 }, 7.5, 'en')
    expect(kb.inline_keyboard[0].map((b) => b.text)).toEqual(['6 h', '7 h', '✓ 7.5 h', '8 h', '9 h'])
    for (const row of kb.inline_keyboard) for (const b of row) expect(b.callback_data.length).toBeLessThanOrEqual(64)
  })
})

// ---------- nudges ----------

const log = (keys: string[] = [], day = DAY): PushLog => cleanPushLog({ day, recs: Object.fromEntries(keys.map((k) => [k, { at: 1, via: 'telegram' }])), outbox: [] }, day)
const nudge = (o: Partial<CoachNudgeIn> = {}): CoachNudgeIn => ({
  minute: 7 * 60 + 10,
  day: DAY,
  prefs: { morning: true, protein: true, checkin: true },
  log: log(),
  checkinDone: false,
  protein: 20,
  proteinGoal: 130,
  bed: '00:00',
  here: false,
  meeting: false,
  quiet: false,
  wake: '07:00',
  training: { kind: 'session', title: 'Upper body' },
  snack: 'Banana + a glass of milk',
  wait: 'Wait 20–30 min',
  proteinFoods: ['Brânză de vaci 5%', 'Kefir or milk 2.5%'],
  checkinLines: ['Food: 1,900 / 2,700 kcal · 90 / 130 g protein'],
  lang: 'en',
  ...o
})

describe('gentle nudges', () => {
  it('morning at the wake time: today’s training and the snack before it', () => {
    const p = decideCoachNudge(nudge())!
    expect(p.key).toBe(coachKey('morning', DAY))
    expect(p.text).toBe('Upper body today 💪 Banana + a glass of milk first, then wait 20–30 min.')
    expect(decideCoachNudge(nudge({ minute: 6 * 60 + 50 }))).toBeNull() // before waking
    expect(decideCoachNudge(nudge({ minute: 9 * 60 + 10 }))).toBeNull() // window over
    expect(decideCoachNudge(nudge({ training: { kind: 'rest', title: 'Rest' } }))!.text).toBe('Rest day today: eat every meal and walk 20 min.')
    expect(decideCoachNudge(nudge({ training: { kind: 'done', title: 'Done' } }))).toBeNull()
    expect(decideCoachNudge(nudge({ log: log([coachKey('morning', DAY)]) }))).toBeNull() // one key a day
  })

  it('midday protein under 40% from 14:00, with his own saved foods', () => {
    const p = decideCoachNudge(nudge({ minute: 14 * 60 + 5, protein: 40 }))!
    expect(p.key).toBe(coachKey('protein', DAY))
    expect(p.text).toBe("Protein's behind (40 / 130 g): Brânză de vaci 5% or Kefir or milk 2.5% with your next meal.")
    expect(decideCoachNudge(nudge({ minute: 14 * 60 + 5, protein: 60 }))).toBeNull() // 46%: fine
    expect(decideCoachNudge(nudge({ minute: 13 * 60 + 50, protein: 10 }))).toBeNull() // before 14:00
    expect(proteinFoods(seedSaved())).toEqual(['Brânză de vaci 5%', 'Kefir or milk 2.5%'])
  })

  it('evening check-in ~21:00: Telegram gets the energy taps, the island opens Today’s card', () => {
    const tg = decideCoachNudge(nudge({ minute: 21 * 60 + 2, protein: 120 }))!
    expect(tg.key).toBe(coachKey('checkin', DAY))
    expect(tg.text).toMatch(/^Food: 1,900 \/ 2,700 kcal/)
    const kb = pushTelegram(tg).keyboard.inline_keyboard
    expect(kb[0].map((b) => b.callback_data)).toEqual(['ck|e|1', 'ck|e|2', 'ck|e|3', 'ck|e|4', 'ck|e|5'])
    const isl = decideCoachNudge(nudge({ minute: 21 * 60 + 2, protein: 120, here: true }))!
    expect(isl.channel).toBe('island')
    expect(isl.buttons.map((b) => b.arg ?? b.op)).toEqual(['open', 'skip'])
    expect(decideCoachNudge(nudge({ minute: 21 * 60 + 2, checkinDone: true, protein: 120 }))).toBeNull()
    expect(checkinWindow('22:00')).toEqual([20 * 60 + 30, 21 * 60 + 50]) // an early bed moves it
  })

  it('never in a meeting or quiet hours; each type has its own switch', () => {
    expect(decideCoachNudge(nudge({ meeting: true }))).toBeNull()
    expect(decideCoachNudge(nudge({ quiet: true }))).toBeNull()
    expect(decideCoachNudge(nudge({ prefs: { morning: false, protein: true, checkin: true } }))).toBeNull()
    expect(decideCoachNudge(nudge({ minute: 14 * 60 + 5, protein: 10, prefs: { morning: true, protein: false, checkin: true } }))).toBeNull()
    expect(decideCoachNudge(nudge({ minute: 21 * 60 + 5, protein: 120, prefs: { morning: true, protein: true, checkin: false } }))).toBeNull()
  })

  it('one cap of 3 a day with meal reminders and food pushes; check-in > protein > morning > food', () => {
    expect(NUDGE_CAP).toBe(3)
    // Two meal reminders went out: the morning nudge would take the place the check-in keeps.
    const s = nudge({ log: log([`meal:${DAY}:morning`, `meal:${DAY}:lunch`]) })
    expect(decideCoachNudge(s)).toBeNull()
    expect(reservedFor(2, s)).toBe(1)
    // With the check-in off, the morning nudge fits.
    expect(decideCoachNudge({ ...s, prefs: { morning: true, protein: true, checkin: false } })).not.toBeNull()
    // Food is last: at 13:00 with protein behind, protein and the check-in keep their places.
    const lunch = nudge({ minute: 13 * 60, protein: 20, log: log([coachKey('morning', DAY)]) })
    expect(capAllows('food', lunch)).toBe(false)
    expect(capAllows('food', { ...lunch, protein: 80 })).toBe(true) // protein fine: only the check-in is kept
    // The check-in still goes as the 3rd.
    expect(decideCoachNudge(nudge({ minute: 21 * 60 + 5, protein: 120, log: log([coachKey('morning', DAY), `meal:${DAY}:lunch`]) }))?.key).toBe(coachKey('checkin', DAY))
    // Never a 4th.
    expect(decideCoachNudge(nudge({ minute: 21 * 60 + 5, protein: 120, log: log([coachKey('morning', DAY), `meal:${DAY}:lunch`, `food:dinner:${DAY}`]) }))).toBeNull()
  })
})

// ---------- the chat ----------

describe('Ask the coach: hard rules', () => {
  it('red-flag words → only the doctor line, no exercise advice (EN and RO)', () => {
    const en = redFlag('I got dizzy and had chest pain during push-ups, should I do fewer reps?')
    expect(en.hit).toBe(true)
    expect(en.reply).toMatch(/Stop training .* see a doctor/)
    expect(en.reply).not.toMatch(/\b(reps?|sets?|push-?ups?|squats?|warm-?up)\b/i)
    const said = 'Am amețeală și durere în piept după antrenament'
    const ro = redFlag(said, langOf(said))
    expect(ro.hit).toBe(true)
    expect(ro.reply).toMatch(/Oprește antrenamentul azi și mergi la medic/)
    expect(redFlag('no dizziness, just normal soreness').hit).toBe(false)
  })

  it('guards the model’s reply: under 2,200, a cut while not rising, fat burners and pills go', () => {
    const g = guardReply('Good question. Eat 1,800 kcal a day to stay lean. Try a cut and eat less this week. Fat burners speed it up. Have 3 eggs at breakfast.', { rising: false })
    expect(g.text).toBe('Good question. Have 3 eggs at breakfast.')
    expect(g.dropped).toHaveLength(3)
    expect(guardReply('A small deficit is fine now.', { rising: false }).text).toBe('')
    expect(guardReply('Creatine 3–5 g a day is optional; no pills needed beyond that.', { rising: false }).text).toMatch(/Creatine/)
  })

  it('knows a coach question and the language', () => {
    expect(isCoachAsk('what should I eat before my workout?')).toBe(true)
    expect(isCoachAsk('ce sa mananc dupa antrenament?')).toBe(true)
    expect(isCoachAsk('move my lab to 15:00')).toBe(false)
    expect(langOf('ce să mănânc azi?')).toBe('ro')
    expect(langOf('am ratat antrenamentul de marti, ce fac?')).toBe('ro')
    expect(langOf('I missed Tuesday, what now?')).toBe('en')
    const note = coachNote({ context: 'Today: Upper body 30 min; food 2700 kcal.', saved: seedSaved(), rising: false })
    expect(note).toMatch(/Never suggest under 2,200 kcal/)
    expect(note).toMatch(/NOT rising: no cuts/)
    expect(note).toMatch(/Saved foods: Egg \(1 large, 72 kcal, 6 g\)/)
    expect(note.length).toBeLessThan(2600) // short prompt
  })
})

const week = (days: TrainWeek['days']): TrainWeek => ({ v: 1, days, updatedAt: 1 })
describe('fast path: a missed session', () => {
  const w = week(['rest', 'upper', 'legs', 'rest', 'upper', 'legs', 'rest'])
  it('"I missed Tuesday, what now?" from the week and the log, EN and RO', () => {
    expect(missedAsk('I missed Tuesday, what now?')).toBe(1)
    expect(missedAsk('skipped my workout yesterday')).toBe('any')
    expect(missedAsk('am ratat antrenamentul de marti')).toBe(1)
    expect(missedAsk('I missed the bus')).toBeNull()
    // Thursday (a rest day), Tuesday's Upper missed, Monday's... the last session was the Saturday before.
    const r = missedAnswer({ week: w, done: [{ date: '2030-03-09', type: 'legs' }], today: '2030-03-14', day: 1, lang: 'en' })
    expect(r.reply).toMatch(/fits today: those muscles have had 48 hours/)
    // A planned session today: no doubling up.
    const r2 = missedAnswer({ week: w, done: [{ date: '2030-03-09', type: 'legs' }], today: '2030-03-15', day: 1, lang: 'en' })
    expect(r2.reply).toMatch(/^No need to double up: do today's Upper body as planned/)
    const ro = missedAnswer({ week: w, done: [{ date: '2030-03-09', type: 'legs' }], today: '2030-03-15', day: 1, lang: 'ro' })
    expect(ro.reply).toMatch(/^Nu dubla/)
  })
})

describe('proposals', () => {
  const saved = seedSaved()
  const ctx = { saved, week: week(['rest', 'upper', 'legs', 'upper', 'rest', 'legs', 'upper']), rising: false }
  it('reads a swap, a meal, a move and a ramp against his data; made-up foods are refused', () => {
    expect(readProposal({ kind: 'swap', slot: 'Morning', from: 'Rye bread', to: 'banana' }, ctx)).toEqual({ kind: 'swap', slotId: 'ds-morning', fromId: 'sf-bread', toId: 'sf-banana' })
    expect(readProposal({ kind: 'meal', slot: 'lunch', foods: ['3 Egg', 'Rye bread', 'Bulgur salad with vegetables'] }, ctx)).toEqual({ kind: 'meal', slotId: 'ds-lunch', items: [{ foodId: 'sf-egg', qty: 3 }, { foodId: 'sf-bread', qty: 1 }, { foodId: 'sf-bulgur', qty: 1 }] })
    expect(readProposal({ kind: 'move', from: 'Tuesday', to: 'Friday' }, ctx)).toEqual({ kind: 'move', from: 1, to: 4 })
    expect(readProposal({ kind: 'move', from: 'Monday', to: 'Friday' }, ctx)).toBeNull() // Monday is a rest day
    expect(readProposal({ kind: 'ramp', baseline: 1620 }, ctx)).toEqual({ kind: 'ramp', baseline: 1600 })
    expect(readProposal({ kind: 'swap', slot: 'Lunch', from: 'bulgur', to: 'Pizza' }, ctx)).toBeNull()
    expect(readProposal({ kind: 'fatburner' }, ctx)).toBeNull()
  })

  it('never a food change that lowers the day while the weight is not rising', () => {
    // Bulgur (400) → buckwheat (280): the day goes down.
    expect(readProposal({ kind: 'swap', slot: 'Lunch', from: 'bulgur', to: 'Buckwheat' }, ctx)).toBeNull()
    expect(readProposal({ kind: 'swap', slot: 'Lunch', from: 'bulgur', to: 'Buckwheat' }, { ...ctx, rising: true })).not.toBeNull()
    // A meal of one coffee would take the day under 2,200 even while rising.
    expect(readProposal({ kind: 'meal', slot: 'Morning', foods: ['Coffee, black'] }, { ...ctx, rising: true })).toBeNull()
  })

  it('applies through the standard day and the week; text and buttons', () => {
    const p = readProposal({ kind: 'swap', slot: 'Morning', from: 'Rye bread', to: 'Banana' }, ctx)!
    const next = applyFood(saved, p as any)
    expect(next.day.slots.find((s) => s.id === 'ds-morning')!.items[1]).toEqual({ foodId: 'sf-banana', qty: 2 })
    expect(dayTotals(next).kcal).toBeGreaterThan(dayTotals(saved).kcal)
    expect(saved.day.slots.find((s) => s.id === 'ds-morning')!.items[1].foodId).toBe('sf-bread') // untouched
    expect(proposalText(p, saved)).toBe('Morning: Banana instead of Rye bread')
    const m = applyMove(ctx.week, { kind: 'move', from: 1, to: 4 })
    // Tuesday's Upper goes to Friday; Thursday's Upper would come the day before it, so the 48-hour rule rests Thursday.
    expect(m.days).toEqual(['rest', 'rest', 'legs', 'rest', 'upper', 'legs', 'upper'])
    expect(m.note).toMatch(/Thursday is now a rest day/)
    // The buttons come only from code: the model can't make an Apply button.
    expect(readButtons([{ label: 'Apply', do: 'coach:apply:cpabc' }])).toEqual([])
    expect(readDo('coach:apply:cpabc')).toEqual({ k: 'coach', op: 'apply', id: 'cpabc' })
    expect(telegramKeyboard([{ label: '✅ Apply', do: 'coach:apply:cpabc' }, { label: 'Not now', do: 'coach:skip:cpabc' }])!.inline_keyboard.map((r) => r[0].callback_data)).toEqual(['cp|a|cpabc', 'cp|n|cpabc'])
  })
})
