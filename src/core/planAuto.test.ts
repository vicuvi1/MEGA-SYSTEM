import { describe, expect, it } from 'vitest'
import { afterRun, autoAllowed, autoReplan, isFlipFlop, AUTO_GAP_MS, type AutoMeta } from './planAuto'
import { ensureIds, replanFromNow } from './planEdit'
import type { CalEvent } from './dayTime'
import type { DayProposal, PlanBlock } from './rhythm'

// Made-up day (public repo). Every time is pinned: no test reads the clock.
const day = '2030-03-12'
const mk = (blocks: PlanBlock[], extra: Partial<DayProposal> = {}): DayProposal => ensureIds({ day, headline: '', mustdos: [], blocks, training: null, waterMl: 2500, ...extra })
const b = (title: string, start: string, minutes: number, more: Partial<PlanBlock> = {}): PlanBlock => ({ title, start, minutes, kind: 'focus', tasks: [title], ...more })
const ev = (title: string, s: string, e: string, id = title): CalEvent => ({ id, calendarId: 'c', title, start: `${day}T${s}:00`, end: `${day}T${e}:00`, allDay: false })
const at = (hm: string) => Date.parse(`${day}T${hm}:00`)
const startOf = (p: DayProposal, title: string) => p.blocks.find((x) => x.title === title)?.start
const ctx = { bedtime: '23:30', endBy: '22:00' }

describe('re-plan by itself', () => {
  it('bad case: a call that runs long sits on the next block; the block moves, with a note', () => {
    const p = mk([b('Lab report', '15:00', 45), b('Read chapter 3', '17:00', 45)])
    const before = [ev('Call with the tutor', '14:00', '14:30', 'call')]
    const now = [ev('Call with the tutor', '14:00', '15:30', 'call')]
    const r = autoReplan(p, 'proposed', { ...ctx, now: '15:05', events: now, prevEvents: before })
    expect(startOf(r.plan, 'Lab report')).toBe('15:40')
    // The block the change didn't touch stays where it was.
    expect(startOf(r.plan, 'Read chapter 3')).toBe('17:00')
    expect(r.note).toBe("Moved 'Lab report' to 15:40 because Call with the tutor ran long")
  })

  it('bad case: the clock passed a block that never started; it moves to the time left', () => {
    const p = mk([b('Lab report', '10:00', 60), b('Essay outline', '16:00', 60)])
    const r = autoReplan(p, 'proposed', { ...ctx, now: '10:30', events: [] })
    expect(startOf(r.plan, 'Lab report')).toBe('10:35')
    expect(startOf(r.plan, 'Essay outline')).toBe('16:00')
    expect(r.note).toBe("Moved 'Lab report' to 10:35 because it didn't start at 10:00")
  })

  it('a block worked on past its end pushes the next draft block', () => {
    const p = mk([b('Lab report', '10:00', 60), b('Essay outline', '11:10', 50)])
    // A focus session from 10:00 still running at 11:20.
    const r = autoReplan(p, 'proposed', { ...ctx, now: '11:20', events: [], sessions: [{ s: at('10:00'), e: at('11:20') }] })
    expect(startOf(r.plan, 'Lab report')).toBe('10:00')
    expect(startOf(r.plan, 'Essay outline')).toBe('11:30')
    expect(r.note).toMatch(/because Lab report ran long/)
  })

  it('approved, pinned and calendar blocks never move; events never move', () => {
    const p = mk([b('Lab report', '10:00', 60, { ok: true }), b('Essay outline', '10:30', 60, { locked: true }), b('Maths set', '11:00', 30, { sync: { eventId: 'e1', start: '11:00', minutes: 30, title: 'Maths set' } })])
    const r = autoReplan(p, 'proposed', { ...ctx, now: '12:00', events: [ev('Lecture', '10:00', '12:00')] })
    expect(r.plan).toBe(p)
    expect(r.note).toBeNull()
    // An approved plan: every block is approved, so nothing moves.
    const all = mk([b('Lab report', '10:00', 60)])
    expect(autoReplan(all, 'approved', { ...ctx, now: '12:00', events: [] }).plan).toBe(all)
  })

  it('bad case: re-plan from now churns blocks nobody asked to move; the automatic one does not', () => {
    const p = mk([b('Lab report', '10:00', 60), b('Essay outline', '17:00', 60)])
    // The manual "Re-plan from now" packs every draft again: the 17:00 block jumps to the afternoon start.
    const manual = replanFromNow(p, { now: '13:00', events: [], endBy: '22:00' })
    expect(startOf(manual.plan, 'Essay outline')).not.toBe('17:00')
    const auto = autoReplan(p, 'proposed', { ...ctx, now: '13:00', events: [] })
    expect(startOf(auto.plan, 'Essay outline')).toBe('17:00')
  })

  it('is idempotent: the same inputs give the same plan, and a second run changes nothing', () => {
    const p = mk([b('Lab report', '10:00', 60), b('Essay outline', '10:40', 60), b('Read chapter 3', '15:00', 30)], { mustdos: ['Essay outline'] })
    const c = { ...ctx, now: '11:00', events: [ev('Lecture', '12:00', '13:00')] }
    const one = autoReplan(p, 'proposed', c)
    expect(autoReplan(p, 'proposed', c).plan).toEqual(one.plan)
    const two = autoReplan(one.plan, 'proposed', c)
    expect(two.note).toBeNull()
    expect(two.plan).toBe(one.plan)
    // A few minutes later, still no flip-flop.
    expect(autoReplan(one.plan, 'proposed', { ...c, now: '11:04' }).note).toBeNull()
  })

  it('a block with no room left goes on the list (never silently dropped)', () => {
    const p = mk([b('Lab report', '18:00', 120)])
    const r = autoReplan(p, 'proposed', { ...ctx, now: '21:40', events: [] })
    expect(r.plan.blocks).toHaveLength(0)
    expect(r.plan.also?.map((a) => a.title)).toContain('Lab report')
    expect(r.note).toBe("No room left today for 'Lab report', it's on the list (it didn't start at 18:00)")
  })

  it('a block too long for what is left is shortened to the biggest free window (25 min or more)', () => {
    const p = mk([b('Lab report', '18:00', 120)])
    const r = autoReplan(p, 'proposed', { ...ctx, now: '21:00', events: [] })
    expect(r.plan.blocks[0]).toMatchObject({ title: 'Lab report', start: '21:05', minutes: 55 })
  })

  it('a P1 task that came in from Todoist gets a free gap; a removed one never comes back', () => {
    const p = mk([b('Essay outline', '10:00', 60)], { dropped: ['sort photos'] })
    const tasks = [
      { id: 't1', content: 'Essay outline', priority: 1 },
      { id: 't2', content: 'Fix the login bug', priority: 4 },
      { id: 't3', content: 'Sort photos', priority: 4 },
      { id: 't4', content: 'Water the plants', priority: 1 }
    ]
    const r = autoReplan(p, 'proposed', { ...ctx, now: '09:00', events: [], tasks, known: ['Essay outline'] })
    expect(r.plan.blocks.map((x) => x.title).sort()).toEqual(['Essay outline', 'Fix the login bug'])
    expect(r.note).toMatch(/^Added 'Fix the login bug' at \d\d:\d\d because it came in from Todoist$/)
    // Same inputs again (the task is now in the plan): nothing new.
    expect(autoReplan(r.plan, 'proposed', { ...ctx, now: '09:00', events: [], tasks, known: ['Essay outline'] }).note).toBeNull()
  })
})

