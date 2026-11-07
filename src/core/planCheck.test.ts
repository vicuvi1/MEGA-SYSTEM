import { describe, expect, it } from 'vitest'
import { checkPlan, fixPlan, issueChip } from './planCheck'
import { ensureIds } from './planEdit'
import type { DayProposal, PlanBlock } from './rhythm'
import type { CalEvent } from './dayTime'

const day = '2030-03-12'
const mk = (blocks: PlanBlock[], extra: Partial<DayProposal> = {}): DayProposal => ensureIds({ day, headline: '', mustdos: [], blocks, training: null, waterMl: 2500, ...extra })
const b = (title: string, start: string, minutes: number, more: Partial<PlanBlock> = {}): PlanBlock => ({ title, start, minutes, kind: 'focus', ...more })
const ev = (title: string, s: string, e: string): CalEvent => ({ id: title, calendarId: 'c', title, start: `${day}T${s}:00`, end: `${day}T${e}:00`, allDay: false })
const codes = (p: DayProposal, ctx = {}) => checkPlan(p, { now: '08:00', bedtime: '23:00', ...ctx }).map((i) => i.code)

describe('Ben checks his own plan', () => {
  it('a good plan has no problems', () => {
    const p = mk([b('Essay', '09:00', 90), b('Maths', '10:40', 60), b('Read', '15:00', 45)])
    expect(codes(p)).toEqual([])
    expect(issueChip([])).toBeNull()
  })

  it('finds overlaps (with each other and with fixed events) and fixes them', () => {
    const p = mk([b('Essay', '09:00', 60), b('Maths', '09:30', 30)])
    expect(codes(p)).toEqual(['overlap'])
    expect(issueChip(checkPlan(p, { now: '08:00' }))).toBe('2 blocks overlap — fix?')
    const fixed = fixPlan(p, { now: '08:00' })
    expect(fixed.fixed).toContain('overlap')
    expect(fixed.plan.blocks.map((x) => x.start)).toEqual(['09:00', '10:00'])
    const onEvent = mk([b('Essay', '11:30', 60)])
    expect(codes(onEvent, { events: [ev('Lecture', '11:00', '12:00')] })).toEqual(['overlap'])
    expect(fixPlan(onEvent, { now: '08:00', events: [ev('Lecture', '11:00', '12:00')] }).plan.blocks[0].start).toBe('12:00')
  })

  it('a pinned block never moves for a fix; the other one makes room', () => {
    const p = mk([b('Essay', '09:00', 60), b('Call', '09:30', 30, { locked: true })])
    const out = fixPlan(p, { now: '08:00' }).plan
    expect(out.blocks.find((x) => x.title === 'Call')!.start).toBe('09:30')
    expect(out.blocks.find((x) => x.title === 'Essay')!.start).toBe('10:00')
  })

  it('wants a break after 90 minutes of deep work', () => {
    const p = mk([b('Essay', '09:00', 60), b('Maths', '10:00', 60)])
    expect(codes(p)).toEqual(['breaks'])
    const out = fixPlan(p, { now: '08:00' }).plan
    expect(out.blocks[1].start).toBe('10:10')
    expect(codes(out)).toEqual([])
  })

  it('wants time for lunch', () => {
    const p = mk([b('Essay', '11:30', 90), b('Maths', '13:10', 80)])
    expect(codes(p)).toContain('meal')
  })

  it('wants a water goal (and sets 2.5 L)', () => {
    const p = mk([b('Essay', '09:00', 60)], { waterMl: 0 })
    expect(codes(p)).toEqual(['water'])
    expect(fixPlan(p, { now: '08:00' }).plan.waterMl).toBe(2500)
    expect(codes(p, { water: false })).toEqual([])
  })

  it('ends before bedtime minus the wind-down: trims, or drops to the list', () => {
    const p = mk([b('Essay', '21:30', 90, { tasks: ['Essay'] }), b('Read', '22:20', 30, { tasks: ['Read ch. 2'] })])
    expect(codes(p)).toContain('late')
    const out = fixPlan(p, { now: '08:00', bedtime: '23:00' })
    expect(out.plan.blocks.map((x) => `${x.title} ${x.start} ${x.minutes}`)).toEqual(['Essay 21:30 45'])
    expect(out.plan.also?.map((a) => a.title)).toEqual(['Read ch. 2'])
  })

  it('no block in the past: moved to from now', () => {
    const p = mk([b('Essay', '07:00', 60), b('Maths', '10:00', 60)])
    expect(codes(p, { now: '09:00' })).toEqual(['past'])
    const out = fixPlan(p, { now: '09:00' }).plan
    expect(out.blocks.map((x) => x.start)).toEqual(['09:05', '10:15'])
  })

  it('more planned than the free time is a warning', () => {
    const p = mk([b('A', '09:00', 600, { kind: 'quick' })])
    expect(codes(p, { events: [ev('Lecture', '10:00', '20:00')] })).toContain('toomuch')
  })
})

describe('a fix never throws away a block it only pushed', () => {
  it('a block that would be pushed past bedtime stays where it was', () => {
    const p = mk([b('Essay', '20:00', 60), b('Maths', '20:30', 60, { sync: { eventId: 'e1', calendarId: 'c', start: '20:30', minutes: 60, title: 'Maths' } })])
    const out = fixPlan(p, { now: '08:00', bedtime: '22:00', events: [ev('Call', '21:00', '22:00')] }).plan
    expect(out.blocks.map((x) => x.title)).toEqual(['Essay', 'Maths'])
  })

  it('flags a plan with no free time left', () => {
    // 08:00 → 22:15 (bed 23:00 minus the wind-down): blocks back to back all day.
    const packed = mk(Array.from({ length: 9 }, (_, i) => b(i % 2 ? 'Quick tasks' : 'Essay', `${String(8 + i * 1.5 >= 10 ? Math.floor(8 + i * 1.5) : `0${Math.floor(8 + i * 1.5)}`)}:${(i * 90) % 60 === 0 ? '00' : '30'}`, 85, i % 2 ? { kind: 'quick' } : {})))
    const issues = checkPlan(packed, { now: '08:00', bedtime: '23:00' })
    expect(issues.map((i) => i.code)).toContain('nofree')
    expect(issueChip(issues.filter((i) => i.code === 'nofree'))).toMatch(/free/)
    // A plan with room left is fine; a bigger share in My life asks for more room.
    const light = mk([b('Essay', '09:00', 90), b('Maths', '11:00', 60), b('Read', '15:00', 45)])
    expect(codes(light)).not.toContain('nofree')
    expect(codes(light, { freeShare: 0.5 })).not.toContain('nofree')
  })
})
