import { describe, expect, it } from 'vitest'
import {
  boardCount,
  cleanPrefs,
  dayMinute,
  dueState,
  dueToday,
  EMPTY_PREFS,
  goodDayRun,
  groupTiles,
  habitStreak,
  lookOf,
  moveBefore,
  nudge,
  orderTiles,
  setSkip,
  skipsOf,
  slotAt,
  slotOf,
  weekDots,
  weekdayOf
} from './habitBoard'

const at = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3))

describe('parts of the day', () => {
  it('morning until noon, day until 18:00, evening until the app day turns at 04:00', () => {
    expect(slotAt(at('05:00'))).toBe('morning')
    expect(slotAt(at('11:59'))).toBe('morning')
    expect(slotAt(at('12:00'))).toBe('day')
    expect(slotAt(at('18:00'))).toBe('evening')
    expect(slotAt(at('01:30'))).toBe('evening')
    expect(dayMinute(1, 30)).toBe(25 * 60 + 30)
  })
  it('a habit sits in its slot, or where its "by" time falls, or with the day', () => {
    expect(slotOf({ slot: 'evening', by: null })).toBe('evening')
    expect(slotOf({ slot: 'any', by: '10:00' })).toBe('morning')
    expect(slotOf({ slot: 'any', by: '12:00' })).toBe('morning')
    expect(slotOf({ slot: 'any', by: '21:00' })).toBe('evening')
    expect(slotOf({ slot: 'any', by: null })).toBe('day')
  })
})

describe('due states', () => {
  const h = { done: false, slot: 'morning' as const, by: '10:00' }
  it('"by 10:00", then soon, then a soft overdue', () => {
    expect(dueState(h, at('07:00'))).toEqual({ state: 'later', hint: 'by 10:00' })
    expect(dueState(h, at('09:00'))).toEqual({ state: 'now', hint: 'by 10:00' })
    expect(dueState(h, at('10:30'))).toEqual({ state: 'overdue', hint: 'was due 10:00' })
  })
  it('done, skipped and not-today win over the clock', () => {
    expect(dueState({ ...h, done: true }, at('23:00')).state).toBe('done')
    expect(dueState({ ...h, skipped: true }, at('23:00')).state).toBe('skipped')
    expect(dueState({ ...h, off: true }, at('23:00')).state).toBe('off')
  })
  it('slots without a time: later, now, then past', () => {
    const e = { done: false, slot: 'evening' as const, by: null }
    expect(dueState(e, at('09:00'))).toEqual({ state: 'later', hint: 'evening' })
    expect(dueState(e, at('19:00'))).toEqual({ state: 'now', hint: 'this evening' })
    expect(dueState(e, at('02:00')).state).toBe('now')
    expect(dueState({ done: false, slot: 'morning', by: null }, at('13:00')).state).toBe('overdue')
    expect(dueState({ done: false, slot: 'any', by: null }, at('13:00')).state).toBe('anytime')
  })
  it('a "by" time after midnight is still tonight', () => {
    expect(dueState({ done: false, slot: 'evening', by: '00:30' }, at('23:30')).state).toBe('now')
    expect(dueState({ done: false, slot: 'evening', by: '00:30' }, at('01:00')).state).toBe('overdue')
  })
})

describe('schedules', () => {
  // 2026-11-02 is a Monday.
  it('knows the weekday', () => {
    expect(weekdayOf('2026-11-02')).toBe(0)
    expect(weekdayOf('2026-11-08')).toBe(6)
  })
  it('weekdays only on weekdays, N× a week until N days are in', () => {
    expect(dueToday({ kind: 'weekdays' }, [], '2026-11-06')).toBe(true)
    expect(dueToday({ kind: 'weekdays' }, [], '2026-11-07')).toBe(false)
    expect(dueToday({ kind: 'perWeek', n: 2 }, ['2026-11-02'], '2026-11-06')).toBe(true)
    expect(dueToday({ kind: 'perWeek', n: 2 }, ['2026-11-02', '2026-11-04'], '2026-11-06')).toBe(false)
    // Last week's days don't count for this week.
    expect(dueToday({ kind: 'perWeek', n: 2 }, ['2026-10-30', '2026-10-31'], '2026-11-03')).toBe(true)
  })
})

