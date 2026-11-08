import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  activeLayout, activeMode, addLocal, applyTemplate, cleanSetup, counterDay, counterRoute, CUSTOM_VERSION, defaultSetup, EMPTY_STATE, exportSetup, fireInput, importSetup, localCount, migrateSetup, nextFire, nextModeChange,
  noteFired, placeWidget, nudgeWidget, planAction, readSetup, reminderGate, routePays, scheduledMode, toggleCheck, widgetState, windowText, cleanReminder, ruleText, uniqueName,
  type CustomSetup, type GateContext, type Mode, type ReminderRule
} from './index'

// Friday 2026-11-13, local time (made-up dates only).
const at = (hm: string, day = 13) => new Date(2026, 10, day, Number(hm.slice(0, 2)), Number(hm.slice(3, 5)), 0, 0).getTime()

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(at('08:30'))
})
afterEach(() => vi.useRealTimers())

const mode = (id: string, schedule: Mode['schedule'] = []): Mode => ({ id, name: id, icon: '✦', layout: { pill: [], island: [], home: [] }, looks: {}, background: null, desktopWallpaper: null, reminders: [], schedule })

describe('validation', () => {
  it('turns junk into a safe default set-up', () => {
    for (const junk of [null, 42, 'x', [], { widgets: 'no' }, { modes: [{}] }]) {
      const s = cleanSetup(junk)
      expect(s.version).toBe(CUSTOM_VERSION)
      expect(s.modes.length).toBeGreaterThan(0)
      expect(s.modes.some((m) => m.id === s.baseMode)).toBe(true)
    }
  })
  it('bounds numbers, drops unknown kinds, keeps layout to real widgets once', () => {
    const s = cleanSetup({
      widgets: [
        { id: 'a', kind: 'counter', title: '<b>Push</b>', goal: 1e9, steps: [10, 10, -5, 25, 50, 75, 100], track: 'reps', exercise: 'pushups' },
        { id: 'a', kind: 'timer', focusMin: 999 },
        { id: 'x', kind: 'script', code: 'alert(1)' },
        { id: 'r', kind: 'ring', of: 'nope' }
      ],
      modes: [{ id: 'm', layout: { pill: ['a', 'a', 'ghost'], island: ['a'], home: ['r'] } }],
      looks: { colors: { accent: 'red', blur: 40 } }
    })
    expect(s.widgets.map((w) => w.kind)).toEqual(['counter', 'timer', 'ring'])
    const c = s.widgets[0] as any
    expect(c.title).not.toMatch(/[<>]/)
    expect(c.goal).toBe(100_000)
    expect(c.steps).toEqual([10, 25, 50, 75])
    expect(s.widgets[1].id).not.toBe('a')
    expect((s.widgets[1] as any).focusMin).toBe(180)
    expect((s.widgets[2] as any).of).toBe('')
    expect(s.modes[0].layout).toEqual({ pill: ['a'], island: [], home: ['r'] })
    expect(s.looks.colors.accent).toBe('#b8f53d')
    expect(s.looks.colors.blur).toBe(12)
  })
  it('keeps only whitelisted action steps', () => {
    const s = cleanSetup({ modes: [{ id: 'study' }], actions: [{ id: 'a', name: 'Go', steps: [{ do: 'focus', minutes: 50, subject: 'Study' }, { do: 'shell', cmd: 'rm -rf /' }, { do: 'open', page: 'http://evil' }, { do: 'mode', mode: 'study' }, { do: 'eval', code: '1' }] }, { id: 'b', steps: [{ do: 'run' }] }] })
    expect(s.actions).toHaveLength(1)
    expect(s.actions[0].steps).toEqual([{ do: 'focus', minutes: 50, subject: 'Study' }, { do: 'mode', mode: 'study' }])
  })
  it('only keeps local file references for pictures and sounds', () => {
    const s = cleanSetup({ background: { kind: 'image', image: 'https://example.com/a.png' }, looks: { sounds: { files: { done: 'local:abc', open: 'javascript:x' } } } })
    expect(s.background.kind).toBe('none')
    expect(s.looks.sounds.files).toEqual({ done: 'local:abc' })
  })
})

