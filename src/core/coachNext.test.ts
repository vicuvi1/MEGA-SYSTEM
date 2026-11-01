import { describe, expect, it } from 'vitest'
import { nextMove, type MoveInput } from './coachNext'

const base: MoveInput = { hour: 10, awaiting: [], planStatus: 'approved', running: null, goals: [], openMustDos: [], evening: false }

describe('do this now', () => {
  it('picks the one move that matters, in order', () => {
    const now = Date.parse('2026-11-02T10:00:00Z')
    expect(nextMove({ ...base, running: { subject: 'Algebra', endsAt: now + 20 * 60000 }, awaiting: ['Start the CV'] }, now)).toMatchObject({ kind: 'running', sub: '20 min left. Phone away, stay on it.' })
    expect(nextMove({ ...base, awaiting: ['Start the CV'], planStatus: 'proposed' })).toMatchObject({ kind: 'answer', promise: 'Start the CV' })
    expect(nextMove({ ...base, planStatus: 'proposed' }).kind).toBe('approve')
    const goals = [{ title: 'CV live', subject: 'CV', todayLeftMin: 40, behind: false }, { title: 'Algebra exam', subject: 'Algebra', todayLeftMin: 65, behind: true }]
    expect(nextMove({ ...base, goals })).toMatchObject({ kind: 'focus', subject: 'Algebra', minutes: 50 })
    expect(nextMove({ ...base, openMustDos: ['Lab report intro', 'Gym'] })).toMatchObject({ kind: 'focus', title: '25 min: Lab report intro' })
    expect(nextMove({ ...base, planStatus: 'none' }).kind).toBe('plan')
    expect(nextMove({ ...base, hour: 21, evening: true, openMustDos: ['x'] })).toMatchObject({ kind: 'ask', title: 'How did today go?' })
  })
})
