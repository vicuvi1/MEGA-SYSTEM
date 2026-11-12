import { describe, expect, it } from 'vitest'
import { budgetCheck, budgetPrefs, cleanLedger, islandAlertPasses, DAILY_PUSH_CAP, dueSlot, sleepReminderDue, sleepReminderShows, slotNotifId, slotOfId, slotText, type BudgetLedger, type PushSlot } from './notifyBudget'

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
    expect(dueSlot(23 * 60 + 5, 3)).toBe(null) // the wind-down moved to 23:15
    expect(dueSlot(23 * 60 + 20, 3)).toBe('winddown')
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

describe('the island in Simple mode', () => {
  it('pops up only for his own timers and reminders', () => {
    expect(islandAlertPasses({ kind: 'over' })).toBe(true)
    expect(islandAlertPasses({ kind: 'remind' })).toBe(true)
    expect(islandAlertPasses({ kind: 'coach', study: { kind: 'pomo' } })).toBe(true)
    for (const kind of ['ben', 'water', 'move', 'coach', 'food', 'checkin', 'reward', 'win', 'praise', 'morning', 'end']) expect(islandAlertPasses({ kind })).toBe(false)
    expect(islandAlertPasses(null)).toBe(false)
  })
})

describe('the 23:15 and 00:00 sleep reminders', () => {
  it('are due at 23:15 and 00:00 (for 45 minutes), and never from the server tick', () => {
    expect(sleepReminderDue(23 * 60 + 14)).toBe(null)
    expect(sleepReminderDue(23 * 60 + 15)).toBe('winddown')
    expect(sleepReminderDue(23 * 60 + 59)).toBe('winddown')
    expect(sleepReminderDue(0)).toBe('lastcall')
    expect(sleepReminderDue(44)).toBe('lastcall')
    expect(sleepReminderDue(45)).toBe(null)
    // dueSlot (the server and the in-app bell) never gives the midnight one.
    for (let m = 0; m < 1440; m++) expect(dueSlot(m, 3, { on: true, afternoon: true })).not.toBe('lastcall')
  })
  it('23:15 is one of the 4; 00:00 is the sleep-only exception on top', () => {
    const full: BudgetLedger = { day: DAY, sent: ['morning', 'afternoon', 'plan', 'winddown'] }
    expect(budgetCheck(full, 'lastcall', DAY).ok).toBe(true)
    expect(budgetCheck(full, 'lastcall', DAY).next.sent).toContain('lastcall')
    expect(budgetCheck({ day: DAY, sent: [...full.sent, 'lastcall'] }, 'lastcall', DAY).ok).toBe(false)
    // The exception never makes room for a 5th ordinary push.
    expect(budgetCheck({ day: DAY, sent: ['morning', 'plan', 'lastcall'] }, 'winddown', DAY).ok).toBe(true)
    expect(cleanLedger({ day: DAY, sent: ['lastcall'] }, DAY).sent).toEqual(['lastcall'])
    expect(slotOfId(slotNotifId('lastcall', DAY))).toBe('lastcall')
    expect(slotText('winddown', { mustDone: 0, mustTotal: 0 })).toBe('Life System: 15 minutes to bed. Phone away, asleep by 23:30.')
    expect(slotText('lastcall', { mustDone: 0, mustTotal: 0 })).toMatch(/^Life System: it is midnight/)
  })
  it('show only with Sleep on and bed not logged', () => {
    const base = { sleepOn: true, bedLogged: false, claimed: true, alreadySent: false }
    expect(sleepReminderShows({ ...base, slot: 'winddown' })).toBe(true)
    expect(sleepReminderShows({ ...base, slot: 'winddown', bedLogged: true })).toBe(false)
    expect(sleepReminderShows({ ...base, slot: 'lastcall', sleepOn: false })).toBe(false)
    // 23:15 needs its slot (claimed now, or already this push on Telegram); 00:00 always passes the budget.
    expect(sleepReminderShows({ ...base, slot: 'winddown', claimed: false })).toBe(false)
    expect(sleepReminderShows({ ...base, slot: 'winddown', claimed: false, alreadySent: true })).toBe(true)
    expect(sleepReminderShows({ ...base, slot: 'lastcall', claimed: false })).toBe(true)
  })
})
