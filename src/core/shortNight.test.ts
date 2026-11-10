import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bedTonight, lighterAnswer, nightReply, readSleepSay, reasonLine, shortNightPlan, NAP_TITLE, SHORT_NIGHT_MIN } from './shortNight'
import { planSummary } from './benPlanText'
import { planTimeline } from './planView'
import type { CalEvent } from './dayTime'
import type { DayProposal, PlanBlock } from './rhythm'

const DAY = '2026-11-10'
const at = (h: number, m = 0) => new Date(2026, 10, 10, h, m)
const ev = (title: string, s: string, e: string): CalEvent => ({ id: title, calendarId: 'cal', title, start: new Date(`${DAY}T${s}:00`).toISOString(), end: new Date(`${DAY}T${e}:00`).toISOString(), allDay: false })
const b = (start: string, minutes: number, title: string, kind: PlanBlock['kind'], tasks: string[] = [], extra: Partial<PlanBlock> = {}): PlanBlock => ({ id: `b${start}`, start, minutes, title, kind, tasks, ...extra })

/** The owner's morning: 8 made-up blocks, 5h45 of focus, 07:35–17:45, training at 18:00. */
const heavy = (): DayProposal => ({
  day: DAY,
  headline: '3 must-dos · 8 blocks · 5h45 focus',
  mustdos: ['Lab report', 'Ethics essay', 'Call the bank'],
  blocks: [
    b('07:35', 25, 'Quick tasks', 'quick', ['Made-up email', 'Made-up form']),
    b('08:10', 45, 'Lab report draft', 'focus', ['Lab report']),
    b('10:10', 60, 'Ethics essay', 'focus', ['Ethics essay']),
    b('11:20', 50, 'Study algebra', 'goal'),
    b('12:20', 30, 'Emails', 'quick', ['Made-up reply']),
    b('15:10', 60, 'Side project', 'focus', ['Made-up project task']),
    b('16:20', 45, 'Reading notes', 'focus', ['Made-up reading']),
    b('17:15', 30, 'Admin', 'quick', ['Made-up admin'])
  ],
  training: { time: '18:00', what: 'Upper body 30 min', minutes: 30 },
  waterMl: 2500
})
const base = { now: '07:41', wake: '07:30', events: [] as CalEvent[], endBy: '22:45' }

describe('reading a sleep report', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(at(7, 41))
  })
  afterEach(() => vi.useRealTimers())

  it("reads the owner's message: times, hours and the reason", () => {
    const s = readSleepSay('I went to sleep at 2 am and got up at 7:30 am, spent too much time with gf eh', new Date())
    expect(s).toMatchObject({ bed: '02:00', wake: '07:30', sleptMin: 330, kind: 'partner', who: 'girlfriend' })
    expect(s!.reason).toMatch(/spent too much time with gf/)
  })

  it('reads other ways of saying it, a bedtime before midnight included', () => {
    expect(readSleepSay('slept from 1:30 to 7', new Date())).toMatchObject({ bed: '01:30', wake: '07:00', sleptMin: 330, reason: null })
    expect(readSleepSay('went to bed at 11 and woke up at 6:45', new Date())).toMatchObject({ bed: '23:00', wake: '06:45', sleptMin: 465 })
    expect(readSleepSay('fell asleep around 12:40, woke up at 7 because of gaming till late', new Date())).toMatchObject({ bed: '00:40', sleptMin: 380, kind: 'screen' })
    expect(readSleepSay('m-am culcat la 2 si m-am trezit la 7:30', new Date())).toMatchObject({ bed: '02:00', wake: '07:30' })
  })

  it('leaves questions, a wake-up still ahead and one time alone to Ben', () => {
    expect(readSleepSay('why am I tired if I slept from 2 to 7:30?', new Date())).toBeNull()
    expect(readSleepSay('going to bed at 2 and getting up at 9', new Date())).toBeNull()
    expect(readSleepSay('went to bed at 2', new Date())).toBeNull()
    expect(readSleepSay('went to bed at 2 and woke up at 9', new Date())).toBeNull()
  })
})