describe('migration', () => {
  it('moves a version 1 set-up (no modes) into the Everyday mode', () => {
    const m = migrateSetup({ version: 1, widgets: [{ id: 'c', kind: 'counter', goal: 10 }], layout: { pill: ['c'] } })
    expect(m.ok).toBe(true)
    const s = cleanSetup((m as any).raw)
    expect(s.modes).toHaveLength(1)
    expect(s.modes[0].layout.pill).toEqual(['c'])
    expect(s.baseMode).toBe(s.modes[0].id)
  })
  it('reads an unversioned set-up and refuses a newer one', () => {
    expect(migrateSetup({ widgets: [] })).toMatchObject({ ok: true, from: 0 })
    expect(migrateSetup({ version: CUSTOM_VERSION + 1 })).toMatchObject({ ok: false })
    expect(readSetup({ version: CUSTOM_VERSION + 1, widgets: [{ id: 'z', kind: 'clock' }] }).widgets).toEqual([])
    expect(readSetup(null)).toEqual(defaultSetup())
  })
})

describe('mode scheduler', () => {
  const modes = [mode('everyday'), mode('study', [{ days: [1, 2, 3, 4, 5], from: '09:00', to: '17:00' }]), mode('gym', [{ days: [], from: '18:00', to: '' }]), mode('night', [{ days: [], from: '23:00', to: '07:00' }])]
  const setup = { modes, baseMode: 'everyday', manual: null }
  it('switches by time', () => {
    expect(activeMode(setup, at('08:30')).mode.id).toBe('everyday')
    expect(activeMode(setup, at('09:00')).mode.id).toBe('study')
    expect(activeMode(setup, at('16:59')).mode.id).toBe('study')
    expect(activeMode(setup, at('17:30')).mode.id).toBe('everyday')
    expect(activeMode(setup, at('18:00')).mode.id).toBe('gym')
    expect(activeMode(setup, at('22:59')).mode.id).toBe('gym')
    expect(activeMode(setup, at('23:30')).mode.id).toBe('night')
    // Past midnight, Saturday: still night until 07:00, then no weekday study.
    expect(activeMode(setup, at('03:00', 14)).mode.id).toBe('night')
    expect(activeMode(setup, at('10:00', 14)).mode.id).toBe('everyday')
  })
  it('a window inside another ends back in the outer one', () => {
    const m = [mode('base'), mode('study', [{ days: [], from: '09:00', to: '17:00' }]), mode('lunch', [{ days: [], from: '12:00', to: '13:00' }])]
    expect(scheduledMode(m, at('12:30'))?.mode).toBe('lunch')
    expect(scheduledMode(m, at('14:00'))?.mode).toBe('study')
  })
  it('a tap holds until the next scheduled window starts', () => {
    const manual = { ...setup, manual: { mode: 'gym', at: at('10:00'), until: null } }
    expect(activeMode(manual, at('10:05'))).toMatchObject({ why: 'manual', mode: { id: 'gym' } })
    expect(activeMode(manual, at('17:30')).mode.id).toBe('gym')
    expect(activeMode(manual, at('18:01'))).toMatchObject({ why: 'schedule', mode: { id: 'gym' } })
    expect(activeMode(manual, at('23:01')).mode.id).toBe('night')
    expect(activeMode({ ...setup, manual: { mode: 'gym', at: at('10:00'), until: at('11:00') } }, at('11:30')).mode.id).toBe('study')
  })
  it('says when it changes next and reads windows plainly', () => {
    expect(nextModeChange(modes, at('08:30'))).toBe(at('09:00'))
    expect(windowText({ days: [1, 2, 3, 4, 5], from: '09:00', to: '17:00' })).toBe('Weekdays 09:00–17:00')
    expect(windowText({ days: [], from: '18:00', to: '' })).toBe('Every day from 18:00')
  })
})

