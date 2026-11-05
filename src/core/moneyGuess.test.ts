import { describe, expect, it } from 'vitest'
import { notMoney } from './moneyGuess'

describe('a number is not always money (X2)', () => {
  it('dates, times, durations and plans are not expenses', () => {
    for (const t of ['exam on 12 december', 'woke up at 7 am', 'run 30 min', 'meeting at 15:00', 'slept 8 hours', 'deadline friday 5', 'read 20 pages']) expect(notMoney(t), t).toBe(true)
  })
  it('real expenses still are', () => {
    for (const t of ['taxi 45', 'coffee 35 maib', 'lunch 120 lei', 'paid 300 for the exam', '/expense 50', 'groceries 230']) expect(notMoney(t), t).toBe(false)
  })
})
