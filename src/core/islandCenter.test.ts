import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyTemplate, cleanSetup, counterRoute, defaultSetup, DEFAULT_LOOKS as CENTER_LOOKS, EMPTY_STATE, noteFired, routePays, type CustomSetup, type ReminderRule } from './custom'
import { centerIslandView, centerLooksToIsland, centerReminderAlert, centerReminderSound, centerReminderTick, isCenterReminder, wallpaperFor, CENTER_LATER_MIN } from './islandCenter'
import { cleanLooks, DEFAULT_LOOKS } from './islandLooks'
import { canUndo, expectPatch } from './islandCommands'
import { inverseAction } from './islandInstant'
import { presentAs } from './islandCalm'
import { EMPTY_ISLAND, type IslandAction, type IslandSnapshot } from './islandModel'

// Friday 2026-11-13, local time (made-up data only).
const at = (hm: string, day = 13) => new Date(2026, 10, day, Number(hm.slice(0, 2)), Number(hm.slice(3, 5)), 0, 0).getTime()
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(at('10:00'))
})
afterEach(() => vi.useRealTimers())

const rule = (r: Partial<ReminderRule> & Pick<ReminderRule, 'id'>): ReminderRule => ({ text: 'Stretch', icon: '🧍', on: true, kind: 'every', everyMin: 30, atPc: false, at: '21:00', days: [], from: '', to: '', cap: 3, log: null, ...r })

function setupWith(over: Partial<CustomSetup> = {}): CustomSetup {
  return cleanSetup({
    ...defaultSetup(),
    savedAt: at('09:00'),
    widgets: [
      { id: 'push', kind: 'counter', title: 'Push-ups', icon: '💪', goal: 100, steps: [10, 25], unit: 'reps', resetAt: '04:00', track: 'none', exercise: '' },
      { id: 'water', kind: 'counter', title: 'Water', icon: '💧', goal: 2000, steps: [250], unit: 'ml', resetAt: '04:00', track: 'water', exercise: '' },
      { id: 'list', kind: 'checklist', title: 'Today', icon: '✅', resetAt: '04:00', items: [{ id: 'a', text: 'Read' }, { id: 'b', text: 'Walk' }] },
      { id: 'clock', kind: 'clock', title: 'Clock', icon: '🕰' }
    ],
    modes: [
      { id: 'everyday', name: 'Everyday', icon: '🌤', layout: { pill: ['push'], island: ['list', 'water'], home: [] }, looks: {}, schedule: [] },
      { id: 'night', name: 'Night', icon: '🌙', layout: { pill: ['clock'], island: [], home: [] }, looks: { island: { ...CENTER_LOOKS.island, size: 'l', radius: 6 }, celebrate: 'glow' }, schedule: [{ days: [], from: '22:00', to: '06:00' }] }
    ],
    baseMode: 'everyday',
    ...over
  })
}

describe('Center looks on the island', () => {
  it('untouched looks keep today\'s island', () => {
    expect(centerLooksToIsland(CENTER_LOOKS)).toEqual({})
    expect(cleanLooks(centerLooksToIsland(CENTER_LOOKS))).toEqual(DEFAULT_LOOKS)
  })
  it('size, corners, position, open size, clock, celebration and sounds are applied', () => {
    const l = centerLooksToIsland({
      ...CENTER_LOOKS,
      island: { ...CENTER_LOOKS.island, size: 's', radius: 4, position: 'top-right', openW: 760, openH: 0 },
      clock: { style: 'analog', h24: false, seconds: true, date: true, zone2: 'Asia/Tokyo' },
      celebrate: 'confetti',
      sounds: { ...CENTER_LOOKS.sounds, pack: 'glass', volume: 0.5, files: { reminder: 'local:s1' } }
    })
    const c = cleanLooks(l)
    expect(c.size).toBe('small')
    expect(c.radius).toBe(4)
    expect(c.position).toBe('top-right')
    expect(c.openSize).toEqual({ width: 760, height: null })
    expect(c.clock).toEqual({ style: 'analog', hour12: true, seconds: true, date: true, zone: 'Asia/Tokyo' })
    expect(c.celebration).toBe('confetti')
    expect(c.sound.pack).toBe('glass')
    expect(c.sound.volume.reminder).toBeCloseTo(0.5 * CENTER_LOOKS.sounds.kinds.reminder)
    expect(c.sound.files).toEqual({ reminder: 'local:s1' })
  })
  it('the off pack is silent; glow and numbers map to the island\'s words', () => {
    const c = cleanLooks(centerLooksToIsland({ ...CENTER_LOOKS, sounds: { ...CENTER_LOOKS.sounds, pack: 'off' }, colors: { ...CENTER_LOOKS.colors, glow: 0 }, font: { family: 'mono', numbers: 'segment' } }))
    expect(c.sound.pack).toBe('none')
    expect(c.glow).toBe('off')
    expect(c.font).toBe('mono')
    expect(c.numbers).toBe('segment')
  })
})

