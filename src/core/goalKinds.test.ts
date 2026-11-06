import { describe, expect, it } from 'vitest'
import {
  bestWeek,
  cleanMeta,
  dailyFromCheckins,
  daysOffLine,
  defaultMeta,
  freshMilestones,
  milestoneKey,
  moveInOrder,
  orderCards,
  periodInfo,
  periodOf,
  periodStatusAt,
  starterGoals,
  stepsFromText,
  stepsPct,
  typedCard,
  type GoalMeta
} from './goalKinds'
import type { CheckIn, MeasureGoal } from './goals'
import { goalsNowText, weeklyGoalLines } from './goalsBen'

// Made-up goals only.
const base: MeasureGoal = {
  id: 1,
  title: 'Goal',
  unit: 'count',
  start: 0,
  target: 4,
  startDay: '2026-10-01',
  deadline: '2099-12-31',
  why: '',
  area: 'Body',
  cadence: 'weekly',
  source: { kind: 'manual' },
  milestones: [],
  curve: 'line',
  doneDay: null
}
const meta = (p: Partial<GoalMeta>): GoalMeta => ({ ...defaultMeta(p.type ?? 'target'), ...p })
const ci = (day: string, value: number, by: CheckIn['by'] = 'me', goalId = 1): CheckIn => ({ id: `${day}-${value}-${Math.random()}`, goalId, at: `${day}T18:00:00.000Z`, day, value, by })

describe('weeks and months', () => {
  it('weeks run Monday to Sunday, months the whole month', () => {
    // 2026-11-06 is a Friday
    expect(periodOf('week', '2026-11-06')).toEqual({ key: 'w2026-11-02', from: '2026-11-02', to: '2026-11-08' })
    expect(periodOf('month', '2026-02-10')).toEqual({ key: 'm2026-02', from: '2026-02-01', to: '2026-02-28' })
  })
})

describe('habits', () => {
  const daily = { '2026-10-26': 1, '2026-10-27': 1, '2026-10-29': 1, '2026-10-31': 1, '2026-10-20': 1, '2026-10-22': 1, '2026-11-02': 1, '2026-11-04': 1 }
  it('counts the days, the streak of weeks made and the best week', () => {
    const pi = periodInfo('habit', 'week', 4, daily, '2026-10-01', '2026-11-06')
    expect(pi.value).toBe(2)
    expect(pi.daysLeft).toBe(3)
    expect(pi.hit).toBe(false)
    // week of 26 Oct made it (4), the week before did not (2): streak 1
    expect(pi.streak).toBe(1)
    expect(pi.best?.value).toBe(4)
    expect(pi.days.map((d) => d.done)).toEqual([true, false, true, false, false, false, false])
    expect(pi.days[5].future).toBe(true)
    expect(periodStatusAt('habit', pi)).toBe('on track')
  })
  it('a habit that cannot be made this week is at risk; one already made is ahead', () => {
    const late = periodInfo('habit', 'week', 4, { '2026-11-02': 1 }, '2026-10-01', '2026-11-07')
    expect(periodStatusAt('habit', late)).toBe('at risk')
    const made = periodInfo('habit', 'week', 2, daily, '2026-10-01', '2026-11-06')
    expect(made.hit).toBe(true)
    expect(made.streak).toBe(3)
    expect(periodStatusAt('habit', made)).toBe('ahead')
  })
  it('a day counts only when it passes the daily amount (water)', () => {
    const pi = periodInfo('habit', 'week', 5, { '2026-11-02': 2100, '2026-11-03': 900, '2026-11-04': 2000 }, '2026-10-01', '2026-11-06', 2000)
    expect(pi.value).toBe(2)
  })
  it('the card: today’s step, the pace words and the flame', () => {
    const g = { ...base, title: 'Work out 4× a week', source: { kind: 'body.workouts' as const } }
    const c = typedCard(g, meta({ type: 'habit' }), [], '2026-11-06', daily)
    expect(c.kind).toBe('habit')
    expect(c.value).toBe(2)
    expect(c.todayStep).toBe('Work out today · 2 of 4 this week')
    expect(c.pace).toBe('On track: 2 more in 3 days')
    expect(c.streak).toBe(1)
    expect(c.best).toMatch(/^Best week: 4 of 4/)
    expect(c.due).toBe(false) // counts itself
  })
  it('logged by hand: the check-ins are the days; due late in the week when nothing is logged', () => {
    const g = { ...base, title: 'Read 4× a week' }
    const c = typedCard(g, meta({ type: 'habit' }), [ci('2026-11-03', 1)], '2026-11-06')
    expect(c.value).toBe(1)
    expect(c.due).toBe(false)
    const quiet = typedCard(g, meta({ type: 'habit' }), [ci('2026-10-28', 1)], '2026-11-06')
    expect(quiet.due).toBe(true)
    expect(typedCard(g, meta({ type: 'habit', paused: true }), [], '2026-11-06').due).toBe(false)
  })
  it('take-backs never go below zero for a day', () => {
    expect(dailyFromCheckins([ci('2026-11-03', 1), ci('2026-11-03', -1), ci('2026-11-04', -2), ci('2026-11-04', 1, 'skip')])).toEqual({ '2026-11-03': 0, '2026-11-04': 0 })
  })
})

