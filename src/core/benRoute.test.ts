import { describe, expect, it } from 'vitest'
import { canRetry, digestText, intentOf, reviewChange, reviewFromData, routeFor, strongSlot, trimContext, type DayDigest } from './benRoute'

const D: DayDigest = {
  day: '2026-03-09',
  score: 58,
  mustdos: { done: 1, total: 3, open: ['Algebra set 4', 'Email the tutor'] },
  focusMin: 75,
  focusBy: [{ subject: 'Lab report', minutes: 50 }, { subject: 'Algebra', minutes: 25 }],
  plannedFocusMin: 120,
  sleep: { bed: '01:40', wake: '08:10', onTime: false, hours: 6.5, quality: 2 },
  water: { met: false, ml: null, target: null },
  workouts: [],
  money: { spent: 145, top: ['Food 95', 'Transport 50'] },
  goals: ['G1 Save 5000 lei: 3100/5000 by 31 Dec (62%), on track'],
  promises: { kept: 1, broken: 1 },
  points: 40
}

describe('intent routing', () => {
  it('reads what kind of message it is', () => {
    expect(intentOf('Review yesterday for me: what went well, what slipped, and one change for today.')).toBe('review')
    expect(intentOf('how was my day?')).toBe('review')
    expect(intentOf('plan my day')).toBe('plan')
    expect(intentOf("make today's plan please")).toBe('plan')
    expect(intentOf('I plan to go to the gym')).not.toBe('plan')
    expect(intentOf('move my gym to 7pm and add 20 min reading')).toBe('multi')
    expect(intentOf('how am I doing on my goals')).toBe('goals')
    expect(intentOf('water 500')).toBe('log')
    expect(intentOf('20 pushups')).toBe('log')
    expect(intentOf('why do I always slip after lunch?')).toBe('advice')
    expect(intentOf('hey')).toBe('chat')
  })

  it('quick logs go to the quick model, reviews and advice to the strong one', () => {
    expect(routeFor('water 500')).toMatchObject({ strong: false, trim: 'light' })
    expect(routeFor('review my day')).toMatchObject({ strong: true, think: true, trim: 'review' })
    expect(routeFor('move my gym to 19:00 and add 20 min reading')).toMatchObject({ strong: false, allActions: true })
    expect(routeFor('what should I do this week?')).toMatchObject({ strong: true, trim: 'full' })
    expect(routeFor('no, that was 45 not 50', { correcting: true })).toMatchObject({ strong: true, allActions: true })
  })
})

describe('time', () => {
  it('the strong model keeps the quick model reserve free, or is skipped', () => {
    const now = 1_000_000
    expect(strongSlot(now, now + 44_000, 20_000)).toBe(20_000)
    expect(strongSlot(now, now + 30_000, 20_000)).toBe(16_000)
    expect(strongSlot(now, now + 18_000, 20_000)).toBe(0)
    expect(strongSlot(now, now + 44_000, 0)).toBe(0)
    expect(canRetry(now, now + 10_000)).toBe(true)
    expect(canRetry(now, now + 3_000)).toBe(false)
  })
})

describe('the prompt diet', () => {
  const ctx = [
    'Now: Monday 9 March, 09:05.',
    "Today's must-dos: [open] Algebra set 4.",
    'Goals planned backward from their deadlines:',
    '- Algebra exam: 4h left',
    'Week score 61/100 (last week 55).',
    'Calendar today: 09:00 Deep block; 19:00 Gym.',
    '- 10:00 something under the calendar',
    'On his PC today by activity (from the desktop app): coding 2h.',
    'Weather: rain at 17:00.',
    'Sleep: bedtime target 23:00.',
    'HIS DAY SO FAR (with times, newest last):',
    '- 08:10 water 250'
  ].join('\n')
  it('a review keeps the numbers and drops the calendar, the PC and plugins', () => {
    const r = trimContext(ctx, 'review')
    expect(r).toMatch(/Week score/)
    expect(r).toMatch(/- Algebra exam/)
    expect(r).toMatch(/Sleep:/)
    expect(r).not.toMatch(/Calendar today|On his PC|Weather|10:00 something|HIS DAY/)
  })
  it('a plan keeps the calendar; full keeps everything', () => {
    expect(trimContext(ctx, 'plan')).toMatch(/Calendar today[\s\S]*10:00 something/)
    expect(trimContext(ctx, 'full')).toBe(ctx)
  })
})

describe('yesterday in numbers', () => {
  it('lists every number from the data', () => {
    const t = digestText(D)
    expect(t).toMatch(/Day score: 58\/100/)
    expect(t).toMatch(/Must-dos: 1\/3 done; left open: Algebra set 4; Email the tutor/)
    expect(t).toMatch(/Focus: 1h 15m of 2h 00m planned \(Lab report 50 min, Algebra 25 min\)/)
    expect(t).toMatch(/bed 01:40, up 08:10 \(late\), 6.5 h, felt 2\/5/)
    expect(t).toMatch(/Workouts: none/)
    expect(t).toMatch(/spent 145 lei/)
    expect(t).toMatch(/G1 Save 5000 lei/)
  })
  it('one change he can tap, from the weakest spot', () => {
    expect(reviewChange(D)).toMatchObject({ do: 'focus:25:Algebra set 4' })
    expect(reviewChange({ ...D, mustdos: { done: 3, total: 3, open: [] }, sleep: { ...D.sleep!, hours: 5.2 } }).do).toMatch(/^say:remind me at 22:30/)
    expect(reviewChange({ ...D, mustdos: { done: 3, total: 3, open: [] }, workouts: ['Push day'], water: { met: true, ml: null, target: null }, sleep: { ...D.sleep!, hours: 7.5 } }).do).toBe('plan')
  })
  it('a review from the numbers alone when no model answers', () => {
    const t = reviewFromData(D)
    expect(t).toMatch(/Yesterday scored 58\/100/)
    expect(t).toMatch(/Went well: 1h 15m of focus/)
    expect(t).toMatch(/Slipped: must-dos 1\/3/)
    expect(t).toMatch(/One change for today: Start with the must-do that slipped \(Algebra set 4\)/)
  })
})
