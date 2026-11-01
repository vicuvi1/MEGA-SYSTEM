import { describe, expect, it } from 'vitest'
import { goalProgress } from './focus'
import { bookBlocks, goalBlockTitle, isGoalBlock, missCost, perDay, planGoal, planLine } from './goalPlan'

const today = '2026-11-02' // Monday
const goal = { id: 1, title: 'Pass the algebra exam', subject: 'Algebra', deadline: '2026-11-12', hours: 20, createdDay: '2026-10-29' }

describe('goals planned backward', () => {
  it('spreads the hours left over the days left, with weekly milestones', () => {
    const g = goalProgress(goal, 4 * 60, today) // 4h done, 16h left, 10 days
    const p = planGoal(g, today)
    expect(p.leftMin).toBe(960)
    expect(p.daysLeft).toBe(10)
    expect(p.perDayMin).toBe(perDay(960, 10)) // 96 → 100
    expect(p.perDayMin).toBe(100)
    expect(p.milestones.map((m) => m.by)).toEqual(['2026-11-08', '2026-11-11'])
    expect(p.milestones[0].targetH).toBeCloseTo(4 + 16 * 0.7, 1)
    expect(p.milestones[1].targetH).toBe(20)
    expect(planLine(p)).toContain('16.0h left → 100 min/day')
  })

  it('says what skipping today costs, and counts what was done today', () => {
    const g = goalProgress(goal, 4 * 60 + 30, today)
    const p = planGoal(g, today, 30)
    expect(p.todayLeftMin).toBe(70)
    expect(missCost(p)).toBe(perDay(930, 9) - 100)
    expect(planGoal(goalProgress(goal, 20 * 60, today), today).status).toBe('done')
  })

  it('books blocks in free time, most urgent first, subject first in the title', () => {
    const p = planGoal(goalProgress(goal, 4 * 60, today), today)
    const ev = [{ id: 'l', calendarId: 'c', title: 'Lecture', start: new Date(`${today}T09:00:00`).toISOString(), end: new Date(`${today}T12:00:00`).toISOString(), allDay: false }]
    const b = bookBlocks([p], ev, today, '08:00', 2)
    expect(b.filter((x) => x.day === today).map((x) => [x.start, x.minutes])).toEqual([['08:00', 50], ['12:00', 50]])
    expect(b.some((x) => x.day === '2026-11-03' && x.start === '08:00' && x.minutes === 50)).toBe(true)
    expect(b[0].title).toBe('Algebra: Pass the algebra exam')
    expect(isGoalBlock({ title: goalBlockTitle(p), ours: true }, p)).toBe(true)
    expect(isGoalBlock({ title: goalBlockTitle(p), ours: false }, p)).toBe(false)
  })
})
