import { describe, expect, it } from 'vitest'
import { activePlan, cleanPlan, currentWeek, ladderPrefill, planWeek, shouldPlan } from './weekPlan'
import { weekFocusFact } from './coach'
import { progressReport } from './progress'

describe('the Sunday top 3, pre-filled from the goal ladder', () => {
  it('ladder steps come first and start picked; goals and projects follow; no repeats', () => {
    const p = ladderPrefill(['5 workouts', 'Protein goal on 6 of 7 days', '10 h of focus'], ['Read 12 books', '5 workouts'], ['Inbox', 'Thesis'])
    expect(p.chips).toEqual(['5 workouts', 'Protein goal on 6 of 7 days', '10 h of focus', 'Read 12 books', 'Thesis'])
    expect(p.picked).toEqual(['5 workouts', 'Protein goal on 6 of 7 days', '10 h of focus'])
  })
  it('picks you already made this week win over the prefill', () => {
    expect(ladderPrefill(['5 workouts'], [], ['Thesis'], ['Thesis']).picked).toEqual(['Thesis'])
    expect(ladderPrefill([], ['A goal'], []).picked).toEqual([])
  })
})

describe('week plan', () => {
  it('Sunday plans the coming week; other days belong to this week', () => {
    expect(planWeek('2026-11-01')).toBe('2026-11-02') // Sunday → next Monday
    expect(planWeek('2026-10-31')).toBe('2026-10-26') // Saturday → this Monday
    expect(currentWeek('2026-11-01')).toBe('2026-10-26') // Sunday still ends the old week
    expect(currentWeek('2026-11-04')).toBe('2026-11-02')
  })

  it('asks for a plan when none is in force, and on Sunday for the next week', () => {
    const p = cleanPlan({ focus: 'wake', note: ' up at 7 ', big3: [{ text: 'Etica', done: false }, { text: '  ', done: false }] }, '2026-11-01')
    expect(p).toMatchObject({ week: '2026-11-02', focus: 'wake', note: 'up at 7', big3: [{ text: 'Etica', done: false, todoistId: null }] })
    expect(shouldPlan(p, '2026-11-01')).toBe(false) // made on Sunday for the next week
    expect(activePlan(p, '2026-11-01')).toBeNull() // not in force until Monday
    expect(activePlan(p, '2026-11-03')).toBe(p)
    expect(shouldPlan(p, '2026-11-08')).toBe(true) // next Sunday: plan again
    expect(shouldPlan(null, '2026-11-04')).toBe(true)
  })

  it('the coach leads with the week focus while it is behind', () => {
    const r = progressReport({ today: '2026-11-04', focus: [], wakes: [{ day: '2026-11-03', onTime: true }], workouts: [], discipline: [], todoist: [], spending: null })
    const f = weekFocusFact({ focus: 'wake', note: 'up at 07:00', big3: [] }, r)
    expect(f?.text).toMatch(/Your focus this week is on-time wake-ups: 1\/7/)
    expect(f?.step).toBe('up at 07:00')
    expect(weekFocusFact(null, r)).toBeNull()
  })
})
