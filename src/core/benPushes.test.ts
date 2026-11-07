// Ben 2's pushes (made-up blocks and times only): push levels per area and the
// move from the old single level, the one dedupe key across the island and
// Telegram, the channel choice, quiet hours, the check-in and its follow-up,
// the morning brief, the evening shutdown, drift to Telegram and the weekly card.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  answerPush,
  areaOf,
  areaOfTitle,
  briefKey,
  channelFor,
  checkinKey,
  claim,
  cleanAreas,
  cleanPcSeen,
  cleanPushLog,
  cleanPushPrefs,
  decideBrief,
  decideCheckin,
  decideShutdown,
  driftToTelegram,
  inQuiet,
  isOffDay,
  levelFromPush,
  markItem,
  minutesUntil,
  outboxAdd,
  outboxTake,
  pcHere,
  pcSeenNext,
  pushCallback,
  pushCardOf,
  pushTelegram,
  readPushCallback,
  shutdownKey,
  toCard,
  weeklyCard,
  weeklyCardText,
  type AreaLevels,
  type CheckinBlock,
  type PushLog
} from './benPushes'
import { cleanLifeFit } from './lifeFit'

const day = '2030-03-12' // a Tuesday
const at = (hm: string, d = day) => new Date(`${d}T${hm}:00`).getTime()
const all = (l: 'soft' | 'normal' | 'hard'): AreaLevels => ({ study: l, work: l, body: l, sleep: l, chores: l, money: l })
const empty = (): PushLog => cleanPushLog(null, day)
const lab: CheckinBlock = { id: 'ev1', title: 'Lab 4', start: at('16:00'), end: at('17:30'), focus: true }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(at('12:00'))
})
afterEach(() => vi.useRealTimers())

describe('push levels per area', () => {
  it('start from the old single push level for every area', () => {
    expect(levelFromPush('gentle')).toBe('soft')
    expect(levelFromPush('firm')).toBe('normal')
    expect(levelFromPush('push')).toBe('hard')
    expect(cleanAreas(null, 'firm')).toEqual(all('normal'))
    // An area set by itself keeps its level; junk falls back.
    expect(cleanAreas({ body: 'soft', money: 'loud' }, 'push')).toEqual({ ...all('hard'), body: 'soft' })
  })

  it('are migrated in My life: an old save gets every area at its push level', () => {
    const fit = cleanLifeFit({ push: 'gentle' })
    expect(fit.areas).toEqual(all('soft'))
    expect(fit.pushes?.shutdownBefore).toBe(30)
    expect(cleanLifeFit({ push: 'push', areas: { sleep: 'soft' } }).areas?.sleep).toBe('soft')
  })

  it('map each nudge to an area (blocks by their name)', () => {
    expect(areaOf('water')).toBe('body')
    expect(areaOf('shutdown')).toBe('sleep')
    expect(areaOf('money')).toBe('money')
    expect(areaOfTitle('English essay')).toBe('study')
    expect(areaOfTitle('Evening shift')).toBe('work')
    expect(areaOfTitle('Gym: legs')).toBe('body')
    expect(areaOfTitle('Laundry and dishes')).toBe('chores')
    expect(areaOf('checkin', 'Pay the bills')).toBe('money')
  })
})

describe('where you are and the one channel', () => {
  it('island while you use the PC, Telegram when idle, locked or off', () => {
    const now = at('16:00')
    expect(channelFor(pcHere({ at: now - 60_000, active: true }, now))).toBe('island')
    expect(channelFor(pcHere({ at: now - 60_000, active: false }, now))).toBe('telegram')
    // The PC went quiet (asleep, off): its last word is too old.
    expect(channelFor(pcHere({ at: now - 9 * 60_000, active: true }, now))).toBe('telegram')
    expect(channelFor(pcHere(null, now))).toBe('telegram')
    expect(cleanPcSeen({ at: 'x' })).toBeNull()
  })

  it('the PC writes only when it changes, or every 5 minutes while you are here (no busy writes)', () => {
    const t = at('10:00')
    const first = pcSeenNext(null, true, t)!
    expect(first).toEqual({ at: t, active: true })
    expect(pcSeenNext(first, true, t + 60_000)).toBeNull()
    expect(pcSeenNext(first, true, t + 5 * 60_000)).toEqual({ at: t + 5 * 60_000, active: true })
    expect(pcSeenNext(first, false, t + 90_000)).toEqual({ at: t + 90_000, active: false })
    expect(pcSeenNext({ at: t, active: false }, false, t + 60 * 60_000)).toBeNull()
  })
})

