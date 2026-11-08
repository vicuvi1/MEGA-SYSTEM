import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { instantAllowed, instantButtons, inverseAction, pushupsOf, scrubAction, INSTANT_GUARD_MS } from './islandInstant'
import { applyExpected, expectPatch } from './islandCommands'
import { EMPTY_ISLAND, type IslandAction, type IslandSnapshot } from './islandModel'

const T = new Date(2031, 2, 14, 10, 0, 0).getTime()
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T)
})
afterEach(() => vi.useRealTimers())

const snap: IslandSnapshot = { ...EMPTY_ISLAND, locked: false, at: T, water: { ml: 500, target: 2000 }, reps: [{ id: 'sq', name: 'Squats', done: 0, target: 50 }, { id: 'pu', name: 'Push-ups', done: 10, target: 100 }] }

describe('instant buttons', () => {
  it('push-ups use your Sport Track push-ups', () => {
    expect(pushupsOf(snap)).toEqual({ id: 'pu', name: 'Push-ups' })
    expect(pushupsOf({ reps: [] })).toEqual({ id: 'pushups', name: 'Push-ups' })
  })
  it('makes the usual actions (no new kinds, no points here)', () => {
    const b = instantButtons(['push10', 'push25', 'push50', 'water250', 'focus25'], snap)
    expect(b.map((x) => x.label)).toEqual(['+10', '+25', '+50', '+250 ml', '▶ 25 min'])
    expect(b[1].action).toEqual({ kind: 'reps', id: 'pu', name: 'Push-ups', n: 25 })
    expect(b[3].action).toEqual({ kind: 'water', ml: 250 })
    expect(b[4].action).toEqual({ kind: 'start', subject: 'Focus', minutes: 25 })
  })
  it('no start while a timer runs, nothing while locked', () => {
    const running = { ...snap, running: { subject: 'x', startedAt: T, endsAt: T + 60_000 } }
    expect(instantButtons(['focus25', 'water250'], running).map((x) => x.id)).toEqual(['water250'])
    expect(instantButtons(['water250'], { ...snap, locked: true })).toEqual([])
  })
  it('a scrolled counter logs its number', () => {
    expect(scrubAction('reps', 37, snap)).toEqual({ kind: 'reps', id: 'pu', name: 'Push-ups', n: 37 })
    expect(scrubAction('water', 400, snap)).toEqual({ kind: 'water', ml: 400 })
  })
})

describe('optimistic + undo', () => {
  it('a tap shows at once, its undo takes it back at once', () => {
    const a = scrubAction('reps', 25, snap)
    const after = expectPatch(snap, { ...a, ex: 'pu' } as IslandAction, T)
    expect(after.reps.find((r) => r.id === 'pu')?.done).toBe(35)
    const inv = inverseAction(a) as IslandAction
    expect(applyExpected(after, [{ id: 'u', action: { ...inv, ex: 'pu' } as IslandAction, at: T + 1 }]).reps.find((r) => r.id === 'pu')?.done).toBe(10)
    const w = expectPatch(snap, { kind: 'water', ml: 250 }, T)
    expect(expectPatch(w, inverseAction({ kind: 'water', ml: 250 })!, T).water.ml).toBe(500)
    expect(inverseAction({ kind: 'start', subject: 'x', minutes: 25 })).toEqual({ kind: 'stop' })
    expect(inverseAction({ kind: 'chat', text: 'hi' })).toBeNull()
  })
  it('a double-click logs once', () => {
    expect(instantAllowed(null, 'push25', T)).toBe(true)
    expect(instantAllowed({ key: 'push25', at: T }, 'push25', T + 100)).toBe(false)
    expect(instantAllowed({ key: 'push25', at: T }, 'push10', T + 100)).toBe(true)
    expect(instantAllowed({ key: 'push25', at: T }, 'push25', T + INSTANT_GUARD_MS)).toBe(true)
  })
})
