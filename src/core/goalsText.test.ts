import { describe, expect, it } from 'vitest'
import { draftLine, parseDeadline, parseGoalText, suggestCadence, GOAL_TEMPLATES } from './goalsText'

const today = '2026-11-06'

describe('deadlines in plain words', () => {
  it('reads the usual ways to write a date', () => {
    expect(parseDeadline('by 31 Dec', today)?.day).toBe('2026-12-31')
    expect(parseDeadline('by Dec 31', today)?.day).toBe('2026-12-31')
    expect(parseDeadline('until 2027-03-01', today)?.day).toBe('2027-03-01')
    expect(parseDeadline('by 31.12', today)?.day).toBe('2026-12-31')
    expect(parseDeadline('by 1/3/2027', today)?.day).toBe('2027-03-01')
    expect(parseDeadline('by end of month', today)?.day).toBe('2026-11-30')
    expect(parseDeadline('by the end of year', today)?.day).toBe('2026-12-31')
    expect(parseDeadline('in 3 months', today)?.day).toBe('2027-02-05')
    expect(parseDeadline('in two weeks', today)?.day).toBe('2026-11-20')
    expect(parseDeadline('by June', today)?.day).toBe('2027-06-30')
  })
  it('a day already gone this year means next year', () => {
    expect(parseDeadline('by 1 March', today)?.day).toBe('2027-03-01')
  })
  it('nothing when there is no date', () => {
    expect(parseDeadline('save 2000 lei', today)).toBeNull()
  })
})

describe('a goal from plain words', () => {
  it('profit', () => {
    const d = parseGoalText('raise profit to 5000 lei by 31 Dec', today)!
    expect(d).toMatchObject({ kind: 'measure', unit: 'lei', target: 5000, deadline: '2026-12-31', source: { kind: 'money.profit' }, area: 'Money' })
    expect(d.title).toBe('Profit 5,000 lei a month')
    expect(parseGoalText('goal: raise the profit to 5k by 31 Dec', today)).toMatchObject({ target: 5000, source: { kind: 'money.profit' } })
  })
  it('saving in euro and dollars', () => {
    expect(parseGoalText('save €2,000 in 6 months', today)).toMatchObject({ unit: 'eur', target: 2000, source: { kind: 'money.saved' }, deadline: '2027-05-08' })
    expect(parseGoalText('save 300 usd by end of month', today)).toMatchObject({ unit: 'usd', target: 300 })
  })
  it('weight: a change down from where you are', () => {
    expect(parseGoalText('lose 5 kg by March 1', today)).toMatchObject({ unit: 'kg', target: null, delta: -5, source: { kind: 'body.weight' }, deadline: '2027-03-01', curve: 'front' })
    expect(parseGoalText('weigh 72 kg by 1 Feb', today)).toMatchObject({ unit: 'kg', target: 72 })
  })
  it('hours of a subject become an hour goal (planned into focus blocks)', () => {
    expect(parseGoalText('finish 30 hours of Rust by 20 Dec', today)).toMatchObject({ kind: 'hours', unit: 'hours', target: 30, subject: 'Rust', deadline: '2026-12-20' })
  })
  it('counts of things', () => {
    expect(parseGoalText('reach 100 GitHub stars by June', today)).toMatchObject({ unit: 'custom', unitLabel: 'stars', target: 100, area: 'Career', source: { kind: 'manual' } })
    expect(parseGoalText('read 12 books by 31 Dec', today)).toMatchObject({ unit: 'custom', unitLabel: 'books', target: 12 })
    expect(parseGoalText('do 3000 pushups by end of year', today)).toMatchObject({ source: { kind: 'sport.reps', arg: 'Pushups' }, target: 3000 })
    expect(parseGoalText('40 workouts by 31 Dec', today)).toMatchObject({ source: { kind: 'body.workouts' } })
    expect(parseGoalText('run 100 km by 31 Dec', today)).toMatchObject({ unit: 'km', target: 100, title: 'Run 100 km' })
  })
  it('a missing deadline is left for the sheet to ask', () => {
    expect(parseGoalText('save 2000 lei', today)).toMatchObject({ target: 2000, deadline: null })
  })
  it('null without a number to aim at', () => {
    expect(parseGoalText('get better at Rust', today)).toBeNull()
    expect(parseGoalText('', today)).toBeNull()
  })
  it('cadence fits the time, and the confirm line reads well', () => {
    expect(suggestCadence(today, '2026-11-20')).toBe('daily')
    expect(suggestCadence(today, '2026-12-31')).toBe('weekly')
    expect(suggestCadence(today, '2027-12-31')).toBe('monthly')
    expect(draftLine(parseGoalText('raise profit to 5000 lei by 31 Dec', today)!)).toBe('Profit 5,000 lei a month · by 31 Dec 2026')
  })
  it('every template has a label and an example', () => {
    for (const t of GOAL_TEMPLATES) {
      expect(t.label.length).toBeGreaterThan(3)
      expect(t.example).toBeGreaterThan(0)
      expect(t.title(String(t.example), 'Rust').length).toBeGreaterThan(1)
    }
  })
})
