import { describe, expect, it } from 'vitest'
import { financeDay, financeMonth, manStartSuggestion, parseFinance, parseFinanceState, parseManLog, parseWaky, sleptMinutes } from './connect'
import { FINANCE, WAKY } from './connect.fixtures'

describe('waky reader', () => {
  it('reads mornings and bedtimes with the grace window', () => {
    const w = parseWaky(WAKY)
    expect(w.mornings.map((m) => [m.day, m.onTime])).toEqual([['2026-10-24', false], ['2026-10-25', true]])
    expect(w.nights.find((n) => n.day === '2026-10-25')?.onTime).toBe(true)
    expect(w.nights.find((n) => n.day === '2026-10-24')?.onTime).toBe(false) // 00:40 is after 23:30
    expect(sleptMinutes(w.nights[1], w.mornings[1])).toBe(7 * 60 + 12)
    expect(() => parseWaky('{"x":1}')).toThrow('Waky')
  })
})

describe('MAN reader', () => {
  it('takes the newest record from the LevelDB log', () => {
    const rec = (n: number, last: string) => `{"streakDays":${n},"longestStreak":${n},"totalVictories":${n - 1},"lastCheckin":"${last}","urgesCrushedCount":2,"oathsSwornCount":3,"empire":{"a":1}}`
    const raw = Buffer.from(`\x00\x01junk_file://\x00\x01MAN_SPARTAN_DATA\x01${rec(9, '2026-10-24')}\x00\x00\x01MAN\x01${rec(10, '2026-10-25')}\x00tail`, 'latin1')
    expect(parseManLog(raw)).toEqual({ streakDays: 10, longestStreak: 10, totalVictories: 9, lastCheckin: '2026-10-25', urgesCrushed: 2, oathsSworn: 3 })
    expect(parseManLog(Buffer.from('nothing here'))).toBeNull()
  })
  it('suggests the start date that shows the same day count', () => {
    const man = { streakDays: 10, longestStreak: 10, totalVictories: 9, lastCheckin: '2026-10-25', urgesCrushed: 0, oathsSworn: 0 }
    const s = manStartSuggestion(man, '2026-10-25')!
    expect(s).toMatchObject({ start: '2026-10-15', showsDays: 10, lastTapDaysAgo: 0 })
    expect(s.note).toMatch(/added a day/)
    expect(manStartSuggestion({ ...man, totalVictories: 10, lastCheckin: '2026-10-20' }, '2026-10-25')!.note).toMatch(/5 days ago/)
  })
})

describe('finance reader', () => {
  it('reads transactions, skips deleted ones and bills from everyday spending', () => {
    const f = parseFinance(FINANCE(0))
    expect(f.tx).toHaveLength(4)
    expect(financeDay(f, '2026-10-24')).toEqual({ logged: true, everydaySpent: 12000 })
    expect(financeDay(f, '2026-10-23')).toEqual({ logged: false, everydaySpent: 0 })
    expect(financeMonth(f, '2026-10-25')).toEqual({ spent: 519000, everyday: 19000, income: 900000, days: 3 })
    expect(() => parseFinance('{"app":"other"}')).toThrow('Finance Helper')
  })
  it('reads the app own saved state the same way', () => {
    const state = JSON.stringify(JSON.parse(FINANCE(0)).data)
    const f = parseFinanceState(state, 123)
    expect(f.savedAt).toBe(123)
    expect(financeDay(f, '2026-10-24').everydaySpent).toBe(12000)
    expect(() => parseFinanceState('{"x":1}', 0)).toThrow()
  })
})
