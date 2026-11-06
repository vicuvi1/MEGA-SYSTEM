// My life (made-up values only): the work window in the day planner, the
// short-shift / no-work override, the push levels and the latest bedtime.
import { describe, expect, it } from 'vitest'
import { checkModelPlan, packDay, workClash, type PlanTask } from './dayPacker'
import { cleanLifeFit, lifeFitLine, pushStyle, readShift, setTonight, shiftReply, workToday, type LifeFit } from './lifeFit'
import { toMin } from './rhythm'
import type { CalEvent } from './dayTime'
import { govern, lateAlert, MAX_PER_HOUR, type Shown } from './healthyDay'
import type { IslandAlert } from './islandModel'

const today = '2030-03-12' // a Tuesday
const ev = (title: string, s: string, e: string): CalEvent => ({ id: title, calendarId: 'c', title, start: `${today}T${s}:00`, end: `${today}T${e}:00`, allDay: false })
// The day is full of classes until 15:00: only the evening is free.
const events = [ev('Morning lectures', '08:00', '12:00'), ev('Lab', '12:30', '15:00')]
const tasks: PlanTask[] = [
  { id: 'a', content: 'Write the essay draft', priority: 4, project: 'Course', due: today },
  { id: 'b', content: 'Study for the quiz', priority: 4, project: 'Course', due: today },
  { id: 'c', content: 'Build the side project login page', priority: 3, project: 'Side project', due: today },
  { id: 'd', content: 'Reply to the club email', priority: 1, project: 'Inbox', due: today },
  { id: 'e', content: 'Pay the phone bill', priority: 1, project: 'Inbox', due: today }
]
const fit: LifeFit = cleanLifeFit({ work: { on: true, days: [1, 2, 3, 4, 5], from: '16:00', to: '22:00', minH: 1, maxH: 3 } })
const base = { today, now: '07:30', events, tasks, top3: [], waterTarget: 2000, workoutDone: true }
const overlaps = (b: { start: string; minutes: number }, s: string, e: string) => toMin(b.start) < toMin(e) && toMin(b.start) + b.minutes > toMin(s)

describe('the work window (My life)', () => {
  it('is only on work days and only when switched on', () => {
    expect(workToday(fit, today)?.mode).toBe('normal')
    expect(workToday(fit, '2030-03-16')).toBeNull() // Saturday
    expect(workToday(cleanLifeFit({}), today)).toBeNull() // off by default
  })

  it('never books deep focus there by default; quick wins may go there', () => {
    const p = packDay({ ...base, work: workToday(fit, today) })
    const deep = p.blocks.filter((b) => b.kind !== 'quick')
    for (const b of deep) expect(overlaps(b, '16:00', '22:00'), b.title).toBe(false)
    const quick = p.blocks.find((b) => b.kind === 'quick')
    expect(quick && overlaps(quick, '16:00', '22:00')).toBe(true)
    // The window doesn't count as free time.
    expect((p.free ?? []).every((w) => toMin(w.end) <= toMin('16:00') || toMin(w.start) >= toMin('22:00'))).toBe(true)
  })

  it('without a work window the evening gets deep blocks (the rule really is the window)', () => {
    const p = packDay(base)
    expect(p.blocks.some((b) => b.kind !== 'quick' && overlaps(b, '16:00', '22:00'))).toBe(true)
  })

  it('"short shift tonight" frees the window after the usual minimum', () => {
    const short = setTonight(fit, today, 'short')
    const w = workToday(short, today)!
    expect(w.busy).toEqual({ from: '16:00', to: '17:00' })
    expect(w.light).toBeNull()
    const p = packDay({ ...base, work: w })
    for (const b of p.blocks) expect(overlaps(b, '16:00', '17:00'), b.title).toBe(false)
    expect(p.blocks.some((b) => b.kind !== 'quick' && toMin(b.start) >= toMin('17:00'))).toBe(true)
  })

  it('"no work tonight" frees the whole window, for that day only', () => {
    const off = setTonight(fit, today, 'off')
    const p = packDay({ ...base, work: workToday(off, today) })
    expect(p.blocks.some((b) => b.kind !== 'quick' && overlaps(b, '16:00', '17:00'))).toBe(true)
    expect(workToday(off, '2030-03-13')?.mode).toBe('normal')
    expect(setTonight(off, today, 'normal').tonight).toBeNull()
  })

  it("the model's plan with deep focus in the window falls back to the packer's", () => {
    const w = workToday(fit, today)
    const packed = packDay({ ...base, work: w })
    const bad = { ...packed, blocks: [{ title: 'Essay', start: '18:00', minutes: 60, kind: 'focus' as const, tasks: ['Write the essay draft'] }] }
    expect(workClash(bad.blocks, w)?.title).toBe('Essay')
    expect(checkModelPlan(bad, packed, tasks, w).blocks).toEqual(packed.blocks)
    expect(workClash([{ title: 'Quick tasks (2)', start: '18:00', minutes: 20, kind: 'quick' }], w)).toBeNull()
  })

  it('reads tonight from plain words', () => {
    expect(readShift('short shift tonight')).toBe('short')
    expect(readShift('No work tonight!')).toBe('off')
    expect(readShift("I'm not working today")).toBe('off')
    expect(readShift('normal shift after all')).toBe('normal')
    expect(readShift('azi nu lucrez')).toBe('off')
    expect(readShift('короткая смена сегодня')).toBe('short')
    expect(readShift('how did I sleep?')).toBeNull()
    expect(readShift('I only slept one hour')).toBeNull()
  })

  it('says what changed, and gives Ben one line about the windows', () => {
    expect(shiftReply(fit, today, 'short')).toBe('Short shift: 16:00–17:00 is work, the rest until 22:00 is free today.')
    expect(shiftReply(fit, today, 'off')).toContain('16:00–22:00 is free')
    const line = lifeFitLine(fit, today, { bed: '23:15', wake: '06:45' })
    expect(line).toContain('bed by 23:15 (latest 00:00), up at 06:45')
    expect(line).toContain('Mon–Fri 16:00–22:00')
    expect(line).toContain('1–3 h')
    expect(line).toContain('never deep focus there')
    expect(lifeFitLine(setTonight(fit, today, 'off'), today, { bed: '23:15', wake: '06:45' })).toContain('no work tonight')
  })

  it('cleans what it reads: bad times, hours and levels fall back', () => {
    const c = cleanLifeFit({ latestBed: '25:00', push: 'shout', work: { on: true, from: 'x', to: '24:00', minH: 4, maxH: 2, days: [9, 1, 1] }, tonight: { day: 'nope', mode: 'off' } })
    expect(c.latestBed).toBe('00:00')
    expect(c.push).toBe('push')
    expect(c.work.to).toBe('24:00')
    expect(c.work.maxH).toBe(4)
    expect(c.work.days).toEqual([1])
    expect(c.tonight).toBeNull()
  })
})

