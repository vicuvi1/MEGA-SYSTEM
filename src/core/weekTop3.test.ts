// Sunday's "pick your top 3": chips, picking, the saved plan (the same big 3)
// and what Today and the island show. Made-up goals and projects.
import { describe, expect, it } from 'vitest'
import { cleanPlan, planFromPicks, toggleChip, top3AskDue, top3Chips, top3Keyboard, weekTop3View, type WeekPlan } from './weekPlan'

const sunday = '2030-03-10'
const monday = '2030-03-11'
const plan = (p: Partial<WeekPlan>): WeekPlan => cleanPlan({ week: monday, big3: [{ text: 'Run 3 times', done: false }], ...p }, sunday, new Date('2030-03-10T18:00:00Z'))

describe('weekly top 3', () => {
  it('offers goals first, then projects, then the suggestions, no repeats, no Inbox, up to 8', () => {
    expect(top3Chips(['Save 500', 'Read 4 books'], ['Inbox', 'Side project', 'read 4 books'], ['Write the essay'])).toEqual(['Save 500', 'Read 4 books', 'Side project', 'Write the essay'])
    expect(top3Chips(Array.from({ length: 12 }, (_, i) => `Goal ${i}`), [])).toHaveLength(8)
  })

  it('picks at most 3, a second tap takes one out', () => {
    let p: string[] = []
    for (const c of ['A', 'B', 'C', 'D']) p = toggleChip(p, c)
    expect(p).toEqual(['A', 'B', 'C'])
    expect(toggleChip(p, 'B')).toEqual(['A', 'C'])
  })

  it('saves the picks as the big 3 and parks the rest (done ones stay done)', () => {
    const prev = plan({ big3: [{ text: 'Side project', done: true }], focus: 'sport', note: 'every morning' })
    const p = cleanPlan(planFromPicks(prev, monday, ['Save 500', 'Side project', 'Read 4 books'], ['Side project', 'Save 500']), sunday)
    expect(p.big3).toEqual([{ text: 'Side project', done: true, todoistId: null }, { text: 'Save 500', done: false, todoistId: null }])
    expect(p.parked).toEqual(['Read 4 books'])
    expect(p.focus).toBe('sport')
    expect(p.note).toBe('every morning')
  })

  it('asks on Sunday and Monday until picked', () => {
    expect(top3AskDue(null, sunday)).toBe(true)
    expect(top3AskDue(null, '2030-03-12')).toBe(false) // Tuesday
    expect(top3AskDue(plan({}), sunday)).toBe(true) // planned, but not from the chips
    expect(top3AskDue(plan({ parked: [] }), sunday)).toBe(false)
    expect(top3AskDue(plan({ parked: [] }), monday)).toBe(false)
  })

  it('Today and the island show the top 3 and the parked ones', () => {
    const p = plan({ big3: [{ text: 'Run 3 times', done: true }, { text: 'Save 500', done: false }], parked: ['Read 4 books'] })
    expect(weekTop3View(p, '2030-03-12')).toEqual({ top: [{ i: 0, text: 'Run 3 times', done: true }, { i: 1, text: 'Save 500', done: false }], parked: ['Read 4 books'] })
    expect(weekTop3View(p, sunday)).toBeNull() // that plan starts Monday
    expect(weekTop3View(null, monday)).toBeNull()
  })

  it("Telegram's chips: two a row, ticks on the picked, Save last", () => {
    const k = top3Keyboard(['A', 'B', 'C'], ['B'])
    expect(k.inline_keyboard).toEqual([
      [{ text: 'A', callback_data: 'w3|0' }, { text: '✓ B', callback_data: 'w3|1' }],
      [{ text: 'C', callback_data: 'w3|2' }],
      [{ text: '✅ Save my top 1', callback_data: 'w3|ok' }]
    ])
  })
})
