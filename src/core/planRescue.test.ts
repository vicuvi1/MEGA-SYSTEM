// Auto-rescue: when it fires (30 min late, once per block, two a day, never
// in a meeting, quiet hours or while a timer runs), what it offers (built by
// the re-plan + Too much today rules, inside your limits) and what Accept
// saves. Made-up plan, pinned clock (all times local).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildRescue, decideRescue, lateBlock, rescueApplied, rescueKey, type RescueInput } from './planRescue'
import { answerPush, claim, cleanPushLog, pushAlert, pushTelegram, readPushCallback } from './benPushes'
import type { DayProposal } from './rhythm'
import type { CalEvent } from './dayTime'

const DAY = '2026-11-06'
const at = (hm: string) => new Date(`${DAY}T${hm}:00`).getTime()
const ev = (title: string, s: string, e: string): CalEvent => ({ id: title, calendarId: 'primary', title, start: new Date(`${DAY}T${s}:00`).toISOString(), end: new Date(`${DAY}T${e}:00`).toISOString(), allDay: false })

const plan = (): DayProposal => ({
  day: DAY,
  headline: 'Lab first',
  mustdos: ['Lab report'],
  blocks: [
    { id: 'lab', title: 'Lab report', start: '10:00', minutes: 60, kind: 'focus', tasks: ['Lab report'] },
    { id: 'read', title: 'Read chapter 3', start: '13:00', minutes: 60, kind: 'focus', tasks: ['Read chapter 3'] },
    { id: 'tidy', title: 'Tidy notes', start: '15:00', minutes: 45, kind: 'focus', tasks: ['Tidy notes'] }
  ],
  training: null,
  waterMl: 2500,
  also: [
    { id: 't1', title: 'Lab report', minutes: 60, priority: 4, at: '10:00' },
    { id: 't2', title: 'Read chapter 3', minutes: 60, priority: 2, at: '13:00' },
    { id: 't3', title: 'Tidy notes', minutes: 45, priority: 1, at: '15:00' }
  ]
})

const input = (now: number, o: Partial<RescueInput> = {}): RescueInput => ({
  now,
  day: DAY,
  on: true,
  plan: plan(),
  status: 'proposed',
  version: 3,
  running: false,
  meeting: false,
  quiet: false,
  log: cleanPushLog(null, DAY),
  here: true,
  ctx: { events: [], sessions: [], endBy: '22:00', limits: null },
  ...o
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(at('10:31'))
})
afterEach(() => vi.useRealTimers())

describe('when a rescue is offered', () => {
  it('only 30 minutes after the start, when nothing started and nothing is ticked', () => {
    expect(lateBlock(plan(), { now: '10:29' })).toBeNull()
    expect(lateBlock(plan(), { now: '10:30' })?.id).toBe('lab')
    // A focus session in its time: it started.
    expect(lateBlock(plan(), { now: '10:40', sessions: [{ s: at('10:05'), e: at('10:20') }] })).toBeNull()
    const ticked = { ...plan(), blocks: plan().blocks.map((b) => (b.id === 'lab' ? { ...b, done: ['Lab report'] } : b)) }
    expect(lateBlock(ticked, { now: '10:40' })).toBeNull()
    // Breaks and meals are not work: never rescued.
    const lunch = { ...plan(), blocks: [{ id: 'l', title: 'Lunch', start: '10:00', minutes: 30 }] }
    expect(lateBlock(lunch, { now: '10:45' })).toBeNull()
  })

  it('offers one short plan with Accept / Not now / Skip today', () => {
    const r = decideRescue(input(at('10:31')))
    expect(r?.push.key).toBe(rescueKey('lab'))
    expect(r?.push.type).toBe('rescue')
    expect(r?.push.text).toMatch(/^Rescue: start 'Lab report' now for 60 min/)
    expect(r?.push.buttons.map((b) => b.op)).toEqual(['accept', 'later', 'skip'])
    expect(r?.offer.block).toMatchObject({ id: 'lab', start: '10:35', moved: true })
    expect(r?.push.channel).toBe('island')
    expect(decideRescue(input(at('10:31'), { here: false }))?.push.channel).toBe('telegram')
    // On Telegram: the same three buttons, one key (bp|a / bp|l / bp|s), and Undo reads back.
    const tg = pushTelegram(r!.push)
    expect(tg.keyboard.inline_keyboard[0].map((b) => b.callback_data)).toEqual(['bp|a|rescue:lab', 'bp|l|rescue:lab', 'bp|s|rescue:lab'])
    expect(readPushCallback('bp|u|rescue:lab')).toEqual({ op: 'undo', ref: 'rescue:lab' })
    // On the island: a card whose taps carry the key.
    expect(pushAlert(r!.push).actions?.map((a) => (a.action as any).op)).toEqual(['accept', 'later', 'skip'])
  })

  it('never in a meeting, in quiet hours, while a timer runs, or when off', () => {
    expect(decideRescue(input(at('10:31'), { meeting: true }))).toBeNull()
    expect(decideRescue(input(at('10:31'), { quiet: true }))).toBeNull()
    expect(decideRescue(input(at('10:31'), { running: true }))).toBeNull()
    expect(decideRescue(input(at('10:31'), { on: false }))).toBeNull()
  })

  it('once per block: shown or skipped, it never comes again', () => {
    const shown = claim(cleanPushLog(null, DAY), rescueKey('lab'), 'island', at('10:31')).log
    expect(decideRescue(input(at('10:50'), { log: shown }))).toBeNull()
    expect(decideRescue(input(at('11:30'), { log: answerPush(shown, rescueKey('lab'), 'skip', at('10:32')) }))).toBeNull()
  })

  it('Not now asks once more 15 minutes later, without Not now', () => {
    const snoozed = answerPush(claim(cleanPushLog(null, DAY), rescueKey('lab'), 'island', at('10:31')).log, rescueKey('lab'), 'later', at('10:32'), 15)
    expect(decideRescue(input(at('10:40'), { log: snoozed }))).toBeNull()
    const again = decideRescue(input(at('10:47'), { log: snoozed }))
    expect(again?.push.key).toBe(rescueKey('lab', true))
    expect(again?.push.buttons.map((b) => b.op)).toEqual(['accept', 'skip'])
    const twice = claim(snoozed, rescueKey('lab', true), 'island', at('10:47')).log
    expect(decideRescue(input(at('11:20'), { log: answerPush(twice, rescueKey('lab', true), 'later', at('10:48')) }))).toBeNull()
  })

  it('at most 2 rescues a day', () => {
    let log = cleanPushLog(null, DAY)
    log = claim(log, rescueKey('a'), 'island', at('08:00')).log
    log = claim(log, rescueKey('b'), 'telegram', at('09:00')).log
    expect(decideRescue(input(at('10:31'), { log }))).toBeNull()
    // A snoozed one asking again does not count as a third.
    const one = claim(cleanPushLog(null, DAY), rescueKey('a'), 'island', at('08:00')).log
    expect(decideRescue(input(at('10:31'), { log: claim(one, rescueKey('a', true), 'island', at('08:20')).log }))?.push.key).toBe(rescueKey('lab'))
  })
})