describe('how hard Ben pushes', () => {
  it('maps onto tone and the caps, never above them', () => {
    const caps = { maxMessages: 15, maxPerHour: 3 }
    const g = pushStyle('gentle', caps)
    const f = pushStyle('firm', caps)
    const p = pushStyle('push', caps)
    expect([g.tone, f.tone, p.tone]).toEqual([2, 3, 4])
    expect(g.messagesPerDay).toBeLessThan(f.messagesPerDay)
    expect(f.messagesPerDay).toBeLessThan(p.messagesPerDay)
    expect(p.messagesPerDay).toBe(15)
    expect(Math.max(g.perHour, f.perHour, p.perHour)).toBeLessThanOrEqual(3)
    expect([g.escalate, f.escalate, p.escalate]).toEqual([false, false, true])
    // Smaller caps stay the ceiling.
    expect(pushStyle('push', { maxMessages: 5, maxPerHour: 1 })).toMatchObject({ messagesPerDay: 5, perHour: 1 })
  })

  it('the island governor uses the level, but never more than its own cap', () => {
    const now = Date.parse('2030-03-12T10:00:00')
    const shown: Shown[] = [
      { at: now - 10 * 60_000, topic: 'eyes', key: 'e1', surface: 'island' },
      { at: now - 20 * 60_000, topic: 'mood', key: 'm1', surface: 'island' }
    ] as Shown[]
    const a: IslandAlert = { id: 'water:1', kind: 'water', title: 'Water', text: 'A glass?', face: '💧', actions: [] }
    const ctx = { now, call: false, focus: false, event: false, asleep: false }
    expect(govern(a, { ...ctx, perHour: 2 }, shown).show?.dot).toBe(true)
    expect(govern(a, ctx, shown).show?.dot).toBeFalsy()
    expect(govern(a, { ...ctx, perHour: 99 }, [...shown, { at: now - 5 * 60_000, topic: 'move', key: 'mv', surface: 'island' } as Shown]).why).toContain(`${MAX_PER_HOUR} interruptions`)
  })
})

describe('the latest bedtime', () => {
  const at = (hm: string, day = '2030-03-12') => Date.parse(`${day}T${hm}:00`)
  const o = { bedTarget: '23:30', latest: '00:00', idleSec: 10, bedLogged: false, dismissed: {}, day: today }
  it('the first late nudge comes at the latest bedtime, the firmer one 30 min later', () => {
    expect(lateAlert({ ...o, now: at('23:50') })).toBeNull()
    expect(lateAlert({ ...o, now: at('00:05', '2030-03-13') })?.title).toBe('Still up?')
    expect(lateAlert({ ...o, now: at('00:05', '2030-03-13') })?.text).toContain('(latest 00:00)')
    expect(lateAlert({ ...o, now: at('00:35', '2030-03-13') })?.title).toBe('An hour past bedtime')
  })
  it('without one it keeps the old +30 / +60', () => {
    expect(lateAlert({ ...o, latest: undefined, now: at('00:05', '2030-03-13') })?.title).toBe('Still up?')
    expect(lateAlert({ ...o, bedTarget: '23:00', latest: undefined, now: at('23:20') })).toBeNull()
    expect(lateAlert({ ...o, bedTarget: '23:00', latest: undefined, now: at('23:35') })?.title).toBe('Still up?')
  })
})
