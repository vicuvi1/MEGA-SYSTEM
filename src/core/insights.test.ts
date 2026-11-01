import { describe, expect, it } from 'vitest'
import { bestStreak, currentStreak, insights, weekday } from './insights'
import type { ProgressInput } from './progress'

const base = (over: Partial<ProgressInput> = {}): ProgressInput => ({ today: '2026-11-01', focus: [], wakes: [], workouts: [], discipline: [], todoist: [], spending: null, mustdos: [], ...over })

describe('insights', () => {
  it('weekday works on plain dates', () => {
    expect(weekday('2026-11-01')).toBe(0) // a Sunday
    expect(weekday('2026-11-02')).toBe(1)
  })

  it('counts streaks up to today, or yesterday when today is not done yet', () => {
    const s = new Set(['2026-10-29', '2026-10-30', '2026-10-31'])
    expect(currentStreak(s, '2026-11-01')).toBe(3)
    expect(currentStreak(new Set([...s, '2026-11-01']), '2026-11-01')).toBe(4)
    expect(currentStreak(new Set(['2026-10-20']), '2026-11-01')).toBe(0)
    expect(bestStreak(new Set(['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07']))).toBe(3)
  })

  it('builds a year of days with levels from what counted', () => {
    const r = insights(
      base({
        focus: [
          { day: '2026-11-01', minutes: 30 },
          { day: '2026-11-01', minutes: 25 },
          { day: '2026-10-31', minutes: 20 }
        ],
        wakes: [{ day: '2026-11-01', onTime: true }, { day: '2026-10-31', onTime: false }],
        workouts: [{ day: '2026-11-01' }],
        todoist: [{ day: '2026-11-01' }]
      })
    )
    expect(r.days).toHaveLength(364)
    const today = r.days[r.days.length - 1]
    expect(today.day).toBe('2026-11-01')
    expect(today.focusMin).toBe(55)
    expect(today.count).toBe(4) // focus 50+, wake, workout, task
    expect(today.level).toBe(4)
    expect(r.days[r.days.length - 2].count).toBe(0) // 20 min and a late wake-up don't count
    expect(r.activeDays).toBe(1)
    expect(r.totalFocusMin).toBe(75)
    expect(r.streaks.find((s) => s.id === 'focus')!.current).toBe(1)
  })

  it('clean days run from the start, minus resets', () => {
    const r = insights(base({ discipline: [{ kind: 'start', day: '2026-10-25' }, { kind: 'reset', day: '2026-10-28' }] }))
    const clean = r.streaks.find((s) => s.id === 'clean')!
    expect(clean.current).toBe(4) // 29, 30, 31, 1
    expect(clean.best).toBe(4)
  })

  it('clean days follow the current streak (latest start, after resets), like Discipline', () => {
    // An old start long ago, a reset, then a new start: the streak is 3 days (Oct 30, 31, Nov 1).
    const r = insights(base({ discipline: [{ kind: 'start', day: '2026-09-01' }, { kind: 'reset', day: '2026-10-20' }, { kind: 'start', day: '2026-10-29' }] }))
    const clean = r.streaks.find((s) => s.id === 'clean')!
    expect(clean.current).toBe(3)
    expect(r.days.filter((d) => d.parts.includes('Clean day')).length).toBe(3)
  })
})

