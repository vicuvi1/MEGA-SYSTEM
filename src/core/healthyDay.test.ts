import { describe, expect, it } from 'vitest'
import {
  MAX_PER_HOUR,
  alertTopic,
  bodyLine,
  calmStationOf,
  govern,
  healthyBonus,
  healthyDay,
  healthyHeadline,
  healthySegments,
  healthyStreak,
  islandHasWater,
  lateAlert,
  noteMessage,
  noteShown,
  parseReminder,
  queueAdd,
  queueRelease,
  reminderAlert,
  reminderDone,
  reminderSnooze,
  sleptOnTime,
  stillQuiet,
  telegramWindDown,
  textTopic,
  waterSeen,
  weeklyHealth,
  windDownMode,
  type ReminderItem,
  type Shown
} from './healthyDay'
import { commandPreview } from './islandCommands'
import { parseVoiceCommand } from './voiceCommands'
import { DEFAULT_ISLAND_PREFS, EMPTY_ISLAND, alertGate, type IslandAlert } from './islandModel'
import { dueRhythm, DEFAULT_RHYTHM_PREFS, rhythmFor } from './rhythm'
import { bedAutoAlert, morningAlert } from './islandBody'

const at = (h: number, m = 0, d = 0) => new Date(2026, 10, 4 + d, h, m).getTime()
const MIN = 60_000
const water = (id = 'water:x:6'): IslandAlert => ({ id, kind: 'water', title: 'A glass of water?', text: '', actions: [] })
const ctx = (now: number, o: Partial<{ call: boolean; focus: boolean; event: boolean; asleep: boolean; windDown: boolean }> = {}) => ({ now, call: false, focus: false, event: false, asleep: false, ...o })

describe('the governor', () => {
  it('passes what is not a nudge, and your reminders even after bed', () => {
    const block: IslandAlert = { id: 'blk:1', kind: 'block', title: 'Starting now', text: '', actions: [] }
    expect(govern(block, ctx(at(10), { focus: true }), []).show).toBe(block)
    const r: IslandAlert = { id: 'remind:a1', kind: 'remind', title: '⏰ meds', text: '', actions: [] }
    expect(govern(r, ctx(at(1, 0, 1), { asleep: true }), []).show).toBe(r)
    expect(govern(water(), ctx(at(1, 0, 1), { asleep: true }), []).show).toBeNull()
  })
  it('holds water and moves back during a call, focus or class, and offers them after', () => {
    const v = govern(water(), ctx(at(13, 10), { call: true }), [])
    expect(v.show).toBeNull()
    expect(v.queue?.id).toBe('water:x:6')
    const posture: IslandAlert = { id: 'posture:x', kind: 'move', title: '', text: '', actions: [], nudge: { type: 'posture', kind: 'posture' } }
    expect(govern(posture, ctx(at(8, 30), { event: true }), []).queue).toBeUndefined()
    const q = queueAdd([], water(), at(13, 10))
    expect(queueRelease(q, ctx(at(13, 20), { call: true })).alert).toBeNull()
    const r = queueRelease(q, ctx(at(13, 46)))
    expect(r.alert?.title).toMatch(/now that it is done/i)
    expect(r.rest).toEqual([])
    // Too old to matter.
    expect(queueRelease(q, ctx(at(16, 0))).alert).toBeNull()
  })
  it('no second nudge about the same thing within 30 minutes (any surface)', () => {
    const shown = noteMessage([], '💧 Water 0.8 of 2.5 L and the day is going.', at(11, 0))
    expect(govern(water(), ctx(at(11, 20)), shown).show).toBeNull()
    expect(govern(water(), ctx(at(11, 31)), shown).show).not.toBeNull()
    // The same card growing from a dot to a peek is not a duplicate.
    const mv = (lvl: string): IslandAlert => ({ id: `move:123:${lvl}`, kind: 'move', title: '', text: '', actions: [] })
    const s2 = noteShown([], { ...mv('dot'), dot: true }, 'island', at(10, 35), true)
    expect(govern(mv('peek'), ctx(at(10, 45)), s2).show?.id).toBe('move:123:peek')
  })
  it(`at most ${MAX_PER_HOUR} interruptions an hour: the next one waits as a dot`, () => {
    let shown: Shown[] = []
    for (const [i, k] of ['posture', 'mood', 'away'].entries()) shown = noteShown(shown, { id: `${k}:x`, kind: 'move', title: '', text: '', actions: [], nudge: { type: k === 'posture' ? 'posture' : k === 'mood' ? 'mood' : 'away', kind: k as any, min: 10 } as any }, 'island', at(10, i * 10), true)
    const v = govern(water(), ctx(at(10, 40)), shown)
    expect(v.show?.dot).toBe(true)
    // The late-night nudge is firm on purpose.
    const late: IslandAlert = { id: 'late:d:1', kind: 'late', title: '', text: '', actions: [] }
    expect(govern(late, ctx(at(10, 40)), shown).show?.dot).toBeUndefined()
  })
  it('in the wind-down hour: only bed things', () => {
    expect(govern(water(), ctx(at(22, 10), { windDown: true }), []).show).toBeNull()
    const wd: IslandAlert = { id: 'winddown:x', kind: 'winddown', title: '', text: '', actions: [] }
    expect(govern(wd, ctx(at(22, 10), { windDown: true }), []).show).toBe(wd)
  })
  it("Ben's Telegram message on the island waits as a dot", () => {
    const ben: IslandAlert = { id: 'ben:2026', kind: 'ben', title: 'Ben', text: '💧 Water 1.0 of 2.5 L', actions: [] }
    expect(govern(ben, ctx(at(12)), []).show?.dot).toBe(true)
  })
  it('reads what a message or card is about', () => {
    expect(textTopic('🌙 <b>Day review: 74/100</b>\nWater 2.1/2.5 L')).toBe('evening')
    expect(textTopic('☀️ <b>Your day</b> · x\n💧 Water: 2.5 L')).toBe('plan')
    expect(textTopic('🌙 <b>Wind-down</b> · in bed by 23:00')).toBe('bed')
    expect(textTopic('⏰ call mom')).toBe('reminder')
    expect(textTopic('💧 Water 0.5 of 2.5 L')).toBe('water')
    expect(alertTopic({ id: 'moved:1', kind: 'move', title: '', text: '', actions: [], nudge: { type: 'moveDone', kind: 'move', logId: '1', name: 'x', n: 1, coins: 0, water: false, line: null } })).toBeNull()
  })
})

