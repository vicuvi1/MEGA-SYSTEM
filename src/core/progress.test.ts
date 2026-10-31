import { describe, expect, it } from 'vitest'
import { addDays } from './dates'
import { progressReport, progressText, type ProgressInput } from './progress'

const today = '2026-10-31'
const days = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, k) => addDays(today, -(from + k)))
const empty: ProgressInput = { today, focus: [], wakes: [], workouts: [], discipline: [], todoist: [], spending: null }

describe('progressReport', () => {
  it('compares the last 7 days with your usual week', () => {
    const r = progressReport({
      ...empty,
      // 60 min a day for the 4 weeks before, 120 a day now: better
      focus: [...days(0, 6).map((day) => ({ day, minutes: 120 })), ...days(7, 34).map((day) => ({ day, minutes: 60 }))],
      // wake-ups on time every day before, 2 of 7 now: worse
      wakes: [...days(0, 6).map((day, k) => ({ day, onTime: k < 2 })), ...days(7, 34).map((day) => ({ day, onTime: true }))],
      discipline: [{ kind: 'start', day: addDays(today, -40) }, { kind: 'reset', day: addDays(today, -2) }],
      spending: [{ day: today, bani: 50_000 }, { day: addDays(today, -8), bani: 50_000 }]
    })
    const m = Object.fromEntries(r.metrics.map((x) => [x.id, x]))
    expect(m.focus).toMatchObject({ now: 840, prev: 420, trend: 'better', text: '14h 00m' })
    expect(m.wake).toMatchObject({ now: 2, prev: 7, trend: 'worse', text: '2/7' })
    expect(m.clean).toMatchObject({ now: 6, prev: 7 })
    expect(m.spend.text).toBe('500 lei')
    expect(m.focus.weeks).toHaveLength(6)
    expect(r.better).toContain('focus')
    expect(r.worse).toContain('wake')
    expect(progressText(r)).toContain('🟢 Focus time: <b>14h 00m</b>')
  })

  it('says so when nothing is logged yet, and leaves out what this device lacks', () => {
    const r = progressReport(empty)
    expect(r.verdict).toMatch(/Not enough logged yet/)
    expect(r.metrics.map((m) => m.id)).not.toContain('spend')
  })

  it('small wobbles are "same", not news', () => {
    const r = progressReport({ ...empty, todoist: [...days(0, 6), ...days(7, 34)].map((day) => ({ day })).concat([{ day: today }]) })
    expect(r.metrics.find((m) => m.id === 'todoist')!.trend).toBe('same')
  })
})
