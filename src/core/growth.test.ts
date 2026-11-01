import { describe, expect, it } from 'vitest'
import { growth, newMilestones } from './growth'
import type { ProgressInput } from './progress'
import { addDays } from './dates'

const today = '2026-11-01'
const base = (over: Partial<ProgressInput> = {}): ProgressInput => ({ today, focus: [], wakes: [], workouts: [], discipline: [], todoist: [], spending: null, mustdos: [], ...over })

describe('growth', () => {
  it('weekly series, you vs your past, best week and a new record', () => {
    // 4 earlier weeks of 60 min/week, then 300 min this week.
    const focus = [0, 1, 2, 3].map((k) => ({ day: addDays(today, -7 * (k + 1)), minutes: 60 }))
    focus.push({ day: today, minutes: 200 }, { day: addDays(today, -2), minutes: 100 })
    const g = growth(base({ focus }), 8)
    const f = g.metrics.find((m) => m.id === 'focus')!
    expect(f.weeks).toHaveLength(8)
    expect(f.thisWeek).toBe(300)
    expect(f.lastWeek).toBe(60)
    expect(f.avg4).toBe(60)
    expect(f.vsLast).toBe(400)
    expect(f.record).toBe(true)
    expect(f.best?.value).toBe(300)
    expect(g.records.bestFocusDay).toEqual({ day: today, minutes: 200 })
  })

  it('spending: lower is better, no record flag', () => {
    const g = growth(base({ spending: [{ day: today, bani: 50000 }, { day: addDays(today, -7), bani: 80000 }] }), 4)
    const s = g.metrics.find((m) => m.id === 'spend')!
    expect(s.best?.value).toBe(50000)
    expect(s.vsLast).toBe(-37) // 500 vs 800 lei: −37.5% rounds to −37
    expect(s.record).toBe(false)
  })

  it('months and milestones (reached with the day, then only the next one)', () => {
    const focus = Array.from({ length: 15 }, (_, k) => ({ day: addDays(today, -k), minutes: 60 }))
    const g = growth(base({ focus, workouts: [{ day: today }] }))
    const f = g.metrics.find((m) => m.id === 'focus')!
    expect(f.months).toHaveLength(12)
    expect(f.months[11]).toEqual({ label: '2026-11', value: 60 })
    expect(f.months[10]).toEqual({ label: '2026-10', value: 14 * 60 })
    const fm = g.milestones.filter((m) => m.id.startsWith('focus-'))
    expect(fm.map((m) => [m.id, m.at])).toEqual([
      ['focus-10', addDays(today, -5)],
      ['focus-25', null]
    ])
    expect(fm[1].progress).toBeCloseTo(15 / 25)
    expect(newMilestones(g.milestones, []).map((m) => m.id)).toEqual(['focus-10'])
    expect(newMilestones(g.milestones, ['focus-10'])).toEqual([])
  })
})
