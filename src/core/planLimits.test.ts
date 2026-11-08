import { describe, expect, it } from 'vitest'
import { packDay } from './dayPacker'
import { auditPlan } from './planAudit'
import { autoReplan } from './planAuto'
import { checkPlan } from './planCheck'
import { ensureIds } from './planEdit'
import { cleanLimits, isWork, limitBreaks, limitsFor, limitsLine, protectedEvents, withProtected, type PlanLimits } from './planLimits'
import { toMin, type DayProposal } from './rhythm'
import type { CalEvent } from './dayTime'

// Made-up data only. Every time is given (no clock is read): 2030-03-12 is a Tuesday.
const day = '2030-03-12'
const ev = (id: string, title: string, s: string, e: string): CalEvent => ({ id, calendarId: 'c', title, start: `${day}T${s}:00`, end: `${day}T${e}:00`, allDay: false })
const end = (b: { start: string; minutes: number }) => toMin(b.start) + b.minutes
const work = (p: DayProposal) => p.blocks.filter(isWork).reduce((t, b) => t + b.minutes, 0)

const limits = (x: Partial<PlanLimits>): PlanLimits => ({ maxFocusMin: null, offAt: null, protect: [], caps: [], ...x })

const crowded = () => ({
  today: day,
  now: '08:00',
  events: [ev('e1', 'Lecture: Algorithms', '09:45', '11:15'), ev('e2', 'Lab: Programming', '13:30', '15:00')],
  tasks: [
    { id: 't1', content: 'Write the essay intro', priority: 4, duration: 90 },
    { id: 't2', content: 'Study chapter 5 for the exam', priority: 3, duration: 90 },
    { id: 't3', content: 'Build the login screen', priority: 3, duration: 90 },
    { id: 't4', content: 'Refactor the parser', priority: 2, duration: 90 },
    { id: 't5', content: 'Read the lab handout', priority: 2, duration: 60 },
    { id: 't6', content: 'Pay the phone bill', priority: 1 },
    { id: 't7', content: 'Email the tutor', priority: 1 }
  ],
  top3: [],
  waterTarget: 2500,
  workoutDone: true
})

describe('cleanLimits', () => {
  it('keeps what makes sense and drops the rest', () => {
    const l = cleanLimits({ maxFocusMin: '242', offAt: '21:00', protect: [{ title: 'Training', start: '18:00', minutes: 45, days: [1, 3, 5, 9] }, { title: '', start: '10:00', minutes: 30 }], caps: [{ kind: 'study', minutes: 240 }, { kind: 'study', minutes: 60 }, { kind: 'nope', minutes: 30 }] })
    expect(l).toEqual({ maxFocusMin: 240, offAt: '21:00', protect: [{ title: 'Training', start: '18:00', minutes: 45, days: [1, 3, 5] }], caps: [{ kind: 'study', minutes: 240 }] })
    expect(cleanLimits(null)).toEqual({ maxFocusMin: null, offAt: null, protect: [], caps: [] })
    expect(cleanLimits({ offAt: '25:00', maxFocusMin: 5 })).toMatchObject({ offAt: null, maxFocusMin: null })
  })

  it('protected blocks hold on their days only, as fixed events', () => {
    const l = limits({ protect: [{ title: 'Training', start: '18:00', minutes: 45, days: [2] }, { title: 'Lunch', start: '12:30', minutes: 40, days: [] }] })
    expect(limitsFor(l, day).protect.map((p) => p.title)).toEqual(['Training', 'Lunch'])
    expect(limitsFor(l, '2030-03-13').protect.map((p) => p.title)).toEqual(['Lunch'])
    const evs = protectedEvents(limitsFor(l, day), day)
    expect(new Date(evs[0].start).getHours()).toBe(18)
    // One already in the calendar at that time is not added twice.
    const cal = [{ ...ev('g1', 'training', '18:00', '18:45') }]
    expect(withProtected(cal, limitsFor(l, day), day).map((e) => e.title)).toEqual(['training', 'Lunch'])
  })

  it('a light day can only lower the work limit', () => {
    expect(limitsFor(limits({ maxFocusMin: 300 }), day, 120).maxFocusMin).toBe(120)
    expect(limitsFor(limits({ maxFocusMin: 90 }), day, 120).maxFocusMin).toBe(90)
    expect(limitsFor(limits({}), day, 120).maxFocusMin).toBe(120)
  })
})