describe('reminders', () => {
  const every = cleanReminder({ id: 'p', text: '20 push-ups', kind: 'every', everyMin: 45, atPc: true, cap: 3 }) as ReminderRule
  const daily = cleanReminder({ id: 'f', text: 'Log food', kind: 'at', at: '21:00' }) as ReminderRule
  it('every 45 min at the PC counts from when you sat down or the last one', () => {
    expect(nextFire(every, at('10:00'), { lastAt: null, todayCount: 0, activeSince: at('09:30') })).toBe(at('10:15'))
    expect(nextFire(every, at('10:00'), { lastAt: at('09:50'), todayCount: 1, activeSince: at('09:00') })).toBe(at('10:35'))
    expect(nextFire(every, at('10:00'), { lastAt: null, todayCount: 0, activeSince: null })).toBeNull()
    // Capped for today: tomorrow.
    expect(nextFire(every, at('10:00'), { lastAt: at('09:50'), todayCount: 3, activeSince: at('09:00') })).toBe(at('00:00', 14))
  })
  it('respects a window and weekdays', () => {
    const r = { ...every, atPc: false, from: '09:00', to: '17:00', days: [1, 2, 3, 4, 5] }
    expect(nextFire(r, at('08:00'), { lastAt: null, todayCount: 0, activeSince: null })).toBe(at('09:00'))
    expect(nextFire(r, at('16:50'), { lastAt: at('16:30'), todayCount: 1, activeSince: null })).toBe(at('09:00', 16))
  })
  it('at 21:00: today, due if missed while held back, then tomorrow', () => {
    expect(nextFire(daily, at('08:30'), { lastAt: null, todayCount: 0, activeSince: null })).toBe(at('21:00'))
    expect(nextFire(daily, at('21:20'), { lastAt: null, todayCount: 0, activeSince: null })).toBe(at('21:20'))
    expect(nextFire(daily, at('21:20'), { lastAt: at('21:00'), todayCount: 1, activeSince: null })).toBe(at('21:00', 14))
    expect(ruleText(daily)).toBe('at 21:00')
    expect(ruleText(every)).toBe('every 45 min at the PC')
  })
  it('the gate keeps the existing protections', () => {
    const c: GateContext = { now: at('14:00'), call: false, focus: false, quiet: false, bedtime: '23:00', wake: '07:00', lastInterruptAt: 0, gapMin: 15, shownToday: 0, dayCap: 12 }
    expect(reminderGate(every, 0, c)).toEqual({ show: true, why: 'ok' })
    expect(reminderGate(every, 0, { ...c, call: true }).why).toBe('call')
    expect(reminderGate(every, 0, { ...c, focus: true }).why).toBe('focus')
    expect(reminderGate(every, 0, { ...c, quiet: true }).why).toBe('quiet')
    expect(reminderGate(every, 0, { ...c, now: at('23:30') }).why).toBe('bedtime')
    expect(reminderGate(every, 0, { ...c, now: at('06:30') }).why).toBe('bedtime')
    expect(reminderGate(every, 0, { ...c, lastInterruptAt: at('13:50') }).why).toBe('gap')
    expect(reminderGate(every, 3, c).why).toBe('rule-cap')
    expect(reminderGate(every, 0, { ...c, shownToday: 12 }).why).toBe('day-cap')
    expect(reminderGate({ ...every, on: false }, 0, c).why).toBe('off')
  })
  it('notes a firing per day', () => {
    let s = noteFired(EMPTY_STATE, 'p', at('10:00'))
    s = noteFired(s, 'p', at('11:00'))
    expect(fireInput(s, 'p', at('12:00'), null)).toEqual({ lastAt: at('11:00'), todayCount: 2, activeSince: null })
    expect(fireInput(s, 'p', at('12:00', 14), null).todayCount).toBe(0)
  })
})

describe('counters (honest points)', () => {
  it('routes taps to the real logs or keeps them custom, never paying by itself', () => {
    const water = counterRoute({ id: 'w', track: 'water', exercise: '' }, 250)
    const reps = counterRoute({ id: 'p', track: 'reps', exercise: 'pushups' }, 25)
    const own = counterRoute({ id: 'o', track: 'none', exercise: '' }, 10)
    expect(water).toEqual({ to: 'water', ml: 250 })
    expect(reps).toEqual({ to: 'reps', exercise: 'pushups', amount: 25 })
    expect(own).toEqual({ to: 'local', widget: 'o', amount: 10 })
    expect(counterRoute({ id: 'p', track: 'reps', exercise: '' }, 5).to).toBe('local')
    for (const r of [water, reps, own]) expect(routePays(r)).toBe(false)
  })
  it('counts per day from the reset time', () => {
    const w = { id: 'o', resetAt: '04:00' }
    expect(counterDay(at('03:00', 14), '04:00')).toBe('2026-11-13')
    let s = addLocal(EMPTY_STATE, w, 10, at('22:00'))
    s = addLocal(s, w, 25, at('02:00', 14))
    expect(localCount(s, w, at('02:30', 14))).toBe(35)
    expect(localCount(s, w, at('05:00', 14))).toBe(0)
    expect(localCount(addLocal(s, w, -99, at('02:30', 14)), w, at('02:30', 14))).toBe(0)
  })
  it('a counter that tracks reps shows the real log, not its own number', () => {
    const setup = cleanSetup({ widgets: [{ id: 'p', kind: 'counter', title: 'Push-ups', goal: 100, track: 'reps', exercise: 'pushups' }] })
    const state = addLocal(EMPTY_STATE, { id: 'p', resetAt: '04:00' }, 999, at('08:30'))
    const v = widgetState(setup.widgets[0], { setup, state, real: { reps: { pushups: 40 } }, now: at('08:30') })
    expect(v).toMatchObject({ value: '40', sub: 'of 100 reps', progress: 0.4, done: false })
  })
})

