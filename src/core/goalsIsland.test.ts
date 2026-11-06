import { describe, expect, it } from 'vitest'
import { goalCard, type MeasureGoal } from './goals'
import { goalAlertId, goalPeek, islandGoals } from './goalsIsland'

const today = '2026-11-20'
const g: MeasureGoal = { id: 1, title: 'Profit 5,000 lei a month', unit: 'lei', start: 1000, target: 5000, startDay: '2026-10-01', deadline: '2026-12-31', why: '', area: 'Money', cadence: 'weekly', source: { kind: 'manual' }, milestones: [], curve: 'line', doneDay: null }
const goals = islandGoals([goalCard(g, [{ id: 'a', goalId: 1, at: '2026-11-10T09:00:00Z', day: '2026-11-10', value: 3200, by: 'me' }], today)])

describe('goals on the island', () => {
  it('rows with the number, the ring and quick answers', () => {
    expect(goals[0]).toMatchObject({ id: 1, value: '3,200 of 5,000 lei', due: true })
    expect(goals[0].quick.map((q) => q.op)[1]).toBe('s')
  })
  it('the check-in peek: only when due, not busy, in the day, not dismissed', () => {
    const now = Date.parse('2026-11-20T12:00:00Z')
    const p = goalPeek(goals, { today, hour: 12, busy: false, dismissed: {}, now })
    expect(p?.kind).toBe('goal')
    expect(p?.actions[0]).toMatchObject({ primary: true, action: { kind: 'goal', goalId: 1 } })
    expect(goalPeek(goals, { today, hour: 12, busy: true, dismissed: {}, now })).toBeNull()
    expect(goalPeek(goals, { today, hour: 22, busy: false, dismissed: {}, now })).toBeNull()
    expect(goalPeek(goals, { today, hour: 12, busy: false, dismissed: { [goalAlertId(goals[0], today)]: now + 1000 }, now })).toBeNull()
  })
})
