import { describe, expect, it } from 'vitest'
import {
  ALIVE_KINDS, DEFAULT_ALIVE, EMPTY_ALIVE, EMPTY_PRESET, LIVELY_ALIVE, aliveStep, cleanAlive, cleanPreset, countdownDue, dayState, dayStory, dismissOffer, glance, mirrorNew,
  next3h, pointsFx, pulseDue, restorePreset, shouldOffer, startPreset, streakRisk, top3Of, voiceReceipt, weatherMoment, type AliveInput, type AliveState, type PresetValues
} from './islandAlive'
import { cleanPeekFor, modeGate } from './islandCalm'

const at = (h: number, m = 0, s = 0) => new Date(2026, 10, 9, h, m, s).getTime()
const ALL = { ...LIVELY_ALIVE }
const base = (now: number, o: Partial<AliveInput> = {}): AliveInput => ({
  now, prefs: ALL, base: null, ctx: { meeting: false, focus: false, quiet: false, asleep: false },
  stats: { mustDone: 2, mustTotal: 3, waterMl: 1200, focusMin: 45 }, blocks: [], streak: null, mirror: [], weather: null, hasKit: () => false, ...o
})
const step = (i: AliveInput, st: AliveState = EMPTY_ALIVE) => aliveStep(i, st)
const ctx = (p: Partial<AliveInput['ctx']>) => ({ meeting: false, focus: false, quiet: false, asleep: false, ...p })

describe('defaults', () => {
  it('everything is off until you accept the preset', () => {
    expect(ALIVE_KINDS.every((k) => DEFAULT_ALIVE[k] === false)).toBe(true)
    expect(cleanAlive(null)).toEqual(DEFAULT_ALIVE)
    expect(step(base(at(14, 1), { prefs: DEFAULT_ALIVE })).alert).toBeNull()
  })
  it('Calm does not peek for alive moments by default; Balanced does once on', () => {
    expect(cleanPeekFor(null).alive).toBe(false)
    const peekFor = { ...cleanPeekFor(null), alive: true }
    expect(modeGate({ mode: 'calm', kind: 'pulse', peekFor: cleanPeekFor(null), base: 'peek' })).toBe('silent')
    expect(modeGate({ mode: 'balanced', kind: 'countdown', peekFor, base: 'peek' })).toBe('peek')
  })
})

describe('hourly pulse', () => {
  it('shows the numbers at the top of the hour, as a 3 second peek', () => {
    const r = step(base(at(14, 0, 20)))
    expect(r.alert?.kind).toBe('pulse')
    expect(r.alert?.title).toBe('14:00')
    expect(r.alert?.text).toBe('2/3 must-dos · 1.2 L · 45 min focus')
    expect(r.alert?.peekMs).toBe(3000)
  })
  it('is once per hour, not at 14:10, not at night', () => {
    expect(pulseDue(at(14, 10), {})).toBeNull()
    expect(pulseDue(at(7, 1), {})).toBeNull()
    expect(pulseDue(at(22, 1), {})).toBeNull()
    const r = step(base(at(14, 0)))
    expect(step(base(at(14, 3)), { ...r.state, card: null }).alert).toBeNull()
  })
  it('skips meetings, focus and quiet hours', () => {
    expect(step(base(at(14, 0), { ctx: ctx({ meeting: true }) })).alert).toBeNull()
    expect(step(base(at(14, 0), { ctx: ctx({ focus: true }), prefs: { ...ALL, shield: false } })).alert).toBeNull()
    expect(step(base(at(14, 0), { ctx: ctx({ quiet: true }) })).alert).toBeNull()
  })
  it('the card goes away after its short life', () => {
    const r = step(base(at(14, 0)))
    expect(step(base(at(14, 0, 30)), r.state).alert?.kind).toBe('pulse')
    expect(step(base(at(14, 2)), r.state).alert).toBeNull()
  })
})