describe('layout and widget views', () => {
  const s0 = cleanSetup({
    widgets: [
      { id: 'c', kind: 'counter', title: 'Push-ups', goal: 100, steps: [10, 25, 50] },
      { id: 't', kind: 'timer', title: 'Focus', focusMin: 50, breakMin: 10 },
      { id: 'd', kind: 'countdown', title: 'Exam', date: '2026-11-25' },
      { id: 'k', kind: 'checklist', title: 'List', items: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }] },
      { id: 'r', kind: 'ring', title: 'Ring', of: 'k' }
    ],
    modes: [{ id: 'm' }]
  })
  it('places by drag and by keyboard, and refuses a full pill', () => {
    let l = s0.modes[0].layout
    l = placeWidget(l, 'c', 'pill').layout
    l = placeWidget(l, 't', 'pill').layout
    l = placeWidget(l, 'd', 'pill', 0).layout
    expect(l.pill).toEqual(['d', 'c', 't'])
    expect(placeWidget(l, 'k', 'pill')).toMatchObject({ full: true })
    l = placeWidget(l, 'k', 'island').layout
    l = nudgeWidget(l, 't', 'up')
    expect(l.pill).toEqual(['d', 't', 'c'])
    l = nudgeWidget(l, 'c', 'nextSlot')
    expect(l).toEqual({ pill: ['d', 't'], island: ['k', 'c'], home: [] })
    l = placeWidget(l, 'c', 'home').layout
    expect(l.island).toEqual(['k'])
    expect(l.home).toEqual(['c'])
  })
  it('activeLayout gives the mode, its widgets and merged looks', () => {
    const s: CustomSetup = { ...s0, modes: [{ ...s0.modes[0], layout: { pill: ['c', 't'], island: ['k', 'r'], home: ['d'] }, looks: { celebrate: 'confetti' } }] }
    const a = activeLayout(s, at('08:30'))
    expect(a.pill.map((w) => w.id)).toEqual(['c', 't'])
    expect(a.island.map((w) => w.id)).toEqual(['k', 'r'])
    expect(a.looks.celebrate).toBe('confetti')
    expect(a.looks.island).toEqual(s.looks.island)
    expect(a.background.kind).toBe('none')
  })
  it('draws each kind as plain data', () => {
    const ctx = { setup: s0, state: toggleCheck(EMPTY_STATE, s0.widgets[3] as any, 'a', at('08:30')), now: at('08:30') }
    expect(widgetState(s0.widgets[2], ctx)).toMatchObject({ value: '12 days', done: false })
    expect(widgetState(s0.widgets[3], ctx)).toMatchObject({ value: '1/2', progress: 0.5 })
    expect(widgetState(s0.widgets[4], ctx)).toMatchObject({ value: '50%', sub: 'List' })
    expect(widgetState(s0.widgets[1], ctx)).toMatchObject({ value: '50:00' })
    expect(widgetState(s0.widgets[1], { ...ctx, real: { focus: { endsAt: at('08:30') + 25 * 60_000, subject: 'Study' } } })).toMatchObject({ value: '25:00', progress: 0.5 })
  })
})

describe('actions', () => {
  it('plans the run: desktop-only steps and a second timer are skipped on the website', () => {
    const s = applyTemplate(defaultSetup(), 'study', at('08:30')).setup
    const act = s.actions[0]
    expect(act.name).toBe('Start study')
    const web = planAction(act, { desktop: false, focusRunning: false, setup: s })
    expect(web.map((p) => p.skip)).toEqual([null, null, 'Only in the desktop app'])
    const desk = planAction(act, { desktop: true, focusRunning: true, setup: s })
    expect(desk[0].skip).toBe('A focus timer is already running')
  })
})

describe('templates', () => {
  it('adds a copy with fresh ids and switches to it; twice gives a second copy', () => {
    const base = defaultSetup()
    const one = applyTemplate(base, 'gym', at('08:30'))
    expect(one.setup.modes.map((m) => m.name)).toEqual(['Everyday', 'Gym'])
    expect(activeMode(one.setup, at('08:31')).mode.id).toBe(one.modeId)
    const gym = one.setup.modes.find((m) => m.id === one.modeId)!
    expect(gym.layout.pill.length).toBe(2)
    expect(one.setup.reminders[0].log?.widget).toBe(gym.layout.home[0])
    const two = applyTemplate(one.setup, 'gym', at('08:40'))
    expect(two.setup.modes.map((m) => m.name)).toEqual(['Everyday', 'Gym', 'Gym 2'])
    expect(new Set(two.setup.widgets.map((w) => w.id)).size).toBe(two.setup.widgets.length)
    for (const id of ['study', 'night', 'gaming'] as const) expect(applyTemplate(base, id, at('08:30')).setup.modes).toHaveLength(2)
  })
})