describe('the packer never breaks the limits on a crowded day', () => {
  it('max work a day, off time and a study cap', () => {
    const l = limitsFor(limits({ maxFocusMin: 180, offAt: '19:00', caps: [{ kind: 'study', minutes: 60 }] }), day)
    const p = packDay({ ...crowded(), limits: l })
    expect(work(p)).toBeLessThanOrEqual(180)
    for (const b of p.blocks) expect(end(b)).toBeLessThanOrEqual(toMin('19:00'))
    expect(limitBreaks(p, l)).toEqual([])
    // Nothing is lost: every task is a must-do, in a block, on the list or moved with a reason.
    const all = [...p.mustdos, ...(p.also ?? []).map((a) => a.title), ...(p.deferred ?? []).map((d) => d.title), ...p.blocks.flatMap((b) => b.tasks ?? [])]
    for (const t of crowded().tasks) expect(all).toContain(t.content)
  })

  it('plans around protected time (training at 16:00 on Tuesdays)', () => {
    const l = limitsFor(limits({ protect: [{ title: 'Training', start: '16:00', minutes: 45, days: [2] }] }), day)
    const p = packDay({ ...crowded(), limits: l })
    for (const b of p.blocks) expect(end(b) <= toMin('16:00') || toMin(b.start) >= toMin('16:45')).toBe(true)
    expect(limitBreaks(p, l)).toEqual([])
  })

  it('without limits the plan is as before (more work than the limit above)', () => {
    expect(work(packDay(crowded()))).toBeGreaterThan(180)
  })
})

const draft = (): DayProposal =>
  ensureIds({
    day,
    headline: '',
    mustdos: ['Write the essay intro'],
    blocks: [
      { title: 'Write the essay intro', start: '08:30', minutes: 90, kind: 'focus', tasks: ['Write the essay intro'] },
      { title: 'Study chapter 5', start: '15:10', minutes: 90, kind: 'focus', tasks: ['Study chapter 5 for the exam'] },
      { title: 'Refactor the parser', start: '17:00', minutes: 90, kind: 'focus', tasks: ['Refactor the parser'] },
      { title: 'Quick tasks (2)', start: '19:00', minutes: 45, kind: 'quick', tasks: ['Pay the phone bill', 'Email the tutor'] },
      { title: 'Pinned reading', start: '20:00', minutes: 60, kind: 'focus', tasks: ['Read the lab handout'], locked: true }
    ],
    training: null,
    waterMl: 2500
  })

describe('the audit and the automatic re-plan keep the limits', () => {
  const l = limitsFor(limits({ maxFocusMin: 240, offAt: '20:00' }), day)
  const ctx = { now: '08:00', bedtime: '23:30', events: crowded().events, limits: l }

  it('the audit trims the least important drafts, never a pinned block', () => {
    const a = auditPlan(draft(), ctx)
    const loose = a.plan.blocks.filter((b) => !b.locked)
    for (const b of loose) expect(end(b)).toBeLessThanOrEqual(toMin('20:00'))
    // The pinned block is yours: it stays even though it runs past the off time.
    expect(a.plan.blocks.find((b) => b.locked)?.start).toBe('20:00')
    // Work: the must-do keeps its block, the least important gave way; the tasks are on the list.
    expect(a.plan.blocks.map((b) => b.title)).toContain('Write the essay intro')
    expect(work(a.plan)).toBeLessThanOrEqual(240)
    expect(a.fixed.some((f) => f.startsWith('limit:'))).toBe(true)
    // Idempotent.
    expect(auditPlan(a.plan, ctx).plan).toEqual(a.plan)
  })

  it('the card check names a broken limit and offers the fix', () => {
    const issues = checkPlan(draft(), ctx)
    expect(issues.find((i) => i.code === 'limit')?.text).toMatch(/of work, your limit is 4h/)
    expect(issues.find((i) => i.code === 'late')?.text).toMatch(/your off time/)
  })

  it('the automatic re-plan never moves a late block past the off time or onto protected time', () => {
    const lp = limitsFor(limits({ offAt: '20:00', protect: [{ title: 'Training', start: '17:00', minutes: 45, days: [] }] }), day)
    const p = ensureIds({ ...draft(), blocks: draft().blocks.slice(0, 2) })
    const r = autoReplan(p, 'proposed', { now: '10:30', bedtime: '23:30', events: crowded().events, limits: lp })
    for (const b of r.plan.blocks) {
      expect(end(b)).toBeLessThanOrEqual(toMin('20:00'))
      expect(end(b) <= toMin('17:00') || toMin(b.start) >= toMin('17:45')).toBe(true)
    }
  })

  it('a new P1 task gets no block when the work limit is full', () => {
    const p = ensureIds({ ...draft(), blocks: draft().blocks.slice(0, 3) })
    const lp = limitsFor(limits({ maxFocusMin: 270 }), day)
    const r = autoReplan(p, 'proposed', { now: '08:00', bedtime: '23:30', events: [], limits: lp, tasks: [{ id: 'n1', content: 'Fix the urgent bug', priority: 4 }], known: ['Write the essay intro'] })
    expect(r.plan.blocks.some((b) => b.title === 'Fix the urgent bug')).toBe(false)
  })

  it('says which limits it kept', () => {
    expect(limitsLine(['offat', 'focus'], l)).toBe('Kept your limits: off at 20:00, 4h of work')
    expect(limitsLine([], l)).toBeNull()
  })
})
