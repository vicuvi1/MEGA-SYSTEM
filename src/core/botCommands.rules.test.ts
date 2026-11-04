import { describe, expect, it } from 'vitest'
import { parseTelegramText } from './botCommands'
import { isSimpleLog } from '../renderer/src/web/botBrain'

// Everyday messages the rules handle without AI (free, instant). Each one
// here once went to the AI or was read wrong.
describe('everyday messages, no AI', () => {
  const p = (t: string) => parseTelegramText(t)
  it('expenses in sentences, English and Romanian', () => {
    expect(p('spent 50 lei on lunch')).toMatchObject({ type: 'expense', expenseAmount: 50, expenseCategory: 'food', expenseNote: 'lunch' })
    expect(p('am cheltuit 120 lei pe benzină')).toMatchObject({ type: 'expense', expenseAmount: 120, expenseCategory: 'transport' })
    expect(p('paid 30 for parking')).toMatchObject({ type: 'expense', expenseAmount: 30, expenseCategory: 'transport', expenseNote: 'parking' })
    expect(p('/expense 45 food lunch')).toMatchObject({ type: 'expense', expenseAmount: 45, expenseCategory: 'food' })
  })
  it('wake-up and bedtime at the time you say', () => {
    expect(p('woke up at 7:30')).toMatchObject({ type: 'wake', args: ['07:30'] })
    expect(p('m-am trezit la 7:30')).toMatchObject({ type: 'wake', args: ['07:30'] })
    expect(p('bed 23:40')).toMatchObject({ type: 'bed', args: ['23:40'] })
    expect(p('m-am culcat la 0:30')).toMatchObject({ type: 'bed', args: ['00:30'] })
  })
  it('a gym session, and questions about spending', () => {
    expect(p('gym done')).toMatchObject({ type: 'sport', exerciseName: 'Gym Session' })
    expect(p('am fost la sală')).toMatchObject({ type: 'sport' })
    expect(p('how much did I spend today?')).toMatchObject({ type: 'spent', period: 'today' })
    expect(p('cât am cheltuit săptămâna asta?')).toMatchObject({ type: 'spent', period: 'week' })
  })
  it('skips the AI for these, uses it for real conversation', () => {
    for (const t of ['spent 50 lei on lunch', 'am cheltuit 120 lei pe benzină', 'woke up at 7:30', 'gym done', 'how much did I spend today?']) expect(isSimpleLog(t), t).toBe(true)
    for (const t of ['coffee 25 and taxi 40', 'I feel lazy, what should I do?', 'plan my afternoon']) expect(isSimpleLog(t), t).toBe(false)
  })
})
