import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyEdit, ensureIds, planItems } from './planEdit'
import { createDebounce, linkEvents, mergeRemote, planJobs, settle, taskTimes, type JobResult } from './planSync'
import type { DayProposal } from './rhythm'
import type { CalEvent } from './dayTime'
import type { TodoTask } from './todoist'

const day = '2030-03-12'
const ids: Record<string, string> = { 'Write the essay': 't1', 'Pay the bill': 't2', 'Email Ana': 't3' }
const taskId = (t: string) => ids[t]
const base = (): DayProposal =>
  ensureIds({
    day,
    headline: 'A test day',
    mustdos: [],
    blocks: [
      { title: 'Write the essay', start: '09:00', minutes: 60, tasks: ['Write the essay'] },
      { title: 'Quick tasks', start: '10:30', minutes: 30, kind: 'quick', tasks: ['Pay the bill', 'Email Ana'] }
    ],
    training: null,
    waterMl: 2500
  })
const idOf = (p: DayProposal, title: string) => planItems(p).find((b) => b.title === title)!.id
/** Runs every job as if Google and Todoist said yes (events get ids e1, e2, …). */
let n = 0
const runAll = (p: DayProposal, status: 'proposed' | 'approved' = 'approved') => {
  const s = planJobs(p, { status, taskId })
  const results: JobResult[] = s.jobs.map((j) => ({ id: j.id, from: j.from, ok: true, snap: j.snap, event: j.google?.kind === 'create' ? { id: `e${++n}`, calendarId: 'primary' } : undefined }))
  return { s, plan: settle(p, results, s.closed) }
}
const tsk = (id: string, content: string, dueTime: string | null): TodoTask => ({ id, content, priority: 1, due: day, dueTime, project: null, recurring: false })
const event = (id: string, title: string, s: string, e: string): CalEvent => ({ id, calendarId: 'primary', title, start: new Date(`${day}T${s}:00`).toISOString(), end: new Date(`${day}T${e}:00`).toISOString(), allDay: false })

beforeEach(() => {
  n = 0
})

describe('what the plan sends', () => {
  it('a draft sends nothing; approving makes the events and gives the tasks their times', () => {
    expect(planJobs(base(), { status: 'proposed', taskId }).jobs).toEqual([])
    const { s, plan } = runAll(base())
    expect(s.jobs.map((j) => j.google?.kind)).toEqual(['create', 'create'])
    expect(s.jobs[1].todo).toEqual([
      { kind: 'time', taskId: 't2', title: 'Pay the bill', due: `${day} 10:30`, duration: 15 },
      { kind: 'time', taskId: 't3', title: 'Email Ana', due: `${day} 10:45`, duration: 15 }
    ])
    // Once settled there is nothing left to send.
    expect(planJobs(plan, { status: 'approved', taskId }).jobs).toEqual([])
    expect(plan.blocks[0].sync).toMatchObject({ eventId: 'e1', start: '09:00' })
  })

  it('many quick moves become one update with the last time', () => {
    let { plan } = runAll(base())
    const id = idOf(plan, 'Write the essay')
    for (const t of ['09:05', '09:10', '09:20', '12:00']) plan = applyEdit(plan, { op: 'move', id, start: t })
    const s = planJobs(plan, { status: 'approved', taskId })
    expect(s.jobs.length).toBe(1)
    expect(s.jobs[0].google).toEqual({ kind: 'update', eventId: 'e1', calendarId: 'primary', start: new Date(`${day}T12:00:00`).toISOString(), end: new Date(`${day}T13:00:00`).toISOString() })
    expect(s.jobs[0].todo).toEqual([{ kind: 'time', taskId: 't1', title: 'Write the essay', due: `${day} 12:00`, duration: 60 }])
  })

  it('only approved blocks sync (part of the plan)', () => {
    let p = base()
    p = applyEdit(p, { op: 'approve', ids: [idOf(p, 'Quick tasks')], on: true })
    const s = planJobs(p, { status: 'proposed', taskId })
    expect(s.jobs.map((j) => j.id)).toEqual([idOf(p, 'Quick tasks')])
  })

  it('a block that already ended is not put into the calendar', () => {
    const s = planJobs(base(), { status: 'approved', taskId, nowMin: 10 * 60 + 5 })
    expect(s.jobs.map((j) => j.google?.kind)).toEqual([undefined, 'create'])
  })

  it('rename, delete and back to draft go through', () => {
    let { plan } = runAll(base())
    const essay = idOf(plan, 'Write the essay')
    plan = applyEdit(plan, { op: 'rename', id: essay, title: 'Essay draft' })
    let s = planJobs(plan, { status: 'approved', taskId })
    expect(s.jobs[0].google).toMatchObject({ kind: 'update', title: 'Essay draft' })
    expect(s.jobs[0].todo).toEqual([{ kind: 'rename', taskId: 't1', content: 'Essay draft' }])
    plan = runAll(plan).plan
    plan = applyEdit(plan, { op: 'remove', id: idOf(plan, 'Quick tasks') })
    s = planJobs(plan, { status: 'approved', taskId })
    expect(s.jobs).toEqual([
      {
        id: expect.any(String),
        from: 'removed',
        google: { kind: 'remove', eventId: 'e2', calendarId: 'primary' },
        todo: [
          { kind: 'clear', taskId: 't2', title: 'Pay the bill', due: day },
          { kind: 'clear', taskId: 't3', title: 'Email Ana', due: day }
        ],
        snap: null
      }
    ])
    plan = runAll(plan).plan
    expect(plan.removed).toBeUndefined()
  })

  it('a task moved to another block keeps a time (never cleared on the way)', () => {
    let { plan } = runAll(base())
    plan = applyEdit(plan, { op: 'moveTask', task: 'Pay the bill', from: idOf(plan, 'Quick tasks'), to: idOf(plan, 'Write the essay') })
    const s = planJobs(plan, { status: 'approved', taskId })
    const todo = s.jobs.flatMap((j) => j.todo)
    expect(todo.some((t) => t.kind === 'clear')).toBe(false)
    expect(todo).toContainEqual({ kind: 'time', taskId: 't2', title: 'Pay the bill', due: `${day} 09:30`, duration: 30 })
  })

  it('a tick closes the task once; an untick reopens it', () => {
    let p = base()
    p = applyEdit(p, { op: 'tick', id: idOf(p, 'Quick tasks'), task: 'Email Ana', on: true })
    let r = runAll(p, 'proposed')
    expect(r.s.ticks).toEqual([{ kind: 'close', taskId: 't3', title: 'Email Ana' }])
    expect(planJobs(r.plan, { status: 'proposed', taskId }).ticks).toEqual([])
    p = applyEdit(r.plan, { op: 'tick', id: idOf(p, 'Quick tasks'), task: 'Email Ana', on: false })
    r = runAll(p, 'proposed')
    expect(r.s.ticks).toEqual([{ kind: 'reopen', taskId: 't3', title: '' }])
  })

  it('lays tasks one after another in their block', () => {
    expect(taskTimes({ start: '10:00', minutes: 50, tasks: ['Pay the bill', 'Email Ana', 'Nope'], done: [] }, taskId).map((t) => `${t.at}/${t.minutes}`)).toEqual(['10:00/25', '10:25/25'])
  })
})

