import { describe, expect, it } from 'vitest'
import { budgetCheck, slotOfId, slotText, dueSlot, type PushSlot } from './notifyBudget'
import { salaryNotice, shortDue } from './salaryNotice'

const NOW = new Date('2026-11-13T10:00:00')

describe("Money's late salary message (2026-11-13)", () => {
  it('builds one neutral bell entry for the slot, with no amount', () => {
    const out = salaryNotice({ month: '2026-11', due: '2026-11-10' }, '2026-11-13', NOW, null)
    expect(out?.month).toBe('2026-11')
    expect(out?.notif.id).toBe('budget:salary:2026-11-13')
    expect(slotOfId(out!.notif.id)).toBe('salary')
    expect(out?.notif.title).toBe('Your salary is not in yet (due 10 Nov)')
    expect(out?.notif.title).not.toMatch(/\d{3}/)
    expect(shortDue('2026-11-03')).toBe('3 Nov')
  })

  it('is sent at most once a month and ignores bad messages', () => {
    expect(salaryNotice({ month: '2026-11', due: '2026-11-10' }, '2026-11-14', NOW, '2026-11')).toBeNull()
    expect(salaryNotice({ month: '2026-12', due: '2026-12-10' }, '2026-12-13', NOW, '2026-11')).not.toBeNull()
    for (const bad of [null, {}, { month: '2026-11' }, { month: 'x', due: '2026-11-10' }, { month: '2026-11', due: '2026-12-10' }, { month: 7, due: 8 }]) {
      expect(salaryNotice(bad, '2026-11-13', NOW, null)).toBeNull()
    }
  })

  it("slot 'salary' obeys the daily budget: once a day, inside the 4 a day, no fixed time", () => {
    const day = '2026-11-13'
    const first = budgetCheck(null, 'salary', day)
    expect(first.ok).toBe(true)
    expect(budgetCheck(first.next, 'salary', day).ok).toBe(false)
    const full = { day, sent: ['morning', 'plan', 'winddown', 'weekly'] as PushSlot[] }
    expect(budgetCheck(full, 'salary', day).ok).toBe(false)
    for (let m = 0; m < 1440; m += 15) expect(dueSlot(m, 0)).not.toBe('salary')
    expect(slotText('salary', { mustDone: 0, mustTotal: 0 })).toMatch(/salary/)
  })
})
