// "Make it yours": pill order, rules per kind, timings, clicks, chips, tucking
// away, and every view of the island opening and closing (IF4–IF11, IP3, IP6).
import { describe, expect, it } from 'vitest'
import {
  activities, alertGate, cleanIslandPrefs, DEFAULT_ISLAND_PREFS, EMPTY_ISLAND, ISLAND_UI, islandStep, islandTiming, isLive, meetingToOpen, pickAlert, pillBubbles, tuckState,
  type IslandSnapshot, type IslandUi, type IslandUiEvent, type IslandView
} from './islandModel'

const at = (h: number, m = 0) => new Date(2026, 10, 4, h, m).getTime()
const snap: IslandSnapshot = {
  ...EMPTY_ISLAND,
  locked: false,
  running: { subject: 'Math', startedAt: at(10), endsAt: at(10, 25) },
  next: { title: 'Gym', start: at(11), end: at(12) },
  ben: { ...EMPTY_ISLAND.ben, unread: 1, last: { text: 'Drink water now', at: new Date(at(9, 55)).toISOString(), face: '🙂' } },
  water: { ml: 500, target: 2000 },
  mustdos: [{ i: 0, text: 'Call the bank', done: false }, { i: 1, text: 'Read', done: true }],
  points: { balance: 120, goal: { title: 'Movie night', price: 200 } },
  tasks: [{ id: 't1', content: 'Send the report', time: '14:00' }]
}

describe('what the pill shows, in your order (IF4)', () => {
  it('keeps the old order by default (new items start off)', () => {
    expect(activities(snap, at(10, 5)).map((a) => a.kind)).toEqual(['timer', 'next', 'ben', 'water'])
  })
  it('follows your order and leaves out what you switched off', () => {
    const order = [{ id: 'water' as const, on: true }, { id: 'points' as const, on: true }, { id: 'timer' as const, on: true }, { id: 'ben' as const, on: false }, { id: 'mustdos' as const, on: true }, { id: 'tasks' as const, on: true }]
    const acts = activities(snap, at(10, 5), order)
    // Items you didn't place come after yours, in their default state.
    expect(acts.map((a) => a.kind)).toEqual(['water', 'points', 'timer', 'mustdos', 'tasks', 'next'])
    expect(acts[1]).toMatchObject({ text: '120 pts', sub: '80 to Movie night' })
    expect(acts.find((a) => a.kind === 'mustdos')).toMatchObject({ text: 'Call the bank', sub: '1 must-do left' })
  })
  it('something starting within 10 minutes moves up, right after a running timer', () => {
    expect(activities(snap, at(10, 52)).map((a) => a.kind)).toEqual(['timer', 'next', 'ben', 'water'])
    const noTimer = { ...snap, running: null }
    expect(activities(noTimer, at(10, 52), [{ id: 'water', on: true }, { id: 'next', on: true }]).map((a) => a.kind)).toEqual(['next', 'water', 'ben'])
  })
  it('the two bubbles read the same order', () => {
    const acts = activities(snap, at(10, 5))
    expect(pillBubbles(acts)).toMatchObject({ main: { kind: 'timer' }, second: { kind: 'next' } })
    expect(pillBubbles(acts, 'water')).toMatchObject({ main: { kind: 'water' }, second: { kind: 'timer' } })
    expect(pillBubbles([])).toEqual({ main: null, second: null })
  })
  it('never brings back the streak flame', () => {
    expect(cleanIslandPrefs({ pillOrder: [{ id: 'streak', on: true }] }).pillOrder.map((x) => x.id)).not.toContain('streak')
  })
})

