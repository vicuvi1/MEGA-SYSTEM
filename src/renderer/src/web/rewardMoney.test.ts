import { describe, expect, it } from 'vitest'
import { moneyNumbers } from './benDesk'

describe('rewards cost real money (M1)', () => {
  it("Safe to spend today comes from Finance Helper's monthly limit", () => {
    const fin = { settings: { limit: { on: true, amount: 300000 } }, tx: [{ type: 'expense', date: '2026-11-03', amount: 150000 }] }
    // 3000 lei limit, 1500 spent, 26 days left (5th to 30th) → about 58 lei a day.
    expect(moneyNumbers(fin, '2026-11-05').safeToday).toBe(5769)
    expect(moneyNumbers({ tx: [] }, '2026-11-05').safeToday).toBeNull()
  })
})
