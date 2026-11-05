import { describe, expect, it } from 'vitest'
import { findWhen, guessShare, readDeepLink, sharedText } from './deepLinks'
import { cleanUnlocks, setUnlock, unlockBlocker, unlockState } from './unlocks'
import { daysThisWeek, goalsBoard } from './goalsBoard'
import type { GoalPlan } from './goalPlan'

describe('home-screen shortcuts and sharing (FT14, FT15)', () => {
  it('reads what a link asks for', () => {
    expect(readDeepLink('?do=water&ml=250')).toEqual({ kind: 'water', ml: 250 })
    expect(readDeepLink('?do=water&ml=99999')).toEqual({ kind: 'water', ml: 250 })
    expect(readDeepLink('?do=focus&min=25')).toEqual({ kind: 'focus', minutes: 25, subject: 'Focus' })
    expect(readDeepLink('?page=today&do=spend')).toEqual({ kind: 'spend' })
    expect(readDeepLink('?page=coach&do=ben')).toEqual({ kind: 'ben' })
    expect(readDeepLink('?page=tasks')).toBeNull()
    expect(readDeepLink('?share=1&title=&text=Buy%20milk&url=')).toEqual({ kind: 'share', title: '', text: 'Buy milk', url: '' })
    expect(readDeepLink('?share=1')).toBeNull()
  })
  it('joins shared title, text and link once', () => {
    expect(sharedText({ title: 'A post', text: 'Read this https://example.com/a', url: 'https://example.com/a' })).toBe('A post — Read this https://example.com/a')
    expect(sharedText({ title: '', text: 'Nice article', url: 'https://example.com/b' })).toBe('Nice article https://example.com/b')
  })
  it('guesses task, note or event', () => {
    const now = new Date('2026-11-05T10:00:00')
    expect(guessShare({ title: '', text: 'Call the dentist', url: '' }, now)).toBe('task')
    expect(guessShare({ title: 'Article', text: '', url: 'https://example.com' }, now)).toBe('note')
    expect(guessShare({ title: '', text: 'Study group fri 18:00', url: '' }, now)).toBe('event')
    expect(findWhen('Study group fri 18:00', now)).toMatchObject({ title: 'Study group', when: { start: 18 * 60 } })
    expect(findWhen('Read 3 pages', now)).toBeNull()
  })
})

describe('rewards that unlock with a goal or a streak (FT21)', () => {
  const facts = { goals: [{ id: 7, title: 'Rust book', done: false }, { id: 8, title: 'CV', done: true }], streaks: { workout: 4 } }
  it('a goal lock opens when the goal is done', () => {
    expect(unlockState({ kind: 'goal', goalId: 7, title: 'Rust book' }, facts)).toMatchObject({ met: false, text: 'Unlocks when "Rust book" is done' })
    expect(unlockState({ kind: 'goal', goalId: 8, title: 'CV' }, facts).met).toBe(true)
    expect(unlockState({ kind: 'goal', goalId: 9, title: 'Gone' }, facts).text).toMatch(/no longer on your list/)
  })
  it('a streak lock opens at the streak', () => {
    expect(unlockState({ kind: 'streak', streak: 'workout', days: 10 }, facts)).toMatchObject({ met: false, progress: 0.4 })
    expect(unlockBlocker({ kind: 'streak', streak: 'workout', days: 3 }, facts)).toBeNull()
    expect(unlockBlocker(null, facts)).toBeNull()
  })
  it('saves and cleans locks', () => {
    const all = setUnlock({}, 3, { kind: 'streak', streak: 'focus', days: 7 })
    expect(all).toEqual({ '3': { kind: 'streak', streak: 'focus', days: 7 } })
    expect(setUnlock(all, 3, null)).toEqual({})
    expect(cleanUnlocks({ x: { kind: 'goal', goalId: 1 }, '4': { kind: 'streak', streak: 'nope', days: 2 } })).toEqual({})
  })
})

describe('one goals list (FT3)', () => {
  const plan = (o: Partial<GoalPlan>): GoalPlan => ({ goalId: 1, title: 'Rust book', subject: 'Rust', deadline: '2026-11-20', leftMin: 600, daysLeft: 15, perDayMin: 40, todayLeftMin: 40, status: 'on track', aheadH: 0, milestones: [], ...o })
  it('counts this week to Sunday or the deadline', () => {
    expect(daysThisWeek('2026-11-05', null)).toBe(4) // Thu → Sun
    expect(daysThisWeek('2026-11-05', '2026-11-07')).toBe(2)
  })
  it('lists goals, aims and the week big 3 in one place with today\'s block', () => {
    const today = '2026-11-05'
    const start = new Date('2026-11-05T15:00:00').toISOString()
    const end = new Date('2026-11-05T16:00:00').toISOString()
    const b = goalsBoard({
      today,
      plans: [plan({}), plan({ goalId: 2, title: 'Math exam', subject: 'Math', deadline: '2026-11-10', status: 'behind', aheadH: -2, todayLeftMin: 20 })],
      aims: [{ title: 'rust book', deadline: '', weekly: '', at: '' }, { title: 'Run 5k', deadline: '2026-12-01', weekly: '3 runs', at: '' }],
      events: [{ id: 'e1', calendarId: 'c', title: 'Rust: Rust book', start, end, allDay: false, ours: true }],
      weekPlan: [{ text: 'Finish CV', done: false }],
      callBig3: ['finish cv', 'Apply to 2 jobs']
    })
    expect(b.goals.map((g) => g.title)).toEqual(['Math exam', 'Rust book', 'Run 5k'])
    expect(b.goals[0]).toMatchObject({ onTrack: false, status: 'behind', hoursLeft: 10, weekLeftMin: 140 })
    expect(b.goals[1]).toMatchObject({ onTrack: true, todayBlock: { start: '15:00', end: '16:00' }, weekLeftMin: 160 })
    expect(b.goals[2]).toMatchObject({ source: 'aim', onTrack: null, weekly: '3 runs', daysLeft: 26 })
    expect(b.week).toEqual([
      { text: 'Finish CV', done: false, from: 'week plan' },
      { text: 'Apply to 2 jobs', done: false, from: 'Sunday call' }
    ])
  })
})