describe('rules per kind (IF5)', () => {
  const base = { prefs: DEFAULT_ISLAND_PREFS, quiet: false, call: false, lastPeekAt: 0, now: 10_000_000 }
  const withRule = (k: keyof typeof DEFAULT_ISLAND_PREFS.kinds, show: 'peek' | 'dot' | 'never') => cleanIslandPrefs({ kinds: { [k]: { show } } })
  it('peek, a dot only, or never', () => {
    expect(alertGate({ ...base, kind: 'water', prefs: withRule('water', 'dot') })).toBe('silent')
    expect(alertGate({ ...base, kind: 'water', prefs: withRule('water', 'never') })).toBe('drop')
    expect(alertGate({ ...base, kind: 'over', prefs: withRule('over', 'dot') })).toBe('silent')
  })
  it('a meeting starting has its own rule, separate from plain blocks', () => {
    const p = withRule('meeting', 'never')
    expect(alertGate({ ...base, kind: 'block', meeting: true, prefs: p })).toBe('drop')
    expect(alertGate({ ...base, kind: 'block', prefs: p })).toBe('peek')
    const blocks = [{ title: 'Team call', start: at(10), end: at(10, 30), call: true }]
    expect(pickAlert({ now: at(10), running: null, blocks, log: [], seenBen: 0, dismissed: {} })).toMatchObject({ kind: 'block', meeting: true })
  })
  it('old on/off settings become peek / never', () => {
    const p = cleanIslandPrefs({ kinds: { eyes: { on: false, sound: true }, water: { on: true, sound: false } } })
    expect(p.kinds.eyes).toEqual({ on: false, sound: true, show: 'never' })
    expect(p.kinds.water).toEqual({ on: true, sound: false, show: 'peek' })
    expect(p.kinds.meeting.show).toBe('peek')
  })
  it('opens the panel N minutes before a meeting you said yes to', () => {
    const s = { ...snap, next: { title: 'Team call', start: at(11), end: at(11, 30), call: true } }
    expect(meetingToOpen(s, at(10, 56), 5)).toBe(`meet:${at(11)}:Team call`)
    expect(meetingToOpen(s, at(10, 50), 5)).toBeNull()
    expect(meetingToOpen(s, at(10, 56), 0)).toBeNull()
    expect(meetingToOpen({ ...s, next: { ...s.next, maybe: 'tentative' } }, at(10, 56), 5)).toBeNull()
    expect(meetingToOpen({ ...s, next: { ...s.next, call: false } }, at(10, 56), 5)).toBeNull()
  })
  it('your gap between pop-ups', () => {
    const p = cleanIslandPrefs({ gapMin: 0 })
    expect(alertGate({ ...base, prefs: p, kind: 'water', lastPeekAt: base.now - 1000 })).toBe('peek')
    const long = cleanIslandPrefs({ gapMin: 10 })
    expect(alertGate({ ...base, prefs: long, kind: 'water', lastPeekAt: base.now - 5 * 60_000 })).toBe('silent')
  })
})

describe('your settings are cleaned (IF3, IF7, IF8, IF10, IF11, IP3)', () => {
  it('defaults', () => {
    const p = cleanIslandPrefs(null)
    expect(p).toMatchObject({ openOn: 'hover', hoverMs: 350, peekSec: 5, gapMin: 3, leaveSec: 2, idleMin: 0, idleLook: 'dot', pillHeight: 38, peekWidth: 400, panelWidth: 460, meetingOpenMin: 0 })
    expect(p.clicks).toEqual({ left: 'panel', middle: 'timer', right: 'quiet' })
    expect(p.chips).toEqual({ water: [250, 500], reps: [10], focus: [25] })
  })
  it('clamps numbers and drops nonsense', () => {
    const p = cleanIslandPrefs({ hoverMs: 5, peekSec: 999, pillHeight: 10, panelWidth: 2000, clicks: { left: 'explode', right: 'app' }, chips: { water: [300, 300, 'x', 5, 750], reps: [], focus: [45, 15] }, openOn: 'click' })
    expect(p).toMatchObject({ hoverMs: 100, peekSec: 60, pillHeight: 28, panelWidth: 640, openOn: 'click' })
    expect(p.clicks).toEqual({ left: 'panel', middle: 'timer', right: 'app' })
    expect(p.chips).toEqual({ water: [300, 750], reps: [10], focus: [45, 15] })
  })
  it('the old "tucks away" pick becomes seconds', () => {
    expect(cleanIslandPrefs({ hide: 'slow' }).leaveSec).toBe(4)
    expect(cleanIslandPrefs({ hide: 'slow', leaveSec: 7.25 }).leaveSec).toBe(7.3)
  })
  it('any real shortcut is kept; nonsense goes back to the default', () => {
    expect(cleanIslandPrefs({ shortcut: 'ctrl+alt+shift+j', quietShortcut: '' })).toMatchObject({ shortcut: 'Control+Alt+Shift+J', quietShortcut: '' })
    expect(cleanIslandPrefs({ shortcut: 'J' }).shortcut).toBe('Control+Shift+Space')
  })
})

describe('tucks away when idle (IP3)', () => {
  it('nothing live for N minutes: a dot or faded; back on hover or when it opens', () => {
    const o = { now: at(12), lastLiveAt: at(11, 40), idleMin: 15, idleLook: 'dot' as const, over: false, view: 'compact' as IslandView }
    expect(tuckState(o)).toBe('dot')
    expect(tuckState({ ...o, idleLook: 'fade' })).toBe('fade')
    expect(tuckState({ ...o, over: true })).toBe('none')
    expect(tuckState({ ...o, view: 'peek' })).toBe('none')
    expect(tuckState({ ...o, idleMin: 0 })).toBe('none')
    expect(tuckState({ ...o, lastLiveAt: at(11, 50) })).toBe('none')
  })
  it('knows what is live', () => {
    expect(isLive(snap, at(10, 5))).toBe(true)
    expect(isLive({ ...EMPTY_ISLAND, locked: false, water: { ml: 0, target: 2000 } }, at(10))).toBe(false)
    expect(isLive({ ...EMPTY_ISLAND, next: { title: 'Gym', start: at(10, 8), end: at(11) } }, at(10))).toBe(true)
  })
})

