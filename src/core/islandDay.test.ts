import { describe, expect, it } from 'vitest'
import { centerCovers, dayParts, DAY_MAIN, DAY_MORE, peekInstant, quickRow } from './islandDay'

const none = { water: false, reps: false, timer: false }

describe('one water control, one push-up button, one focus button', () => {
  it('the quick row has each once', () => {
    expect(quickRow({ covers: none, running: false, hasReps: true })).toEqual(['water', 'reps', 'focus'])
  })
  it('no focus while a timer runs (the timer card has Stop), no push-ups without an exercise', () => {
    expect(quickRow({ covers: none, running: true, hasReps: false })).toEqual(['water'])
  })
  it('nothing while locked', () => {
    expect(quickRow({ covers: none, running: false, hasReps: true, locked: true })).toEqual([])
  })
  it('a Custom Center widget replaces the built-in one', () => {
    const covers = centerCovers([{ kind: 'counter', track: 'water' }, { kind: 'counter', track: 'reps' }, { kind: 'timer' }])
    expect(covers).toEqual({ water: true, reps: true, timer: true })
    expect(quickRow({ covers, running: false, hasReps: true })).toEqual([])
    expect(quickRow({ covers: centerCovers([{ kind: 'counter', track: 'none' }]), running: false, hasReps: true })).toEqual(['water', 'reps', 'focus'])
    expect(centerCovers(null)).toEqual(none)
  })
})

describe('the hover peek has no repeats', () => {
  const all = ['push10', 'push25', 'water250', 'focus25'] as const
  it('no second ▶ (the peek has its own Start / Focus)', () => {
    expect(peekInstant(all, none)).toEqual(['push10', 'push25', 'water250'])
  })
  it('your pill counters replace the built-in water and push-ups', () => {
    expect(peekInstant(all, { water: true, reps: false })).toEqual(['push10', 'push25'])
    expect(peekInstant(all, { water: true, reps: true })).toEqual([])
  })
})

describe('the Day page is short', () => {
  it('one to-do list and one quick row, in a fixed order', () => {
    expect(DAY_MAIN.filter((p) => p === 'today')).toHaveLength(1)
    expect(DAY_MAIN.filter((p) => p === 'quick')).toHaveLength(1)
    expect(dayParts({ alert: true, running: false, sleep: false, today: true, quick: 3, center: false, ben: false })).toEqual(['alert', 'today', 'quick'])
  })
  it('the rest is behind More, never both', () => {
    for (const p of DAY_MORE) expect((DAY_MAIN as readonly string[]).includes(p)).toBe(false)
  })
})
