import { describe, expect, it } from 'vitest'
import { auditLine, auditPlan, blockWhy, leftTasks, moveToTomorrow, type AuditTask } from './planAudit'
import { checkPlan } from './planCheck'
import { applyEdit, ensureIds, replanFromNow } from './planEdit'
import type { CalEvent } from './dayTime'
import type { DayProposal, PlanBlock } from './rhythm'

// Made-up day and tasks (public repo). Every time is pinned: no test reads the clock.
const day = '2030-03-12'
const mk = (blocks: PlanBlock[], extra: Partial<DayProposal> = {}): DayProposal => ensureIds({ day, headline: '', mustdos: [], blocks, training: null, waterMl: 2500, ...extra })
const b = (title: string, start: string, minutes: number, more: Partial<PlanBlock> = {}): PlanBlock => ({ title, start, minutes, kind: 'focus', tasks: [title], ...more })
const ev = (title: string, s: string, e: string): CalEvent => ({ id: title, calendarId: 'c', title, start: `${day}T${s}:00`, end: `${day}T${e}:00`, allDay: false })
const task = (id: string, content: string, more: Partial<AuditTask> = {}): AuditTask => ({ id, content, priority: 1, due: day, ...more })
/** Every task title anywhere in the plan. */
const everywhere = (p: DayProposal) => [...p.mustdos, ...p.blocks.flatMap((x) => [x.title, ...(x.tasks ?? [])]), ...(p.also ?? []).map((a) => a.title), ...(p.deferred ?? []).map((d) => d.title)].map((s) => s.toLowerCase())