describe('countdown', () => {
  const blocks = [{ title: 'Study', start: at(15, 0), end: at(16, 0) }]
  it('10 minutes and 2 minutes before, each once', () => {
    expect(countdownDue(at(14, 49), blocks, {})).toBeNull()
    const a = step(base(at(14, 50), { blocks }))
    expect(a.alert?.kind).toBe('countdown')
    expect(a.alert?.title).toBe('Study in 10 min')
    expect(step(base(at(14, 50, 30), { blocks }), { ...a.state, card: null }).alert).toBeNull()
    const b = step(base(at(14, 58, 10), { blocks }), { ...a.state, card: null })
    expect(b.alert?.title).toBe('Study in 2 min')
  })
  it('offers the kit only when there is one', () => {
    const k = step(base(at(14, 50), { blocks, hasKit: () => true }))
    expect(k.alert?.text).toBe('Start the kit?')
    expect(k.alert?.actions[0].action).toMatchObject({ kind: 'boost', op: 'kitOpen', arg: 'Study' })
    expect(step(base(at(14, 50), { blocks })).alert?.actions[0].action.kind).toBe('start')
  })
  it('skips meetings, maybes and marked blocks; a late tick is not a 10', () => {
    expect(countdownDue(at(14, 50), [{ ...blocks[0], call: true }], {})).toBeNull()
    expect(countdownDue(at(14, 50), [{ ...blocks[0], maybe: 'tentative' }], {})).toBeNull()
    expect(countdownDue(at(14, 50), [{ ...blocks[0], mark: 'done' }], {})).toBeNull()
    expect(countdownDue(at(14, 56), blocks, {})).toBeNull()
  })
  it('the 2 minute card is not held back by the 10 minute gap', () => {
    const a = step(base(at(14, 57, 30), { blocks }), { ...EMPTY_ALIVE, lastAt: at(14, 55) })
    expect(a.alert).toBeNull()
    const b = step(base(at(14, 58, 30), { blocks }), { ...EMPTY_ALIVE, lastAt: at(14, 58) })
    expect(b.alert?.title).toBe('Study in 2 min')
  })
})

describe('streak at risk', () => {
  const s = { days: 6, doneToday: false, rep: { id: 'pu', name: 'push-ups', n: 10 } }
  it('evening only, real action', () => {
    expect(streakRisk(at(19, 30), s, {})).toBeNull()
    const r = step(base(at(21, 0, 30), { streak: s }))
    expect(r.alert?.kind).toBe('streakRisk')
    expect(r.alert?.title).toBe('Workout streak ends in 3h')
    expect(r.alert?.text).toContain('10 push-ups now?')
    expect(r.alert?.actions[0].action).toEqual({ kind: 'reps', id: 'pu', name: 'push-ups', n: 10 })
  })
  it('not when done today or a short streak', () => {
    expect(streakRisk(at(21, 0), { ...s, doneToday: true }, {})).toBeNull()
    expect(streakRisk(at(21, 0), { ...s, days: 1 }, {})).toBeNull()
    expect(streakRisk(at(21, 0), null, {})).toBeNull()
  })
  it('a second chance at 22:00', () => {
    const r = step(base(at(20, 1), { streak: s }))
    expect(streakRisk(at(20, 30), s, r.state.seen)).toBeNull()
    expect(streakRisk(at(22, 5), s, r.state.seen)?.hoursLeft).toBe(2)
  })
})

describe('mirror', () => {
  const item = { id: 't1', title: 'Call Leo', src: 'todoist' as const }
  it('the first look is only the baseline', () => {
    expect(mirrorNew(null, [item])).toEqual([])
    expect(mirrorNew([], [item])).toEqual([item])
    expect(mirrorNew(['t1'], [item])).toEqual([])
  })
  it('announces a new task once and merges several', () => {
    const first = step(base(at(10, 5), { mirror: [] }))
    const r = step(base(at(10, 6), { mirror: [item, { id: 't2', title: 'Buy milk', src: 'telegram' }] }), first.state)
    expect(r.alert?.title).toBe('📱 Added: Call Leo')
    expect(r.alert?.text).toBe('+1 more from Todoist')
    expect(step(base(at(10, 7), { mirror: [item] }), { ...r.state, card: null }).alert).toBeNull()
  })
})

describe('rate limit and merging', () => {
  it('one non-urgent peek per 10 minutes', () => {
    const a = step(base(at(14, 0), { mirror: [] }))
    expect(a.alert?.kind).toBe('pulse')
    const b = step(base(at(14, 3), { mirror: [{ id: 'x', title: 'New thing', src: 'todoist' }] }), { ...a.state, card: null })
    expect(b.alert).toBeNull()
    const c = step(base(at(14, 11), { mirror: [{ id: 'y', title: 'Later thing', src: 'todoist' }] }), { ...b.state, card: null })
    expect(c.alert?.title).toBe('📱 Added: Later thing')
  })
  it('a busy moment becomes one card with a count', () => {
    const r = step(base(at(14, 0), { blocks: [{ title: 'Study', start: at(14, 9), end: at(15, 0) }] }))
    expect(r.alert?.kind).toBe('countdown')
    expect(r.alert?.text).toContain('+1 more')
  })
  it('never over another card', () => {
    const other = { id: 'w', kind: 'water' as const, title: 'Water', text: '', actions: [] }
    expect(step(base(at(14, 0), { base: other })).alert).toBe(other)
  })
  it('weather: rain heads-up once', () => {
    const w = { day: '2026-11-09', rain: [{ from: '17:00', to: '18:00', prob: 70 }], sunrise: '07:10', sunset: '16:40' }
    const r = step(base(at(15, 30), { weather: w }))
    expect(r.alert?.title).toBe('Rain at 17:00')
    expect(step(base(at(15, 45), { weather: w }), { ...r.state, card: null }).alert).toBeNull()
  })
})

