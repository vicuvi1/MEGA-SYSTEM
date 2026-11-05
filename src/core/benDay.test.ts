import { describe, expect, it } from 'vitest'
import { badHour, nudged, nudgeGapMin, shouldNudge, type NudgeFacts } from './coachKit'
import { checkoutKeyboard, checkoutText, dueRhythm, lightenForSleep, DEFAULT_RHYTHM_PREFS } from './rhythm'
import { rescueFromEvents } from './benPlans'

const today = '2026-11-05'
const at = (hm: string) => new Date(`${today}T${hm}:00`)

describe("Ben's day (W1–W9)", () => {
  it('backs off when nudges are ignored, resets when he acts (W3)', () => {
    let st = nudged({}, today, at('10:00'))
    expect(nudgeGapMin(st)).toBe(45)
    st = nudged(st, today, at('11:00'), 120) // still idle since the last nudge: ignored
    expect(st.ignored).toBe(1)
    expect(nudgeGapMin(st)).toBe(90)
    st = nudged(st, today, at('12:30'), 200)
    expect(nudgeGapMin(st)).toBe(120)
    st = nudged(st, today, at('15:00'), 20) // did something since: reacted
    expect(st.ignored).toBe(0)
  })
  it('learns hours he never reacts in (W9)', () => {
    const st = { slots: { '14': [5, 0] as [number, number] } }
    expect(badHour(st, 14)).toBe(true)
    expect(badHour(st, 10)).toBe(false)
    const f: NudgeFacts = { today, time: '14:10', focusRunning: false, focusMinToday: 0, openMustDos: 2, idleMin: 120, wakeLogged: true }
    expect(shouldNudge(st, f, at('14:10'))).toBe(false)
    expect(shouldNudge(st, { ...f, time: '15:10' }, at('15:10'))).toBe(true)
  })
  it('offers a plan in the afternoon when there is none (W8)', () => {
    const facts = { today, time: '13:00', weekday: 4, wakeAt: '07:00', wakeTarget: '07:00', waterMl: 2000, waterTarget: 2000, workoutDone: true, paused: false }
    expect(dueRhythm({ day: today, water: [] } as any, DEFAULT_RHYTHM_PREFS, facts as any)).toContain('replan')
    expect(dueRhythm({ day: today, water: [] } as any, DEFAULT_RHYTHM_PREFS, { ...facts, time: '16:30' } as any)).not.toContain('replan')
  })
  it('makes the plan lighter after a short night (W5)', () => {
    const plan = { day: today, headline: 'Big day', mustdos: [], blocks: [1, 2, 3, 4].map((i) => ({ title: `B${i}`, start: `0${8 + i}:00`, minutes: 60 })), training: { time: '18:00', what: 'Gym' }, waterMl: 2700 }
    const l = lightenForSleep(plan, 320)
    expect(l.blocks).toHaveLength(3)
    expect(l.blocks[0].minutes).toBe(45)
    expect(l.training?.what).toBe('easy: Gym')
    expect(l.headline).toContain('Short night (5h20)')
    expect(lightenForSleep(plan, 450)).toBe(plan)
  })
  it('checks out the day honestly (W6)', () => {
    const items = ['Lab report', 'Algebra block']
    expect(checkoutKeyboard(items, [null, null]).inline_keyboard).toHaveLength(2)
    expect(checkoutKeyboard(items, ['k', null]).inline_keyboard).toHaveLength(1)
    expect(checkoutText(items, ['k', 'x'])).toContain('1 done, 0 partly, 1 not')
    expect(checkoutText(items, ['k', 'x'])).toContain('No points')
  })
  it('rescues a slipping day: Ben moves his blocks, classes stay (W1)', () => {
    const iso = (hm: string) => at(hm).toISOString()
    const events = [
      { id: 'a', title: 'Algebra', start: iso('09:00'), end: iso('10:30'), ours: true },
      { id: 'c', title: 'Class', start: iso('15:00'), end: iso('17:00') },
      { id: 'b', title: 'Lab report', start: iso('17:30'), end: iso('19:00'), ours: true }
    ]
    const r = rescueFromEvents(events, at('14:00').getTime(), at('22:00').getTime())
    expect(r.moves.find((m) => m.id === 'c')?.action).toBe('keep')
    const a = r.moves.find((m) => m.id === 'a')!
    expect(a.action === 'move' || a.action === 'shrink').toBe(true)
    expect(a.start! >= at('14:00').getTime()).toBe(true)
  })
})

