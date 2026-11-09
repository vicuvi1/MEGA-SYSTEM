// The goal ladder: quarter math, milestones worked backward, action scoring,
// traffic lights, the timeline, the top 3 prefill, max 3 active and the swap,
// the reviews, and the planner placing the week's steps. Made-up data only.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addDays } from './dates'
import {
  activate, activeGoals, cleanLadder, confirmMilestones, defaultLadder, EMPTY_FACTS, fixLine, goalWeek, ladderBenLine, ladderCards, ladderTop3, lightOf, markReviewed, milestoneHit, monthToReview, monthlyReviewData, notNowGoals, park, quarterLine, quarterOf, resultOf, setResultTarget, setTarget, suggestMilestones, swap, timeline, weeklyReviewData, weeklyReviewDue,
  type LadderFacts
} from './goalLadder'
import { LADDER_STUDY_ID, ladderStudyGoal, placeStudy, placeWeekSteps, placeWorkouts } from './ladderPlan'
import type { DeadlinePlan } from './planDeadlines'

// Quarter: Mon 2 Nov 2026 – Sun 24 Jan 2027. Today: Fri 13 Nov (week 2).
const START = '2026-11-02'
const TODAY = '2026-11-13'
const days = (from: string, n: number, v = 1) => Object.fromEntries(Array.from({ length: n }, (_, i) => [addDays(from, i), v]))

function facts(over: Partial<LadderFacts> = {}): LadderFacts {
  return {
    ...EMPTY_FACTS,
    daily: {
      // week 1: 5 workouts, protein 6 days, 3 weigh-ins; week 2 (Mon–Thu): 2 workouts, 4 protein days, 1 weigh-in
      workouts: { ...days('2026-11-02', 5), '2026-11-09': 1, '2026-11-11': 1 },
      proteinDays: { ...days('2026-11-02', 6), ...days('2026-11-09', 4) },
      weighIns: { '2026-11-02': 1, '2026-11-04': 1, '2026-11-06': 1, '2026-11-10': 1 },
      focusHours: { '2026-11-09': 2, '2026-11-10': 1.5, '2026-11-11': 1, '2026-11-12': 1.5, '2026-11-13': 1 }
    },
    weights: [
      { week: '2026-10-26', avg: 70 },
      { week: '2026-11-02', avg: 70.3 },
      { week: '2026-11-09', avg: 70.6 }
    ],
    splitDays: 4,
    ...over
  }
}
const Q = quarterOf({ start: START, weeks: 12, name: 'Iron Path' }, null, TODAY)

describe('the quarter is the season', () => {
  it('12 weeks, 3 months of 4 weeks, week and month of today', () => {
    expect(Q).toMatchObject({ start: START, weeks: 12, end: '2027-01-24', week: 2, month: 1, months: 3, season: 'Iron Path' })
    expect(quarterOf({ start: START, weeks: 12, name: 'x' }, null, '2026-12-01')).toMatchObject({ week: 5, month: 2 })
  })
  it('an old 8-week season in progress keeps its length: 2 months', () => {
    expect(quarterOf({ start: '2026-10-05', weeks: 8, name: 'Old' }, null, TODAY)).toMatchObject({ weeks: 8, end: '2026-11-29', week: 6, month: 2, months: 2 })
  })
  it('without a season: 12 weeks from the ladder start, rolling on', () => {
    expect(quarterOf(null, null, TODAY)).toMatchObject({ start: '2026-11-09', weeks: 12, week: 1 })
    expect(quarterOf(null, '2026-08-03', TODAY)).toMatchObject({ start: '2026-10-26', week: 3 })
  })
})