describe('the plan audit: every task has a place', () => {
  it('bad case: re-plan from now dropped a must-do with no reason; the audit lists it with one', () => {
    // A must-do block that no longer fits after a late start: replanFromNow takes it off the plan.
    const p = mk([b('Lab report', '09:00', 120), b('Essay outline', '10:00', 60)], { mustdos: ['Lab report'] })
    const r = replanFromNow(p, { now: '19:30', events: [], endBy: '21:00' })
    expect(r.unplaced).toContain('Lab report')
    // It is a must-do, so it is not on "Also today" either: before the audit, nothing said why it is missing.
    expect(r.plan.blocks.some((x) => x.title === 'Lab report')).toBe(false)
    expect((r.plan.also ?? []).some((a) => a.title === 'Lab report')).toBe(false)
    const a = auditPlan(r.plan, { now: '19:30', bedtime: '23:00' })
    expect(a.left).toContainEqual({ title: 'Lab report', why: 'room', text: 'no room today' })
    expect(a.line).toMatch(/^1 task didn't fit: Lab report\. Move it to tomorrow\?$|tasks didn't fit/)
  })

  it('bad case: a task Todoist has for today but the plan lost goes back on the list (never silently dropped)', () => {
    const p = mk([b('Essay outline', '10:00', 60)])
    const tasks = [task('t1', 'Essay outline'), task('t2', 'Email the lab partner', { priority: 3 })]
    const a = auditPlan(p, { now: '09:00', bedtime: '23:00', tasks })
    expect(a.fixed).toContain('missing')
    expect(a.plan.also?.find((x) => x.id === 't2')).toMatchObject({ title: 'Email the lab partner', priority: 3 })
    expect(a.line).toBe("1 task didn't fit: Email the lab partner. Move it to tomorrow?")
  })

  it('a task at a calendar event, one waiting on you, and one moved to tomorrow each state their reason', () => {
    const p = mk([b('Essay outline', '10:00', 60)], {
      also: [{ title: 'Gym', minutes: 45, priority: 1, event: '17:00' }, { title: 'Call the bank', minutes: 15, priority: 2, asked: true }],
      deferred: [{ title: 'Sort photos', why: 'The day is full: tomorrow' }],
      squeeze: { keep: 'Call the bank' }
    })
    const left = leftTasks(p)
    expect(left).toEqual([
      { title: 'Gym', why: 'event', text: 'at the 17:00 event' },
      { title: 'Call the bank', why: 'waiting', text: 'waiting on you' },
      { title: 'Sort photos', why: 'tomorrow', text: 'The day is full: tomorrow' }
    ])
    expect(auditLine(left)).toBeNull()
  })

  it('a task the user took off the plan is not put back', () => {
    const p = mk([b('Essay outline', '10:00', 60), b('Read chapter 3', '12:00', 45)])
    const removed = applyEdit(p, { op: 'remove', id: p.blocks[1].id! })
    expect(removed.dropped).toContain('read chapter 3')
    const a = auditPlan(removed, { now: '09:00', bedtime: '23:00', tasks: [task('t1', 'Essay outline'), task('t3', 'Read chapter 3')] })
    expect(a.plan.blocks.map((x) => x.title)).toEqual(['Essay outline'])
    expect(a.plan.also?.some((x) => x.id === 't3') ?? false).toBe(false)
  })

  it('no duplicates: the same task in two blocks stays in the first', () => {
    const p = mk([b('Essay outline', '10:00', 60), b('Essay outline (45 min)', '14:00', 45)])
    const a = auditPlan(p, { now: '09:00', bedtime: '23:00' })
    expect(a.plan.blocks).toHaveLength(1)
  })

  it('fixes overlaps and past blocks, and keeps a block the user just placed', () => {
    const p = mk([b('Essay outline', '10:00', 60), b('Maths set', '10:30', 60)])
    const a = auditPlan(p, { now: '09:00', bedtime: '23:00', keep: [p.blocks[1].id!] })
    expect(a.plan.blocks.find((x) => x.title === 'Maths set')!.start).toBe('10:30')
    // After it, with the 10-minute break that 2 hours of deep work need.
    expect(a.plan.blocks.find((x) => x.title === 'Essay outline')!.start).toBe('11:40')
    const past = mk([b('Essay outline', '07:00', 60)])
    expect(auditPlan(past, { now: '09:00', bedtime: '23:00' }).plan.blocks[0].start).toBe('09:05')
    // With fixPast off (the "Shift the plan?" prompt asks instead) it stays.
    expect(auditPlan(past, { now: '09:00', bedtime: '23:00', fixPast: false }).plan.blocks[0].start).toBe('07:00')
  })

  it('more work than free time: only the minimum gives way (shortened first), pinned and approved ones stay', () => {
    const p = mk([b('Essay outline', '19:00', 90, { locked: true }), b('Maths set', '20:40', 60), b('Read chapter 3', '21:50', 30, { ok: true, sync: { eventId: 'e1', start: '21:50', minutes: 30, title: 'Read chapter 3' } })])
    expect(checkPlan(p, { now: '19:00', bedtime: '22:30' }).some((i) => i.code === 'toomuch')).toBe(true)
    const a = auditPlan(p, { now: '19:00', bedtime: '22:30' })
    expect(checkPlan(a.plan, { now: '19:00', bedtime: '22:30' }).some((i) => i.code === 'toomuch')).toBe(false)
    expect(a.plan.blocks.map((x) => x.title)).toContain('Essay outline')
    expect(a.plan.blocks.map((x) => x.title)).toContain('Read chapter 3')
    // The draft is shortened by just what is too much (15 min), not taken off.
    expect(a.plan.blocks.find((x) => x.title === 'Maths set')?.minutes).toBe(45)
    expect(a.line).toBeNull()
  })

  it('when shortening is not enough the least important draft leaves (to the list); must-dos never do', () => {
    const p = mk([b('Lab report', '19:00', 60), b('Maths set', '20:10', 30), b('Read chapter 3', '20:50', 30, { kind: 'quick' })], { mustdos: ['Lab report'] })
    const a = auditPlan(p, { now: '19:00', bedtime: '21:30' })
    expect(a.plan.blocks.map((x) => x.title)).toContain('Lab report')
    expect(everywhere(a.plan)).toContain('read chapter 3')
    expect(a.left.some((l) => l.title === 'Read chapter 3' && l.why === 'room')).toBe(true)
  })

  it('bad case: a call inside a work window was counted twice as busy, so a light plan looked "too much"', () => {
    const p = mk([b('Essay outline', '10:00', 60), b('Maths set', '12:00', 45)])
    const events = [ev('Work window', '14:00', '20:00'), ev('Client call', '15:00', '16:00'), ev('Stand-up', '15:30', '16:00'), ev('Review', '16:00', '18:00'), ev('Sync', '17:00', '18:00'), ev('Prep', '18:00', '20:00')]
    expect(checkPlan(p, { now: '09:00', bedtime: '21:45', events }).some((i) => i.code === 'toomuch')).toBe(false)
    // So the audit takes nothing off the plan.
    expect(auditPlan(p, { now: '09:00', bedtime: '21:45', events }).plan.blocks).toHaveLength(2)
  })

  it('a time the plan itself gave the task in Todoist is not a deadline', () => {
    const p = mk([b('Lab report', '16:00', 60, { ok: true, sync: { eventId: 'e1', start: '16:00', minutes: 60, title: 'Lab report', tasks: [{ id: 't1', title: 'Lab report', at: '16:00', minutes: 60 }] } })])
    const tasks = [task('t1', 'Lab report', { dueTime: '16:00' })]
    expect(blockWhy(p.blocks[0], p, tasks) ?? '').not.toMatch(/due 16:00/)
    expect(auditPlan(p, { now: '09:00', bedtime: '23:00', tasks }).issues.some((i) => /is due/.test(i.text))).toBe(false)
  })

  it('a task due at a time is planned before it', () => {
    const p = mk([b('Lab report', '16:00', 60)])
    const tasks = [task('t1', 'Lab report', { dueTime: '15:00' })]
    const a = auditPlan(p, { now: '09:00', bedtime: '23:00', tasks })
    expect(a.fixed).toContain('deadline')
    expect(a.plan.blocks[0].start < '14:01').toBe(true)
  })

  it('is idempotent: auditing twice gives the same plan', () => {
    const p = mk([b('Essay outline', '07:00', 60), b('Maths set', '10:00', 60), b('Maths set', '10:30', 30)], { mustdos: ['Essay outline'] })
    const ctx = { now: '09:00', bedtime: '23:00', events: [ev('Lecture', '11:00', '12:00')], tasks: [task('t9', 'Book the dentist')] }
    const once = auditPlan(p, ctx).plan
    expect(auditPlan(once, ctx).plan).toEqual(once)
  })

  it('"Move to tomorrow" moves the tasks under tomorrow with a reason, nothing deleted', () => {
    const p = mk([b('Essay outline', '10:00', 60)], { also: [{ id: 't2', title: 'Email the lab partner', minutes: 15, priority: 1 }], mustdos: ['Lab report'] })
    const out = moveToTomorrow(p, [{ title: 'Email the lab partner', id: 't2' }, { title: 'Lab report' }])
    expect(out.also).toEqual([])
    expect(out.mustdos).toEqual([])
    expect(out.deferred).toEqual([
      { title: 'Email the lab partner', id: 't2', why: 'You moved it to tomorrow' },
      { title: 'Lab report', why: 'You moved it to tomorrow' }
    ])
    expect(leftTasks(out).every((l) => l.why === 'tomorrow')).toBe(true)
  })
})