describe('focus shield', () => {
  const water = { id: 'water:1', kind: 'water' as const, title: '💧 Time for water', text: '', actions: [] }
  const ben = { id: 'ben:1', kind: 'ben' as const, title: "Ben's message", text: '', actions: [] }
  const over = { id: 'over:1', kind: 'over' as const, title: 'Time is up', text: '', actions: [] }
  const focus = ctx({ focus: true })
  it('holds non-urgent cards, counts them once, lets urgent through', () => {
    let r = step(base(at(14, 10), { base: water, ctx: focus }))
    expect(r.alert).toBeNull()
    expect(r.held).toBe(1)
    r = step(base(at(14, 11), { base: water, ctx: focus }), r.state)
    expect(r.held).toBe(1)
    r = step(base(at(14, 12), { base: ben, ctx: focus }), r.state)
    expect(r.held).toBe(2)
    expect(step(base(at(14, 13), { base: over, ctx: focus }), r.state).alert).toBe(over)
    expect(r.state.held.map((h) => h.id)).toEqual(['water:1', 'ben:1'])
  })
  it('releases one summary when the timer ends', () => {
    let r = step(base(at(14, 10), { base: water, ctx: focus }))
    r = step(base(at(14, 12), { base: ben, ctx: focus }), r.state)
    const end = step(base(at(14, 30)), r.state)
    expect(end.alert?.title).toBe('2 waited while you focused')
    expect(end.alert?.text).toContain('Time for water')
    expect(end.state.held).toEqual([])
    expect(end.held).toBe(0)
  })
  it('an alive card during focus is held too, and a pulse is skipped', () => {
    const blocks = [{ title: 'Study', start: at(14, 58), end: at(15, 30) }]
    const r = step(base(at(14, 50), { blocks, ctx: focus }))
    expect(r.alert).toBeNull()
    expect(r.held).toBeGreaterThan(0)
    const r2 = step(base(at(15, 0), { ctx: focus }), r.state)
    expect(r2.held).toBe(r.held)
  })
  it('does nothing when the switch is off', () => {
    const r = step(base(at(14, 10), { base: water, ctx: focus, prefs: { ...ALL, shield: false } }))
    expect(r.alert).toBe(water)
    expect(r.held).toBe(0)
  })
})

describe('Lively preset', () => {
  const before: PresetValues = { mode: 'calm', sound: 'subtle', coach: false, wins: false, push: 'gentle', brief: false, shutdown: true, peekAlive: false, alive: DEFAULT_ALIVE }
  it('offers once, only to Calm', () => {
    expect(shouldOffer(EMPTY_PRESET, 'calm')).toBe(true)
    expect(shouldOffer(EMPTY_PRESET, 'lively')).toBe(false)
    expect(shouldOffer(dismissOffer(EMPTY_PRESET), 'calm')).toBe(false)
  })
  it('sets everything, then restores exactly what you had', () => {
    const a = startPreset(EMPTY_PRESET, before, 'balanced')
    expect(a.apply).toMatchObject({ mode: 'balanced', sound: 'full', coach: true, wins: true, push: 'firm', brief: true, shutdown: true, peekAlive: true })
    expect(a.apply.alive).toEqual(LIVELY_ALIVE)
    const b = restorePreset(a.state)
    expect(b.apply).toEqual(before)
    expect(b.state.active).toBe(false)
    expect(restorePreset(b.state).apply).toBeNull()
  })
  it('switching Balanced to Lively keeps the original values', () => {
    const a = startPreset(EMPTY_PRESET, before, 'balanced')
    const b = startPreset(a.state, a.apply, 'lively')
    expect(b.apply.mode).toBe('lively')
    expect(restorePreset(b.state).apply).toEqual(before)
  })
  it('survives a round trip through storage and junk', () => {
    const a = startPreset(EMPTY_PRESET, before, 'lively')
    expect(cleanPreset(JSON.parse(JSON.stringify(a.state)))).toEqual(a.state)
    expect(cleanPreset({ active: true, prev: 'x' })).toEqual({ offered: false, active: false, choice: null, prev: null })
    expect(cleanPreset(null)).toEqual(EMPTY_PRESET)
  })
})