describe('milestones worked backward', () => {
  it('+4 kg in 12 weeks is about +1.33 kg a month from the starting weekly average', () => {
    const g = defaultLadder().goals.find((x) => x.id === 'gain')!
    const ms = suggestMilestones(g, facts(), Q)
    expect(ms.map((m) => m.value)).toEqual([71.3, 72.7, 74])
    expect(ms[0].text).toBe('Month 1: +1.3 kg (71.3 kg weekly average)')
    expect(ms[2].text).toMatch(/\+4 kg/)
  })
  it('study: weekly focus target times the weeks; confirmed edits win', () => {
    const l = setTarget(defaultLadder(), 'study', 'focusHours', 8)
    const g = l.goals.find((x) => x.id === 'study')!
    expect(suggestMilestones(g, facts(), Q).map((m) => m.value)).toEqual([32, 64, 96])
    const c = confirmMilestones(l, 'study', [{ month: 1, text: 'Month 1: 30 h', value: 30 }])
    expect(c.goals.find((x) => x.id === 'study')!.milestones).toEqual([{ month: 1, text: 'Month 1: 30 h', value: 30 }])
    expect(() => confirmMilestones(l, 'study', [])).toThrow()
  })
  it('a month is hit by its number at the month end', () => {
    const g = defaultLadder().goals.find((x) => x.id === 'gain')!
    const f = facts({ weights: [{ week: '2026-10-26', avg: 70 }, { week: '2026-11-23', avg: 71.4 }] })
    expect(milestoneHit(g, f, Q, 1, '2026-12-02')).toBe(true)
    expect(milestoneHit(g, f, Q, 1, '2026-11-20')).toBeNull()
  })
})

describe('scoring actions, not results', () => {
  const l = defaultLadder()
  const gain = l.goals.find((x) => x.id === 'gain')!
  it('a finished week: each action against its target', () => {
    const w = goalWeek(gain, facts(), '2026-11-02', TODAY)
    expect(w.actions.map((a) => a.text)).toEqual(['5/5 workouts', '6/6 protein days', '3/3 weigh-ins'])
    expect(w).toMatchObject({ score: 100, light: 'green' })
  })
  it('this week is judged on its finished days only (Fri: Mon–Thu)', () => {
    const w = goalWeek(gain, facts(), '2026-11-09', TODAY)
    expect(w.actions.map((a) => a.text)).toEqual(['2/5 workouts', '4/6 protein days', '1/3 weigh-ins'])
    // expected by Thu night: 5·4/7 = 2.86, 6·4/7 = 3.43, 3·4/7 = 1.71
    expect(w.score).toBe(Math.round(((2 / (20 / 7) + 1 + 1 / (12 / 7)) / 3) * 100))
    expect(w.light).toBe('yellow')
    // a new week starts calm: nothing judged on Monday
    expect(goalWeek(gain, facts(), '2026-11-16', '2026-11-16')).toMatchObject({ score: null, light: 'none' })
  })
  it('the weight result is shown, never scored', () => {
    const r = resultOf(gain, facts(), Q, TODAY)
    expect(r).toMatchObject({ start: 70, now: 70.6, target: 74, pct: 15 })
    // no weigh-ins at all: the light still comes from actions
    const w = goalWeek(gain, facts({ weights: [] }), '2026-11-02', TODAY)
    expect(w.light).toBe('green')
  })
  it('traffic light thresholds: 80 green, 50 yellow, else red', () => {
    expect([lightOf(80), lightOf(79), lightOf(50), lightOf(49), lightOf(null)]).toEqual(['green', 'yellow', 'yellow', 'red', 'none'])
  })
  it('behind: one plain fix for the worst action, no guilt words', () => {
    const f = facts({ daily: { workouts: {}, proteinDays: days('2026-11-09', 4), weighIns: days('2026-11-09', 2) } })
    const w = goalWeek(gain, f, '2026-11-09', TODAY)
    expect(w.light).toBe('yellow')
    const fix = fixLine(w, TODAY)!
    expect(fix).toBe('3 days left: every workout you fit in still counts.')
    expect(fix).not.toMatch(/fail|lazy|should have|bad/i)
  })
  it('study sessions are only scored when deadlines exist; money needs a target', () => {
    const study = l.goals.find((x) => x.id === 'study')!
    expect(goalWeek(study, facts(), '2026-11-09', TODAY).actions[1].target).toBeNull()
    expect(goalWeek(study, facts({ hasDeadlines: true }), '2026-11-09', TODAY).actions[1].target).toBe(4)
    const money = l.goals.find((x) => x.id === 'money')!
    expect(goalWeek(money, facts(), '2026-11-09', TODAY).light).toBe('none')
    const m2 = setResultTarget(l, 'money', 1300).goals.find((x) => x.id === 'money')!
    expect(goalWeek(m2, facts(), '2026-11-09', TODAY).actions[0].target).toBe(300)
  })
})