describe('stop or extend focus from chat (W7)', () => {
  it('reads the actions', async () => {
    const { readAction } = await import('../renderer/src/web/botBrain')
    expect(readAction('stop')).toEqual({ kind: 'stopfocus' })
    expect(readAction('extend: 5')).toEqual({ kind: 'extendfocus', minutes: 5 })
    expect(readAction('extend: 500')).toBeNull()
  })
})

describe('the week and stakes (W13–W18)', () => {
  it('books the big 3 in free time, one block per task per day (W13)', async () => {
    const { bookBig3 } = await import('./rhythm')
    const days = ['2026-11-06', '2026-11-07']
    const events = [{ id: 'c', calendarId: 'x', title: 'Class', start: new Date('2026-11-06T09:00:00').toISOString(), end: new Date('2026-11-06T12:00:00').toISOString(), allDay: false }]
    const list = bookBig3(['Lab report', 'CV'], events as any, days, new Date('2026-11-05T20:00:00').toISOString())
    expect(list).toHaveLength(4)
    expect(list[0]).toMatchObject({ day: '2026-11-06', start: '12:00', end: '12:50', title: '🎯 Lab report' })
    expect(list.filter((b) => b.title.includes('CV'))).toHaveLength(2)
  })
  it("uses last night's draft only when nothing clashes (W18)", async () => {
    const { draftFits } = await import('./rhythm')
    const plan = { day: '2026-11-06', headline: '', mustdos: [], blocks: [{ title: 'A', start: '10:00', minutes: 50 }], training: null, waterMl: 0 }
    expect(draftFits(plan, [])).toBe(true)
    expect(draftFits(plan, [{ id: 'x', calendarId: '', title: 'New class', start: new Date('2026-11-06T10:30:00').toISOString(), end: new Date('2026-11-06T11:30:00').toISOString(), allDay: false }])).toBe(false)
  })
  it('suggests a stake and settles it by the focus log (W15, W16)', async () => {
    const { suggestStake, proofMet, addStake } = await import('./benStakes')
    const now = new Date('2026-11-05T14:00:00')
    const s = suggestStake('Algebra', now)
    expect(s.text).toBe('25 min focus on Algebra by 17:00')
    const [st] = addStake([], s.text, s.due, s.points, now, s.proof)
    const later = (min: number, subject = 'Algebra') => ({ sessions: [{ subject, startedAt: new Date('2026-11-05T15:00:00').toISOString(), minutes: min }] })
    expect(proofMet(st, later(25))).toBe(true)
    expect(proofMet(st, later(10))).toBe(false)
    expect(proofMet(st, later(30, 'Reading'))).toBe(false)
  })
})

describe("Ben's bedtime message with your numbers (WK16)", () => {
  it('names the debt and the early event, and stays quiet when all is fine', async () => {
    const { bedtimeNudge } = await import('./coach')
    const t = bedtimeNudge({ bedTarget: '23:00', wakeTarget: '07:00', debtMin: 130, nights: 6, firstEvent: { title: 'Exam', time: '09:00' }, slipping: null, first: null })!
    expect(t).toContain('in bed by <b>22:30</b>')
    expect(t).toContain('Exam at 09:00 tomorrow')
    expect(t).toContain('2 h 10 min short')
    expect(bedtimeNudge({ bedTarget: '23:00', wakeTarget: '07:00', debtMin: 20, nights: 6, firstEvent: { title: 'Gym', time: '18:00' }, slipping: null, first: null })).toBeNull()
  })
})

describe('Ben logs sets (SP14)', () => {
  it('reads "sets: bench 3x8x60" and sends the body action rules for it', async () => {
    const { readAction, actionGroups } = await import('../renderer/src/web/botBrain')
    expect(readAction('sets: bench 3x8x60')).toEqual({ kind: 'sets', text: 'bench 3x8x60' })
    expect(readAction('sets: nonsense')).toBeNull()
    expect(actionGroups('bench 3x8x60')).toContain('"sets: ')
  })
})