describe('quiet hours and clock maths', () => {
  it('quiet hours wrap midnight', () => {
    const q = { from: '22:30', to: '07:00' }
    expect(inQuiet(at('23:00'), q)).toBe(true)
    expect(inQuiet(at('06:59'), q)).toBe(true)
    expect(inQuiet(at('07:00'), q)).toBe(false)
    expect(inQuiet(at('12:00'), { from: '12:00', to: '13:00' })).toBe(true)
    expect(inQuiet(at('12:00'), null)).toBe(false)
  })
  it('minutes until bedtime work across midnight', () => {
    expect(minutesUntil(at('23:30'), '00:00')).toBe(30)
    expect(minutesUntil(at('23:10'), '23:30')).toBe(20)
    expect(minutesUntil(at('00:10', '2030-03-13'), '23:30')).toBe(-40)
  })
})

describe('the one dedupe key', () => {
  it('a push claimed on one channel never goes out on the other', () => {
    let log = empty()
    const a = claim(log, checkinKey('ev1'), 'island', at('16:00'))
    expect(a.ok).toBe(true)
    log = a.log
    expect(claim(log, checkinKey('ev1'), 'telegram', at('16:02')).ok).toBe(false)
    // Saved and read back on another device (or the server): still claimed.
    const back = cleanPushLog(JSON.parse(JSON.stringify(log)), day)
    expect(claim(back, checkinKey('ev1'), 'telegram', at('16:03')).ok).toBe(false)
    // A new day starts clean.
    expect(cleanPushLog(log, '2030-03-13').recs).toEqual({})
  })
})

describe('PR1: check-ins when a block starts', () => {
  const input = (now: number, more: Partial<Parameters<typeof decideCheckin>[0]> = {}) => ({ now, on: true, blocks: [lab], running: false, meeting: false, quiet: false, levels: all('normal'), log: empty(), here: true, ...more })

  it('asks "ready?" at the start with Start, 10 min later and Skip', () => {
    const p = decideCheckin(input(at('16:01')))!
    expect(p.key).toBe('checkin:ev1')
    expect(p.text).toMatch(/Lab 4/)
    expect(p.buttons.map((b) => b.op)).toEqual(['start', 'later', 'skip'])
    expect(p.buttons[0]).toMatchObject({ arg: 'Lab 4', minutes: 89 })
    expect(p.channel).toBe('island')
    expect(decideCheckin(input(at('16:01'), { here: false }))!.channel).toBe('telegram')
  })

  it('stays quiet in a meeting, in quiet hours, while a timer runs, and for an event you go to', () => {
    expect(decideCheckin(input(at('16:01'), { meeting: true }))).toBeNull()
    expect(decideCheckin(input(at('16:01'), { quiet: true }))).toBeNull()
    expect(decideCheckin(input(at('16:01'), { running: true }))).toBeNull()
    expect(decideCheckin(input(at('16:01'), { blocks: [{ ...lab, focus: false }] }))).toBeNull()
    expect(decideCheckin(input(at('15:59')))).toBeNull()
  })

  it('one firmer nudge 10 minutes later if not started, then it stops', () => {
    let log = claim(empty(), checkinKey('ev1'), 'island', at('16:00')).log
    expect(decideCheckin(input(at('16:08'), { log }))).toBeNull()
    const firm = decideCheckin(input(at('16:10'), { log, here: false }))!
    expect(firm.key).toBe('checkin-firm:ev1')
    expect(firm.text).toMatch(/10 min/)
    expect(firm.channel).toBe('telegram')
    expect(firm.buttons.map((b) => b.op)).toEqual(['start', 'skip'])
    log = claim(log, firm.key, 'telegram', at('16:10')).log
    expect(decideCheckin(input(at('16:20'), { log }))).toBeNull()
    expect(decideCheckin(input(at('16:39'), { log }))).toBeNull()
  })

  it('Start or Skip end it; "10 min later" asks again then', () => {
    const asked = claim(empty(), checkinKey('ev1'), 'telegram', at('16:00')).log
    expect(decideCheckin(input(at('16:12'), { log: answerPush(asked, checkinKey('ev1'), 'skip', at('16:01')) }))).toBeNull()
    expect(decideCheckin(input(at('16:12'), { log: answerPush(asked, checkinKey('ev1'), 'start', at('16:01')) }))).toBeNull()
    const later = answerPush(asked, checkinKey('ev1'), 'later', at('16:05'))
    expect(decideCheckin(input(at('16:14'), { log: later }))).toBeNull()
    expect(decideCheckin(input(at('16:15'), { log: later }))!.key).toBe('checkin-firm:ev1')
  })

  it('follows the area level: Soft has no firm follow-up, Hard is firmer', () => {
    const log = claim(empty(), checkinKey('ev1'), 'island', at('16:00')).log
    expect(decideCheckin(input(at('16:20'), { log, levels: all('soft') }))).toBeNull()
    // Soft re-asks gently only after "10 min later".
    const soft = decideCheckin(input(at('16:16'), { log: answerPush(log, checkinKey('ev1'), 'later', at('16:05')), levels: all('soft') }))!
    expect(soft.text).toBe('Lab 4: ready now?')
    const hard = decideCheckin(input(at('16:10'), { log, levels: { ...all('soft'), study: 'hard' } }))!
    expect(hard.text).toMatch(/😤/)
    // The block's own area decides: a gym block follows Body.
    const gym = { ...lab, id: 'g', title: 'Gym session' }
    const g = claim(empty(), checkinKey('g'), 'island', at('16:00')).log
    expect(decideCheckin(input(at('16:10'), { blocks: [gym], log: g, levels: { ...all('hard'), body: 'soft' } }))).toBeNull()
  })
})