describe('timeline', () => {
  it('12 weeks: past weeks coloured, the rest future', () => {
    const g = defaultLadder().goals.find((x) => x.id === 'gain')!
    const t = timeline(g, facts(), Q, TODAY)
    expect(t).toHaveLength(12)
    expect(t.slice(0, 3).map((w) => w.light)).toEqual(['green', 'yellow', 'future'])
    expect(t[11].start).toBe('2027-01-18')
  })
})

describe('max 3 critical goals, swap from "Not now"', () => {
  it('starts with gain, strong and study on; money, career and sleep ready on "Not now"', () => {
    const l = defaultLadder()
    expect(activeGoals(l).map((g) => g.id)).toEqual(['gain', 'strong', 'study'])
    expect(notNowGoals(l).map((g) => g.id)).toEqual(['money', 'career', 'sleep'])
  })
  it('a 4th is refused; a swap trades places in one tap; park frees a spot', () => {
    const l = defaultLadder()
    expect(() => activate(l, 'sleep')).toThrow(/Up to 3/)
    const s = swap(l, 'study', 'sleep')
    expect(activeGoals(s).map((g) => g.id)).toEqual(['gain', 'strong', 'sleep'])
    expect(notNowGoals(s).map((g) => g.id)).toContain('study')
    expect(() => swap(l, 'money', 'sleep')).toThrow()
    expect(activeGoals(activate(park(l, 'gain'), 'career')).map((g) => g.id)).toEqual(['strong', 'study', 'career'])
  })
  it('a saved ladder is cleaned: never more than 3 on, every template there, junk dropped', () => {
    const c = cleanLadder({ goals: [{ id: 'gain', on: true }, { id: 'sleep', on: true }, { id: 'money', on: true }, { id: 'career', on: true }, { id: 'nope', on: true }, { id: 'gain', on: false }], reviews: ['2026-11-02', 'x'] })
    expect(activeGoals(c).map((g) => g.id)).toEqual(['gain', 'sleep', 'money'])
    expect(c.goals).toHaveLength(6)
    expect(c.reviews).toEqual(['2026-11-02'])
    expect(cleanLadder(null)).toEqual(defaultLadder())
  })
})

describe('the weekly top 3 and the reviews', () => {
  const l = defaultLadder()
  it('pre-fills one step per critical goal, from the action that did worst last week', () => {
    const f = facts({ daily: { ...facts().daily, focusHours: { '2026-11-02': 3 } } })
    expect(ladderTop3(l, f, '2026-11-09', TODAY)).toEqual(['5 workouts', '4 training sessions from your split', '10 h of focus'])
  })
  it('the Sunday review: actions per goal for the whole week, then next week\'s top 3', () => {
    const sun = '2026-11-15'
    expect(weeklyReviewDue(l, sun)).toBe(true)
    expect(weeklyReviewDue(l, TODAY)).toBe(false)
    const r = weeklyReviewData(l, facts(), sun)
    expect(r).toMatchObject({ week: '2026-11-09', next: '2026-11-16', done: false })
    expect(r.goals[0].actions).toEqual(['2/5 workouts', '4/6 protein days', '1/3 weigh-ins'])
    expect(r.goals[0].light).toBe('red')
    expect(r.goals[0].fix).toBe('Weigh in tomorrow morning, before breakfast.')
    expect(r.top3).toHaveLength(3)
    const done = markReviewed(l, r.week)
    expect(weeklyReviewDue(done, sun)).toBe(false)
    expect(weeklyReviewDue(done, '2026-11-16')).toBe(false)
  })
  it('the monthly review: due in the first week of the next month', () => {
    expect(monthToReview(quarterOf({ start: START, weeks: 12, name: 'x' }, null, '2026-12-01'))).toBe(1)
    expect(monthToReview(Q)).toBeNull()
    const m = monthlyReviewData(l, facts(), Q, 1, '2026-12-01')
    expect(m.goals[0]).toMatchObject({ id: 'gain', hit: false })
    expect(m.goals[0].next?.month).toBe(2)
  })
  it('the Today line and Ben\'s line come from the cards', () => {
    const cards = ladderCards(l, facts(), Q, TODAY)
    expect(quarterLine(cards)).toMatch(/^Quarter goal: /)
    expect(quarterLine(ladderCards(l, facts(), Q, TODAY).slice(0, 1))).toBe('Quarter goal: Gain about 4 kg lean · this week 2/5 workouts, 4/6 protein days')
    expect(quarterLine([])).toBe('')
    expect(ladderBenLine(cards, Q)).toMatch(/week 2 of 12, season "Iron Path"/)
  })
})

