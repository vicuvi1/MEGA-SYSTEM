import { describe, expect, it } from 'vitest'
import { chatQuickAdd, dayWords, fmtLen, parseQuick, type QuickCtx } from './quickAdd'

// Made-up clock: Tuesday 12 March 2030, 10:00. No test reads the real time.
const ctx: QuickCtx = { today: '2030-03-12', now: '10:00' }
const ok = (s: string, c: QuickCtx = ctx) => {
  const r = parseQuick(s, c)
  if (!r.ok) throw new Error(`"${s}" asked: ${r.ask}`)
  return r.task
}
const ask = (s: string, c: QuickCtx = ctx) => {
  const r = parseQuick(s, c)
  if (r.ok) throw new Error(`"${s}" parsed as ${r.task.chip}`)
  return r.ask
}

describe('quick-add: the five examples', () => {
  it('"lab report tomorrow 2h"', () => {
    const t = ok('lab report tomorrow 2h')
    expect(t).toMatchObject({ title: 'Lab report', day: '2030-03-13', time: null, minutes: 120, p: null, priority: 1 })
    expect(t.chip).toBe('Lab report · tomorrow · 2h')
    expect(t.todoist).toBe('Lab report tomorrow for 120 min')
  })
  it('"gym 18:00 45 min"', () => {
    const t = ok('gym 18:00 45 min')
    expect(t).toMatchObject({ title: 'Gym', day: '2030-03-12', time: '18:00', minutes: 45 })
    expect(t.chip).toBe('Gym · today 18:00 · 45 min')
    expect(t.todoist).toBe('Gym today at 18:00 for 45 min')
  })
  it('"call mom at 7pm"', () => {
    expect(ok('call mom at 7pm')).toMatchObject({ title: 'Call mom', time: '19:00', day: '2030-03-12', minutes: null })
  })
  it('"essay friday 3h p1"', () => {
    const t = ok('essay friday 3h p1')
    expect(t).toMatchObject({ title: 'Essay', day: '2030-03-15', minutes: 180, p: 1, priority: 4 })
    expect(t.chip).toBe('Essay · Friday · 3h · P1')
    expect(t.todoist).toBe('Essay 15 Mar p1 for 180 min')
  })
  it('"read 20m"', () => {
    const t = ok('read 20m')
    expect(t).toMatchObject({ title: 'Read', day: '2030-03-12', minutes: 20, time: null })
    expect(t.chip).toBe('Read · today · 20 min')
  })
})

describe('quick-add: typos and spacing', () => {
  it.each(['tomorow', 'tommorow', 'tomorrw', 'tmrw', 'tmr', 'tomoro', 'Tomorrow'])('"%s" is tomorrow', (w) => {
    expect(ok(`buy stamps ${w}`).day).toBe('2030-03-13')
  })
  it.each([
    ['2 h', 120],
    ['2h', 120],
    ['2hrs', 120],
    ['2 hours', 120],
    ['1.5h', 90],
    ['1,5 h', 90],
    ['1h30', 90],
    ['1h 30m', 90],
    ['1h30m', 90],
    ['45min', 45],
    ['45 mins', 45],
    ['45 minutes', 45],
    ['for 30 min', 30],
    ['half an hour', 30],
    ['an hour', 60]
  ])('length "%s" is %i min', (w, m) => {
    expect(ok(`study ${w}`).minutes).toBe(m)
    expect(ok(`study ${w}`).title).toBe('Study')
  })
  it('weekday typos', () => {
    expect(ok('essay wensday').day).toBe('2030-03-13')
    expect(ok('essay thurday').day).toBe('2030-03-14')
    expect(ok('essay firday').day).toBe('2030-03-15')
    expect(ok('essay saterday').day).toBe('2030-03-16')
  })
  it('extra spaces and capitals are fine', () => {
    expect(ok('  Lab   Report   TOMORROW   2H  ').chip).toBe('Lab Report · tomorrow · 2h')
  })
})