describe('limits and repeats', () => {
  it('a limit: under, close, over; the best week is the lowest finished one', () => {
    const g = { ...base, title: 'Gaming: at most 5h a week', unit: 'hours' as const, target: 5, source: { kind: 'pc.kind' as const, arg: 'gaming' } }
    const daily = { '2026-10-27': 6, '2026-11-03': 1.5 }
    const c = typedCard(g, meta({ type: 'limit' }), [], '2026-11-06', daily)
    expect(c.status).toBe('ahead')
    expect(c.todayStep).toBe('Under 1h10 today · 3h30 left this week')
    expect(c.period?.best?.value).toBe(0) // an earlier week with none
    const over = typedCard(g, meta({ type: 'limit' }), [], '2026-11-06', { '2026-11-03': 6 })
    expect(over.status).toBe('at risk')
    expect(over.pace).toBe('Over the limit this week')
    expect(over.todayStep).toBe('Over by 1h: none today')
    // a limit is only "made" when the week is over
    expect(over.period?.streak).toBe(5)
  })
  it('a repeat: save every month', () => {
    const g = { ...base, title: 'Save 2,000 lei every month', unit: 'lei' as const, target: 2000, cadence: 'monthly' as const, source: { kind: 'money.saved' as const } }
    const c = typedCard(g, meta({ type: 'repeat', per: 'month' }), [], '2026-11-06', { '2026-10-05': 2500, '2026-11-02': 400 })
    expect(c.value).toBe(400)
    expect(c.need).toBe('1,600 lei')
    expect(c.period?.history.slice(-2).map((r) => r.hit)).toEqual([true, false])
    expect(c.streak).toBe(1)
    expect(c.todayStep).toMatch(/this week · 1,600 lei to go$/)
  })
})

describe('projects', () => {
  it('steps from words, with ranges, counts and weights', () => {
    expect(stepsFromText('learn domain 1..5, 3 practice exams, book exam x2').map((s) => `${s.text}/${s.weight}`)).toEqual([
      'Learn domain 1/1',
      'Learn domain 2/1',
      'Learn domain 3/1',
      'Learn domain 4/1',
      'Learn domain 5/1',
      'Practice exam 1/1',
      'Practice exam 2/1',
      'Practice exam 3/1',
      'Book exam/2'
    ])
  })
  it('the share done goes by weight; today’s step is the next one', () => {
    const steps = [
      { id: 'a', text: 'Domain 1', weight: 1, done: '2026-10-10' },
      { id: 'b', text: 'Domain 2', weight: 1, done: null },
      { id: 'c', text: 'Practice exam', weight: 2, done: null }
    ]
    expect(stepsPct(steps)).toBe(25)
    const g = { ...base, title: 'Security+', unit: 'pct' as const, target: 100, deadline: '2026-12-31' }
    const c = typedCard(g, meta({ type: 'project', steps }), [], '2026-11-06')
    expect(c.pct).toBe(25)
    expect(c.todayStep).toBe('Next: Domain 2')
    expect(c.pace).toMatch(/days behind: \d steps? gets you back/)
  })
})

describe('the pace line in days and the best week', () => {
  const g: MeasureGoal = { ...base, title: 'Pushups', target: 900, startDay: '2026-10-01', deadline: '2026-12-30', source: { kind: 'sport.reps', arg: 'Pushups' } }
  it('days behind and ahead', () => {
    // the line goes 10 a day: on 6 Nov (36 days in) it says 360
    expect(daysOffLine(g, 360, '2026-11-06')).toBe(0)
    expect(daysOffLine(g, 330, '2026-11-06')).toBe(3)
    expect(daysOffLine(g, 400, '2026-11-06')).toBe(-4)
  })
  it('the card says how many days and what gets you back', () => {
    const c = typedCard(g, meta({}), [ci('2026-10-20', 150), ci('2026-11-05', 300)], '2026-11-06')
    expect(c.pace).toBe('6 days behind: 60 pushups today gets you back')
    expect(c.todayStep).toMatch(/^\+\d+ pushups today$/)
  })
  it('best week from the series', () => {
    expect(bestWeek(g, [{ day: '2026-10-01', value: 0 }, { day: '2026-10-07', value: 50 }, { day: '2026-10-14', value: 250 }, { day: '2026-10-21', value: 280 }], '2026-11-06')).toEqual({ from: '2026-10-12', gain: 200 })
  })
})