describe('the plan after a short night', () => {
  it('starts after now, cuts focus to about 60%, keeps the must-dos, adds a nap and lightens training', () => {
    const r = shortNightPlan(heavy(), { ...base, sleptMin: 330 })!
    expect(r).toBeTruthy()
    const p = r.plan
    expect(p.blocks.every((x) => x.start >= '07:45')).toBe(true)
    expect(r.focusBefore).toBe(345)
    expect(r.focusAfter).toBe(planSummary(p).focusMin)
    expect(r.focusAfter).toBeLessThanOrEqual(210)
    expect(p.blocks.every((x) => x.minutes <= 60)).toBe(true)
    for (const m of ['Lab report', 'Ethics essay']) expect(p.blocks.some((x) => x.tasks?.includes(m))).toBe(true)
    expect(p.mustdos).toEqual(heavy().mustdos)
    // The nap: a real block before 15:00; the text and the plan say the same time.
    const nap = p.blocks.find((x) => x.rest)!
    expect(nap).toMatchObject({ title: NAP_TITLE, start: '13:30', minutes: 30 })
    expect(r.nap).toEqual({ start: '13:30', end: '14:00' })
    expect(r.focusAfter).toBe(205)
    expect(r.lead).toBe('Lighter day: 3h25 focus instead of 5h45, nap 13:30–14:00, training 70% (20 min at 18:00).')
    expect(p.training).toMatchObject({ what: 'Lighter 70%: Upper body 30 min', minutes: 20, time: '18:00' })
    // What left the timeline waits on today's list (never tomorrow without asking).
    expect(p.lightMoved?.length).toBeGreaterThan(0)
    for (const t of p.lightMoved!) expect(p.also?.some((a) => a.title === t)).toBe(true)
    expect(p.deferred ?? []).toEqual([])
    expect(p.shortNight).toBe(330)
    expect(p.headline).toMatch(/^Short night \(5h30\): a lighter day/)
  })

  it('puts the hardest work in his best hours when known, else 2 hours after waking', () => {
    const learned = shortNightPlan(heavy(), { ...base, sleptMin: 330, best: [10, 11] })!.plan
    // The biggest must-do (the 60-minute essay) is the hardest work.
    expect(learned.blocks.find((x) => x.tasks?.includes('Ethics essay'))!.start).toBe('10:00')
    const plain = shortNightPlan(heavy(), { ...base, sleptMin: 330 })!.plan
    const hardest = plain.blocks.filter((x) => !x.rest).sort((a, c) => c.minutes - a.minutes)[0]
    expect(hardest.start).toBe('09:30')
  })

  it('goes around the calendar, and moves the nap when 13:30 is taken', () => {
    const r = shortNightPlan(heavy(), { ...base, sleptMin: 330, events: [ev('Lab: Programming', '13:30', '15:00')] })!
    expect(r.nap).toEqual({ start: '12:30', end: '13:00' })
    for (const x of r.plan.blocks) expect(x.start >= '15:10' || x.start < '13:20').toBe(true)
  })

  it('no nap after 14:30, and half the focus under 5 hours', () => {
    const late = shortNightPlan(heavy(), { ...base, now: '14:40', sleptMin: 330 })
    expect(late?.nap ?? null).toBeNull()
    expect(late?.plan.blocks.some((x) => x.rest) ?? false).toBe(false)
    const tiny = shortNightPlan(heavy(), { ...base, sleptMin: 260 })!
    expect(tiny.focusAfter).toBeLessThanOrEqual(175)
    expect(tiny.plan.training?.what).toMatch(/^(Lighter 70%|Short 50%):/)
  })

  it('never moves pinned, approved or calendar blocks, and never lightens twice', () => {
    const p = heavy()
    p.blocks[1] = { ...p.blocks[1], locked: true }
    p.blocks[5] = { ...p.blocks[5], sync: { eventId: 'e1', start: '15:10', minutes: 60, title: 'Side project' } }
    const r = shortNightPlan(p, { ...base, sleptMin: 330 })!
    expect(r.plan.blocks.find((x) => x.id === p.blocks[1].id)).toMatchObject({ start: '08:10', minutes: 45 })
    expect(r.plan.blocks.find((x) => x.id === p.blocks[5].id)).toMatchObject({ start: '15:10', minutes: 60 })
    expect(shortNightPlan(r.plan, { ...base, sleptMin: 330 })).toBeNull()
  })

  it('a good night (6h30 or more) changes nothing', () => {
    expect(shortNightPlan(heavy(), { ...base, sleptMin: SHORT_NIGHT_MIN })).toBeNull()
  })

  it('the nap is on the timeline but not counted as focus', () => {
    const p = shortNightPlan(heavy(), { ...base, sleptMin: 330 })!.plan
    const s = planSummary(p)
    expect(s.blocks).toBe(p.blocks.length - 1)
    expect(planTimeline(p, 7 * 60 + 41).totalMin).toBe(s.focusMin)
  })
})

describe('what Ben says', () => {
  it('a bedtime for tonight from the wake target and the sleep need', () => {
    expect(bedTonight({ target: '00:00', wakeTomorrow: '07:30', needMin: 480 })).toBe('23:30')
    expect(bedTonight({ target: '23:00', wakeTomorrow: '08:30', needMin: 480 })).toBe('23:00')
    expect(bedTonight({ target: '23:30', wakeTomorrow: '05:00', needMin: 540 })).toBe('21:30')
  })

  it('one kind line with one tiny thing for tonight, no lecture', () => {
    expect(reasonLine({ kind: 'partner', who: 'girlfriend' }, '23:30')).toBe('Time with your girlfriend counts too, no guilt. Tonight: say goodnight by 23:15, lights out by 23:30.')
    expect(reasonLine({ kind: 'screen', who: null }, '23:30')).toMatch(/phone on the charger away from the bed at 23:00/)
    expect(reasonLine({ kind: null, who: null }, '23:30')).toBeNull()
  })

  it('leads with what changed, then the sleep, then the kind line', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(at(7, 41))
    const say = readSleepSay('I went to sleep at 2 am and got up at 7:30 am, spent too much time with gf eh', new Date())!
    vi.useRealTimers()
    const r = shortNightPlan(heavy(), { ...base, sleptMin: say.sleptMin })!
    const out = nightReply(say, r, { bed: '23:30', hasPlan: true, approved: false })
    const lines = out.reply.split('\n')
    expect(lines[0]).toBe(r.lead)
    expect(lines[1]).toMatch(/^Slept 5h30 \(02:00–07:30\), logged\. Kept your 3 must-dos\./)
    expect(lines[2]).toMatch(/^Time with your girlfriend/)
    expect(lines.length).toBe(3)
    expect(out.chips).toEqual(['Move the rest to tomorrow', 'Keep the full plan', 'What now?'])
    // No plan yet / an approved plan: said plainly, nothing claimed.
    expect(nightReply(say, null, { bed: '23:30', hasPlan: false, approved: false }).chips[0]).toBe('Plan my day')
    expect(nightReply(say, null, { bed: '23:30', hasPlan: true, approved: true }).reply).toMatch(/approved and in your calendar, so I left it/)
  })

  it('reads the chips back', () => {
    expect(lighterAnswer('Move the rest to tomorrow')).toBe('rest')
    expect(lighterAnswer('keep the full plan.')).toBe('keep')
    expect(lighterAnswer('keep the plan simple')).toBeNull()
  })
})