describe('quick-add: times', () => {
  it.each([
    ['at 7pm', '19:00'],
    ['at 7 pm', '19:00'],
    ['7pm', '19:00'],
    ['at 7:30pm', '19:30'],
    ['7:30 PM', '19:30'],
    ['12am', '00:00'],
    ['12pm', '12:00'],
    ['12:15am', '00:15'],
    ['at 9am', '09:00'],
    ['9:05', '09:05'],
    ['at 18', '18:00'],
    ['@ 19:45', '19:45'],
    ['at noon', '12:00'],
    ['11 p.m.', '23:00']
  ])('"%s" is %s', (w, hm) => {
    const t = ok(`call mom ${w} tomorrow`)
    expect(t.time).toBe(hm)
    expect(t.title).toBe('Call mom')
  })
  it('a range gives the start and the length', () => {
    expect(ok('gym 18:00-18:45')).toMatchObject({ time: '18:00', minutes: 45, title: 'Gym' })
    expect(ok('seminar 14:00 - 15:30 friday')).toMatchObject({ time: '14:00', minutes: 90, day: '2030-03-15' })
  })
  it('a time with no day is today when still ahead', () => {
    expect(ok('call mom at 7pm').day).toBe('2030-03-12')
  })
  it('title numbers without a unit stay in the title', () => {
    expect(ok('read chapter 20 tomorrow')).toMatchObject({ title: 'Read chapter 20', minutes: null })
    expect(ok('email 3 people').title).toBe('Email 3 people')
  })
})

describe('quick-add: days', () => {
  it('today and tonight', () => {
    expect(ok('pay rent today').day).toBe('2030-03-12')
    expect(ok('wash up tonight').day).toBe('2030-03-12')
    expect(ok('wash up tonight').title).toBe('Wash up')
  })
  it.each([
    ['monday', '2030-03-18'],
    ['wednesday', '2030-03-13'],
    ['thursday', '2030-03-14'],
    ['friday', '2030-03-15'],
    ['sunday', '2030-03-17'],
    ['fri', '2030-03-15'],
    ['on friday', '2030-03-15'],
    ['by friday', '2030-03-15'],
    ['due friday', '2030-03-15'],
    ['on mon', '2030-03-18'],
    ['next friday', '2030-03-22'],
    ['next monday', '2030-03-18'],
    ['this friday', '2030-03-15']
  ])('"%s" is %s', (w, day) => {
    const t = ok(`essay ${w}`)
    expect(t.day).toBe(day)
    expect(t.title).toBe('Essay')
  })
  it('the same weekday as today asks (today or next week)', () => {
    expect(ask('essay tuesday')).toBe('Today is Tuesday: today or next Tuesday? Say "today" or "next tuesday".')
    expect(ok('essay next tuesday').day).toBe('2030-03-19')
    expect(ok('essay today').day).toBe('2030-03-12')
  })
  it('in N days or weeks, dates, ISO', () => {
    expect(ok('dentist in 3 days').day).toBe('2030-03-15')
    expect(ok('review in 2 weeks').day).toBe('2030-03-26')
    expect(ok('exam 20 nov').day).toBe('2030-11-20')
    expect(ok('exam nov 20').day).toBe('2030-11-20')
    expect(ok('exam on 20th of November').day).toBe('2030-11-20')
    expect(ok('exam 2030-04-02').day).toBe('2030-04-02')
    expect(ok('form 3 mar').day).toBe('2031-03-03')
    expect(ok('exam 20 nov').title).toBe('Exam')
  })
  it('a short weekday word inside a title is not a day', () => {
    expect(ok('buy sun cream tomorrow')).toMatchObject({ title: 'Buy sun cream', day: '2030-03-13' })
    expect(ok('money talk friday').title).toBe('Money talk')
    expect(ok('friend call tomorrow').title).toBe('Friend call')
    expect(ok('sunny day plan tomorrow').title).toBe('Sunny day plan')
  })
  it('day words', () => {
    expect(dayWords('2030-03-12', ctx.today)).toBe('today')
    expect(dayWords('2030-03-13', ctx.today)).toBe('tomorrow')
    expect(dayWords('2030-03-15', ctx.today)).toBe('Friday')
    expect(dayWords('2030-03-26', ctx.today)).toBe('26 Mar')
  })
})

describe('quick-add: priority', () => {
  it.each([
    ['p1', 1, 4],
    ['p2', 2, 3],
    ['p3', 3, 2],
    ['p4', 4, 1],
    ['P1', 1, 4]
  ])('%s maps to Todoist %i', (w, p, api) => {
    const t = ok(`essay ${w} tomorrow`)
    expect(t.p).toBe(p)
    expect(t.priority).toBe(api)
    expect(t.todoist).toContain(`p${p}`)
  })
  it('p5 and p-words are part of the title', () => {
    expect(ok('p5 report').title).toBe('P5 report')
    expect(ok('pitch deck tomorrow').title).toBe('Pitch deck')
  })
})

