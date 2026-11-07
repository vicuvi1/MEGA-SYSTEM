import { describe, expect, it } from 'vitest'
import { behindFlags, cleanEssays, essaysLine, essayStatus, planEssay, replan, stepSizes, stepsToday, stepTask, tickStep } from './essays'

const T = '2026-11-07'

describe('essay planner', () => {
  it('sizes: about 450 words an hour, drafts in sessions of 50 min at most', () => {
    expect(stepSizes(1500)).toEqual({ outline: 45, drafts: [50, 50, 50, 50], edit: 45, submit: 15 })
    expect(stepSizes(300)).toEqual({ outline: 25, drafts: [40], edit: 25, submit: 15 })
  })
  it('plans backward: submit on the due day, edit the day before, outline first', () => {
    const e = planEssay({ title: 'Made-up essay on privacy', due: '2026-11-20', words: 1500 }, T, 'e1')
    expect(e.tight).toBe(false)
    expect(e.steps.map((s) => [s.label, s.day])).toEqual([
      ['Outline', '2026-11-14'],
      ['Draft 1/4', '2026-11-15'],
      ['Draft 2/4', '2026-11-16'],
      ['Draft 3/4', '2026-11-17'],
      ['Draft 4/4', '2026-11-18'],
      ['Edit', '2026-11-19'],
      ['Submit', '2026-11-20']
    ])
  })
  it('too few days: the steps share the days from today and it says it is tight', () => {
    const e = planEssay({ title: 'Lab report', due: '2026-11-09', words: 1000 }, T, 'e2')
    expect(e.tight).toBe(true)
    expect(e.steps[0].day).toBe(T)
    expect(e.steps.at(-1)!.day).toBe('2026-11-09')
    const days = e.steps.map((s) => s.day)
    expect([...days].sort()).toEqual(days)
  })
  it('status: on track, behind when a step day passed undone, done, late', () => {
    let e = planEssay({ title: 'Essay', due: '2026-11-12', words: 500 }, T, 'e3')
    expect(essayStatus(e, T).state).toBe('on track')
    const later = e.steps[1].day
    expect(essayStatus(e, later).state).toBe('behind')
    expect(behindFlags([e], later)[0]).toMatch(/^Essay: 1 step behind \(Outline\), due in \d days$/)
    for (const s of e.steps) e = tickStep(e, s.id, true)
    expect(essayStatus(e, later)).toMatchObject({ state: 'done', pct: 100, minutesLeft: 0 })
    expect(essayStatus(planEssay({ title: 'x', due: T, words: 300 }, T, 'e4'), '2026-11-08').state).toBe('late')
  })
  it('replan moves the open steps to start today, keeping the due day', () => {
    let e = planEssay({ title: 'Essay', due: '2026-11-15', words: 800 }, '2026-11-01', 'e5')
    e = tickStep(e, e.steps[0].id, true)
    const r = replan(e, '2026-11-12')
    expect(r.steps[0].day).toBe(e.steps[0].day)
    expect(r.steps[1].day).toBe('2026-11-12')
    expect(r.steps.at(-1)!.day).toBe('2026-11-15')
  })
  it("today's steps, the task text and Ben's line", () => {
    const e = planEssay({ title: 'Ethics essay', due: '2026-11-11', words: 400 }, T, 'e6')
    expect(stepsToday([e], T).map((x) => x.step.label)).toEqual(['Outline'])
    expect(stepTask(e, e.steps[0])).toBe('Outline: Ethics essay (25 min)')
    expect(essaysLine([e], T)).toBe('Essays: Ethics essay due 2026-11-11 (on track, next: Outline today)')
    expect(cleanEssays([e])).toEqual([e])
  })
})