describe('dots and streaks', () => {
  const today = '2026-11-06'
  it('seven dots, oldest first: done, missed, rest, skip, and today open', () => {
    const dots = weekDots(['2026-11-01', '2026-11-03', '2026-11-05'], today, { rest: ['2026-11-02'], skips: ['2026-11-04'] })
    expect(dots.map((d) => d.state)).toEqual(['missed', 'done', 'rest', 'done', 'skip', 'done', 'open'])
    expect(dots[6].day).toBe(today)
  })
  it('weekends are "off" for a weekdays habit, and N× a week never shows a miss', () => {
    const dots = weekDots([], today, { schedule: { kind: 'weekdays' } })
    expect(dots.map((d) => d.state)).toEqual(['off', 'off', 'missed', 'missed', 'missed', 'missed', 'open'])
    expect(weekDots([], today, { schedule: { kind: 'perWeek', n: 3 } }).filter((d) => d.state === 'missed')).toHaveLength(0)
  })
  it('a skip or a rest day keeps the streak alive but adds nothing', () => {
    expect(habitStreak(['2026-11-03', '2026-11-05'], today, { skips: ['2026-11-04'] })).toEqual({ n: 2, unit: 'day' })
    expect(habitStreak(['2026-11-03', '2026-11-05'], today)).toEqual({ n: 1, unit: 'day' })
    expect(habitStreak(['2026-11-05', '2026-11-06'], today)).toEqual({ n: 2, unit: 'day' })
  })
  it('weekends do not break a weekdays streak', () => {
    expect(habitStreak(['2026-10-29', '2026-10-30', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'], today, { schedule: { kind: 'weekdays' } }).n).toBe(6)
  })
  it('N× a week counts weeks in a row', () => {
    const days = ['2026-10-20', '2026-10-22', '2026-10-27', '2026-10-29', '2026-11-03']
    expect(habitStreak(days, today, { schedule: { kind: 'perWeek', n: 2 } })).toEqual({ n: 2, unit: 'week' })
    expect(habitStreak([...days, '2026-11-05'], today, { schedule: { kind: 'perWeek', n: 2 } })).toEqual({ n: 3, unit: 'week' })
  })
})

describe('order and groups', () => {
  const tiles = [
    { id: 'oath', done: true, slot: 'morning' as const },
    { id: 'focus', done: false, slot: 'day' as const },
    { id: 'workout', done: true, slot: 'day' as const },
    { id: 'skin', done: false, skipped: true, slot: 'day' as const },
    { id: 'read', done: false, slot: 'day' as const },
    { id: 'spend', done: false, slot: 'evening' as const }
  ]
  it('done ones move to the end (skipped after them) unless the order is fixed', () => {
    expect(orderTiles(tiles.filter((t) => t.slot === 'day')).map((t) => t.id)).toEqual(['focus', 'read', 'workout', 'skin'])
    expect(orderTiles(tiles.filter((t) => t.slot === 'day'), [], true).map((t) => t.id)).toEqual(['focus', 'workout', 'skin', 'read'])
    expect(orderTiles(tiles.filter((t) => t.slot === 'day'), ['read', 'focus']).map((t) => t.id)).toEqual(['read', 'focus', 'workout', 'skin'])
  })
  it('Morning, Day, Evening: counts leave skipped ones out, a finished part is settled', () => {
    const g = groupTiles(tiles, at('13:00'))
    expect(g.map((x) => [x.slot, x.done, x.total, x.current, x.settled])).toEqual([
      ['morning', 1, 1, false, true],
      ['day', 1, 3, true, false],
      ['evening', 0, 1, false, false]
    ])
  })
  it('the count and the perfect day (a skip is not perfect)', () => {
    expect(boardCount(tiles)).toEqual({ done: 2, total: 5, perfect: false })
    const all = tiles.map((t) => ({ ...t, done: true, skipped: false }))
    expect(boardCount(all).perfect).toBe(true)
    expect(boardCount([...all, { id: 'x', done: false, skipped: true, slot: 'day' as const }]).perfect).toBe(false)
    expect(boardCount([]).perfect).toBe(false)
  })
  it('drag to reorder and one step up or down', () => {
    expect(moveBefore(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b'])
    expect(moveBefore(['a', 'b', 'c'], 'a', null)).toEqual(['b', 'c', 'a'])
    expect(nudge(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c'])
    expect(nudge(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c'])
  })
})

describe('good days in a row', () => {
  const daily = (days: string[]) => ({ days, asked: () => true })
  it('two thirds of the habits make a good day; today counts once it gets there', () => {
    const h = [daily(['2026-11-04', '2026-11-05']), daily(['2026-11-04', '2026-11-05', '2026-11-06']), daily(['2026-11-03'])]
    expect(goodDayRun(h, '2026-11-06')).toBe(2)
    const h2 = [daily(['2026-11-04', '2026-11-05', '2026-11-06']), daily(['2026-11-04', '2026-11-05', '2026-11-06']), daily([])]
    expect(goodDayRun(h2, '2026-11-06')).toBe(3)
  })
})

describe('board settings', () => {
  it('cleans what it reads, keeps only known icons, colours and times', () => {
    const p = cleanPrefs({ looks: { oath: { icon: 'sunrise', color: 'nope', by: '25:00', slot: 'evening' } }, order: ['a', 'a', 'b'], hidden: 'x', skips: { '2026-11-06': ['oath'], bad: ['x'] }, fixed: 'yes' })
    expect(p).toEqual({ looks: { oath: { icon: 'sunrise', slot: 'evening' } }, order: ['a', 'b'], hidden: [], skips: { '2026-11-06': ['oath'] }, fixed: false })
    expect(cleanPrefs(null)).toEqual(EMPTY_PREFS)
  })
  it('looks: yours over the built-in over the default', () => {
    expect(lookOf('oath', EMPTY_PREFS)).toEqual({ icon: 'sunrise', color: 'amber', slot: 'morning', by: '10:00' })
    expect(lookOf('oath', { ...EMPTY_PREFS, looks: { oath: { by: null } } }).by).toBeNull()
    expect(lookOf('own:x', EMPTY_PREFS, { icon: 'book' }).icon).toBe('book')
  })
  it('skips per day, taken back cleanly', () => {
    const p = setSkip(EMPTY_PREFS, 'oath', '2026-11-06', true)
    expect(skipsOf(p, 'oath')).toEqual(['2026-11-06'])
    expect(setSkip(p, 'oath', '2026-11-06', false).skips).toEqual({})
  })
})
