import { describe, expect, it } from 'vitest'
import { addHabit, cleanBook, EMPTY_BOOK, habitRef, habitRows, habitsLine, logHabit, missedYesterday, removeHabit, renameHabit, unlogHabit } from './myHabits'
import { DEFAULT_RULES, isFlowRule } from './rules'

const now = new Date('2026-11-05T10:00:00Z')
const book = () => {
  let b = addHabit(EMPTY_BOOK, 'Read 10 pages', now)
  b = addHabit(b, 'Stretch', new Date(now.getTime() + 1000))
  return b
}

describe('your own habits (FT1)', () => {
  it('adds, renames and removes; no doubles, no empty names', () => {
    const b = book()
    expect(b.habits.map((h) => h.name)).toEqual(['Read 10 pages', 'Stretch'])
    expect(() => addHabit(b, ' read 10 PAGES ', now)).toThrow(/already/)
    expect(() => addHabit(b, '   ', now)).toThrow(/Name the habit/)
    const r = renameHabit(b, b.habits[1].id, 'Stretch 5 min')
    expect(r.habits[1].name).toBe('Stretch 5 min')
    expect(removeHabit(r, b.habits[0].id).habits).toHaveLength(1)
  })
  it('a tap logs once a day and a wrong tap can be taken back', () => {
    const b = book()
    const id = b.habits[0].id
    const once = logHabit(b, id, '2026-11-05')
    expect(logHabit(once, id, '2026-11-05')).toBe(once)
    expect(unlogHabit(once, id, '2026-11-05').log['2026-11-05']).toEqual([])
    expect(habitRef(id, '2026-11-05')).toBe(`habit:${id}:2026-11-05`)
  })
  it('streaks count days in a row; a rest day keeps them', () => {
    let b = book()
    const id = b.habits[0].id
    for (const d of ['2026-11-01', '2026-11-02', '2026-11-04']) b = logHabit(b, id, d)
    expect(habitRows(b, '2026-11-05')[0]).toMatchObject({ done: false, streak: 1, best: 2, week: 3 })
    expect(habitRows(b, '2026-11-05', ['2026-11-03'])[0].streak).toBe(3)
  })
  it('never miss twice: kept last week, missed yesterday, not done today', () => {
    let b = book()
    const [read, stretch] = b.habits.map((h) => h.id)
    b = logHabit(b, read, '2026-11-02')
    b = logHabit(b, stretch, '2026-11-04')
    expect(missedYesterday(b, '2026-11-05').map((h) => h.name)).toEqual(['Read 10 pages'])
    expect(missedYesterday(b, '2026-11-05', ['2026-11-04'])).toEqual([])
    expect(missedYesterday(logHabit(b, read, '2026-11-05'), '2026-11-05')).toEqual([])
    expect(habitsLine(b, '2026-11-05')).toMatch(/never miss twice\): Read 10 pages/)
  })
  it('cleans what was saved', () => {
    expect(cleanBook(null)).toEqual({ habits: [], log: {} })
    expect(cleanBook({ habits: [{ id: 'a', name: ' x ' }, { id: 1 }], log: { bad: ['a'], '2026-11-01': ['a', 'a'] } })).toEqual({ habits: [{ id: 'a', name: 'x', at: '' }], log: { '2026-11-01': ['a'] } })
  })
  it('pays a small capped amount, never by a bare tap on the wallet', () => {
    const r = DEFAULT_RULES.find((x) => x.id === 'habit.own')!
    expect(r).toMatchObject({ coins: 2, dailyCap: 6 })
    expect(isFlowRule('habit.own')).toBe(true)
  })
})
