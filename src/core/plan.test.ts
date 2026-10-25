import { describe, expect, it } from 'vitest'
import {
  alreadyDone, blockOn, blocksToMiss, dueReminders, EVERY_DAY, finishAllowedAt, isOverdue, onWeekday, planFinish, planSkip,
  planTaskComplete, sortTasks, taskOn, TASKS_DAILY_COIN_CAP, validateBlock, validateTask, weekdayIndex, WORK_DAYS,
  type Block, type Task
} from './plan'

// 2026-10-26 is a Monday
const task = (p: Partial<Task> = {}): Task => ({
  id: 1, title: 'Read 20 pages', category: 'university', coins: 10, xp: 20, priority: 2, due: null,
  repeat: 'none', weekdays: 0, notes: null, createdDay: '2026-10-20', ...p
})
const block = (p: Partial<Block> = {}): Block => ({
  id: 1, title: 'Math', kind: 'study', start: '18:00', minutes: 50, weekdays: WORK_DAYS, date: null, remindMin: 5, createdDay: '2026-10-20', ...p
})

describe('weekdays', () => {
  it('maps days to Monday-first bits', () => {
    expect(weekdayIndex('2026-10-26')).toBe(0)
    expect(weekdayIndex('2026-11-01')).toBe(6)
    expect(onWeekday(WORK_DAYS, '2026-10-30')).toBe(true) // Friday
    expect(onWeekday(WORK_DAYS, '2026-10-31')).toBe(false) // Saturday
  })
})

describe('tasks', () => {
  it('shows one-off tasks until done, then only on the day they were done', () => {
    const t = task()
    expect(taskOn(t, '2026-10-26', new Set())).toBe(true)
    expect(taskOn(t, '2026-10-19', new Set())).toBe(false)
    const done = new Set(['2026-10-26'])
    expect(taskOn(t, '2026-10-26', done)).toBe(true)
    expect(taskOn(t, '2026-10-27', done)).toBe(false)
    expect(alreadyDone(t, '2026-10-27', done)).toBe(true)
  })
  it('repeats daily and weekly', () => {
    const daily = task({ repeat: 'daily' })
    expect(alreadyDone(daily, '2026-10-27', new Set(['2026-10-26']))).toBe(false)
    const weekly = task({ repeat: 'weekly', weekdays: 1 | 4 }) // Mon, Wed
    expect(taskOn(weekly, '2026-10-26', new Set())).toBe(true)
    expect(taskOn(weekly, '2026-10-27', new Set())).toBe(false)
    expect(() => planTaskComplete(weekly, '2026-10-27', new Set(), 0)).toThrow('not scheduled')
  })
  it('flags overdue one-offs', () => {
    expect(isOverdue(task({ due: '2026-10-25' }), '2026-10-26', new Set())).toBe(true)
    expect(isOverdue(task({ due: '2026-10-25' }), '2026-10-26', new Set(['2026-10-25']))).toBe(false)
  })
  it('pays coins up to the daily task cap, XP always', () => {
    expect(planTaskComplete(task(), '2026-10-26', new Set(), 0)).toEqual({ coins: 10, xp: 20 })
    expect(planTaskComplete(task(), '2026-10-26', new Set(), TASKS_DAILY_COIN_CAP - 4)).toEqual({ coins: 4, xp: 20 })
    expect(planTaskComplete(task(), '2026-10-26', new Set(), TASKS_DAILY_COIN_CAP)).toEqual({ coins: 0, xp: 20 })
    expect(() => planTaskComplete(task(), '2026-10-26', new Set(['2026-10-25']), 0)).toThrow('Already done')
  })
  it('validates tasks', () => {
    expect(() => validateTask(task({ title: '' }))).toThrow('title')
    expect(() => validateTask(task({ coins: 31 }))).toThrow('Coins')
    expect(() => validateTask(task({ repeat: 'weekly', weekdays: 0 }))).toThrow('weekday')
    expect(() => validateTask(task({ due: '26/10' }))).toThrow('Due')
  })
  it('sorts open, high-priority, soonest first', () => {
    const list = [
      { ...task({ title: 'b', priority: 2 }), done: false },
      { ...task({ title: 'a', priority: 1 }), done: true },
      { ...task({ title: 'c', priority: 1, due: '2026-10-30' }), done: false },
      { ...task({ title: 'd', priority: 1, due: '2026-10-27' }), done: false }
    ]
    expect(sortTasks(list).map((t) => t.title)).toEqual(['d', 'c', 'b', 'a'])
  })
})