describe('why each block is there', () => {
  it('says only what the data holds, at most two reasons', () => {
    const p = mk([b('Lab report', '10:00', 60, { locked: true }), b('Essay outline', '12:00', 60), b('Quick tasks', '15:00', 30, { kind: 'quick', tasks: ['Pay the bill', 'Book the dentist'] }), b('Read chapter 3', '16:00', 45), b('Algebra (exam)', '18:00', 60, { kind: 'goal', tasks: [] })], {
      mustdos: ['Essay outline'],
      also: [{ id: 't1', title: 'Lab report', minutes: 60, priority: 4, at: '10:00' }, { id: 't3', title: 'Read chapter 3', minutes: 45, priority: 1, project: 'University', at: '16:00' }]
    })
    const tasks = [task('t1', 'Lab report', { priority: 4, dueTime: '15:00' }), task('t2', 'Essay outline', { priority: 3, due: '2030-03-08' })]
    const why = (i: number) => blockWhy(p.blocks[i], p, tasks)
    expect(why(0)).toBe('pinned · due 15:00')
    expect(why(1)).toBe('overdue · must-do')
    expect(why(2)).toBe('2 small tasks together')
    expect(why(3)).toBe('from Todoist · University')
    expect(why(4)).toBe('goal time for today')
    expect(blockWhy(b('Walk', '19:00', 30), mk([]), [])).toBeNull()
  })

  it('a task due later in the week says the day', () => {
    const p = mk([b('Lab report', '10:00', 60)])
    expect(blockWhy(p.blocks[0], p, [task('t1', 'Lab report', { due: '2030-03-15' })])).toBe('due Friday')
  })
})