describe('the Healthy day ring', () => {
  const base = { waterMl: 2500, waterTarget: 2500, moves: 3, breaks: 3, sleptOnTime: true }
  it('scores four parts and says it in one line', () => {
    const h = healthyDay(base)
    expect(h).toMatchObject({ met: 4, all: true, score: 100 })
    expect(bodyLine(h)).toBe('Body today: 2.5 of 2.5 L water, 3 of 3 move breaks, 3 of 3 screen breaks, bed on time last night. All four: a healthy day. 💚')
    const half = healthyDay({ ...base, waterMl: 1250, moves: 1, sleptOnTime: null })
    expect(half.met).toBe(1)
    expect(half.score).toBe(Math.round(((0.5 + 1 / 3 + 1 + 0) / 4) * 100))
    expect(bodyLine(half)).toContain('no bedtime logged last night. 1 of 4 healthy.')
    expect(bodyLine(healthyDay({ ...base, breaks: 1 }))).toContain('3 of 4. Missing: breaks.')
  })
  it('pays the bonus once, and takes it back if a part is undone the same day', () => {
    expect(healthyBonus(healthyDay(base), null)).toBe('pay')
    expect(healthyBonus(healthyDay(base), 41)).toBeNull()
    expect(healthyBonus(healthyDay({ ...base, moves: 2 }), 41)).toBe('undo')
    expect(healthyBonus(healthyDay({ ...base, moves: 2 }), null)).toBeNull()
  })
  it('a streak of healthy days', () => {
    const days = { '2026-11-02': { healthy: true }, '2026-11-03': { healthy: true }, '2026-11-04': {} }
    expect(healthyStreak(days, '2026-11-04')).toBe(2)
    expect(healthyStreak({ ...days, '2026-11-04': { healthy: true } }, '2026-11-04')).toBe(3)
  })
  it('bed on time: 15 minutes of grace, past midnight too', () => {
    expect(sleptOnTime({ bedTime: '23:10', bedTarget: '23:00', bedOnTime: null })).toBe(true)
    expect(sleptOnTime({ bedTime: '00:20', bedTarget: '23:00', bedOnTime: null })).toBe(false)
    expect(sleptOnTime({ bedTime: '22:30', bedTarget: '23:00', bedOnTime: null })).toBe(true)
    expect(sleptOnTime({ bedTime: '00:10', bedTarget: '00:00', bedOnTime: null })).toBe(true)
    expect(sleptOnTime(null)).toBeNull()
  })
  it('the week: water average, moves, breaks and steady bedtimes', () => {
    const days = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-08'].map((day, i) => ({ day, waterMl: 2000 + i * 200, waterTarget: 2400, moves: 3 + i, breaks: 2, healthy: i === 2 }))
    const beds = [
      { day: '2026-11-03', bedTime: '23:05', bedOnTime: true },
      { day: '2026-11-04', bedTime: '00:20', bedOnTime: false },
      { day: '2026-11-08', bedTime: '22:55', bedOnTime: true }
    ]
    const w = weeklyHealth(days, beds, '2026-11-08')
    expect(w).toMatchObject({ days: 4, waterAvgMl: 2300, waterDaysMet: 2, moves: 18, breaks: 8, bedOnTime: 2, bedNights: 3, bedSpreadMin: 85, healthyDays: 1 })
    expect(w.lines[2]).toContain('all over the place (1h25')
  })
})

