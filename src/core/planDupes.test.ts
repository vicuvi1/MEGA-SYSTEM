import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { packDay, type PlanTask } from './dayPacker'
import { toMin, type DayProposal, type PlanBlock } from './rhythm'
import { dedupePlan, dedupeTasks, normTitle, sameThing } from './planDedupe'
import type { CalEvent } from './dayTime'

// A made-up Saturday: the same things arrive from several places (a Todoist
// task, an app copy of it, a habit's calendar event, a promise), as in the
// "duplicates everywhere" report. One thing must give one block.
const today = '2030-03-16'
const ev = (id: string, title: string, s: string, e: string, extra: Partial<CalEvent> = {}): CalEvent => ({ id, calendarId: 'c', title, start: `${today}T${s}:00`, end: `${today}T${e}:00`, allDay: false, ...extra })
const events = [ev('wake', 'Wake up', '06:00', '06:15'), ev('habit-gym', 'Gym (45 min)', '17:00', '17:45'), ev('habit-review', 'Weekly review (30 min)', '18:00', '18:30')]
const tasks: PlanTask[] = [
  { id: 'td-1', content: 'gym', priority: 4, project: 'Health', due: today },
  { id: 'app-1', content: 'Gym!', priority: 2, project: 'Health', due: today },
  { id: 'td-2', content: 'Weekly review: rethink my priorities, plan the week', priority: 3, project: 'Life', due: today },
  { id: 'td-3', content: 'Finish the algebra problem set', priority: 4, project: 'University', due: today },
  { id: 'td-4', content: 'Revise chapter 2 notes', priority: 2, project: 'University', due: today },
  { id: 'td-5', content: 'Read chapter 3 of the course book', priority: 2, project: 'University', due: today },
  { id: 'td-6', content: 'Prepare the lab slides', priority: 2, project: 'University', due: today },
  { id: 'td-7', content: 'Email the landlord', priority: 1, project: 'Inbox', due: today },
  { id: 'td-7b', content: 'email the landlord.', priority: 1, project: 'Inbox', due: today },
  { id: 'td-8', content: 'Read chapter 4 of the course book', priority: 1, project: 'University', due: today }
]
const base = { today, now: '09:00', events, tasks, top3: [], waterTarget: 2500, workoutDone: false }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
/** Every place a title shows as its own thing: blocks (and their tasks) and open "Also today" rows (a must-do's own block is its time, not a copy). */
function places(p: DayProposal, what: string): string[] {
  const w = norm(what)
  const out: string[] = []
  for (const b of p.blocks) {
    if (norm(b.title) === w || (b.tasks ?? []).some((t) => norm(t) === w)) out.push(`block ${b.start}`)
  }
  for (const a of p.also ?? []) if (!a.at && norm(a.title) === w) out.push('also')
  return out
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${today}T09:00:00`))
})
afterEach(() => vi.useRealTimers())

describe('one thing = one block (the duplicates report)', () => {
  it('a task with the same name as a calendar event gets no block of its own', () => {
    const p = packDay(base)
    // "gym" (Todoist) and "Gym!" (app copy) are the habit's 17:00 event: no block for them.
    expect(p.blocks.filter((b) => /gym/i.test(b.title) || (b.tasks ?? []).some((t) => /gym/i.test(t)))).toEqual([])
    // "Weekly review: …" is the 18:00 weekly review: no second block at night.
    expect(p.blocks.filter((b) => /weekly review/i.test(b.title) || (b.tasks ?? []).some((t) => /weekly review/i.test(t)))).toEqual([])
    // Still on the list (never lost), pointing at the event.
    const review = (p.also ?? []).find((a) => /weekly review/i.test(a.title))
    expect(review?.event).toBe('18:00')
  })

  it('the same task twice (two ids, same words) shows once', () => {
    const p = packDay(base)
    expect(places(p, 'Email the landlord')).toHaveLength(1)
    // "gym" and its app copy "Gym!" are one row (at the 17:00 event).
    expect(places(p, 'gym')).toEqual(['also'])
    expect((p.also ?? []).filter((a) => /gym/i.test(a.title)).map((a) => a.event)).toEqual(['17:00'])
  })

  it('a task in a group block is not also its own row in "Also today"', () => {
    const p = packDay(base)
    for (const t of tasks) expect(places(p, t.content).length).toBeLessThanOrEqual(1)
    // The group block's name doesn't repeat every task (they are its checkboxes).
    for (const b of p.blocks) if ((b.tasks ?? []).length > 2) expect(b.title.split(',').length).toBeLessThan(3)
  })

  it('different things that only look alike stay apart', () => {
    const p = packDay(base)
    // Chapter 3 and chapter 4 are two tasks, not one.
    expect(places(p, 'Read chapter 3 of the course book')).toHaveLength(1)
    expect(places(p, 'Read chapter 4 of the course book').length + (p.deferred ?? []).filter((d) => /chapter 4/.test(d.title)).length).toBe(1)
  })

  it('no block in the past on a from-now plan', () => {
    const p = packDay(base)
    expect(p.blocks.every((b) => toMin(b.start) >= toMin('09:00'))).toBe(true)
  })
})

describe('when two titles are the same thing', () => {
  it('ignores case, punctuation, an emoji in front and a length', () => {
    expect(normTitle('💪 Gym (45 min)')).toBe('gym')
    expect(sameThing('gym', 'Gym!')).toBe(true)
    expect(sameThing('Sport', 'Sport · 20 min')).toBe(true)
    expect(sameThing('Stretch 1h', 'stretch')).toBe(true)
  })
  it('the words before ":" count when they are 2+ words', () => {
    expect(sameThing('Weekly review: rethink my priorities, plan the week', 'Weekly review (30 min)')).toBe(true)
    // "University: …" is a task of a course, not the class called "University".
    expect(sameThing('University: read chapter 3', 'University')).toBe(false)
    // Two tasks under one heading are two tasks.
    expect(sameThing('Weekly review: plan the week', 'Weekly review: tidy the inbox')).toBe(false)
  })
  it('keeps numbers that are not a length', () => {
    expect(sameThing('Read chapter 3', 'Read chapter 4')).toBe(false)
    expect(sameThing('Lab 2 report', 'Lab 3 report')).toBe(false)
  })
  it('one task per id, then per title, the first (most important) copy stays with its flags', () => {
    const out = dedupeTasks([
      { id: 'a', content: 'Email Ana' },
      { id: 'a', content: 'Email Ana (copy in today and @today)' },
      { id: 'b', content: 'email ana.', asked: true },
      { id: 'c', content: 'Email Ben' }
    ])
    expect(out.map((t) => t.id)).toEqual(['a', 'c'])
    expect(out[0].asked).toBe(true)
  })
})

describe('the plan cleaned at the end (any planner)', () => {
  const block = (title: string, start: string, extra: Partial<PlanBlock> = {}): PlanBlock => ({ title, start, minutes: 30, kind: 'focus', ...extra })
  const plan = (blocks: PlanBlock[], also: DayProposal['also'] = [], extra: Partial<DayProposal> = {}): DayProposal => ({ day: today, headline: 'x', mustdos: [], blocks, training: null, waterMl: 2000, also, ...extra })

  it("drops the model's copies: a task in two blocks, a block named like an event, a block twice", () => {
    const p = dedupePlan(
      plan([
        block('University: problem set, notes', '10:00', { tasks: ['Finish the problem set', 'Revise notes'] }),
        block('Finish the problem set', '13:00', { tasks: ['Finish the problem set'] }),
        block('gym', '15:00'),
        block('Deep work', '19:00'),
        block('deep work', '20:00')
      ]),
      { events, after: '09:05' }
    )
    expect(p.blocks.map((b) => b.start)).toEqual(['10:00', '19:00'])
  })

  it('a pinned or approved block wins over the loose copy, and over the event', () => {
    const p = dedupePlan(plan([block('Gym', '12:00', { locked: true }), block('gym', '15:00', { tasks: ['gym'] })]), { events, after: '09:05' })
    expect(p.blocks).toHaveLength(1)
    expect(p.blocks[0].locked).toBe(true)
  })

  it('"Also today": once per id or title, never a must-do, tied to its block or its event', () => {
    const p = dedupePlan(
      plan(
        [block('Inbox: email the landlord +1 more', '11:00', { tasks: ['Email the landlord', 'Pay rent'] })],
        [
          { id: 'x', title: 'Email the landlord', minutes: 15, priority: 1 },
          { id: 'y', title: 'email the landlord.', minutes: 15, priority: 1 },
          { id: 'z', title: 'Weekly review: plan the week', minutes: 30, priority: 3 },
          { title: 'Call the bank', minutes: 15, priority: 1 }
        ],
        { mustdos: ['call the bank'] }
      ),
      { events, after: '09:05' }
    )
    expect(p.also).toEqual([
      { id: 'x', title: 'Email the landlord', minutes: 15, priority: 1, at: '11:00' },
      { id: 'z', title: 'Weekly review: plan the week', minutes: 30, priority: 3, event: '18:00' }
    ])
  })

  it('a workout already in the calendar: no second training slot (a pinned one stays)', () => {
    expect(dedupePlan(plan([], [], { training: { time: '19:00', what: 'Workout · 45 min' } }), { events, after: '09:05' }).training).toBeNull()
    expect(dedupePlan(plan([], [], { training: { time: '19:00', what: 'Workout · 45 min', locked: true } }), { events, after: '09:05' }).training).not.toBeNull()
  })

  it('an event already over, a declined one or one the app made does not swallow a task', () => {
    const ev2 = [ev('gone', 'Gym', '07:00', '08:00'), ev('no', 'Weekly review', '18:00', '18:30', { declined: true }), ev('ours', 'Email the landlord', '12:00', '12:15', { ours: true })]
    const p = packDay({ ...base, events: ev2 })
    expect(p.blocks.some((b) => (b.tasks ?? []).some((t) => /gym/i.test(t)) || /gym/i.test(b.title))).toBe(true)
    expect(p.blocks.some((b) => (b.tasks ?? []).some((t) => /weekly review/i.test(t)) || /weekly review/i.test(b.title))).toBe(true)
  })

  it('is idempotent: cleaning or planning twice gives the same plan', () => {
    const once = packDay(base)
    expect(dedupePlan(once, { events, after: '09:05' })).toEqual(once)
    expect(packDay(base)).toEqual(once)
  })

  it('a re-plan does not bring back a block whose task now sits in the calendar (task time synced as an event)', () => {
    // The approved "Finish the algebra problem set" block put the task at 10:10; Todoist's own calendar
    // shows it as an event. The next plan must not give the task a second block.
    const synced = [...events, ev('todoist-td-3', 'Finish the algebra problem set', '10:10', '11:10')]
    const p = packDay({ ...base, events: synced })
    expect(places(p, 'Finish the algebra problem set')).toEqual(['also'])
    expect(p.mustdos.some((m) => /algebra/i.test(m))).toBe(false)
  })
})
