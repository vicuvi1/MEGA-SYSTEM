import { describe, expect, it } from 'vitest'
import { goalCard, type CheckIn, type MeasureGoal } from './goals'
import { answerValue, askText, behindMove, cleanAsks, emptyAsks, findGoal, goalsNowText, GOAL_ASKS_PER_DAY, markPing, pickPing, quickAnswers, quickStep, reportText, seedSeen, weeklyGoalLines } from './goalsBen'

const today = '2026-11-20'
const profit: MeasureGoal = { id: 1, title: 'Profit 5,000 lei a month', unit: 'lei', start: 1000, target: 5000, startDay: '2026-10-01', deadline: '2026-12-31', why: 'Rent without stress', area: 'Money', cadence: 'weekly', source: { kind: 'manual' }, milestones: [], curve: 'line', doneDay: null }
const pushups: MeasureGoal = { ...profit, id: 2, title: '3000 pushups', unit: 'count', start: 0, target: 3000, source: { kind: 'sport.reps', arg: 'Pushups' }, area: 'Body' }
const ci = (goalId: number, day: string, value: number, by: CheckIn['by'] = 'me'): CheckIn => ({ id: `${goalId}${day}`, goalId, at: `${day}T09:00:00.000Z`, day, value, by })

const cardP = (list: CheckIn[] = [ci(1, '2026-11-10', 3200)]) => goalCard(profit, list, today)
const cardR = (value = 1200) => goalCard(pushups, [ci(2, '2026-11-19', value, 'auto')], today)

describe('when Ben asks', () => {
  it('asks a due manual goal once per period, in the day hours, under the cap', () => {
    const st = emptyAsks(today)
    const p = pickPing([cardP()], st, 11)
    expect(p?.kind).toBe('ask')
    expect(pickPing([cardP()], st, 8)).toBeNull()
    expect(pickPing([cardP()], st, 22)).toBeNull()
    const after = markPing(st, p!)
    expect(pickPing([cardP()], after, 15)).toBeNull()
    expect(pickPing([cardP()], { ...st, n: GOAL_ASKS_PER_DAY }, 11)).toBeNull()
  })
  it('never asks when you already checked in this week', () => {
    expect(pickPing([cardP([ci(1, '2026-11-17', 3300)])], emptyAsks(today), 11)).toBeNull()
  })
  it('goals that count themselves only report a change, never ask', () => {
    let st = seedSeen(emptyAsks(today), [cardR(1200)])
    expect(st.seen['2']).toBe(1200)
    expect(pickPing([cardR(1200)], st, 11)).toBeNull()
    const p = pickPing([cardR(1350)], st, 11)
    expect(p).toMatchObject({ kind: 'report', before: 1200 })
    st = markPing(st, p!)
    expect(pickPing([cardR(1400)], st, 12)).toBeNull()
  })
  it('a new day resets the count, keeps what was asked', () => {
    const st = cleanAsks({ day: '2026-11-19', n: 2, asked: { 1: 'w2026-11-16' }, seen: { 2: 100 } }, today)
    expect(st).toMatchObject({ day: today, n: 0, asked: { 1: 'w2026-11-16' }, seen: { 2: 100 } })
  })
})

describe('what Ben says', () => {
  it('the check-in question has the numbers', () => {
    const t = askText(cardP())
    expect(t).toContain("3,200 of 5,000 lei")
    expect(t).toContain('41 days left')
    expect(t).toMatch(/need \+\d+ lei a week/)
    expect(t).toContain("What's the number now?")
  })
  it('quick answers: minus, same, plus, skip, and what they mean', () => {
    const c = cardP()
    const q = quickAnswers(c)
    expect(q.map((x) => x.op)).toEqual([`-${quickStep(c)}`, 's', `+${quickStep(c)}`, 'k'])
    expect(answerValue(c, 's')).toBe(3200)
    expect(answerValue(c, '+50')).toBe(3250)
    expect(answerValue(c, '-200')).toBe(3000)
    expect(answerValue(c, '=4100')).toBe(4100)
    expect(answerValue(c, 'k')).toBeNull()
    expect(answerValue(c, 'nonsense')).toBeNull()
  })
  it('the report for an auto goal', () => {
    expect(reportText(cardR(1350), 1200)).toMatch(/^📈 3000 pushups: 1,350 of 3,000 \(\+150 since last time\)\./)
  })
  it('one concrete move when behind', () => {
    const behind = goalCard(profit, [ci(1, '2026-11-10', 1500)], today)
    expect(behind.status === 'behind' || behind.status === 'at risk').toBe(true)
    expect(behindMove(behind)?.do).toMatch(/^focus:25:/)
    expect(behindMove(cardP([ci(1, '2026-11-10', 4000)]))).toBeNull()
    const hours = goalCard({ ...profit, id: 5, unit: 'hours', start: 0, target: 30, source: { kind: 'focus.hours', arg: 'Rust' } }, [], today)
    expect(behindMove(hours)?.do).toBe('focus:50:Rust')
  })
  it('the Sunday lines and the prompt section stay short', () => {
    const lines = weeklyGoalLines([cardP([ci(1, '2026-11-10', 3000), ci(1, '2026-11-18', 3200)])], today)
    expect(lines[0]).toContain('+200 lei this week')
    const p = goalsNowText([cardP(), cardR()])
    expect(p.split('\n').length).toBeLessThanOrEqual(5)
    expect(p).toContain('G1')
    expect(p).toContain('goalcheck: G1 | 3400')
    expect(goalsNowText([])).toContain('none yet')
  })
  it('finds a goal by ref or title', () => {
    const cards = [cardP(), cardR()]
    expect(findGoal(cards, 'G2')?.goal.id).toBe(2)
    expect(findGoal(cards, 'pushups')?.goal.id).toBe(2)
    expect(findGoal(cards, 'G9')).toBeNull()
  })
})