describe('wind-down and late night', () => {
  it('dims from bedtime − 60 and stays firm after it', () => {
    expect(windDownMode(at(21, 59), '23:00', false)).toBeNull()
    expect(windDownMode(at(22, 0), '23:00', false)).toMatchObject({ phase: 'wind', minutes: 60, music: true })
    expect(windDownMode(at(22, 50), '23:00', false)?.line).toMatch(/close the laptop now/i)
    expect(windDownMode(at(23, 40), '23:00', false)).toMatchObject({ phase: 'late', minutes: 40, music: false })
    expect(windDownMode(at(23, 40), '23:00', true)).toBeNull()
    expect(windDownMode(at(6, 0, 1), '23:00', false)).toBeNull()
  })
  it('two late-night nudges at most, only at the PC', () => {
    const o = { bedTarget: '23:00', idleSec: 10, bedLogged: false, dismissed: {}, day: '2026-11-04' }
    expect(lateAlert({ ...o, now: at(23, 15) })).toBeNull()
    expect(lateAlert({ ...o, now: at(23, 30) })?.id).toBe('late:2026-11-04:1')
    expect(lateAlert({ ...o, now: at(0, 5, 1) })?.title).toMatch(/hour past bedtime/i)
    expect(lateAlert({ ...o, now: at(1, 10, 1) })).toBeNull()
    expect(lateAlert({ ...o, now: at(23, 40), idleSec: 600 })).toBeNull()
  })
  it("Telegram's wind-down waits when the island showed it, or bed is logged", () => {
    expect(telegramWindDown({ minutesBefore: 40, bedLogged: false, islandBedAt: null, now: at(22, 20) })).toBe(true)
    expect(telegramWindDown({ minutesBefore: 40, bedLogged: false, islandBedAt: at(22, 0), now: at(22, 20) })).toBe(false)
    expect(telegramWindDown({ minutesBefore: 40, bedLogged: true, islandBedAt: null, now: at(22, 20) })).toBe(false)
    expect(telegramWindDown({ minutesBefore: 55, bedLogged: false, islandBedAt: null, now: at(22, 5) })).toBe(false)
  })
  it('calm music picks a calm station', () => {
    expect(calmStationOf([{ name: 'Upbeat workout', vibe: 'workout' }, { name: 'Evening soul', vibe: 'soul' }, { name: 'Ambient drift', vibe: 'ambient' }])?.name).toBe('Ambient drift')
    expect(calmStationOf([{ name: 'My sleep mix' }, { name: 'Ambient drift', vibe: 'ambient' }])?.name).toBe('My sleep mix')
  })
})

