import { describe, expect, it } from 'vitest'
import { deleteAsk, leftAnswer, moneyAsk, monthAnswer, pickToDelete, readSpend, todayAnswer, type MoneyRow } from './benMoneyAsk'

describe('readSpend: a spending he logs, in many phrasings', () => {
  it.each([
    ['add that I spent 55 mdl today for food', 55, 'food'],
    ['spent 55 lei on food', 55, 'food'],
    ['I spent 55 on food', 55, 'food'],
    ['add 55 mdl food', 55, 'food'],
    ['log 120 lei for groceries', 120, 'groceries'],
    ['55 food', 55, 'food'],
    ['55 lei food', 55, 'food'],
    ['55 lei on taxi', 55, 'taxi'],
    ['food 55', 55, 'food'],
    ['coffee 35 lei', 35, 'coffee'],
    ['paid 40 lei for the bus', 40, 'bus'],
    ['spent 12.5 lei on bread', 12.5, 'bread'],
    ['am cheltuit 55 lei pe mancare', 55, 'mancare'],
    ['am cheltuit 55 lei azi pe mâncare', 55, 'mancare'],
    ['потратил 55 лей на еду', 55, 'еду'],
    ['Spent 300 lei on a gift.', 300, 'gift']
  ])('%s', (text, amount, note) => {
    expect(readSpend(text)).toEqual({ amount, note })
  })

  it.each([
    'how much did I spend today?',
    'should I spend 55 on food?',
    'spent 55 lei yesterday on food',
    'spent 20 dollars on a book',
    'ran 5 km',
    '30 pushups',
    'water 500',
    'exam on 12 december',
    'woke up at 7',
    'I spent 2 hours on the lab',
    'spent 55 and 20 on food',
    'add a task to buy food',
    'delete that one',
    'what can I afford with 500 lei'
  ])('not a spending log: %s', (text) => {
    expect(readSpend(text)).toBeNull()
  })
})

describe('moneyAsk: simple money questions and deletes', () => {
  it('reads today and "where did X come from"', () => {
    expect(moneyAsk('what did I spend today?')).toEqual({ kind: 'today', mentioned: null })
    expect(moneyAsk('how much did I spend today')).toEqual({ kind: 'today', mentioned: null })
    expect(moneyAsk('wait where you got 70 from?')).toEqual({ kind: 'today', mentioned: 70 })
    expect(moneyAsk('where did the 70 lei come from')).toEqual({ kind: 'today', mentioned: 70 })
    expect(moneyAsk("what's the 70?")).toEqual({ kind: 'today', mentioned: 70 })
    expect(moneyAsk('ce am cheltuit azi')).toEqual({ kind: 'today', mentioned: null })
  })
  it('reads deletes and "left this month"', () => {
    expect(moneyAsk('delete that one')).toEqual({ kind: 'delete', hint: '', amount: null })
    expect(moneyAsk('delete the last one')).toEqual({ kind: 'delete', hint: 'last', amount: null })
    expect(moneyAsk('delete the gaming one')).toEqual({ kind: 'delete', hint: 'gaming', amount: null })
    expect(moneyAsk('remove the 15 lei one')).toEqual({ kind: 'delete', hint: '', amount: 15 })
    expect(moneyAsk('delete M2')).toEqual({ kind: 'delete', hint: 'm2', amount: null })
    expect(moneyAsk('how much is left this month?')).toEqual({ kind: 'left' })
    expect(moneyAsk('how much money do I have left this month')).toEqual({ kind: 'left' })
    expect(moneyAsk('How much did I spend this month?')).toEqual({ kind: 'month' })
  })
  it('leaves other things alone', () => {
    for (const t of ['delete the gym event', 'delete that task', 'why do I spend so much?', 'should I cut food spending?', 'how much water is left', 'undo', 'what did I spend last month?', 'plan my day']) expect(moneyAsk(t), t).toBeNull()
  })
})

const TODAY = '2026-11-08'
const rows: MoneyRow[] = [
  { id: 'life-reward-41', ref: 'M1', date: TODAY, amount: 1500, currency: 'MDL', category: 'Reward', note: 'Reward: 🎮 1 hour of gaming, guilt-free', type: 'expense', fromRewards: true },
  { id: 'tg-1', ref: 'M2', date: TODAY, amount: 5500, currency: 'MDL', category: 'Food', note: 'food', type: 'expense' },
  { id: 'tg-0', ref: 'M3', date: '2026-11-07', amount: 3000, currency: 'MDL', category: 'Transport', note: 'taxi', type: 'expense' }
]

describe('answers: every number from the records', () => {
  it('lists today with M-numbers and says where 70 came from', () => {
    const a = todayAnswer(rows, TODAY, 70)
    expect(a.reply).toContain("Today's 70 lei is 2 records:")
    expect(a.reply).toContain('M1 15 lei · Reward')
    expect(a.reply).toContain('M2 55 lei · Food')
    expect(a.reply).toMatch(/M1 came from a Rewards buy with points/)
    expect(a.reply).not.toContain('taxi')
    expect(todayAnswer(null, TODAY, null).reply).toMatch(/can't see your Finance Helper/)
    expect(todayAnswer([], TODAY, null).reply).toBe('You have no spending recorded today.')
  })
  it('picks the record to delete, and the confirm shows it exactly', () => {
    expect(pickToDelete(rows, { kind: 'delete', hint: 'gaming', amount: null }).row?.id).toBe('life-reward-41')
    expect(pickToDelete(rows, { kind: 'delete', hint: 'reward', amount: null }).row?.id).toBe('life-reward-41')
    expect(pickToDelete(rows, { kind: 'delete', hint: '', amount: 55 }).row?.id).toBe('tg-1')
    expect(pickToDelete(rows, { kind: 'delete', hint: 'm3', amount: null }).row?.id).toBe('tg-0')
    expect(pickToDelete(rows, { kind: 'delete', hint: '', amount: null }).row?.id).toBe('life-reward-41')
    expect(pickToDelete(rows, { kind: 'delete', hint: 'cinema', amount: null }).why).toMatch(/can't find/)
    const c = deleteAsk(rows[1], 'abc123')
    expect(c.reply).toContain('M2 55 lei · Food')
    expect(c.buttons?.[0]).toEqual({ label: '🗑 Yes, delete M2', do: 'say:✓abc123 Yes, delete M2 55 lei · Food' })
  })
  it('says what is left this month', () => {
    expect(leftAnswer({ spentMonth: 120_000, limit: 500_000, limitLeft: 380_000, safeToday: 16_522 }).reply).toBe('You have 3,800 lei left this month (spent 1,200 lei of 5,000 lei).\nThat is about 165.22 lei a day until the month ends.')
    expect(leftAnswer({ spentMonth: 120_000, limit: null, limitLeft: null, safeToday: null }).reply).toMatch(/no monthly limit/)
    expect(monthAnswer({ spentMonth: 190_000, limit: 500_000, records: 3, byCategory: [{ name: 'Food', amount: 6_000 }, { name: 'Dining', amount: 12_000 }, { name: 'Reward', amount: 1_000 }] }).reply).toBe('You spent 1,900 lei this month (3 records).\nMost of it: Dining 120 lei, Food 60 lei, Reward 10 lei.\nThat leaves 3,100 lei of your 5,000 lei limit.')
    expect(leftAnswer({ spentMonth: 600_000, limit: 500_000, limitLeft: -100_000, safeToday: 0 }).reply).toMatch(/1,000 lei over/)
  })
})
