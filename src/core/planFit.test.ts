import { describe, expect, it } from 'vitest'
import { dropTaskAt, fitVerdict, movedLine, nearestSlot, placeQuick, tooMuchToday, type FitCtx } from './planFit'
import { applyEdit, ensureIds } from './planEdit'
import { moveToTomorrow, type AuditTask } from './planAudit'
import type { CalEvent } from './dayTime'
import type { DayLimits } from './planLimits'
import type { DayProposal, PlanBlock } from './rhythm'

// Made-up day and tasks (public repo). Every time is pinned: no test reads the clock.
const day = '2030-03-12'
const mk = (blocks: PlanBlock[], extra: Partial<DayProposal> = {}): DayProposal => ensureIds({ day, headline: '', mustdos: [], blocks, training: null, waterMl: 2500, ...extra })
const b = (title: string, start: string, minutes: number, more: Partial<PlanBlock> = {}): PlanBlock => ({ title, start, minutes, kind: 'focus', tasks: [title], ...more })
const ev = (title: string, s: string, e: string): CalEvent => ({ id: title, calendarId: 'c', title, start: `${day}T${s}:00`, end: `${day}T${e}:00`, allDay: false })
const task = (id: string, content: string, more: Partial<AuditTask> = {}): AuditTask => ({ id, content, priority: 1, due: day, ...more })
const ctx = (more: Partial<FitCtx> = {}): FitCtx => ({ events: [ev('Lecture', '13:00', '14:30')], endBy: '21:00', ...more })
const lim = (more: Partial<DayLimits> = {}): DayLimits => ({ maxFocusMin: null, offAt: null, protect: [], caps: [], ...more })

describe('fit hint: the verdict while you drag', () => {
  const plan = mk([b('Essay outline', '09:00', 60), b('Lab report', '11:00', 90)])
  it('fits in a free gap and says how much is free around it', () => {
    const v = fitVerdict(plan, { start: '10:00', minutes: 45, title: 'Read' }, ctx())
    expect(v).toMatchObject({ fits: true, code: 'ok', free: 60, text: 'Fits · 1h free' })
  })
  it('free time stops at the next event', () => {
    const v = fitVerdict(plan, { start: '12:30', minutes: 30, title: 'Read' }, ctx())
    expect(v).toMatchObject({ fits: true, free: 30, text: 'Fits · 30 min free' })
  })
  it('overlapping a calendar event names it', () => {
    const v = fitVerdict(plan, { start: '12:45', minutes: 45, title: 'Read' }, ctx())
    expect(v).toMatchObject({ fits: false, code: 'overlap', free: 0, text: "Doesn't fit: overlaps Lecture" })
  })
  it('overlapping another block names it, and the block itself is not its own obstacle', () => {
    const lab = plan.blocks.find((x) => x.title === 'Lab report')!
    expect(fitVerdict(plan, { start: '09:30', minutes: 60, title: 'Read' }, ctx()).text).toBe("Doesn't fit: overlaps Essay outline")
    expect(fitVerdict(plan, { id: lab.id, start: '11:15', minutes: 90, title: lab.title }, ctx()).fits).toBe(true)
  })
  it('past your off time and past bedtime', () => {
    expect(fitVerdict(plan, { start: '16:30', minutes: 60, title: 'Read' }, ctx({ limits: lim({ offAt: '17:00' }) })).text).toBe("Doesn't fit: over your 17:00 off time")
    expect(fitVerdict(plan, { start: '20:30', minutes: 60, title: 'Read' }, ctx()).text).toBe("Doesn't fit: runs past 21:00")
  })
  it('over your work limit, and over a cap', () => {
    const v = fitVerdict(plan, { start: '15:00', minutes: 60, title: 'Read' }, ctx({ limits: lim({ maxFocusMin: 180 }) }))
    expect(v).toMatchObject({ fits: false, code: 'work', text: "Doesn't fit: over your 3h limit" })
    expect(fitVerdict(plan, { start: '15:00', minutes: 30, title: 'Read' }, ctx({ limits: lim({ maxFocusMin: 180 }) })).fits).toBe(true)
    const sp = mk([b('Study maths', '09:00', 60)])
    const cap = fitVerdict(sp, { start: '15:00', minutes: 30, title: 'Study stats' }, ctx({ limits: lim({ caps: [{ kind: 'study', minutes: 60 }] }) }))
    expect(cap).toMatchObject({ fits: false, code: 'cap', text: "Doesn't fit: over your 1h study limit" })
  })
  it('a break or a meal is not work', () => {
    expect(fitVerdict(plan, { start: '15:00', minutes: 60, title: 'Lunch break' }, ctx({ limits: lim({ maxFocusMin: 60 }) })).fits).toBe(true)
  })
  it('a start in the past does not fit (when the clock is given)', () => {
    expect(fitVerdict(plan, { start: '08:00', minutes: 30, title: 'Read' }, ctx({ now: '08:30' })).text).toBe("Doesn't fit: that time has passed")
    expect(fitVerdict(plan, { start: '08:30', minutes: 30, title: 'Read' }, ctx({ now: '08:30' })).fits).toBe(true)
  })
  it('nearest slot snaps to the closest free gap, never an overlap', () => {
    const input = { start: '13:30', minutes: 45, title: 'Read' }
    const at = nearestSlot(plan, input, ctx())
    // Lecture 13:00-14:30: the closest places are 12:15 (before) or 14:30 (after); 12:15 is 75 min away, 14:30 is 60.
    expect(at).toBe('14:30')
    expect(fitVerdict(plan, { ...input, start: at! }, ctx()).fits).toBe(true)
  })
  it('no slot at all: null', () => {
    const full = mk([b('A', '00:00', 12 * 60), b('B', '12:00', 12 * 60)])
    expect(nearestSlot(full, { start: '10:00', minutes: 30, title: 'X' }, ctx({ events: [] }))).toBeNull()
  })
})