describe('order, meta and milestones', () => {
  it('old goals without extras are targets; broken extras fall back', () => {
    expect(cleanMeta(null).type).toBe('target')
    expect(cleanMeta({ type: 'nope', color: 'pink', photo: 'http://x/y.png', steps: [{ text: '' }, { text: 'One', weight: 99 }] })).toMatchObject({ type: 'target', color: 'lime', photo: null, steps: [{ text: 'One', weight: 10, done: null }] })
  })
  it('pinned first, paused last, your own order before the rest', () => {
    const mk = (id: number, m: Partial<GoalMeta>) => typedCard({ ...base, id, deadline: '2026-12-31' }, meta(m), [], '2026-11-06')
    const out = orderCards([mk(1, {}), mk(2, { paused: true }), mk(3, { order: 0 }), mk(4, { pinned: true })])
    expect(out.map((c) => c.goal.id)).toEqual([4, 3, 1, 2])
    expect(moveInOrder([4, 3, 1], 1, -1)).toEqual([4, 1, 3])
    expect(moveInOrder([4, 3, 1], 4, -1)).toEqual([4, 3, 1])
  })
  it('celebrates each new quarter once; a goal seen the first time is only remembered', () => {
    const g = { ...base, target: 100, deadline: '2026-12-31' }
    const at = (v: number) => typedCard(g, meta({}), [ci('2026-11-05', v)], '2026-11-06')
    const first = freshMilestones([at(30)], {})
    expect(first.celebrate).toEqual([])
    expect(first.seen).toEqual({ '1': '25' })
    const half = freshMilestones([at(55)], first.seen)
    expect(half.celebrate.map((x) => x.level)).toEqual([50])
    expect(freshMilestones([at(56)], half.seen).celebrate).toEqual([])
    expect(milestoneKey(at(100)).level).toBe(100)
  })
  it('habits celebrate the week they make', () => {
    const g = { ...base, title: 'Read' }
    const before = typedCard(g, meta({ type: 'habit' }), [ci('2026-11-02', 1), ci('2026-11-03', 1), ci('2026-11-04', 1)], '2026-11-06')
    const after = typedCard(g, meta({ type: 'habit' }), [ci('2026-11-02', 1), ci('2026-11-03', 1), ci('2026-11-04', 1), ci('2026-11-06', 1)], '2026-11-06')
    const seen = freshMilestones([before], {}).seen
    expect(freshMilestones([after], seen).celebrate.map((x) => x.level)).toEqual([100])
  })
})

describe('starter goals and Ben', () => {
  it('three starters that fit your data', () => {
    const s = starterGoals({ today: '2026-11-06', workouts30: 9, focusTop: { subject: 'Rust', hours: 12 }, finance: true, sleepLogs30: 0, waterDays30: 0 })
    expect(s.map((x) => x.id)).toEqual(['workout', 'save', 'hours'])
    expect(s[0].title).toBe('Work out 4× a week')
    expect(s[2].words).toMatch(/^finish \d+ hours of Rust by/)
    expect(starterGoals({ today: '2026-11-06', workouts30: 0, focusTop: null, finance: false, sleepLogs30: 3, waterDays30: 0 }).map((x) => x.id)).toEqual(['workout', 'hours', 'sleep'])
  })
  it('Ben sees each kind in its own words, with today’s step', () => {
    const habit = typedCard({ ...base, title: 'Work out 4× a week', source: { kind: 'body.workouts' } }, meta({ type: 'habit' }), [], '2026-11-06', { '2026-11-02': 1 })
    const text = goalsNowText([habit])
    expect(text).toMatch(/G1 Work out 4× a week: 1 of 4 this week/)
    expect(text).toMatch(/today: Work out today/)
    expect(weeklyGoalLines([habit], '2026-11-06')[0]).toMatch(/^🎯 Work out 4× a week: 1 of 4 this week/)
  })
})
