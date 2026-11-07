import { describe, expect, it } from 'vitest'
import { applyEdit, editLabel, ensureIds, idsUntil, keptAsEvents, mergeKept, planGaps, planItems, replanFromNow, snap5, TRAIN_ID } from './planEdit'
import type { DayProposal } from './rhythm'
import type { CalEvent } from './dayTime'

// A made-up day.
const day = '2030-03-12'
const plan = (): DayProposal => ({
  day,
  headline: 'A test day',
  mustdos: ['Write the essay'],
  blocks: [
    { title: 'Write the essay', start: '09:00', minutes: 60, kind: 'focus', tasks: ['Write the essay'] },
    { title: 'Quick tasks (2)', start: '10:30', minutes: 30, kind: 'quick', tasks: ['Pay the bill', 'Email Ana'] },
    { title: 'Study maths', start: '14:00', minutes: 90, kind: 'focus', tasks: ['Maths set 3'] }
  ],
  training: { time: '18:00', what: 'Gym (45 min)' },
  waterMl: 2500,
  also: [{ id: 't2', title: 'Pay the bill', minutes: 15, priority: 1, at: '10:30' }]
})
const ev = (title: string, s: string, e: string): CalEvent => ({ id: title, calendarId: 'c', title, start: `${day}T${s}:00`, end: `${day}T${e}:00`, allDay: false })
const idOf = (p: DayProposal, title: string) => planItems(p).find((b) => b.title === title)!.id

describe('plan edits', () => {
  it('gives every block a stable id', () => {
    const a = ensureIds(plan())
    const b = ensureIds(plan())
    expect(a.blocks.map((x) => x.id)).toEqual(b.blocks.map((x) => x.id))
    expect(new Set(a.blocks.map((x) => x.id)).size).toBe(3)
    expect(ensureIds(a)).toBe(a)
  })

  it('moves a block, snapped to 5 minutes, and keeps the list in time order', () => {
    const p = ensureIds(plan())
    const out = applyEdit(p, { op: 'move', id: idOf(p, 'Write the essay'), start: '11:02' })
    expect(out.blocks.map((b) => b.title)).toEqual(['Quick tasks (2)', 'Write the essay', 'Study maths'])
    expect(out.blocks[1].start).toBe('11:00')
    expect(snap5(63)).toBe(65)
  })

  it('a pinned block refuses to move or stretch', () => {
    let p = ensureIds(plan())
    const id = idOf(p, 'Study maths')
    p = applyEdit(p, { op: 'lock', id, on: true })
    expect(applyEdit(p, { op: 'move', id, start: '16:00' })).toBe(p)
    expect(applyEdit(p, { op: 'resize', id, minutes: 30 })).toBe(p)
    expect(editLabel({ op: 'lock', id, on: true }, p)).toBe('Pinned Study maths')
  })

  it('resizes (15 minutes at least), renames, deletes and adds', () => {
    let p = ensureIds(plan())
    const id = idOf(p, 'Study maths')
    p = applyEdit(p, { op: 'resize', id, minutes: 7 })
    expect(p.blocks.find((b) => b.id === id)!.minutes).toBe(15)
    p = applyEdit(p, { op: 'rename', id, title: '  Algebra   set ' })
    expect(p.blocks.find((b) => b.id === id)!.title).toBe('Algebra set')
    p = applyEdit(p, { op: 'remove', id })
    expect(p.blocks.length).toBe(2)
    p = applyEdit(p, { op: 'add', start: '12:00', minutes: 45, title: 'Read' })
    expect(p.blocks.map((b) => `${b.start} ${b.title}`)).toContain('12:00 Read')
  })

  it('renaming a one-task block renames the task too', () => {
    const p = ensureIds(plan())
    const out = applyEdit(p, { op: 'rename', id: idOf(p, 'Write the essay'), title: 'Essay draft' })
    expect(out.blocks[0].tasks).toEqual(['Essay draft'])
    expect(out.mustdos).toEqual(['Essay draft'])
  })

  it('a deleted block that is in the calendar goes on the removed list', () => {
    let p = ensureIds(plan())
    const id = idOf(p, 'Study maths')
    p = { ...p, blocks: p.blocks.map((b) => (b.id === id ? { ...b, ok: true, sync: { eventId: 'e1', calendarId: 'primary', start: b.start, minutes: b.minutes, title: b.title } } : b)) }
    const out = applyEdit(p, { op: 'remove', id })
    expect(out.removed).toEqual([{ id, eventId: 'e1', calendarId: 'primary', tasks: undefined }])
  })

  it('moves a task from one block to another, and the Also list follows', () => {
    const p = ensureIds(plan())
    const out = applyEdit(p, { op: 'moveTask', task: 'Pay the bill', from: idOf(p, 'Quick tasks (2)'), to: idOf(p, 'Study maths') })
    expect(out.blocks.find((b) => b.title === 'Quick tasks (2)')!.tasks).toEqual(['Email Ana'])
    expect(out.blocks.find((b) => b.title === 'Study maths')!.tasks).toEqual(['Maths set 3', 'Pay the bill'])
    expect(out.also![0].at).toBe('14:00')
  })

  it('edits the training slot like a block', () => {
    let p = ensureIds(plan())
    p = applyEdit(p, { op: 'move', id: TRAIN_ID, start: '19:00' })
    p = applyEdit(p, { op: 'resize', id: TRAIN_ID, minutes: 60 })
    expect(p.training).toMatchObject({ time: '19:00', minutes: 60, what: 'Gym (45 min)' })
    expect(planItems(p).find((x) => x.train)!.minutes).toBe(60)
    expect(applyEdit(p, { op: 'remove', id: TRAIN_ID }).training).toBeNull()
  })

  it('approves part of the plan: until 14:00', () => {
    const p = ensureIds(plan())
    const ids = idsUntil(p, '14:00')
    expect(ids.length).toBe(2)
    const out = applyEdit(p, { op: 'approve', ids, on: true })
    expect(out.blocks.map((b) => !!b.ok)).toEqual([true, true, false])
  })

  it('ticks a task and unticks it', () => {
    const p = ensureIds(plan())
    const id = idOf(p, 'Quick tasks (2)')
    const on = applyEdit(p, { op: 'tick', id, task: 'Email Ana', on: true })
    expect(on.blocks[1].done).toEqual(['Email Ana'])
    expect(applyEdit(on, { op: 'tick', id, task: 'Email Ana', on: false }).blocks[1].done).toEqual([])
  })

  it('finds the free gaps around blocks and events', () => {
    const gaps = planGaps(ensureIds(plan()), [ev('Lecture', '11:00', '13:00')], '08:00', '20:00')
    expect(gaps.map((g) => `${g.start}+${g.minutes}`)).toEqual(['08:00+60', '10:00+30', '13:00+60', '15:30+150', '18:45+75'])
  })
})