describe('changes made in Google Calendar or Todoist', () => {
  it('an event moved in Google moves the block', () => {
    const { plan } = runAll(base())
    const r = mergeRemote(plan, [event('e1', 'Write the essay', '11:00', '12:30'), event('e2', 'Quick tasks', '10:30', '11:00')], null)
    expect(r.notes).toEqual(['Write the essay moved to 11:00 in Google Calendar'])
    const b = r.plan.blocks.find((x) => x.title === 'Write the essay')!
    expect(b).toMatchObject({ start: '11:00', minutes: 90 })
    // Taken in: nothing to send back to Google (only the task's new time to Todoist).
    const s = planJobs(r.plan, { status: 'approved', taskId })
    expect(s.jobs.map((j) => j.google)).toEqual([undefined])
  })

  it('your edit not sent yet is newer and wins', () => {
    let { plan } = runAll(base())
    plan = applyEdit(plan, { op: 'move', id: idOf(plan, 'Write the essay'), start: '13:00' })
    const r = mergeRemote(plan, [event('e1', 'Write the essay', '11:00', '12:00'), event('e2', 'Quick tasks', '10:30', '11:00')], null)
    expect(r.notes).toEqual([])
    expect(r.plan.blocks.find((x) => x.title === 'Write the essay')!.start).toBe('13:00')
  })

  it('deleted in Google: the block goes; a failed read deletes nothing', () => {
    const { plan } = runAll(base())
    expect(mergeRemote(plan, [event('e2', 'Quick tasks', '10:30', '11:00')], null).plan.blocks.map((b) => b.title)).toEqual(['Quick tasks'])
    expect(mergeRemote(plan, null, null).plan).toBe(plan)
  })

  it('a task closed in Todoist is ticked here; one moved in Todoist moves its block or leaves it', () => {
    const { plan } = runAll(base())
    const r = mergeRemote(plan, null, [tsk('t1', 'Write the essay', '15:00'), tsk('t3', 'Email Ana', '10:45')])
    expect(r.notes).toEqual(['Write the essay moved to 15:00 in Todoist', 'Pay the bill was done in Todoist'])
    expect(r.plan.blocks.find((b) => b.title === 'Write the essay')!.start).toBe('15:00')
    expect(r.plan.blocks.find((b) => b.title === 'Quick tasks')!.done).toEqual(['Pay the bill'])
    // The calendar follows; the closed task is not closed twice.
    const s = planJobs(r.plan, { status: 'approved', taskId })
    expect(s.ticks).toEqual([])
    expect(s.jobs.find((j) => j.google)?.google).toMatchObject({ kind: 'update', eventId: 'e1' })
  })
})

describe('batching quick edits', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })
  it('runs once 400 ms after the last poke, and again for a poke while running', async () => {
    let runs = 0
    let release: () => void = () => {}
    const d = createDebounce(400, () => {
      runs++
      return new Promise<void>((ok) => (release = ok))
    })
    d.poke()
    vi.advanceTimersByTime(300)
    d.poke()
    vi.advanceTimersByTime(300)
    expect(runs).toBe(0)
    vi.advanceTimersByTime(150)
    expect(runs).toBe(1)
    d.poke()
    vi.advanceTimersByTime(500)
    expect(runs).toBe(1) // still running: waits
    release()
    await vi.runAllTimersAsync()
    expect(runs).toBe(2)
  })
})

describe('older approved plans', () => {
  it('finds each block its calendar event by name and start, so nothing is made twice', () => {
    const p = linkEvents(base(), 'approved', [event('g1', 'Write the essay', '09:00', '10:00'), event('g2', 'Other', '10:30', '11:00')])
    expect(p.blocks[0].sync).toMatchObject({ eventId: 'g1', start: '09:00', minutes: 60 })
    expect(p.blocks[1].sync).toBeUndefined()
    const s = planJobs(p, { status: 'approved', taskId })
    expect(s.jobs.map((j) => j.google?.kind)).toEqual([undefined, 'create'])
  })
})
