import { describe, expect, it } from 'vitest'
import { suppKind, suppStreak, suppsFor, takenDays, todaysTick } from './supplements'

const ev = (id: string, day: string, amount = 1, undoes: string | null = null) => ({ id, at: `${day}T08:00:00Z`, day, kind: suppKind('creatine'), amount, source: 'web', undoes })

describe('supplements (BD17)', () => {
  it('vitamin D only in the darker months', () => {
    expect(suppsFor('2026-11-07', ['creatine', 'vitd']).map((s) => s.id)).toEqual(['creatine', 'vitd'])
    expect(suppsFor('2026-07-07', ['creatine', 'vitd']).map((s) => s.id)).toEqual(['creatine'])
    expect(suppsFor('2026-11-07', [])).toEqual([])
  })
  it('a streak of honest ticks; a removed tick does not count', () => {
    const events = [ev('a', '2026-11-04'), ev('b', '2026-11-05'), ev('c', '2026-11-06'), ev('d', '2026-11-07'), ev('x-d', '2026-11-07', 0, 'd')]
    const days = takenDays(events, 'creatine')
    expect([...days].sort()).toEqual(['2026-11-04', '2026-11-05', '2026-11-06'])
    expect(suppStreak(days, '2026-11-07')).toBe(3)
    expect(suppStreak(days, '2026-11-09')).toBe(0)
    expect(todaysTick(events, 'creatine', '2026-11-07')).toBeNull()
    expect(todaysTick(events, 'creatine', '2026-11-06')).toBe('c')
  })
})