describe('PR2: drift goes to Telegram only when the island would not show it', () => {
  it('once per drift, by the same key', () => {
    const o = { alertId: 'coach:drift:1:1', title: 'Back to English essay?', text: '25 min of video during English essay. Back to it?', log: empty(), now: at('17:00') }
    expect(driftToTelegram({ ...o, islandShows: true })).toBeNull()
    const item = driftToTelegram({ ...o, islandShows: false })!
    expect(item.text).toMatch(/English essay/)
    const log = outboxAdd(empty(), item)
    expect(driftToTelegram({ ...o, log, islandShows: false })).toBeNull()
    // The server takes it once; old ones (15 min+) are dropped.
    const t = outboxTake(log, at('17:02'))
    expect(t.send).toHaveLength(1)
    expect(t.log.outbox).toEqual([])
    expect(outboxTake(log, at('17:20')).send).toHaveLength(0)
  })
})

describe('PR3: the morning brief', () => {
  const base = { day, wake: '06:30', prefs: cleanPushPrefs(null), off: false, mustDos: ['Essay intro', 'Rust chapter 4', 'Call the dentist'], firstBlock: { title: 'Lab 4', start: at('08:00') }, waterTargetMl: 2500, levels: all('normal'), log: empty(), here: false }
  it('3 lines at the wake time with "Plan my day", once', () => {
    expect(decideBrief({ ...base, now: at('06:29') })).toBeNull()
    const b = decideBrief({ ...base, now: at('06:30') })!
    expect(b.text.split('\n')).toEqual(['✅ Must-dos: Essay intro · Rust chapter 4 · Call the dentist', '▶ First block: Lab 4 at 08:00', '💧 Water goal: 2.5 L today'])
    expect(b.buttons[0]).toMatchObject({ op: 'plan', label: '🗓 Plan my day' })
    expect(b.channel).toBe('telegram')
    const log = claim(empty(), briefKey(day), 'telegram', at('06:30')).log
    expect(decideBrief({ ...base, log, now: at('06:40') })).toBeNull()
    expect(decideBrief({ ...base, now: at('08:31') })).toBeNull()
  })
  it('skips days off and sick days, and when it is switched off', () => {
    expect(isOffDay(cleanPushPrefs({ offDays: [2] }), day)).toBe(true)
    expect(isOffDay(cleanPushPrefs(null), day, 'sick')).toBe(true)
    expect(decideBrief({ ...base, now: at('06:35'), off: true })).toBeNull()
    expect(decideBrief({ ...base, now: at('06:35'), prefs: cleanPushPrefs({ brief: false }) })).toBeNull()
  })
  it('says what is missing plainly', () => {
    const b = decideBrief({ ...base, now: at('06:35'), mustDos: [], firstBlock: null })!
    expect(b.text).toMatch(/No must-dos yet: tap Plan my day/)
    expect(b.text).toMatch(/No blocks planned yet/)
  })
})