describe('Center view for the island', () => {
  it('a set-up never saved and empty shows nothing', () => {
    expect(centerIslandView(defaultSetup(), EMPTY_STATE, {}, at('10:00'))).toBeNull()
  })
  it('the pill and open island get the mode\'s widgets as cards', () => {
    const v = centerIslandView(setupWith(), EMPTY_STATE, { waterMl: 750 }, at('10:00'))!
    expect(v.mode.id).toBe('everyday')
    expect(v.pill.map((w) => w.id)).toEqual(['push'])
    expect(v.pill[0]).toMatchObject({ steps: [10, 25], goal: 100, n: 0, value: '0' })
    expect(v.island.find((w) => w.id === 'water')).toMatchObject({ value: '750', track: 'water' })
    expect(v.island.find((w) => w.id === 'list')!.items).toEqual([{ id: 'a', text: 'Read', done: false }, { id: 'b', text: 'Walk', done: false }])
    expect(v.modes.map((m) => m.id)).toEqual(['everyday', 'night'])
  })
  it('a mode switch (by its times or a tap) swaps the widgets and the looks', () => {
    const s = setupWith()
    const night = centerIslandView(s, EMPTY_STATE, {}, at('22:30'))!
    expect(night.mode).toMatchObject({ id: 'night', why: 'schedule' })
    expect(night.pill.map((w) => w.id)).toEqual(['clock'])
    expect(night.island).toEqual([])
    expect(night.looks).toMatchObject({ size: 'large', radius: 6, celebration: 'glow' })
    const tapped = centerIslandView({ ...s, manual: { mode: 'night', at: at('09:59'), until: null } }, EMPTY_STATE, {}, at('10:00'))!
    expect(tapped.mode).toMatchObject({ id: 'night', why: 'manual' })
    expect(tapped.key).not.toBe(centerIslandView(s, EMPTY_STATE, {}, at('10:00'))!.key)
  })
})

describe('Center counters on the island (honest points)', () => {
  it('taps route to the real logs; a custom counter pays nothing', () => {
    expect(counterRoute({ id: 'w', track: 'water', exercise: '' }, 250)).toEqual({ to: 'water', ml: 250 })
    expect(counterRoute({ id: 'p', track: 'reps', exercise: 'pushups' }, 25)).toEqual({ to: 'reps', exercise: 'pushups', amount: 25 })
    const local = counterRoute({ id: 'x', track: 'none', exercise: '' }, 5)
    expect(local).toEqual({ to: 'local', widget: 'x', amount: 5 })
    expect(routePays(local)).toBe(false)
  })
  it('a step shows at once on the island and can be undone', () => {
    const center = centerIslandView(setupWith(), EMPTY_STATE, {}, at('10:00'))!
    const snap: IslandSnapshot = { ...EMPTY_ISLAND, center }
    const a: IslandAction = { kind: 'center', op: 'count', widget: 'push', amount: 25 }
    expect(canUndo(a)).toBe(true)
    const after = expectPatch(snap, a, at('10:00'))
    expect(after.center!.pill[0]).toMatchObject({ n: 25, value: '25', progress: 0.25, done: false })
    expect(expectPatch(after, inverseAction(a)!, at('10:00')).center!.pill[0].n).toBe(0)
    const ticked = expectPatch(snap, { kind: 'center', op: 'check', widget: 'list', item: 'a' }, at('10:00'))
    expect(ticked.center!.island.find((w) => w.id === 'list')!.value).toBe('1/2')
    expect(expectPatch(snap, { kind: 'center', op: 'mode', mode: 'night' }, at('10:00')).center!.mode).toMatchObject({ id: 'night', why: 'manual' })
  })
})