describe('island data', () => {
  it('dayState', () => {
    const o = { dayPct: 50, mustDone: 1, mustTotal: 2, restDay: false, drifting: false }
    expect(dayState({ now: at(9), ...o, dayPct: 0 })).toBe('ontrack')
    expect(dayState({ now: at(16), ...o, dayPct: 5, mustDone: 0 })).toBe('behind')
    expect(dayState({ now: at(16), ...o, dayPct: 70 })).toBe('ontrack')
    expect(dayState({ now: at(16), ...o, drifting: true })).toBe('drifting')
    expect(dayState({ now: at(16), ...o, restDay: true, drifting: true })).toBe('rest')
  })
  it('top3 puts open must-dos first and has no copies', () => {
    expect(top3Of({ mustdos: [{ text: 'A', done: true }, { text: 'B', done: false }], top: [{ text: 'b', done: false }, { text: 'C', done: false }], todoist: [{ content: 'D' }] })).toEqual([
      { title: 'B', done: false }, { title: 'A', done: true }, { title: 'C', done: false }
    ])
  })
  it('next3h', () => {
    const r = next3h({ now: at(14), blocks: [{ title: 'Study', start: at(15), end: at(16) }, { title: 'Late', start: at(18), end: at(19) }, { title: 'Call', start: at(14, 30), end: at(15), call: true }], reminders: [{ at: at(16), text: 'Pills' }], tasks: [{ content: 'Post', at: at(16, 30) }, { content: 'No time', at: null }] })
    expect(r.map((x) => `${x.kind}:${x.title}`)).toEqual(['meeting:Call', 'block:Study', 'reminder:Pills', 'task:Post'])
  })
  it('pointsFx only when the balance goes up', () => {
    expect(pointsFx(null, 50, 'x', 1)).toBeNull()
    expect(pointsFx(50, 50, 'x', 1)).toBeNull()
    expect(pointsFx(50, 40, 'x', 1)).toBeNull()
    expect(pointsFx(50, 53, 'Move break', 1)).toMatchObject({ delta: 3, label: 'Move break' })
  })
  it('story from 23:00 to 04:00', () => {
    const o = { focusMin: 135, waterMl: 2100, waterTarget: 2000, mustDone: 3, mustTotal: 3, streak: 6 }
    expect(dayStory({ now: at(22, 59), ...o })).toBeNull()
    const s = dayStory({ now: at(23), ...o })
    expect(s?.lines[0]).toBe('You focused for 2 h 15 min.')
    expect(s?.stats).toEqual({ focusMin: 135, waterMl: 2100, done: 3 })
    expect(dayStory({ now: at(2), ...o })).not.toBeNull()
    expect(dayStory({ now: at(4, 1), ...o })).toBeNull()
  })
  it('glance counts reached rep targets', () => {
    expect(glance({ waterMl: 500, waterGoal: 2000, reps: [{ done: 10, target: 10 }, { done: 1, target: 5 }], moneyLeft: null, proteinG: 40, proteinGoal: 120 })).toMatchObject({ habitsDone: 1, habitsTotal: 2 })
  })
  it('weather moment: tint and lines', () => {
    const w = { day: '2026-11-09', rain: [{ from: '17:00', to: '18:00', prob: 70 }], sunrise: '07:10', sunset: '16:40' }
    expect(weatherMoment(w, at(7, 30))?.tint).toBe('dawn')
    expect(weatherMoment(w, at(12))).toEqual({ tint: 'day', line: null })
    expect(weatherMoment(w, at(15))).toEqual({ tint: 'day', line: 'Rain at 17:00' })
    expect(weatherMoment({ ...w, rain: [] }, at(16))).toEqual({ tint: 'dusk', line: 'Sunset in 40 min' })
    expect(weatherMoment(w, at(20))?.tint).toBe('night')
    expect(weatherMoment(null, at(12))).toBeNull()
  })
})

describe('voice receipt', () => {
  it('says what Ben really saved', () => {
    expect(voiceReceipt({ reply: 'Done!', done: ['➕ gym · tomorrow 18:00'] })).toBe('✓ ➕ gym · tomorrow 18:00')
    expect(voiceReceipt({ reply: '<b>Hm</b> ok', done: ['(nothing saved)'] })).toBe('Hm ok')
    expect(voiceReceipt({ reply: 'x', receipt: 'Saved 1 task' })).toBe('Saved 1 task')
  })
})