// IP6: every view, every event: where it goes and what timer it sets.
describe('the island states, view by view (IP6)', () => {
  const t = islandTiming(DEFAULT_ISLAND_PREFS)
  const ui = (view: IslandView, extra: Partial<IslandUi> = {}): IslandUi => ({ ...ISLAND_UI, view, ...extra })
  const go = (u: IslandUi, ...events: IslandUiEvent[]) => events.reduce((s, e) => islandStep(s, e, t).ui, u)

  it('compact: hover peeks after your delay, click and toggle open, an alert peeks', () => {
    expect(islandStep(ui('compact'), { type: 'hover', on: true }, t).timer).toEqual({ ms: 350, event: { type: 'hoverHeld' } })
    expect(go(ui('compact'), { type: 'hover', on: true }, { type: 'hoverHeld' }).view).toBe('peek')
    expect(go(ui('compact'), { type: 'click' }).view).toBe('expanded')
    expect(islandStep(ui('compact'), { type: 'toggle' }, t)).toMatchObject({ ui: { view: 'expanded' }, focusInput: true })
    expect(islandStep(ui('compact'), { type: 'alert' }, t)).toMatchObject({ ui: { view: 'peek', byAlert: true }, timer: { ms: 5000 } })
    for (const e of [{ type: 'leave' }, { type: 'close' }, { type: 'blur' }, { type: 'alertEnd' }] as IslandUiEvent[]) expect(go(ui('compact'), e).view).toBe('compact')
  })
  it('peek: leaving shrinks it, a click opens, Escape closes', () => {
    const peek = ui('peek', { over: true })
    expect(islandStep(peek, { type: 'hover', on: false }, t).timer).toEqual({ ms: 700, event: { type: 'leave' } })
    expect(go(peek, { type: 'hover', on: false }, { type: 'leave' }).view).toBe('compact')
    expect(go(peek, { type: 'click' }).view).toBe('expanded')
    expect(go(peek, { type: 'close' }).view).toBe('compact')
    // An alert peek ends by itself unless the mouse is on it.
    expect(go(ui('peek', { byAlert: true }), { type: 'alertEnd' }).view).toBe('compact')
    expect(go(ui('peek', { byAlert: true, over: true }), { type: 'alertEnd' }).view).toBe('peek')
  })
  it('expanded: stays while the mouse is on it or you type; goes after your time away, on blur, Escape or toggle', () => {
    const open = ui('expanded', { over: true })
    expect(islandStep(open, { type: 'hover', on: false }, t).timer).toEqual({ ms: 2000, event: { type: 'leave' } })
    expect(go(open, { type: 'hover', on: false }, { type: 'leave' }).view).toBe('compact')
    expect(go(open, { type: 'leave' }).view).toBe('expanded')
    expect(go(ui('expanded', { typing: true }), { type: 'blur' }).view).toBe('expanded')
    expect(go(ui('expanded', { pinned: true }), { type: 'leave' }).view).toBe('expanded')
    expect(go(ui('expanded'), { type: 'blur' }).view).toBe('compact')
    expect(go(ui('expanded', { pinned: true, typing: true }), { type: 'close' })).toMatchObject({ view: 'compact', pinned: false, typing: false })
    expect(go(ui('expanded'), { type: 'toggle' }).view).toBe('compact')
    expect(go(ui('expanded'), { type: 'alert' }).view).toBe('expanded')
    expect(go(ui('expanded'), { type: 'click' }).view).toBe('expanded')
  })
  it('open on click only: no peek on hover (IF7)', () => {
    const click = islandTiming({ ...DEFAULT_ISLAND_PREFS, openOn: 'click' })
    expect(islandStep(ui('compact'), { type: 'hover', on: true }, click).timer).toBeNull()
    expect(islandStep(ui('compact'), { type: 'click' }, click).ui.view).toBe('expanded')
  })
  it('your timings (IF11)', () => {
    const mine = islandTiming(cleanIslandPrefs({ hoverMs: 900, peekSec: 12, leaveSec: 6 }))
    expect(islandStep(ui('compact'), { type: 'hover', on: true }, mine).timer?.ms).toBe(900)
    expect(islandStep(ui('compact'), { type: 'alert' }, mine).timer?.ms).toBe(12_000)
    expect(islandStep(ui('expanded', { over: true }), { type: 'hover', on: false }, mine).timer?.ms).toBe(6000)
    // The old 'fast' / 'normal' / 'slow' argument still works.
    expect(islandStep(ui('expanded', { over: true }), { type: 'hover', on: false }, 'slow').timer?.ms).toBe(4000)
  })
  it('a meeting opens the panel by itself and it goes again if untouched (IF5)', () => {
    const s = islandStep(ui('compact'), { type: 'autoOpen', ms: 60_000 }, t)
    expect(s).toMatchObject({ ui: { view: 'expanded', byAlert: true }, timer: { ms: 60_000, event: { type: 'leave' } } })
    expect(go(s.ui, { type: 'leave' }).view).toBe('compact')
    expect(go(s.ui, { type: 'hover', on: true }, { type: 'leave' }).view).toBe('expanded')
  })
})
