import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bedOnTime, focusBlocksStarted, honestScore, mustLine, sleepCheck, threeLine, upOnTime, weekSummaryText } from './threeNumbers'

describe('the 3 numbers and the honest day score', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-11T21:00:00'))
  })
  afterEach(() => vi.useRealTimers())

  it('an empty day scores 0 (no must-dos, no focus, no sleep logged)', () => {
    expect(honestScore({ sleep: null, focusBlocks: 0, mustDone: 0, mustTotal: 0 }).score).toBe(0)
  })

  it('must-dos 0/0 never gives a high score, even with lots of focus and good sleep', () => {
    const s = honestScore({ sleep: { bedTime: '23:00', wakeTime: '06:30' }, focusBlocks: 6, mustDone: 0, mustTotal: 0 })
    expect(s.parts.must).toBe(0)
    expect(s.score).toBe(67)
  })

  it('a full day is 100', () => {
    expect(honestScore({ sleep: { bedTime: '23:30', wakeTime: '06:45' }, focusBlocks: 3, mustDone: 3, mustTotal: 3 }).score).toBe(100)
  })

  it('must-dos count out of 3, never out of fewer', () => {
    expect(honestScore({ sleep: null, focusBlocks: 0, mustDone: 1, mustTotal: 1 }).score).toBe(11)
    expect(honestScore({ sleep: null, focusBlocks: 0, mustDone: 2, mustTotal: 3 }).score).toBe(22)
    expect(honestScore({ sleep: null, focusBlocks: 0, mustDone: 4, mustTotal: 4 }).score).toBe(33)
  })

  it('focus blocks count up to 3', () => {
    expect(honestScore({ sleep: null, focusBlocks: 1, mustDone: 0, mustTotal: 0 }).score).toBe(11)
    expect(honestScore({ sleep: null, focusBlocks: 9, mustDone: 0, mustTotal: 0 }).score).toBe(33)
  })

  it('asleep by 23:30 and up by 06:45, with the same 5 min grace as points', () => {
    expect(bedOnTime('23:30')).toBe(true)
    expect(bedOnTime('22:10')).toBe(true)
    expect(bedOnTime('23:35')).toBe(true)
    expect(bedOnTime('23:36')).toBe(false)
    expect(bedOnTime('00:40')).toBe(false)
    expect(bedOnTime(null)).toBe(null)
    expect(upOnTime('06:45')).toBe(true)
    expect(upOnTime('06:50')).toBe(true)
    expect(upOnTime('06:51')).toBe(false)
    // A night judged by the targets it was logged with (the same ones that paid points).
    expect(sleepCheck({ bedTime: '23:50', wakeTime: '07:10', bedTarget: '23:45', wakeTarget: '07:15' })).toMatchObject({ bedOk: true, upOk: true, met: true })
    expect(sleepCheck({ bedTime: '23:50', wakeTime: '07:10', bedTarget: null, wakeTarget: null })).toMatchObject({ bedOk: false, upOk: false })
    expect(upOnTime('')).toBe(null)
    expect(sleepCheck({ bedTime: '00:20', wakeTime: '06:30' })).toMatchObject({ bedOk: false, upOk: true, met: false })
    expect(sleepCheck(null).text).toBe('Not logged')
    expect(honestScore({ sleep: { bedTime: '00:20', wakeTime: '06:30' }, focusBlocks: 0, mustDone: 0, mustTotal: 3 }).score).toBe(17)
  })

  it('counts focus blocks started, a running one too', () => {
    expect(focusBlocksStarted([{ startedAt: '2026-11-11T09:00:00' }, { startedAt: null }], true)).toBe(2)
  })

  it('neutral lines and the weekly summary', () => {
    expect(mustLine(2, 3)).toBe('2 of 3 done')
    expect(mustLine(0, 0)).toBe('No must-dos yet')
    expect(threeLine({ sleep: null, focusBlocks: 1, mustDone: 2, mustTotal: 3 })).toBe('sleep not logged · 1 focus block · 2 of 3 done')
    const text = weekSummaryText([
      { day: '2026-11-09', sleep: { bedTime: '23:00', wakeTime: '06:30' }, focusBlocks: 2, mustDone: 3, mustTotal: 3 },
      { day: '2026-11-10', sleep: null, focusBlocks: 0, mustDone: 0, mustTotal: 0 }
    ])
    expect(text).toContain('Sleep on time: 1 of 2 nights')
    expect(text).toContain('Focus blocks started: 2')
    expect(text).toContain('Must-dos done: 3 of 6')
    expect(text).toContain('Average day score: 45/100')
  })
})
