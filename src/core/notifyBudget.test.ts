import { describe, expect, it } from 'vitest'
import { budgetCheck, budgetPrefs, DAILY_PUSH_CAP, dueSlot, slotNotifId, slotOfId, slotText, type BudgetLedger, type PushSlot } from './notifyBudget'

const DAY = '2026-11-11'

describe('the daily push budget', () => {
  it('caps at 4 a day, each slot once', () => {
    let led: BudgetLedger | null = null
    const tries: PushSlot[] = ['morning', 'morning', 'afternoon', 'plan', 'winddown', 'weekly']
    const sent: PushSlot[] = []
    for (const s of tries) {
      const v = budgetCheck(led, s, DAY, { on: true, afternoon: true }, 0 + 3)
      if (v.ok) sent.push(s)
      led = v.next
    }
    expect(sent).toEqual(['morning', 'afternoon', 'plan', 'winddown'])
    expect(sent.length).toBeLessThanOrEqual(DAILY_PUSH_CAP)
  })

  it('never more than 4 whatever is asked', () => {
    let led: BudgetLedger | null = null
    let n = 0
    for (let i = 0; i < 50; i++) {
      const v = budgetCheck(led, (['morning', 'afternoon', 'weekly', 'plan', 'winddown'] as PushSlot[])[i % 5], DAY, { on: true, afternoon: true }, 0)
      if (v.ok) n++
      led = v.next
    }
    expect(n).toBe(4)
  })

  it('everything else stays in the app; the afternoon nudge is off by default', () => {
    expect(budgetCheck(null, null, DAY).ok).toBe(false)
    expect(budgetCheck(null, null, DAY).reason).toMatch(/in the app only/)
    expect(budgetCheck(null, 'afternoon', DAY).ok).toBe(false)
    expect(budgetCheck(null, 'weekly', DAY, undefined, 3).ok).toBe(false)
    expect(budgetCheck(null, 'weekly', DAY, undefined, 0).ok).toBe(true)
    expect(budgetCheck(null, 'afternoon', DAY, { on: true, afternoon: true }, 0).ok).toBe(false)
  })

  it('a new day starts empty; budget off lets the old senders through', () => {
    expect(budgetCheck({ day: '2026-11-10', sent: ['morning', 'plan', 'winddown', 'afternoon'] }, 'morning', DAY).ok).toBe(true)
    expect(budgetCheck(null, null, DAY, { on: false, afternoon: false }).ok).toBe(true)
  })

  it('finds the slot due now', () => {
    expect(dueSlot(7 * 60, 3)).toBe('morning')
    expect(dueSlot(7 * 60 + 50, 3)).toBe(null)
    expect(dueSlot(21 * 60 + 20, 3)).toBe('plan')
    expect(dueSlot(23 * 60 + 5, 3)).toBe('winddown')
    expect(dueSlot(18 * 60, 0)).toBe('weekly')
    expect(dueSlot(18 * 60, 2)).toBe(null)
    expect(dueSlot(15 * 60 + 30, 2)).toBe(null)
    expect(dueSlot(15 * 60 + 30, 2, { on: true, afternoon: true })).toBe('afternoon')
    expect(dueSlot(7 * 60, 3, undefined, ['morning'])).toBe(null)
  })

  it('ids, prefs and neutral words', () => {
    expect(slotOfId(slotNotifId('plan', DAY))).toBe('plan')
    expect(slotOfId('ben:abc')).toBe(null)
    expect(budgetPrefs(null)).toEqual({ on: true, afternoon: false })
    expect(budgetPrefs({ budget: false, afternoon: true })).toEqual({ on: false, afternoon: true })
    for (const s of ['morning', 'afternoon', 'plan', 'winddown'] as PushSlot[]) {
      const t = slotText(s, { mustDone: 2, mustTotal: 3 })
      expect(t).toMatch(/^Life System: /)
      expect(t).not.toMatch(/protein|kcal|weight|lunch|food|meal/i)
    }
    expect(slotText('afternoon', { mustDone: 2, mustTotal: 3 })).toBe('Life System: 2 of 3 done.')
  })
})
