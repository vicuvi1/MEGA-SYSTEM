import { describe, expect, it } from 'vitest'
import { budgetCheck, dueSlot, slotNotifId, slotOfId, slotText, type PushSlot } from './notifyBudget'

describe('a failed backup is one of the 4 (2026-11-12)', () => {
  it("slot 'backup': once a day, counted in the 4, no fixed time", () => {
    const day = '2026-11-12'
    expect(slotOfId(slotNotifId('backup', day))).toBe('backup')
    const first = budgetCheck(null, 'backup', day)
    expect(first.ok).toBe(true)
    expect(budgetCheck(first.next, 'backup', day).ok).toBe(false)
    const full = { day, sent: ['morning', 'plan', 'winddown', 'weekly'] as PushSlot[] }
    expect(budgetCheck(full, 'backup', day).ok).toBe(false)
    for (let m = 0; m < 1440; m += 15) expect(dueSlot(m, 0)).not.toBe('backup')
    expect(slotText('backup', { mustDone: 0, mustTotal: 0 })).toMatch(/Data safety/)
  })
})