describe('quick-add: asks one short question instead of guessing', () => {
  it('a bare "at 7"', () => expect(ask('call mom at 7')).toBe('Is "at 7" morning or evening? Say 7am or 7pm.'))
  it('a time that already passed today', () => expect(ask('call mom at 7am')).toBe('07:00 has already passed today. Say "tomorrow"?'))
  it('but not when the day is said', () => expect(ok('call mom tomorrow at 7am').time).toBe('07:00'))
  it('two different days', () => expect(ask('essay friday monday')).toBe('Which day: Friday or Monday?'))
  it('two different times', () => expect(ask('call mom 17:00 19:00')).toBe('Which time: 17:00 or 19:00?'))
  it('two different lengths', () => expect(ask('read 20m 30m')).toBe('Which length: 20 min or 30 min?'))
  it('no title', () => {
    expect(ask('tomorrow 2h')).toBe("What's the task called?")
    expect(ask('')).toBe("What's the task?")
  })
  it('a time that is not a time', () => {
    expect(ask('call 25:00')).toMatch(/couldn't read 25:00/)
    expect(ask('call 13pm')).toMatch(/couldn't read 13:00 pm/)
    expect(ask('call 7:75')).toMatch(/couldn't read/)
  })
  it('next week, a past date, a silly length, a day that is not there', () => {
    expect(ask('plan next week')).toBe('Which day next week? Try "next Monday".')
    expect(ask('form 2030-01-02')).toBe('2 Jan is in the past. Which day?')
    expect(ask('study 20h')).toMatch(/very long task/)
    expect(ask('party 31 feb')).toMatch(/no 31 Feb/i)
  })
})

describe('quick-add: the clock is pinned', () => {
  it('"11pm" is ahead at 22:00 and passed at 23:30', () => {
    expect(ok('wind down at 11pm', { today: '2030-03-12', now: '22:00' }).time).toBe('23:00')
    expect(ask('wind down at 11pm', { today: '2030-03-12', now: '23:30' })).toMatch(/already passed/)
  })
  it('weekday maths follows today, not the real date', () => {
    expect(ok('essay friday', { today: '2030-03-14', now: '09:00' }).day).toBe('2030-03-15')
    expect(ask('essay friday', { today: '2030-03-15', now: '09:00' })).toMatch(/Today is Friday/)
    expect(ok('essay next friday', { today: '2030-03-15', now: '09:00' }).day).toBe('2030-03-22')
  })
})

describe('the Coach chat', () => {
  it('"task", "todo", "quick add" and "+" mean a task', () => {
    expect(chatQuickAdd('task lab report tomorrow 2h', ctx)).toMatchObject({ task: { title: 'Lab report', day: '2030-03-13', minutes: 120 } })
    expect(chatQuickAdd('+ read 20m', ctx)).toMatchObject({ task: { title: 'Read', minutes: 20 } })
    expect(chatQuickAdd('+read 20m', ctx)).toMatchObject({ task: { title: 'Read', minutes: 20 } })
    expect(chatQuickAdd('todo: call mom at 7pm', ctx)).toMatchObject({ task: { title: 'Call mom', time: '19:00' } })
    expect(chatQuickAdd('Quick add essay friday p1', ctx)).toMatchObject({ task: { title: 'Essay', p: 1 } })
  })
  it('an unclear line gets the one question', () => {
    expect(chatQuickAdd('task call mom at 7', ctx)).toEqual({ ask: 'Is "at 7" morning or evening? Say 7am or 7pm.' })
    expect(chatQuickAdd('task tomorrow 2h', ctx)).toEqual({ ask: "What's the task called?" })
  })
  it('everything else stays with Ben (events, questions, "add ...", talk)', () => {
    for (const t of ['add lab report tomorrow 2h', 'lab report tomorrow 2h', 'gym 18:00 45 min', 'read 20m', 'slept at 11pm', 'what should I do tomorrow?', 'plan my day', 'thanks', 'tasks for today', 'task', 'todo', '+']) expect(chatQuickAdd(t, ctx)).toBeNull()
  })
  it('length text', () => {
    expect(fmtLen(45)).toBe('45 min')
    expect(fmtLen(120)).toBe('2h')
    expect(fmtLen(90)).toBe('1h 30m')
  })
})