describe('pinned blocks survive Regenerate', () => {
  it('keeps pinned and approved-in-calendar blocks, and new blocks give way', () => {
    let prev = ensureIds(plan())
    prev = applyEdit(prev, { op: 'lock', id: idOf(prev, 'Study maths'), on: true })
    expect(keptAsEvents(prev).map((e) => e.title)).toEqual(['Study maths'])
    const fresh: DayProposal = { ...plan(), blocks: [{ title: 'Something new', start: '14:30', minutes: 60 }, { title: 'Maths again', start: '16:00', minutes: 60, tasks: ['Maths set 3'] }, { title: 'Morning', start: '09:00', minutes: 60 }] }
    const out = mergeKept(fresh, prev)
    expect(out.blocks.map((b) => b.title)).toEqual(['Morning', 'Study maths'])
    expect(out.blocks[1].locked).toBe(true)
  })
})

describe('re-plan from now', () => {
  it('keeps done and pinned blocks and packs the rest into the time left', () => {
    let p = ensureIds(plan())
    p = applyEdit(p, { op: 'lock', id: idOf(p, 'Study maths'), on: true })
    const essay = { s: Date.parse(`${day}T09:00:00`), e: Date.parse(`${day}T09:50:00`) }
    const r = replanFromNow(p, { now: '10:40', events: [ev('Lecture', '11:00', '12:00')], sessions: [essay] })
    const by = Object.fromEntries(r.plan.blocks.map((b) => [b.title, b.start]))
    expect(by['Write the essay']).toBe('09:00') // done (worked on)
    expect(by['Study maths']).toBe('14:00') // pinned
    expect(by['Quick tasks (2)']).toBe('12:10') // was running late: after the lecture
    expect(r.unplaced).toEqual([])
  })

  it('a block that no longer fits leaves the plan and its tasks go on the list', () => {
    const p = ensureIds(plan())
    const r = replanFromNow(p, { now: '20:30', events: [] })
    expect(r.unplaced.length).toBeGreaterThan(0)
    expect(r.plan.also!.some((a) => a.title === 'Maths set 3')).toBe(true)
  })
})
