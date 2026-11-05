import { describe, expect, it } from 'vitest'
import { missTwiceLine, neverMissTwice } from './neverMissTwice'

const base = { today: '2026-11-05', focus: [{ day: '2026-11-02', minutes: 50 }], workoutDays: ['2026-11-01'], restDays: [] as string[] }

describe('never miss twice (D4)', () => {
  it('a missed day after a habit offers the small version', () => {
    const items = neverMissTwice(base)
    expect(items.map((x) => x.id)).toEqual(['focus', 'workout'])
    expect(missTwiceLine(items)).toMatch(/15 minutes of focus and 10 push-ups/)
  })
  it('nothing when yesterday was fine, today is done, or it was a rest day', () => {
    expect(neverMissTwice({ ...base, focus: [...base.focus, { day: '2026-11-04', minutes: 30 }], workoutDays: [...base.workoutDays, '2026-11-04'] })).toEqual([])
    expect(neverMissTwice({ ...base, focus: [...base.focus, { day: '2026-11-05', minutes: 20 }], restDays: ['2026-11-04'] })).toEqual([])
  })
  it('no habit yet, no nagging', () => {
    expect(neverMissTwice({ today: '2026-11-05', focus: [], workoutDays: [], restDays: [] })).toEqual([])
    expect(missTwiceLine([])).toBeNull()
  })
})
