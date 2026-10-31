import { describe, expect, it } from 'vitest'
import { addDays } from './dates'
import { coachFacts, coachPrompt, coachText, worthSaying } from './coach'
import { progressReport, type ProgressInput } from './progress'

const today = '2026-10-31'
const base: ProgressInput = { today, focus: [], wakes: [], workouts: [], discipline: [], todoist: [], spending: null, mustdos: [] }

describe('coach', () => {
  it('speaks up when you slip, with one step', () => {
    const i: ProgressInput = {
      ...base,
      focus: [{ day: addDays(today, -3), minutes: 50 }],
      wakes: [0, 1, 2, 3].map((k) => ({ day: addDays(today, -k), onTime: false })),
      workouts: [{ day: addDays(today, -6) }]
    }
    const facts = coachFacts(i, progressReport(i))
    expect(facts.map((f) => f.id)).toEqual(['no-focus', 'late-wake', 'no-sport', 'no-plan'])
    expect(facts[0].text).toBe('No focus session for 3 days.')
    expect(worthSaying(facts)).toBe(true)
    const text = coachText(facts)
    expect(text).toContain('• No focus session for 3 days.')
    expect(text).toContain('👉 Do one 25-minute focus block')
    expect(coachPrompt(facts, progressReport(i), { mustdos: [], todoistToday: 4, when: 'morning' })).toContain('Todoist tasks due today or late: 4')
  })

  it('stays quiet on a good day', () => {
    const i: ProgressInput = {
      ...base,
      focus: [{ day: today, minutes: 60 }],
      workouts: [{ day: today }],
      mustdos: [1, 2, 3].map((k) => ({ day: addDays(today, -k), done: true })),
      discipline: [{ kind: 'start', day: addDays(today, -20) }]
    }
    const facts = coachFacts(i, progressReport(i))
    expect(worthSaying(facts)).toBe(false)
    expect(facts.map((f) => f.id)).toContain('good-streak')
  })
})