describe('PR4: the evening shutdown', () => {
  const base = { day, bed: '23:30', prefs: cleanPushPrefs(null), closed: false, bedLogged: false, done: ['Essay intro', 'Gym'], open: [{ id: 'm:Rust chapter 4', text: 'Rust chapter 4', kind: 'mustdo' as const }, { id: 't:42', text: 'Reply to the club', kind: 'todo' as const, ref: '42' }], levels: all('normal'), log: empty(), here: true }
  it('30 min before bed: done, open items with Tomorrow / Drop / Keep, and bed', () => {
    expect(decideShutdown({ ...base, now: at('22:59') })).toBeNull()
    const s = decideShutdown({ ...base, now: at('23:00') })!
    expect(s.key).toBe(shutdownKey(day))
    expect(s.text).toMatch(/Done today: Essay intro, Gym/)
    expect(s.text).toMatch(/1\. Rust chapter 4/)
    expect(s.text).toMatch(/Bed at 23:30 \(in 30 min\)/)
    expect(s.items).toHaveLength(2)
    expect(s.buttons[0].op).toBe('shutdown')
    const tg = pushTelegram({ ...s, channel: 'telegram' })
    expect(tg.keyboard.inline_keyboard.slice(1).map((r) => r.map((b) => b.callback_data))).toEqual([
      ['bp|t|0', 'bp|d|0', 'bp|k|0'],
      ['bp|t|1', 'bp|d|1', 'bp|k|1']
    ])
  })
  it('works with a bedtime after midnight', () => {
    expect(decideShutdown({ ...base, bed: '00:00', now: at('23:30') })).not.toBeNull()
    expect(decideShutdown({ ...base, bed: '00:00', now: at('23:20') })).toBeNull()
  })
  it('not when the day is already shut down or bed is logged', () => {
    expect(decideShutdown({ ...base, now: at('23:05'), closed: true })).toBeNull()
    expect(decideShutdown({ ...base, now: at('23:05'), bedLogged: true })).toBeNull()
  })
  it('the marks are shared, one item or all left at once', () => {
    let log: PushLog = { ...empty(), shutdown: { day, items: base.open, marks: {} } }
    log = markItem(log, 'm:Rust chapter 4', 'keep')
    log = markItem(log, '*', 'tomorrow')
    expect(log.shutdown!.marks).toEqual({ 'm:Rust chapter 4': 'keep', 't:42': 'tomorrow' })
    expect(cleanPushLog(log, day).shutdown!.marks).toEqual(log.shutdown!.marks)
  })
})

describe('PR7: the weekly card', () => {
  it('a score, 3 wins and 1 thing to fix from the week score', () => {
    const metrics = [
      { label: 'Focus', text: '9h', now: 9, target: 10, targetText: '10h' },
      { label: 'Wake-ups', text: '3', now: 3, target: 7, targetText: '7' },
      { label: 'Training', text: '4', now: 4, target: 4, targetText: '4' },
      { label: 'Must-dos', text: '15', now: 15, target: 21, targetText: '21' }
    ]
    const c = weeklyCard({ score: 72, prevScore: 67, metrics })
    expect(c.wins).toEqual(['Training: 4 of 4', 'Focus: 9h of 10h', 'Must-dos: 15 of 21'])
    expect(c.fix).toBe('Wake-ups: 3 of 7')
    const t = weeklyCardText(c)
    expect(t).toMatch(/72\/100 \(\+5 vs last week\)/)
    expect(t).toMatch(/One thing to fix: Wake-ups/)
    expect(weeklyCardText(c, 'hard')).toMatch(/no excuses/)
  })
  it('with little data it says so', () => {
    expect(weeklyCard({ score: 0, prevScore: 0, metrics: [] }).wins).toEqual(['You showed up.'])
  })
})

describe('Telegram and Coach cards', () => {
  it('buttons round-trip through callback data', () => {
    expect(readPushCallback(pushCallback('later', 'checkin:ev1')!)).toEqual({ op: 'later', ref: 'checkin:ev1' })
    expect(readPushCallback('bp|t|*')).toEqual({ op: 'tomorrow', ref: '*' })
    expect(pushCallback('later', 'x'.repeat(80))).toBeNull()
  })
  it('the check-in message uses the bot focus button for Start', () => {
    const p = decideCheckin({ now: at('16:00'), on: true, blocks: [lab], running: false, meeting: false, quiet: false, levels: all('normal'), log: empty(), here: false })!
    const m = pushTelegram(p, (s) => `fo|${s}`)
    expect(m.text).toMatch(/^🎯 <b>Lab 4 · 16:00<\/b>/)
    expect(m.keyboard.inline_keyboard[0].map((b) => b.callback_data)).toEqual(['fo|Lab 4', 'bp|l|checkin:ev1', 'bp|s|checkin:ev1'])
    const card = pushCardOf(JSON.parse(JSON.stringify(toCard(p))))!
    expect(card.type).toBe('checkin')
    expect(pushCardOf({ type: 'other', key: 'x', title: 'x', lines: [] })).toBeNull()
  })
})
