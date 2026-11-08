import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { liveActivities, mmss, splitPill, workoutAfterLog, workoutUndo, REST_SEC, WORKOUT_GAP_MS, type LiveInput } from './islandLive'

const T = new Date(2031, 2, 14, 10, 0, 0).getTime()
const MIN = 60_000
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T)
})
afterEach(() => vi.useRealTimers())

const timer = { subject: 'Write the essay', startedAt: T - 5 * MIN, endsAt: T + 20 * MIN }
const music = { playing: true, title: 'Made-up track', artist: 'Someone' }

describe('live activities', () => {
  it('formats times', () => {
    expect(mmss(75)).toBe('1:15')
    expect(mmss(3725)).toBe('1:02:05')
    expect(mmss(-65)).toBe('+1:05')
  })
  it('orders by what matters most', () => {
    const l = liveActivities({ now: T, running: timer, music, eyes: { endsAt: T + 12_000 } })
    expect(l.map((a) => a.kind)).toEqual(['eyes', 'timer', 'music'])
    expect(l[1].value).toBe('20:00')
    expect(l[0].urgent).toBe(true)
  })
  it('a timer that ran over beats a meeting soon; a paused one drops below a rest', () => {
    const over = liveActivities({ now: T, running: { ...timer, endsAt: T - MIN }, next: { title: 'Standup', start: T + 10 * MIN, end: T + 25 * MIN, call: true } })
    expect(over.map((a) => [a.kind, a.prio])).toEqual([['timer', 95], ['meeting', 60]])
    expect(over[0].value).toBe('+1:00')
    const paused = liveActivities({ now: T, running: { ...timer, pausedAt: T - MIN }, workout: workoutAfterLog(null, 'Push-ups', 25, T - 10_000) })
    expect(paused.map((a) => a.kind)).toEqual(['workout', 'timer'])
    expect(paused[1].value).toBe('⏸ 21:00')
  })
  it('a meeting counts down, then is "now"', () => {
    const b = { title: 'Standup', start: T + 90_000, end: T + 16 * MIN, call: true }
    const [m] = liveActivities({ now: T, next: b })
    expect(m).toMatchObject({ kind: 'meeting', value: 'in 1:30', prio: 90, urgent: true })
    expect(liveActivities({ now: T + 2 * MIN, current: b })[0].value).toBe('now')
    expect(liveActivities({ now: T, next: { ...b, call: false } })).toEqual([])
    expect(liveActivities({ now: T, next: { ...b, start: T + 2 * 3600_000, end: T + 3 * 3600_000 } })).toEqual([])
  })
  it('water only when behind pace; paused music is low', () => {
    expect(liveActivities({ now: T, water: { ml: 500, target: 2000 } })).toEqual([])
    expect(liveActivities({ now: T, water: { ml: 500, target: 2000 }, waterBehind: true })[0]).toMatchObject({ kind: 'water', value: '500 / 2000 ml', progress: 0.25 })
    expect(liveActivities({ now: T, music: { ...music, playing: false } })[0]).toMatchObject({ prio: 15, value: 'Paused' })
  })
  it('the look can switch kinds off', () => {
    expect(liveActivities({ now: T, running: timer, music, allow: { music: false } }).map((a) => a.kind)).toEqual(['timer'])
  })
})

describe('split pill: which two win', () => {
  const pick = (i: Omit<LiveInput, 'now'>, split = true) => {
    const s = splitPill(liveActivities({ now: T, ...i }), split)
    return [s.left?.kind ?? null, s.right?.kind ?? null]
  }
  it('timer left, music right', () => expect(pick({ running: timer, music })).toEqual(['timer', 'music']))
  it('timer left, water right when behind', () => expect(pick({ running: timer, water: { ml: 200, target: 2000 }, waterBehind: true })).toEqual(['timer', 'water']))
  it('the top two win; a third waits', () => expect(pick({ running: timer, music, eyes: { endsAt: T + 10_000 } })).toEqual(['eyes', 'timer']))
  it('a companion never takes the left from a main thing', () => {
    // A meeting 40 min away (prio 30) is below playing music (50), but music stays right.
    expect(pick({ music, next: { title: 'Standup', start: T + 40 * MIN, end: T + 55 * MIN, call: true } })).toEqual(['meeting', 'music'])
  })
  it('one thing: no split; split off: one thing', () => {
    expect(pick({ running: timer })).toEqual(['timer', null])
    expect(pick({ running: timer, music }, false)).toEqual(['timer', null])
    expect(pick({})).toEqual([null, null])
  })
  it('paused music still shares the pill (it is at the floor)', () => expect(pick({ running: timer, music: { ...music, playing: false } })).toEqual(['timer', 'music']))
})

describe('the island workout', () => {
  it('counts sets and starts a rest', () => {
    const a = workoutAfterLog(null, 'Push-ups', 25, T)
    expect(a).toEqual({ name: 'Push-ups', sets: 1, reps: 25, lastAt: T, restEndsAt: T + REST_SEC * 1000 })
    const b = workoutAfterLog(a, 'Push-ups', 10, T + 2 * MIN)
    expect(b).toMatchObject({ sets: 2, reps: 35 })
    expect(liveActivities({ now: T + 2 * MIN + 30_000, workout: b })[0]).toMatchObject({ label: 'Set 2 · Push-ups', value: 'Rest 1:00' })
    expect(liveActivities({ now: T + 10 * MIN, workout: b })[0]).toMatchObject({ value: '35 reps', prio: 45 })
    expect(liveActivities({ now: T + 2 * MIN + WORKOUT_GAP_MS, workout: b })).toEqual([])
    expect(workoutAfterLog(b, 'Squats', 20, T + 3 * MIN)).toMatchObject({ sets: 1, reps: 20 })
    expect(workoutAfterLog(b, 'Push-ups', 20, T + 2 * MIN + WORKOUT_GAP_MS)).toMatchObject({ sets: 1 })
  })
  it('undo takes one set back', () => {
    const b = workoutAfterLog(workoutAfterLog(null, 'Push-ups', 25, T), 'Push-ups', 10, T + MIN)
    expect(workoutUndo(b, 10)).toMatchObject({ sets: 1, reps: 25, restEndsAt: null })
    expect(workoutUndo(workoutUndo(b, 10), 25)).toBeNull()
  })
})
