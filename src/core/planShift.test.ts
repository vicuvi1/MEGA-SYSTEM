import { describe, expect, it } from 'vitest'
import { packDay, unaccounted, type PlanTask } from './dayPacker'
import { lateBlocks, planStartAt, shiftPlan } from './planShift'
import { toMin, type DayProposal } from './rhythm'
import type { CalEvent } from './dayTime'

// A made-up day: a lecture at 12:00, lots of work.
const today = '2030-03-12'
const ev = (title: string, s: string, e: string): CalEvent => ({ id: title, calendarId: 'c', title, start: `${today}T${s}:00`, end: `${today}T${e}:00`, allDay: false })
const lecture = ev('Lecture', '12:00', '13:30')
const overlaps = (a: { start: string; minutes: number }, s: string, e: string) => toMin(a.start) < toMin(e) && toMin(a.start) + a.minutes > toMin(s)

/** A packed day: many long, urgent tasks (more than one day holds) plus older small chores. */
const busy: PlanTask[] = [
  ...Array.from({ length: 9 }, (_, i) => ({ id: `u${i}`, content: `Study unit ${i + 1} for the exam`, priority: 4, project: 'University', due: today, duration: 60 })),
  { id: 'o1', content: 'Clean the hallway', priority: 1, project: 'Home', due: '2030-03-01', duration: 30 },
  { id: 'o2', content: 'Sort old photos', priority: 1, project: 'Home', due: '2030-03-02', duration: 30 }
]

describe('a plan starts from now', () => {
  it('now rounded up to the next 5 minutes, plus a short buffer', () => {
    expect(planStartAt('10:00')).toBe('10:05')
    expect(planStartAt('10:02')).toBe('10:10')
    expect(planStartAt('23:58')).toBe('23:55')
  })

  it('asked for at 10:00: no block starts before 10:05', () => {
    const p = packDay({ today, now: '10:00', events: [lecture], tasks: busy.slice(0, 5), top3: [], waterTarget: 2500, workoutDone: false })
    expect(p.blocks.length).toBeGreaterThan(0)
    for (const b of p.blocks) expect(toMin(b.start)).toBeGreaterThanOrEqual(toMin('10:05'))
    for (const b of p.blocks) expect(overlaps(b, '12:00', '13:30')).toBe(false)
  })

  it('a morning plan opened late: past, unstarted blocks move into the time left; events and started blocks stay', () => {
    const plan: DayProposal = {
      day: today,
      headline: 'x',
      mustdos: ['Algebra set'],
      blocks: [
        { title: 'Reading', start: '07:00', minutes: 45, kind: 'focus', tasks: ['Reading'] },
        { title: 'Algebra set', start: '08:00', minutes: 60, kind: 'focus', tasks: ['Algebra set'] },
        { title: 'Lab report', start: '09:15', minutes: 50, kind: 'focus', tasks: ['Lab report'] },
        { title: 'Project', start: '14:00', minutes: 60, kind: 'focus', tasks: ['Project'] }
      ],
      training: { time: '18:00', what: 'Workout · 45 min' },
      waterMl: 2500
    }
    // He did start the 09:15 block (a focus session from 09:20).
    const sessions = [{ s: Date.parse(`${today}T09:20:00`), e: Date.parse(`${today}T09:55:00`) }]
    expect(lateBlocks(plan, '10:00', sessions).map((b) => b.title)).toEqual(['Reading', 'Algebra set'])
    const r = shiftPlan(plan, { now: '10:00', events: [lecture], sessions })
    const t = (title: string) => r.plan.blocks.find((b) => b.title === title)!
    // The must-do goes first, into the first free time from 10:05.
    expect(t('Algebra set').start).toBe('10:05')
    expect(toMin(t('Reading').start)).toBeGreaterThanOrEqual(toMin('10:05'))
    // Fixed events and blocks ahead are respected; started blocks stay.
    for (const b of r.plan.blocks) expect(overlaps(b, '12:00', '13:30')).toBe(false)
    expect(t('Lab report').start).toBe('09:15')
    expect(t('Project').start).toBe('14:00')
    expect(overlaps(t('Reading'), '14:00', '15:00')).toBe(false)
    expect(r.moves.map((m) => `${m.title} ${m.from}→${m.to}`)).toContain('Algebra set 08:00→10:05')
    expect(r.plan.training?.time).toBe('18:00')
    expect(r.unplaced).toEqual([])
  })

  it('nothing in the past: the plan is left as it is', () => {
    const plan: DayProposal = { day: today, headline: 'x', mustdos: [], blocks: [{ title: 'A', start: '11:00', minutes: 30 }], training: null, waterMl: 2000 }
    const r = shiftPlan(plan, { now: '10:00', events: [] })
    expect(r.moves).toEqual([])
    expect(r.plan).toBe(plan)
  })
})

describe('what he asked for today is never moved to tomorrow', () => {
  const asks: PlanTask[] = [
    { id: 'a1', content: 'Read 10 min', priority: 1, due: today, starred: true },
    { id: 'a2', content: 'Facial exercises system', priority: 1, due: today, asked: true }
  ]

  it('a full day (6h+ of focus): his two asks get a slot; an older, lower-priority chore makes room', () => {
    const tasks = [...busy, ...asks]
    // Last night's top 3 are the must-dos, so his asks are not must-dos themselves.
    const p = packDay({ today, now: '07:30', events: [lecture], tasks, top3: ['Study unit 1 for the exam', 'Study unit 2 for the exam', 'Study unit 3 for the exam'], waterTarget: 2500, workoutDone: true })
    expect(p.mustdos).not.toContain('Read 10 min')
    const deferred = (p.deferred ?? []).map((d) => d.title)
    expect(deferred).not.toContain('Read 10 min')
    expect(deferred).not.toContain('Facial exercises system')
    const inBlocks = p.blocks.flatMap((b) => b.tasks ?? [])
    expect(inBlocks).toContain('Read 10 min')
    expect(inBlocks).toContain('Facial exercises system')
    // Nothing is lost, and the day really was full (other work goes to tomorrow, with reasons).
    expect(unaccounted(p, tasks)).toEqual([])
    expect(deferred.length).toBeGreaterThan(0)
    expect(p.deferred!.every((d) => d.why.length > 0)).toBe(true)
    // The older chores were the ones moved (not the urgent exam units).
    expect(deferred).toEqual(expect.arrayContaining(['Clean the hallway']))
  })

  it('when even swapping cannot fit it, his ask stays on today\'s list and the plan asks', () => {
    // From 21:00 only one short window is left: must-dos take it.
    const tasks = [...busy.slice(0, 3), asks[1]]
    const p = packDay({ today, now: '21:00', events: [], tasks, top3: [], waterTarget: 2500, workoutDone: true })
    expect((p.deferred ?? []).map((d) => d.title)).not.toContain('Facial exercises system')
    const also = (p.also ?? []).find((a) => a.title === 'Facial exercises system')
    const blocked = p.blocks.some((b) => (b.tasks ?? []).includes('Facial exercises system'))
    expect(blocked || also?.asked).toBe(true)
    if (!blocked) expect(p.squeeze?.keep).toBe('Facial exercises system')
  })
})