describe('what the rescue plan does', () => {
  it('the late draft starts now; drafts in its way move; nothing else changes', () => {
    const p = { ...plan(), blocks: [...plan().blocks, { id: 'mail', title: 'Answer emails', start: '11:00', minutes: 30, kind: 'quick' as const, tasks: ['Answer emails'] }] }
    const r = buildRescue(p, 'proposed', { now: '10:31', events: [], endBy: '22:00' })!
    const lab = r.plan.blocks.find((b) => b.id === 'lab')!
    expect(lab).toMatchObject({ start: '10:35', minutes: 60 })
    expect(lab.locked).toBeUndefined()
    const mail = r.plan.blocks.find((b) => b.id === 'mail')!
    expect(mail.start >= '11:35').toBe(true)
    expect(r.plan.blocks.find((b) => b.id === 'read')!.start).toBe('13:00')
  })

  it('is shortened to the free time before a meeting', () => {
    const r = buildRescue(plan(), 'proposed', { now: '10:31', events: [ev('Call with the tutor', '11:20', '12:00')], endBy: '22:00' })!
    expect(r.block).toMatchObject({ start: '10:35', minutes: 45 })
    expect(r.text).toMatch(/for 45 min/)
  })

  it('keeps your limits: what does not fit before the off time goes to tomorrow', () => {
    const limits = { maxFocusMin: 120, offAt: '16:00', protect: [], caps: [] }
    const r = buildRescue(plan(), 'proposed', { now: '10:31', events: [], endBy: '22:00', limits })!
    expect(r.tomorrow.map((x) => x.title)).toEqual(expect.arrayContaining(['Tidy notes']))
    expect(r.tomorrow.map((x) => x.title)).not.toContain('Lab report')
    expect(r.text).toMatch(/move 'Tidy notes'.* to tomorrow\.$/)
    const work = r.plan.blocks.reduce((t, b) => t + b.minutes, 0)
    expect(work).toBeLessThanOrEqual(120)
    expect(r.plan.deferred?.map((d) => d.title)).toContain('Tidy notes')
  })

  it('an approved, pinned or calendar block never moves: you start it for the time it has left', () => {
    const r = buildRescue(plan(), 'approved', { now: '10:31', events: [], endBy: '22:00' })!
    expect(r.block).toMatchObject({ start: '10:00', moved: false, minutes: 29 })
    expect(r.plan.blocks.find((b) => b.id === 'lab')!.start).toBe('10:00')
    const pinned = { ...plan(), blocks: plan().blocks.map((b) => (b.id === 'read' ? { ...b, locked: true } : b)) }
    const r2 = buildRescue(pinned, 'proposed', { now: '10:31', events: [], endBy: '22:00', limits: { maxFocusMin: 60, offAt: null, protect: [], caps: [] } })!
    expect(r2.plan.blocks.find((b) => b.id === 'read')).toMatchObject({ start: '13:00', locked: true })
  })

  it('no room to start now (a meeting right now): no rescue', () => {
    expect(buildRescue(plan(), 'proposed', { now: '10:31', events: [ev('Seminar', '10:30', '12:00')], endBy: '22:00' })).toBeNull()
  })

  it('Accept saves the offered plan, or the same intent on a plan that changed since', () => {
    const r = decideRescue(input(at('10:31'), { ctx: { events: [], endBy: '22:00', limits: { maxFocusMin: 120, offAt: '16:00', protect: [], caps: [] } } }))!
    expect(rescueApplied(r.offer, plan(), 3, 'proposed')).toBe(r.offer.plan)
    const edited = { ...plan(), headline: 'Changed on the phone' }
    const again = rescueApplied(r.offer, edited, 4, 'proposed')
    expect(again.headline).toBe('Changed on the phone')
    expect(again.blocks.find((b) => b.id === 'lab')!.start).toBe('10:35')
    expect(again.deferred?.map((d) => d.title)).toEqual(r.offer.tomorrow.map((t) => t.title))
    // Approved meanwhile: the block stays where it is.
    expect(rescueApplied(r.offer, plan(), 4, 'approved').blocks.find((b) => b.id === 'lab')!.start).toBe('10:00')
  })
})