describe('quick-add placement for today', () => {
  const plan = mk([b('Essay outline', '09:00', 60)])
  it('at the time said when it fits', () => {
    expect(placeQuick(plan, { title: 'Gym', minutes: 45, time: '18:00' }, ctx({ now: '08:30' }))).toEqual({ start: '18:00', minutes: 45, moved: false })
  })
  it('the time is taken: the nearest gap, and it says why', () => {
    const r = placeQuick(plan, { title: 'Call', minutes: 30, time: '13:30' }, ctx({ now: '08:30' }))
    expect(r).toMatchObject({ start: '12:30', minutes: 30, moved: true })
    expect(r?.why).toMatch(/13:30 was taken \(overlaps Lecture\)/)
  })
  it('no time said: the first gap from now, 15 minutes at least', () => {
    expect(placeQuick(plan, { title: 'Read', minutes: 20 }, ctx({ now: '08:30' }))).toEqual({ start: '08:35', minutes: 20, moved: false })
    expect(placeQuick(plan, { title: 'Read', minutes: 5 }, ctx({ now: '08:30' }))?.minutes).toBe(15)
  })
  it('the work limit is full: no room today', () => {
    expect(placeQuick(plan, { title: 'Read', minutes: 60 }, ctx({ now: '08:30', limits: lim({ maxFocusMin: 90 }) }))).toBeNull()
  })
  it('no length said: the planner estimates one', () => {
    expect(placeQuick(plan, { title: 'Write the lab report' }, ctx({ now: '08:30' }))!.minutes).toBeGreaterThanOrEqual(25)
  })
})

describe('dropping a task row on the day column', () => {
  it('takes the task out of its block and makes a block of its own', () => {
    const p = mk([b('3 small tasks', '09:00', 45, { tasks: ['Pay bill', 'Book dentist', 'Email Sam'], kind: 'quick' })])
    const from = p.blocks[0].id!
    const out = dropTaskAt(p, { task: 'Book dentist', from, start: '15:00', minutes: 25, id: 'new1' })
    expect(out.blocks.find((x) => x.id === from)?.tasks).toEqual(['Pay bill', 'Email Sam'])
    expect(out.blocks.find((x) => x.id === 'new1')).toMatchObject({ title: 'Book dentist', start: '15:00', minutes: 25, tasks: ['Book dentist'] })
  })
  it('a block that was just that task goes away', () => {
    const p = mk([b('Read chapter 4', '09:00', 30)])
    const out = dropTaskAt(p, { task: 'Read chapter 4', from: p.blocks[0].id!, start: '15:00', minutes: 30, id: 'new1' })
    expect(out.blocks.map((x) => x.start)).toEqual(['15:00'])
  })
})

