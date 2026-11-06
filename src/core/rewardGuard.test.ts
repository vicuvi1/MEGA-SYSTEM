import { describe, expect, it } from 'vitest'
import type { LedgerEntry } from './ledger'
import { cleanRules, funPace, guardBlocker, ruleTags, setRules, todayDeeds } from './rewardGuard'

const e = (id: number, day: string, module: string, coins: number, ruleId: string | null = null): LedgerEntry => ({ id, ts: `${day}T10:00:00Z`, day, module, kind: 'earn', coins, xp: 0, ruleId })

describe('healthy limits', () => {
  it('keeps only sane rules', () => {
    expect(cleanRules({ 3: { perDay: 2 }, 4: { pair: 'workout' }, x: { perDay: 1 }, 5: { perDay: 0, pair: 'nap' } })).toEqual({ 3: { perDay: 2 }, 4: { pair: 'workout' } })
    expect(setRules({ 3: { perDay: 2 } }, 3, null)).toEqual({})
    expect(setRules({}, 9, { perDay: 1, pair: 'focus' })).toEqual({ 9: { perDay: 1, pair: 'focus' } })
  })
  it('reads today from the ledger (undone rows do not count)', () => {
    const rows = [e(1, '2026-11-05', 'body', 10, 'body.workout_done'), e(2, '2026-11-04', 'focus', 15, 'focus.session'), { ...e(3, '2026-11-05', 'body', 0), kind: 'undo' as const, undoOf: 1 }]
    expect(todayDeeds(rows, '2026-11-05')).toEqual({ workout: false, move: false, focus: false })
    expect(todayDeeds([e(1, '2026-11-05', 'body', 3, 'body.move_break')], '2026-11-05')).toEqual({ workout: false, move: true, focus: false })
  })
  it('a most-per-day and "pair it"', () => {
    const none = { workout: false, move: false, focus: false }
    expect(guardBlocker({ perDay: 2 }, 1, none)).toBeNull()
    expect(guardBlocker({ perDay: 2 }, 2, none)).toBe('2 a day: again tomorrow')
    expect(guardBlocker({ pair: 'workout' }, 0, none)).toMatch(/workout today first/)
    expect(guardBlocker({ pair: 'workout' }, 0, { ...none, workout: true })).toBeNull()
    expect(ruleTags({ perDay: 1, pair: 'move' })).toEqual(['Once a day', 'After you move'])
  })
})

describe("Ben's note on fun", () => {
  const base = { earnedWeek: 300, funSpentWeek: 0, funBudgetLei: null, funLeftLei: null, dayOfMonth: 10, daysInMonth: 30 }
  it('is quiet when fun is in balance', () => {
    expect(funPace(base)).toEqual({ level: 'ok', line: null })
    expect(funPace({ ...base, funSpentWeek: 100 }).level).toBe('ok')
  })
  it('notices fun running ahead of earning', () => {
    expect(funPace({ ...base, funSpentWeek: 200 }).level).toBe('watch')
    const over = funPace({ ...base, earnedWeek: 80, funSpentWeek: 120 })
    expect(over.level).toBe('over')
    expect(over.line).toMatch(/120 points spent, 80 earned/)
  })
  it('watches the fun budget in lei, but not in the last week of the month', () => {
    expect(funPace({ ...base, funBudgetLei: 500, funLeftLei: 50 }).level).toBe('watch')
    expect(funPace({ ...base, funBudgetLei: 500, funLeftLei: 0 }).level).toBe('over')
    expect(funPace({ ...base, funBudgetLei: 500, funLeftLei: 50, dayOfMonth: 27 }).level).toBe('ok')
  })
})
