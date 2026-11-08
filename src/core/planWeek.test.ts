import { describe, expect, it } from 'vitest'
import { packDay } from './dayPacker'
import { isWork, NO_LIMITS, type PlanLimits } from './planLimits'
import { sessionsOn } from './planDeadlines'
import { cleanWeek, dayRooms, dayRules, draftDays, EMPTY_WEEK, mondayOf, weekDeadlines, weekSummary, type WeekShape } from './planWeek'
import type { CalEvent } from './dayTime'

// Made-up data only. 2030-03-11 is a Monday; nothing reads the clock.
const mon = '2030-03-11'
const week = (f: (i: number) => Partial<WeekShape['days'][number]>): WeekShape => ({ days: EMPTY_WEEK.days.map((d, i) => ({ ...d, ...f(i) })), setOn: mon })
const limits = (x: Partial<PlanLimits> = {}): PlanLimits => ({ ...NO_LIMITS, ...x })
const tasks = [
  { id: 't1', content: 'Write the essay intro', priority: 4, duration: 90 },
  { id: 't2', content: 'Build the login screen', priority: 3, duration: 90 },
  { id: 't3', content: 'Refactor the parser', priority: 2, duration: 90 },
  { id: 't4', content: 'Read the lab handout', priority: 2, duration: 60 }
]

describe('the week plan', () => {
  it('cleans what was saved', () => {
    const w = cleanWeek({ days: [{ type: 'heavy', gym: true }, { type: 'odd' }, null], setOn: mon })
    expect(w.days[0]).toEqual({ type: 'heavy', gym: true })
    expect(w.days[1]).toEqual({ type: 'normal', gym: false })
    expect(w.days).toHaveLength(7)
    expect(cleanWeek(null)).toEqual(EMPTY_WEEK)
    expect(mondayOf('2030-03-17')).toBe(mon)
  })

  it('a light day caps work at 2h and gym days decide the workout slot', () => {
    const w = week((i) => (i === 2 ? { type: 'light' } : i === 0 ? { gym: true } : {}))
    expect(dayRules(w, limits(), '2030-03-13')).toMatchObject({ type: 'light', train: false })
    expect(dayRules(w, limits(), '2030-03-13').limits.maxFocusMin).toBe(120)
    expect(dayRules(w, limits(), mon)).toMatchObject({ gym: true, train: true })
    // No gym day set at all: the workout slot is planned as before.
    expect(dayRules(EMPTY_WEEK, limits(), mon).train).toBe(true)
  })

  it('the week plan feeds the day plan: a light Wednesday gets at most 2h of work', () => {
    const w = week((i) => (i === 2 ? { type: 'light' } : {}))
    const r = dayRules(w, limits(), '2030-03-13')
    const p = packDay({ today: '2030-03-13', now: '08:00', events: [], tasks, top3: [], waterTarget: 2500, workoutDone: !r.train, limits: r.limits })
    expect(p.blocks.filter(isWork).reduce((t, b) => t + b.minutes, 0)).toBeLessThanOrEqual(120)
    // A normal Tuesday with the same tasks plans more.
    const tue = dayRules(w, limits(), '2030-03-12')
    expect(packDay({ today: '2030-03-12', now: '08:00', events: [], tasks, top3: [], waterTarget: 2500, workoutDone: true, limits: tue.limits }).blocks.filter(isWork).reduce((t, b) => t + b.minutes, 0)).toBeGreaterThan(120)
  })

  it('deadline sessions go to heavy days first, and the morning plan holds today\'s session', () => {
    const w = week((i) => (i === 1 || i === 3 ? { type: 'heavy' } : i === 2 ? { type: 'light' } : {}))
    const goals = [{ id: 1, title: 'Etica exam', subject: 'Etica', deadline: '2030-03-15', leftMin: 180 }]
    const plans = weekDeadlines({ today: mon, now: '08:00', goals, events: [], week: w, limits: limits() })
    expect(plans[0].sessions.map((s) => s.day)).toEqual(['2030-03-12', '2030-03-14'])
    const tue = sessionsOn(plans, '2030-03-12')
    const p = packDay({ today: '2030-03-12', now: '08:00', events: [], tasks: [], top3: [], waterTarget: 2500, workoutDone: true, goals: tue.map((s) => ({ title: s.title, minutes: s.minutes, id: s.id, why: s.why })) })
    expect(p.blocks.map((b) => b.title)).toContain('Etica: Etica exam')
  })

  it('a day\'s room follows the events, the off time and the study cap', () => {
    const ev: CalEvent = { id: 'e', calendarId: 'c', title: 'Lecture', start: `${mon}T09:00:00`, end: `${mon}T17:00:00`, allDay: false }
    const [free] = dayRooms({ today: mon, now: '07:00', days: 1, events: [], week: EMPTY_WEEK, limits: limits() })
    const [busy] = dayRooms({ today: mon, now: '07:00', days: 1, events: [ev], week: EMPTY_WEEK, limits: limits() })
    const [capped] = dayRooms({ today: mon, now: '07:00', days: 1, events: [], week: EMPTY_WEEK, limits: limits({ caps: [{ kind: 'study', minutes: 60 }], offAt: '20:00' }) })
    expect(busy.minutes).toBeLessThan(free.minutes)
    expect(capped.minutes).toBe(60)
  })

  it('the summary shows the next 7 days: planned hours against the limits and deadline coverage', () => {
    const w = week((i) => (i === 2 ? { type: 'light' } : {}))
    const goals = [{ id: 1, title: 'Etica exam', subject: 'Etica', deadline: '2030-03-14', leftMin: 600 }]
    const plans = weekDeadlines({ today: '2030-03-12', now: '08:00', goals, events: [], week: w, limits: limits({ maxFocusMin: 240 }) })
    const s = weekSummary({ today: '2030-03-12', week: w, limits: limits({ maxFocusMin: 240 }), plans, todayMin: 200 })
    expect(s.rows.map((r) => r.name)).toEqual(['Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon'])
    expect(s.rows[0]).toMatchObject({ today: true, plannedMin: 200, capMin: 240, over: false })
    expect(s.rows[1]).toMatchObject({ type: 'light', capMin: 120 })
    expect(s.rows[1].plannedMin).toBeLessThanOrEqual(120)
    expect(s.deadlines[0].shortMin).toBeGreaterThan(0)
    expect(s.deadlines[0].line).toMatch(/^Etica exam: not enough room before Thursday 14 Mar: .+ short\.$/)
  })

  it('a week change re-plans only draft days, never the past or an approved today', () => {
    expect(draftDays(mon, 'proposed')).toEqual({ replanToday: true, from: mon })
    expect(draftDays(mon, 'approved')).toEqual({ replanToday: false, from: '2030-03-12' })
    expect(draftDays(mon, null).replanToday).toBe(true)
  })
})
