import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { allHardWeek, dismissWarning, isDismissed, lighterOn, lighterReps, lowFood, setLighter, strengthDrops, trainWarnings, type WarnInput } from './trainWarnings'
import { mergeTrain } from './trainLog'

// Made-up data, pinned dates (2026-11-20 is a Friday).
const T = '2026-11-20'
const ex = [
  { id: 'd', name: 'diamond push-ups', move: 'diamond_pushup', unit: 'reps' },
  { id: 'r', name: 'Table rows', move: 'table_row', unit: 'reps' }
] as any[]
const set = (reps: number, extra: Record<string, unknown> = {}) => ({
  reps,
  ...extra
})
const base = (over: Partial<WarnInput> = {}): WarnInput => ({
  log: {},
  exercises: ex,
  today: T,
  perWeek: 5,
  food: null,
  dismissed: {},
  lighter: false,
  ...over
})

describe('smart warnings', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(`${T}T08:30:00`))
  })
  afterEach(() => vi.useRealTimers())

  it('strength dropping 2 sessions in a row on the same exercise', () => {
    const log = {
      '2026-11-14': { d: [set(12), set(11)] },
      '2026-11-17': { d: [set(11), set(10)] },
      '2026-11-19': { d: [set(10), set(9)] }
    }
    expect(strengthDrops(log, ex, T)).toEqual([{ exId: 'd', name: 'diamond push-ups', values: [12, 11, 10] }])
    const w = trainWarnings(base({ log }))
    expect(w).toHaveLength(1)
    expect(w[0]).toMatchObject({ id: 'tired', action: 'lighter' })
    expect(w[0].line).toMatch(/^Diamond push-ups went down 2 sessions in a row \(12 → 11 → 10\)\. That usually means tired, not weaker\./)
    // One drop only (up, then down) is not a warning; a heavier backpack counts as stronger.
    expect(strengthDrops({ ...log, '2026-11-17': { d: [set(13)] } }, ex, T)).toEqual([])
    expect(strengthDrops({ ...log, '2026-11-19': { d: [set(10, { kg: 5 })] } }, ex, T)).toEqual([])
    // Today's session in progress is not judged yet.
    expect(
      strengthDrops(
        {
          '2026-11-17': { d: [set(12)] },
          '2026-11-19': { d: [set(11)] },
          [T]: { d: [set(4)] }
        },
        ex,
        T
      )
    ).toEqual([])
  })

  it('"Hard" on everything for a week', () => {
    const h = (n: number) => Array.from({ length: n }, () => set(10, { feel: 'hard' }))
    const log = { '2026-11-17': { d: h(4) }, '2026-11-19': { r: h(4) } }
    expect(allHardWeek(log, T)).toBe(true)
    expect(trainWarnings(base({ log }))[0].line).toMatch(/^Every set felt hard this week/)
    expect(allHardWeek({ ...log, '2026-11-18': { d: [set(10, { feel: 'ok' })] } }, T)).toBe(false)
    expect(allHardWeek({ '2026-11-19': { r: h(8) } }, T)).toBe(false)
    // A lighter week already running: no tired warning.
    expect(trainWarnings(base({ log, lighter: true }))).toEqual([])
  })

  it('low food on 3 of the last 5 days', () => {
    const food = [
      { day: '2026-11-14', kcal: 1500 },
      { day: '2026-11-15', kcal: 1800 },
      { day: '2026-11-16', kcal: 1700 },
      { day: '2026-11-17', kcal: 0 },
      { day: '2026-11-18', kcal: 1900 },
      { day: '2026-11-19', kcal: 2400 },
      { day: T, kcal: 300 }
    ]
    expect(lowFood(food, T)).toEqual({ low: 3, of: 4 })
    const w = trainWarnings(base({ food }))
    expect(w).toEqual([
      {
        id: 'food',
        title: 'Eat a bit more',
        line: "You're training 5×/week but not eating enough to grow. Under 2,000 kcal on 3 of the last 4 days you logged.",
        action: 'food'
      }
    ])
    // Two low days only: nothing. Not training: nothing.
    expect(
      lowFood(
        food.map((d) => (d.day === '2026-11-18' ? { ...d, kcal: 2500 } : d)),
        T
      )
    ).toBeNull()
    expect(trainWarnings(base({ food, perWeek: 1 }))).toEqual([])
  })

  it('dismissed for a week, then shown again', () => {
    const st: any = {}
    dismissWarning(st, 'food', T)
    expect(isDismissed(st.trainWarnDismiss, 'food', T)).toBe(true)
    expect(isDismissed(st.trainWarnDismiss, 'food', '2026-11-26')).toBe(true)
    expect(isDismissed(st.trainWarnDismiss, 'food', '2026-11-27')).toBe(false)
    expect(isDismissed(st.trainWarnDismiss, 'tired', T)).toBe(false)
    const food = [
      { day: '2026-11-17', kcal: 1500 },
      { day: '2026-11-18', kcal: 1500 },
      { day: '2026-11-19', kcal: 1500 }
    ]
    expect(trainWarnings(base({ food, dismissed: st.trainWarnDismiss }))).toEqual([])
    // Two devices: the later dismiss wins per warning.
    const m: any = mergeTrain({ trainWarnDismiss: { food: '2026-11-01', tired: '2026-11-19' } }, { trainWarnDismiss: { food: T } })
    expect(m.trainWarnDismiss).toEqual({ food: T, tired: '2026-11-19' })
  })

  it('one tap sets a lighter week (70%) for the next 7 days', () => {
    const st: any = {}
    setLighter(st, T, 5)
    expect(st.trainLighter).toEqual({ from: T, until: '2026-11-26', at: 5 })
    expect(lighterOn(st, '2026-11-26')).toEqual({ until: '2026-11-26' })
    expect(lighterOn(st, '2026-11-27')).toBeNull()
    expect(lighterReps(10)).toBe(7)
    expect(lighterReps(1)).toBe(1)
    setLighter(st, T, 6, false)
    expect(lighterOn(st, T)).toBeNull()
    expect((mergeTrain({ trainLighter: { from: T, until: '2026-11-26', at: 9 } }, { trainLighter: st.trainLighter }) as any).trainLighter.at).toBe(9)
  })
})