describe('the planner places the week steps (drafts, within limits, no duplicates)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-13T08:30:00'))
  })
  afterEach(() => vi.useRealTimers())
  const l = defaultLadder()
  const rooms = ['2026-11-13', '2026-11-14', '2026-11-15'].map((day) => ({ day, minutes: 120, weight: 2 }))
  it('study: the hours left this week as sessions of up to 90 min, one a day, due Monday', () => {
    const g = ladderStudyGoal(l, facts(), TODAY)!
    expect(g).toMatchObject({ id: LADDER_STUDY_ID, deadline: '2026-11-16', leftMin: 180 })
    const p = placeStudy(g, rooms, [], TODAY)!
    expect(p.sessions.map((s) => [s.day, s.minutes])).toEqual([['2026-11-14', 90], ['2026-11-15', 90]])
    expect(p.sessions.reduce((t, s) => t + s.minutes, 0)).toBe(180)
    expect(new Set(p.sessions.map((s) => s.id)).size).toBe(p.sessions.length)
    // the same inputs: the same ids (a re-plan never doubles a block)
    expect(placeStudy(g, rooms, [], TODAY)!.sessions.map((s) => s.id)).toEqual(p.sessions.map((s) => s.id))
  })
  it('real deadlines keep their room first; the rest stays inside each day\'s limit', () => {
    const exam: DeadlinePlan = { goalId: 7, title: 'Exam', deadline: '2026-11-20', leftMin: 240, sessions: rooms.map((r, i) => ({ id: `dl-7-${i}`, goalId: 7, title: 'Exam', day: r.day, minutes: 90, n: i + 1, of: 3, why: '' })), shortMin: 0, line: null }
    const p = placeStudy(ladderStudyGoal(l, facts(), TODAY), rooms, [exam], TODAY)!
    for (const s of p.sessions) expect(s.minutes).toBeLessThanOrEqual(30)
    expect(p.shortMin).toBe(90)
  })
  it('nothing to place when the week\'s hours are done or study is "Not now"', () => {
    const f = facts({ daily: { focusHours: days('2026-11-09', 5, 2) } })
    expect(ladderStudyGoal(l, f, TODAY)).toBeNull()
    expect(ladderStudyGoal(park(l, 'study'), facts(), TODAY)).toBeNull()
  })
  it('workouts follow the training split, skip days trained, only as many as are left', () => {
    const split = ['rest', 'upper', 'legs', 'upper', 'rest', 'legs', 'upper'] as const
    expect(placeWorkouts([...split], [], TODAY, 3)).toEqual([
      { day: '2026-11-14', type: 'legs', draft: true },
      { day: '2026-11-15', type: 'upper', draft: true }
    ])
    const all = placeWeekSteps({ ladder: l, facts: facts(), today: TODAY, rooms, existing: [], split: [...split] })
    expect(all.workouts.map((w) => w.day)).toEqual(['2026-11-14', '2026-11-15'])
    expect(all.workouts.every((w) => w.draft)).toBe(true)
    expect(all.study?.sessions.length).toBe(2)
  })
})