describe('too much today', () => {
  const tasks = [task('t1', 'Lab report', { priority: 4 }), task('t2', 'Essay outline', { priority: 3 }), task('t3', 'Tidy notes'), task('t4', 'Book dentist')]
  const plan = mk(
    [b('Lab report', '09:00', 120), b('Essay outline', '11:30', 60), b('Tidy notes', '15:00', 45), b('Book dentist', '16:00', 30, { kind: 'quick' })],
    { mustdos: ['Lab report'] }
  )
  const c = { now: '08:30', events: [ev('Lecture', '13:00', '14:30')], endBy: '21:00', tasks }

  it('keeps the must-do and the top tasks that fit, moves the rest, and says exactly what', () => {
    const t = tooMuchToday(plan, { ...c, limits: lim({ maxFocusMin: 195 }) })
    // Budget 195 min: Lab report (must-do, 120) + Essay outline (60) = 180; Tidy notes (45) would be 225.
    expect(t.budget).toBe(195)
    expect(t.kept).toBe(180)
    expect(t.items.map((x) => x.title)).toEqual(['Tidy notes', 'Book dentist'])
    expect(t.items[0]).toEqual({ title: 'Tidy notes', id: 't3' })
    expect(movedLine(t)).toBe('Moved 2 to tomorrow: Tidy notes (45 min), Book dentist (30 min)')
    expect(t.fits).toBe(false)
  })
  it('a smaller block still fits after a bigger one that did not', () => {
    const t = tooMuchToday(plan, { ...c, limits: lim({ maxFocusMin: 210 }) })
    // 180 kept; Tidy notes 45 -> 225 no; Book dentist 30 -> 210 yes.
    expect(t.items.map((x) => x.title)).toEqual(['Tidy notes'])
  })
  it('without a limit the budget is 75% of the free time left', () => {
    const t = tooMuchToday(plan, c)
    // 08:30-21:00 is 750 min minus the 90 min Lecture = 660; 75% = 495: everything fits.
    expect(t.budget).toBe(495)
    expect(t.fits).toBe(true)
    expect(t.items).toEqual([])
  })
  it('pinned, approved, ticked, calendar and past blocks never move; must-dos stay even over the budget', () => {
    const p = mk(
      [
        b('Lab report', '09:00', 120, { locked: true }),
        b('Essay outline', '11:30', 60, { ok: true }),
        b('Tidy notes', '15:00', 45, { done: ['Tidy notes'] }),
        b('Book dentist', '16:00', 30, { sync: { eventId: 'g1', start: '16:00', minutes: 30, title: 'Book dentist' } }),
        b('Read chapter 4', '08:00', 60),
        b('Plan the week', '17:00', 60, { tasks: ['Plan the week'] }),
        b('Update the CV', '18:00', 60)
      ],
      { mustdos: ['Update the CV'] }
    )
    const t = tooMuchToday(p, { ...c, now: '09:30', limits: lim({ maxFocusMin: 60 }) })
    expect(t.items.map((x) => x.title)).toEqual(['Plan the week'])
  })
  it('tasks listed with "no room today" go too, a must-do or an asked one does not', () => {
    const p = mk([b('Lab report', '09:00', 60)], {
      mustdos: ['Lab report', 'Call the bank'],
      also: [
        { title: 'Water the plants', minutes: 15, priority: 1, id: 't9' },
        { title: 'Reply to Sam', minutes: 15, priority: 1, asked: true }
      ]
    })
    const t = tooMuchToday(p, { ...c, tasks: [] })
    expect(t.items).toEqual([{ title: 'Water the plants', id: 't9' }])
  })
  it('the moves are the existing Move to tomorrow: whole blocks leave, others stay, nothing is deleted', () => {
    const t = tooMuchToday(plan, { ...c, limits: lim({ maxFocusMin: 195 }) })
    const after = moveToTomorrow(plan, t.items)
    expect(after.blocks.map((x) => x.title)).toEqual(['Lab report', 'Essay outline'])
    expect(after.deferred?.map((d) => d.title)).toEqual(['Tidy notes', 'Book dentist'])
    // Applying it twice changes nothing more.
    expect(tooMuchToday(after, { ...c, limits: lim({ maxFocusMin: 195 }) }).items).toEqual([])
    // Undo is the plan before.
    expect(applyEdit(plan, { op: 'replace', plan, label: 'x' }).blocks).toHaveLength(4)
  })
  it('more than four moved: the line counts the rest', () => {
    const items = ['A', 'B', 'C', 'D', 'E', 'F'].map((title) => ({ title }))
    expect(movedLine({ items, blocks: [] })).toBe('Moved 6 to tomorrow: A, B, C, D +2 more')
  })
})