describe('blocks', () => {
  it('occurs on its weekdays or its one-off date', () => {
    expect(blockOn(block(), '2026-10-26')).toBe(true)
    expect(blockOn(block(), '2026-10-31')).toBe(false)
    expect(blockOn(block({ weekdays: 0, date: '2026-10-31' }), '2026-10-31')).toBe(true)
    expect(blockOn(block({ createdDay: '2026-10-28' }), '2026-10-27')).toBe(false)
  })
  it('needs 80% of the block on the timer before it counts', () => {
    const started = '2026-10-26T15:00:00.000Z'
    expect(finishAllowedAt(started, 50).toISOString()).toBe('2026-10-26T15:40:00.000Z')
    expect(() => planFinish('pending', null, 50, new Date())).toThrow('Start the focus timer')
    expect(() => planFinish('running', started, 50, new Date('2026-10-26T15:30:00Z'))).toThrow('10 more min')
    expect(() => planFinish('running', started, 50, new Date('2026-10-26T15:40:00Z'))).not.toThrow()
    expect(() => planFinish('done', started, 50, new Date())).toThrow('closed')
    expect(() => planSkip('skipped')).toThrow('closed')
    expect(() => planSkip('running')).not.toThrow()
  })
  it('marks unclosed past study blocks as missed, only since the block existed', () => {
    const b = block({ createdDay: '2026-10-28' }) // Wed
    const misses = blocksToMiss([b, block({ id: 2, kind: 'other' })], new Set(['1:2026-10-29']), '2026-11-02')
    expect(misses.map((m) => m.day)).toEqual(['2026-10-28', '2026-10-30'])
  })
  it('sends a heads-up and a start reminder once each, and drops stale ones', () => {
    const rb = { id: 1, day: '2026-10-26', title: 'Math', kind: 'study' as const, status: 'pending' as const, remindMin: 5, startsAt: '2026-10-26T15:00:00.000Z' }
    const sent = new Set<string>()
    expect(dueReminders([rb], new Date('2026-10-26T14:54:00Z'), sent)).toEqual([])
    const pre = dueReminders([rb], new Date('2026-10-26T14:55:30Z'), sent)
    expect(pre.map((r) => r.title)).toEqual(['Math in 5 min'])
    pre.forEach((r) => sent.add(r.key))
    expect(dueReminders([rb], new Date('2026-10-26T14:57:00Z'), sent)).toEqual([])
    expect(dueReminders([rb], new Date('2026-10-26T15:00:10Z'), sent).map((r) => r.title)).toEqual(['Math starts now'])
    expect(dueReminders([rb], new Date('2026-10-26T15:30:00Z'), new Set())).toEqual([])
    expect(dueReminders([{ ...rb, status: 'running' }], new Date('2026-10-26T15:00:10Z'), new Set())).toEqual([])
  })

  it('validates blocks', () => {
    expect(() => validateBlock(block({ start: '25:00' }))).toThrow('HH:MM')
    expect(() => validateBlock(block({ minutes: 2 }))).toThrow('5 to 600')
    expect(() => validateBlock(block({ weekdays: 0 }))).toThrow('weekdays or a date')
    expect(() => validateBlock(block({ weekdays: EVERY_DAY }))).not.toThrow()
  })
})