describe('export and import', () => {
  it('round-trips a set-up', () => {
    const s = applyTemplate(applyTemplate(defaultSetup(), 'study', at('08:30')).setup, 'night', at('08:31')).setup
    const r = importSetup(exportSetup(s, at('08:30')))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.setup.widgets).toEqual(s.widgets)
    expect(r.setup.modes).toEqual(s.modes)
    expect(r.setup.manual).toBeNull()
    expect(r.counts.modes).toBe(3)
  })
  it('drops device-only pictures and sounds from the file', () => {
    const s = cleanSetup({ ...defaultSetup(), widgets: [{ id: 'c', kind: 'clock' }], background: { kind: 'image', image: 'local:pic1' }, looks: { sounds: { files: { done: 'local:snd1' } } } })
    const txt = exportSetup(s, at('08:30'))
    expect(txt).not.toMatch(/local:/)
    const r = importSetup(txt)
    expect(r.ok && r.setup.background.kind).toBe('none')
  })
  it('refuses broken files with a plain message', () => {
    expect(importSetup('')).toMatchObject({ ok: false, why: 'The file is empty' })
    expect(importSetup('{oops')).toMatchObject({ ok: false, why: expect.stringContaining("isn't JSON") })
    expect(importSetup(JSON.stringify({ hello: 1 }))).toMatchObject({ ok: false, why: expect.stringContaining("isn't a Life System") })
    expect(importSetup(JSON.stringify({ kind: 'life-system/custom-setup', version: 99, setup: { widgets: [] } }))).toMatchObject({ ok: false, why: expect.stringContaining('newer version') })
    expect(importSetup(JSON.stringify({ kind: 'life-system/custom-setup', version: 2, setup: { widgets: [{ kind: 'script', code: 'x' }] } }))).toMatchObject({ ok: false, why: expect.stringContaining('nothing in it') })
    expect(importSetup('x'.repeat(300_000))).toMatchObject({ ok: false, why: expect.stringContaining('too big') })
  })
  it('imports a version 1 file through the migration', () => {
    const r = importSetup(JSON.stringify({ kind: 'life-system/custom-setup', version: 1, setup: { widgets: [{ id: 'c', kind: 'counter', goal: 20 }], layout: { home: ['c'] } } }))
    expect(r.ok && r.setup.modes[0].layout.home).toEqual(['c'])
  })
})

describe('phase 3: names, island place and size, wallpaper', () => {
  it('no two widgets with the same name in one layout (auto " 2"); other modes keep theirs', () => {
    expect(uniqueName('Study list', ['study list'])).toBe('Study list 2')
    expect(uniqueName('Study list', ['Study list', 'Study list 2'])).toBe('Study list 3')
    expect(uniqueName('Water', ['Timer'])).toBe('Water')
    const s = cleanSetup({
      widgets: [
        { id: 'a', kind: 'checklist', title: 'Study list', items: [{ id: 'i', text: 'Read' }] },
        { id: 'b', kind: 'ring', title: 'Study list', of: 'a' },
        { id: 'c', kind: 'timer', title: 'Timer' },
        { id: 'd', kind: 'timer', title: 'Timer' }
      ],
      modes: [
        { id: 'm1', layout: { pill: ['a'], island: ['b'], home: ['c'] } },
        { id: 'm2', layout: { pill: ['d'], island: [], home: [] } }
      ]
    })
    expect(s.widgets.map((w) => w.title)).toEqual(['Study list', 'Study list 2', 'Timer', 'Timer'])
  })
  it('island position and open size are kept inside what an island can be', () => {
    const s = cleanSetup({ looks: { island: { position: 'top-left', openW: 5000, openH: -3 } } })
    expect(s.looks.island).toMatchObject({ position: 'top-left', openW: 900, openH: 0 })
    expect(cleanSetup({ looks: { island: { position: 'middle' } } }).looks.island.position).toBe('auto')
  })
  it('a mode\'s wallpaper keeps its evening picture (local only)', () => {
    const s = cleanSetup({ modes: [{ id: 'm', desktopWallpaper: { image: 'local:i1', night: 'C:\\x.jpg' } }, { id: 'n', desktopWallpaper: { image: 'local:i2', night: 'local:i3' } }] })
    expect(s.modes[0].desktopWallpaper).toEqual({ image: 'local:i1', night: '' })
    expect(s.modes[1].desktopWallpaper).toEqual({ image: 'local:i2', night: 'local:i3' })
  })
})