describe('when the automatic re-plan may run', () => {
  const meta = (count: number, atMs: number): AutoMeta => ({ day, count, at: atMs })
  it('off, while editing, twice in 2 minutes, or past 5 a day: no', () => {
    const now = at('12:00')
    expect(autoAllowed({ on: false, editing: false, meta: null, day, nowMs: now }).ok).toBe(false)
    expect(autoAllowed({ on: true, editing: true, meta: null, day, nowMs: now }).why).toBe('editing')
    expect(autoAllowed({ on: true, editing: false, meta: meta(1, now - 60_000), day, nowMs: now }).why).toBe('soon')
    expect(autoAllowed({ on: true, editing: false, meta: meta(1, now - AUTO_GAP_MS), day, nowMs: now }).ok).toBe(true)
    expect(autoAllowed({ on: true, editing: false, meta: meta(5, now - 3_600_000), day, nowMs: now }).why).toBe('limit')
    // A new day starts the count again.
    expect(autoAllowed({ on: true, editing: false, meta: { ...meta(5, now - 3_600_000), day: '2030-03-11' }, day, nowMs: now }).ok).toBe(true)
  })

  it('bad case: a run that would put back what the last run moved is a flip-flop', () => {
    const a = mk([b('Lab report', '10:00', 60)])
    const bb = { ...a, blocks: [{ ...a.blocks[0], start: '10:40' }] }
    const m = afterRun(null, day, at('10:30'), a, bb)
    expect(m.count).toBe(1)
    expect(isFlipFlop(m, day, bb, a)).toBe(true)
    expect(isFlipFlop(m, day, bb, { ...a, blocks: [{ ...a.blocks[0], start: '11:00' }] })).toBe(false)
  })
})