describe('Center reminders on the island', () => {
  const ctx = { call: false, focus: false, quiet: false, bedtime: '23:00', wake: '07:00', lastInterruptAt: 0 }
  const s = setupWith({ reminders: [rule({ id: 'r1' })] })
  it('fires when due, as a card that stays (Calm too)', () => {
    const t = centerReminderTick({ setup: s, state: EMPTY_STATE, now: at('10:00'), activeSince: null, later: {}, ctx })
    expect(t.fire?.id).toBe('r1')
    const a = centerReminderAlert(t.fire!, at('10:00'))
    expect(isCenterReminder(a)).toBe(true)
    expect(a.actions.map((x) => x.label)).toEqual(['✓ Done', `In ${CENTER_LATER_MIN} min`])
    expect(presentAs({ mode: 'calm', kind: a.kind, id: a.id, gate: 'peek' })).toBe('card')
  })
  it('waits in a call, a focus timer, quiet time, after bedtime and right after another card', () => {
    for (const [c, why] of [[{ call: true }, 'call'], [{ focus: true }, 'focus'], [{ quiet: true }, 'quiet'], [{ lastInterruptAt: at('09:55') }, 'gap']] as const) {
      const t = centerReminderTick({ setup: s, state: EMPTY_STATE, now: at('10:00'), activeSince: null, later: {}, ctx: { ...ctx, ...c } })
      expect(t.fire).toBeNull()
      expect(t.held.r1).toBe(why)
    }
    expect(centerReminderTick({ setup: s, state: EMPTY_STATE, now: at('23:30'), activeSince: null, later: {}, ctx }).held.r1).toBe('bedtime')
  })
  it('keeps the rule\'s cap and the day\'s cap of 12', () => {
    let st = EMPTY_STATE
    for (const h of ['08:00', '08:40', '09:20']) st = noteFired(st, 'r1', at(h))
    const capped = centerReminderTick({ setup: s, state: st, now: at('10:00'), activeSince: null, later: {}, ctx })
    expect(capped.fire).toBeNull()
    const many = setupWith({ reminders: [rule({ id: 'r2', cap: 50 })] })
    let st2 = EMPTY_STATE
    for (let i = 0; i < 12; i++) st2 = noteFired(st2, 'other', at('06:00') + i * 60_000)
    const day = centerReminderTick({ setup: many, state: st2, now: at('10:00'), activeSince: null, later: {}, ctx })
    expect(day.fire).toBeNull()
    expect(day.held.r2).toBe('day-cap')
  })
  it('only rules of the mode on now; "In 10 min" brings it back once', () => {
    const two = setupWith({ reminders: [rule({ id: 'r1' }), rule({ id: 'r2', text: 'Drink' })] })
    const picked = cleanSetup({ ...two, modes: [{ ...two.modes[0], reminders: ['r2'] }, two.modes[1]] })
    expect(centerReminderTick({ setup: picked, state: EMPTY_STATE, now: at('10:00'), activeSince: null, later: {}, ctx }).fire?.id).toBe('r2')
    const st = noteFired(EMPTY_STATE, 'r1', at('09:58'))
    expect(centerReminderTick({ setup: s, state: st, now: at('10:00'), activeSince: null, later: {}, ctx: { ...ctx } }).fire).toBeNull()
    expect(centerReminderTick({ setup: s, state: st, now: at('10:08'), activeSince: null, later: { r1: at('10:08') }, ctx }).fire?.id).toBe('r1')
  })
  it('rings once, never as a dot, in a call, quiet or after bed', () => {
    const base = { gate: 'peek' as const, played: false, islandSound: true, volume: 80, hush: null, quiet: false, call: false, blocked: null }
    expect(centerReminderSound(base).ring).toBe(true)
    expect(centerReminderSound({ ...base, played: true }).ring).toBe(false)
    expect(centerReminderSound({ ...base, gate: 'silent' }).ring).toBe(false)
    expect(centerReminderSound({ ...base, call: true }).ring).toBe(false)
    expect(centerReminderSound({ ...base, hush: 'bed' }).ring).toBe(false)
    expect(centerReminderSound({ ...base, volume: 0 }).ring).toBe(false)
  })
})

describe('Windows wallpaper pick', () => {
  it('the evening picture from 20:00 to 06:00', () => {
    const w = { image: 'local:day', night: 'local:eve' }
    expect(wallpaperFor(w, at('10:00'))).toBe('local:day')
    expect(wallpaperFor(w, at('21:00'))).toBe('local:eve')
    expect(wallpaperFor({ image: 'local:day', night: '' }, at('21:00'))).toBe('local:day')
    expect(wallpaperFor(null, at('10:00'))).toBeNull()
  })
})

describe('unique widget names', () => {
  it('the Study template gives its checklist and ring different names', () => {
    const r = applyTemplate(defaultSetup(), 'study', at('10:00')).setup
    const titles = r.widgets.map((w) => w.title)
    expect(new Set(titles).size).toBe(titles.length)
    expect(titles).toContain('Study list')
    expect(titles).toContain('Study progress')
  })
})