describe('the morning', () => {
  it('quiet hours end once you logged waking up', () => {
    expect(stillQuiet(true, new Date(at(6, 50)), '06:40')).toBe(false)
    expect(stillQuiet(true, new Date(at(6, 30)), '06:40')).toBe(true)
    expect(stillQuiet(true, new Date(at(6, 50)), null)).toBe(true)
    expect(stillQuiet(true, new Date(at(23, 30)), '06:40')).toBe(true)
    expect(stillQuiet(false, new Date(at(6, 50)), null)).toBe(false)
  })
  it('one morning card: the PC bedtime rides on it, and no "I\'m up" once the wake-up is logged', () => {
    const m = morningAlert({ now: at(7, 30), firstActiveAt: at(7, 30), wakeLogged: true, wakeTime: '06:40', firstBlock: null, dismissed: {}, bedAuto: '23:05' })!
    expect(m.text).toBe('Bed at 23:05 (the PC logged it). Up at 06:40. Nothing planned yet.')
    expect(m.actions.map((a) => a.label)).toEqual(['▶ Start my day', 'Fix bedtime'])
    expect(bedAutoAlert({ bed: { time: '23:05', at: new Date(at(7, 30)).toISOString() }, now: at(7, 31), running: false, wakeLogged: true, morningShown: true, dismissed: {} })).toBeNull()
    const lone = bedAutoAlert({ bed: { time: '23:05', at: new Date(at(7, 30)).toISOString() }, now: at(7, 31), running: false, wakeLogged: true, morningShown: false, dismissed: {} })!
    expect(lone.actions.some((a) => a.label.includes("I'm up"))).toBe(false)
  })
})

describe('Telegram and the island share water', () => {
  it("water logged anywhere restarts the island's 90 minutes, and Telegram waits after the island's card", () => {
    expect(waterSeen(null, 500, at(9))).toEqual({ ml: 500, at: 0 })
    expect(waterSeen({ ml: 500, at: 0 }, 1000, at(12, 30))).toEqual({ ml: 1000, at: at(12, 30) })
    expect(waterSeen({ ml: 1000, at: at(12, 30) }, 1000, at(13))).toEqual({ ml: 1000, at: at(12, 30) })
    expect(islandHasWater(at(11), at(12))).toBe(true)
    expect(islandHasWater(at(10), at(12))).toBe(false)
  })
  it('the rhythm: no water or training in a class, a call or focus, nor after the island just nudged, nothing after bed', () => {
    const st = rhythmFor(null, '2026-11-04')
    const f = { today: '2026-11-04', time: '15:00', weekday: 3, wakeAt: '06:40', wakeTarget: '07:00', waterMl: 200, waterTarget: 2500, workoutDone: false, paused: false }
    expect(dueRhythm({ ...st, briefing: {} as any }, DEFAULT_RHYTHM_PREFS, f)).toContain('water')
    expect(dueRhythm({ ...st, briefing: {} as any }, DEFAULT_RHYTHM_PREFS, { ...f, busy: true })).not.toContain('water')
    expect(dueRhythm({ ...st, briefing: {} as any }, DEFAULT_RHYTHM_PREFS, { ...f, islandWaterAt: at(14, 30), nowMs: at(15) })).not.toContain('water')
    expect(dueRhythm({ ...st, briefing: {} as any }, DEFAULT_RHYTHM_PREFS, { ...f, time: '19:00', busy: true })).not.toContain('training')
    expect(dueRhythm(st, DEFAULT_RHYTHM_PREFS, { ...f, time: '21:30', asleep: true })).toEqual([])
  })
})

