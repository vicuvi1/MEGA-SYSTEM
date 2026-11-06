import { describe, expect, it } from 'vitest'
import { computeSleepStats, fromMinutes, isBedOnTime, isWakeOnTime, targetForDay, toMinutes, type SleepLog } from './sleep'

describe('sleep core', () => {
  it('converts to and from minutes correctly', () => {
    expect(toMinutes('07:30')).toBe(450)
    expect(toMinutes('00:00')).toBe(0)
    expect(toMinutes('23:59')).toBe(1439)
    expect(fromMinutes(450)).toBe('07:30')
    expect(fromMinutes(1440)).toBe('00:00')
  })

  it('evaluates wake on-time with grace window', () => {
    expect(isWakeOnTime('06:55', '07:00')).toBe(true)
    expect(isWakeOnTime('07:00', '07:00')).toBe(true)
    expect(isWakeOnTime('07:20', '07:00')).toBe(true) // 20 min grace, like Waky
    expect(isWakeOnTime('07:21', '07:00')).toBe(false)
    expect(isWakeOnTime('08:30', '07:00')).toBe(false)
  })

  it('evaluates bedtime on-time with grace window', () => {
    expect(isBedOnTime('23:00', '23:00')).toBe(true)
    expect(isBedOnTime('23:25', '23:00')).toBe(true)
    expect(isBedOnTime('22:45', '23:00')).toBe(true)
    expect(isBedOnTime('00:10', '23:00')).toBe(false)
    // Early is on time (P6); after midnight against a midnight target still works.
    expect(isBedOnTime('21:00', '23:00')).toBe(true)
    expect(isBedOnTime('00:20', '00:00')).toBe(true)
    expect(isBedOnTime('01:00', '00:00')).toBe(false)
  })

  it('determines targets based on weekday vs weekend', () => {
    // 2026-10-26 was a Monday
    expect(targetForDay('2026-10-26', '07:00', '08:30')).toBe('07:00')
    // 2026-10-31 is a Saturday
    expect(targetForDay('2026-10-31', '07:00', '08:30')).toBe('08:30')
  })

  it('computes sleep streaks and stats accurately', () => {
    const logs: SleepLog[] = [
      { id: 1, day: '2026-10-25', wakeTime: '06:50', wakeTarget: '07:00', onTime: true, bedTime: '23:00', bedTarget: '23:00', bedOnTime: true, quality: 5, createdAt: '' },
      { id: 2, day: '2026-10-26', wakeTime: '07:10', wakeTarget: '07:00', onTime: true, bedTime: '23:30', bedTarget: '23:00', bedOnTime: true, quality: 4, createdAt: '' },
      { id: 3, day: '2026-10-27', wakeTime: '07:05', wakeTarget: '07:00', onTime: true, bedTime: '23:15', bedTarget: '23:00', bedOnTime: true, quality: 4, createdAt: '' }
    ]

    const stats = computeSleepStats(logs, '2026-10-27')
    expect(stats.streak).toBe(3)
    expect(stats.bestStreak).toBe(3)
    expect(stats.onTimeRate).toBe(1)
    expect(stats.todayLog).not.toBeNull()
    expect(stats.todayLog?.day).toBe('2026-10-27')
    expect(stats.avgSleepMin).toBeGreaterThan(400)
  })
})

import { bedNightDay } from './sleep'
describe('a night belongs to its morning', () => {
  it('bed at 23:30 or 01:30 goes on the next morning; a nap at 10:00 stays today', () => {
    expect(bedNightDay('2026-11-04', 23)).toBe('2026-11-05')
    expect(bedNightDay('2026-11-04', 1)).toBe('2026-11-05')
    expect(bedNightDay('2026-11-04', 10)).toBe('2026-11-04')
  })
})

import { wakeLoggedToday } from './sleep'
describe('a wake-up logged today, from anywhere', () => {
  it('counts today’s row with a wake time, even when last night’s bedtime made the row', () => {
    // Bed at 23:30 made today's row last night; "I'm up" on Telegram filled the wake time this morning.
    expect(wakeLoggedToday({ day: '2026-11-06', wakeTime: '06:36' }, '2026-11-06')).toBe(true)
    // A wake-up at exactly 07:00 is a real one too.
    expect(wakeLoggedToday({ day: '2026-11-06', wakeTime: '07:00' }, '2026-11-06')).toBe(true)
  })
  it('a bedtime alone, or yesterday’s row, is no wake-up', () => {
    expect(wakeLoggedToday({ day: '2026-11-06', wakeTime: '' }, '2026-11-06')).toBe(false)
    expect(wakeLoggedToday({ day: '2026-11-05', wakeTime: '06:50' }, '2026-11-06')).toBe(false)
    expect(wakeLoggedToday(null, '2026-11-06')).toBe(false)
  })
})