describe('reminders you set', () => {
  const now = at(17, 0)
  it('reads "remind me to … at …" in many shapes', () => {
    expect(parseReminder('remind me to call mom at 18:00', now)).toEqual({ text: 'call mom', at: at(18, 0) })
    expect(parseReminder('remind me at 6pm to stretch', now)).toEqual({ text: 'stretch', at: at(18, 0) })
    expect(parseReminder('remind me in 20 min to drink water', now)).toEqual({ text: 'drink water', at: at(17, 20) })
    expect(parseReminder('remind me tomorrow at 9 to pay rent', now)).toEqual({ text: 'pay rent', at: at(9, 0, 1) })
    // A time already past today means tomorrow.
    expect(parseReminder('remind me to take out the bins at 7:30', now)).toEqual({ text: 'take out the bins', at: at(7, 30, 1) })
    expect(parseReminder('remind me to call mom friday', now)).toBeNull()
    expect(parseReminder('water 500', now)).toBeNull()
  })
  it('the "/" palette and the voice make it a reminder, not a task', () => {
    const s = commandPreview('remind me to call mom at 18:00', { now, running: null, tasks: [], meet: null, chips: { water: [250], reps: [10], focus: [25] }, reps: [], subject: 'Focus' })
    expect(s[0]).toMatchObject({ icon: '⏰', label: 'Remind me at 18:00: call mom', action: { kind: 'remind', op: 'add', text: 'call mom', at: at(18, 0) } })
    const v = parseVoiceCommand('remind me to call mom at six pm', { snap: { ...EMPTY_ISLAND, locked: false }, chips: { water: [250], reps: [10], focus: [25] }, now })
    expect(v).toMatchObject({ kind: 'action', action: { kind: 'remind', op: 'add', text: 'call mom', at: at(18, 0) } })
    // Without a time it stays a Todoist task.
    expect(parseVoiceCommand('remind me to pay rent friday', { snap: { ...EMPTY_ISLAND, locked: false }, chips: { water: [250], reps: [10], focus: [25] }, now })).toMatchObject({ action: { kind: 'chat', text: 'task pay rent friday' } })
  })
  it('the island card: once due, with Done and Snooze; gone once answered anywhere', () => {
    let list: ReminderItem[] = [{ id: 'r1', at: new Date(at(18)).toISOString(), text: 'call mom', kind: 'remind' }]
    expect(reminderAlert(list, at(17, 59), {})).toBeNull()
    const a = reminderAlert(list, at(18), {})!
    expect(a).toMatchObject({ id: 'remind:r1', kind: 'remind', title: 'call mom', face: '⏰' })
    expect(a.actions.map((x) => x.label)).toEqual(['✓ Done', '10 min', '1 hour'])
    // Sent to Telegram (done there means "sent"): still on the island until you answer.
    list = list.map((r) => ({ ...r, done: true, sentAt: new Date(at(18)).toISOString() }))
    expect(reminderAlert(list, at(18, 5), {})).not.toBeNull()
    const snoozed = reminderSnooze(list, 'r1', 10, at(18, 5))
    expect(snoozed[0]).toMatchObject({ done: false, sentAt: null, handled: false, at: new Date(at(18, 15)).toISOString() })
    expect(reminderAlert(snoozed, at(18, 10), {})).toBeNull()
    expect(reminderAlert(snoozed, at(18, 15), {})).not.toBeNull()
    expect(reminderAlert(reminderDone(snoozed, 'r1', at(18, 16)), at(18, 17), {})).toBeNull()
    // Ben's own check-ins stay on Telegram.
    expect(reminderAlert([{ id: 'c1', at: new Date(at(18)).toISOString(), text: 'did you go?', kind: 'checkin' }], at(18, 1), {})).toBeNull()
  })
  it('in quiet mode a reminder waits as a dot (never lost)', () => {
    expect(alertGate({ kind: 'remind', prefs: DEFAULT_ISLAND_PREFS, quiet: true, call: false, lastPeekAt: 0, now: at(18) })).toBe('silent')
    expect(alertGate({ kind: 'water', prefs: DEFAULT_ISLAND_PREFS, quiet: true, call: false, lastPeekAt: 0, now: at(18) })).toBe('drop')
  })
})

describe('the Healthy day card says clearly what the ring shows', () => {
  it('count = parts complete, percent = overall progress', () => {
    expect(healthyHeadline({ met: 0, score: 20, bonus: false })).toBe('0 of 4 complete · 20% overall')
    expect(healthyHeadline({ met: 4, score: 100, bonus: true })).toBe('All four complete · +5 points')
    expect(healthyHeadline({ met: 4, score: 100, bonus: false })).toBe('All four complete')
  })
  it('one segment per part, filled by its own progress', () => {
    const seg = healthySegments([
      { id: 'water', pct: 0.48, done: false },
      { id: 'move', pct: 0, done: false },
      { id: 'breaks', pct: 1.4, done: false },
      { id: 'sleep', pct: 0.2, done: true }
    ])
    expect(seg.map((x) => x.fill)).toEqual([0.48, 0, 1, 1])
    expect(seg[3].done).toBe(true)
  })
})
