import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  aimFor, applyOffer, orderItems, stepWindow, coachLine, finishReport, keepOffer, programPhases, requirementsOf, restMobility, shiftMove, shiftWorkout, trackerFinish, trackerLog, trackerSessionId, trackerToday, trackerUndo, weekBars
} from './sportTrain'
import { moveSessions, sessionItems, trainOf } from './trainLog'

// Made-up data only. The default week: Mon rest · Tue Upper · Wed Legs · Thu Upper · Fri rest · Sat Legs · Sun Upper.
// 2026-11-10 is a Tuesday (Upper), 2026-11-12 a Thursday (Upper), 2026-11-13 a Friday (rest), 2026-11-15 a Sunday (Upper).
const TUE = '2026-11-10'
const THU = '2026-11-12'
const FRI = '2026-11-13'
const SUN = '2026-11-15'

/** His old setup: daily rep targets (130 push-ups, 60 press, 60 squats) and their day totals. */
function oldSetup(): any {
  return {
    lastDate: TUE,
    exercises: [
      { id: 'ex_p', name: 'Push-ups', target: 130, unit: 'reps', active: true, doneToday: 0 },
      { id: 'ex_c', name: 'Press', target: 60, unit: 'reps', active: true, doneToday: 0 },
      { id: 'ex_s', name: 'Squats', target: 60, unit: 'reps', active: true, doneToday: 0 }
    ],
    days: { '2026-11-03': { ex_p: 130, ex_c: 60, ex_s: 60 }, '2026-11-05': { ex_p: 120, ex_c: 60, ex_s: 60 } },
    sets: {},
    history: [{ id: 1, day: '2026-11-03', title: 'Daily routine: 130 Push-ups' }],
    sportySettings: { coach: 'beast', autoProgression: true, progressionStreak: 0 }
  }
}

/** Logs every planned set of a move at these reps and effort. */
const logAll = (st: any, day: string, reps: number, feel: 'easy' | 'ok' | 'hard', opts: { formOff?: boolean; ladder?: 'push' | 'pull' } = {}) => {
  const ladder = opts.ladder ?? 'push'
  const n = trackerToday(st, day).items.find((i) => i.ladder.id === ladder)!.sets
  for (let i = 0; i < n; i++) trackerLog(st, { day, type: 'upper', ladder, reps, feel, form: opts.formOff ? 'off' : 'good', now: Date.parse(day + 'T18:00:00Z') + i, salt: `${day}${ladder}${i}` })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-10T08:30:00Z'))
})
afterEach(() => vi.useRealTimers())

describe("the Training home's Today is the split's session", () => {
  it('Tuesday is Upper: each move on a level from his past bests, as sets × range at an effort target', () => {
    const v = trackerToday(oldSetup(), TUE)
    expect(v).toMatchObject({ type: 'upper', stage: 'ready', title: 'Upper body' })
    expect(v.items.map((i) => i.ladder.id)).toEqual(['push', 'pull', 'shoulders'])
    const push = v.items[0]
    // 130 push-ups a day is about 22 a set: past plain push-ups, so a harder variation.
    expect(push.name).toBe('Diamond push-ups')
    expect(push.target).toBe('3 × 6–12')
    expect(push.effort).toBe('stop 1–2 reps before failure')
    expect(push.levelText).toBe('Step 3 of 8')
    expect(push.aim).toEqual([6, 6, 6])
    expect(push.demo).toBe('diamond_pushup')
    expect(push.offer).toBeNull()
    expect(v.minutes).toBeLessThanOrEqual(30)
    // Old rep logs are untouched: the day totals and history stay for stats and badges.
    expect(oldSetup().days['2026-11-03'].ex_p).toBe(130)
  })

  it('a best set of 50 push-ups places him on a much harder variation', () => {
    const st = { ...oldSetup(), bestSets: { push: { move: 'pushup', reps: 50, day: '2026-11-01' } } }
    expect(trackerToday(st, TUE).items[0].name).toBe('Archer push-ups')
  })

  it('a rest day shows rest and mobility, with Train anyway; "I can\'t train today" is rest too', () => {
    const v = trackerToday(oldSetup(), FRI)
    expect(v).toMatchObject({ type: 'rest', stage: 'rest', title: 'Rest day', items: [] })
    expect(v.mobility.length).toBeGreaterThan(0)
    expect(v.anyway).not.toBeNull()
    const any = trackerToday(oldSetup(), FRI, { anyway: v.anyway })
    expect(any).toMatchObject({ type: v.anyway, stage: 'ready', byChoice: true })
    expect(restMobility(FRI)).toEqual(v.mobility)
    const skip = trackerToday(oldSetup(), TUE, { skip: true })
    expect(skip).toMatchObject({ type: 'rest', stage: 'rest', skipped: true, title: 'Rest today', anyway: null })
    expect(coachLine(skip)).toMatch(/Resting today is fine/)
    // Once a set is logged the session counts, skip or not.
    const st = oldSetup()
    trackerLog(st, { day: TUE, type: 'upper', ladder: 'push', reps: 8, feel: 'ok', now: 1, salt: 'a' })
    expect(trackerToday(st, TUE, { skip: true }).stage).toBe('going')
  })

  it('Full / Lighter / Short are sets, not % of reps', () => {
    const st = oldSetup()
    const sets = (dose: 'full' | 'light' | 'short') => trackerToday(st, TUE, { dose }).items.map((i) => i.sets)
    expect(sets('full')).toEqual([3, 5, 2])
    expect(sets('light')).toEqual([2, 4, 2])
    expect(sets('short')).toEqual([2, 2, 2])
    // The range stays: Lighter means fewer sets, the same effort.
    expect(trackerToday(st, TUE, { dose: 'light' }).items[1].target).toBe('4 × 8–15')
  })
})

describe('logging sets', () => {
  it('each set is logged with its effort into the set log, the day total and the session; undo takes it back', () => {
    const st = oldSetup()
    const r = trackerLog(st, { day: TUE, type: 'upper', ladder: 'push', reps: 8, feel: 'ok', now: 1000, salt: 'a' })!
    expect(r.set).toMatchObject({ reps: 8, feel: 'ok', rir: 2, session: trackerSessionId(TUE, 'upper') })
    const exId = st.exercises.find((e: any) => e.move === 'diamond_pushup').id
    expect(st.sets[TUE][exId]).toHaveLength(1)
    expect(st.days[TUE][exId]).toBe(8)
    // The level he was placed on is now saved, with the day.
    expect(st.trainLevels.push).toMatchObject({ level: 2, reached: { '2': TUE } })
    const v = trackerToday(st, TUE)
    expect(v.stage).toBe('going')
    expect(v.items[0].done.map((s) => s.reps)).toEqual([8])
    expect(v.items[0].nextTime?.kind).toBe('reps')
    expect(st.trainLog[0].exercises[0].sets).toEqual([{ reps: 8, feel: 'ok' }])
    expect(trackerUndo(st, { day: TUE, type: 'upper', setId: r.set.id!, now: 2000 })).toBe(true)
    expect(trackerToday(st, TUE).items[0].done).toEqual([])
    expect(st.days[TUE][exId]).toBeUndefined()
  })

  it('the form check is saved on the set', () => {
    const st = oldSetup()
    const r = trackerLog(st, { day: TUE, type: 'upper', ladder: 'push', reps: 8, feel: 'ok', formOff: true, now: 1000, salt: 'a' })!
    expect(r.set.form).toBe('off')
    expect(st.trainLog[0].exercises[0].sets).toEqual([{ reps: 8, feel: 'ok', form: 'off' }])
  })

  it('under the top: the aim is last time with one more rep on the lowest set', () => {
    const st = oldSetup()
    ;[9, 8, 8].forEach((r, i) => trackerLog(st, { day: TUE, type: 'upper', ladder: 'push', reps: r, feel: 'ok', now: 1000 + i, salt: `r${i}` }))
    const thu = trackerToday(st, THU).items[0]
    expect(thu.name).toBe('Diamond push-ups')
    expect(thu.aim).toEqual([9, 9, 8])
    expect(aimFor({ last: null, level: thu.level, sets: 2 })).toEqual([6, 6])
  })

  it('Finish marks the session done and gives a workout made only of logged sets; nothing logged, nothing to pay', () => {
    const st = oldSetup()
    expect(trackerFinish(st, { day: TUE, type: 'upper', now: 9000 })).toBeNull()
    trackerLog(st, { day: TUE, type: 'upper', ladder: 'pull', reps: 10, feel: 'hard', now: 1000, salt: 'p' })
    const w = trackerFinish(st, { day: TUE, type: 'upper', now: 9000 })!
    expect(w.items).toHaveLength(1)
    expect(w.items[0]).toMatchObject({ amount: 10, sets: [{ reps: 10 }] })
    expect(trackerToday(st, TUE)).toMatchObject({ stage: 'done', title: 'Done: Upper body' })
  })
})

describe('double progression: the next variation is offered, you choose Apply or Keep', () => {
  it('one session at the top is not enough: "one more session at the top"', () => {
    const st = oldSetup()
    logAll(st, TUE, 12, 'easy')
    const it = trackerToday(st, TUE).items[0]
    expect(it.offer).toBeNull()
    expect(it.status).toMatchObject({ state: 'building', hits: 1 })
    expect(it.nextTime?.line).toBe('Next time: Diamond push-ups 3 × 12 again, because one more session at the top unlocks the next move.')
    expect(coachLine(trackerToday(st, THU))).toBe('One more session at the top of Diamond push-ups (3×12, not hard) unlocks Decline push-ups.')
  })

  it('every set at the top, easy, twice → Decline push-ups offered; Apply puts the next session on it', () => {
    const st = oldSetup()
    logAll(st, TUE, 12, 'easy')
    logAll(st, THU, 12, 'easy')
    const v = trackerToday(st, THU)
    const it = v.items[0]
    expect(it.name).toBe('Diamond push-ups')
    expect(it.offer).toMatchObject({ to: 3, move: 'decline_pushup', name: 'Decline push-ups', target: '3 × 6–12', reason: '3×12 easy twice', line: 'Unlocked: Decline push-ups, because 3×12 easy twice.' })
    expect(it.nextTime?.kind).toBe('up')
    expect(coachLine(v)).toBe('Decline push-ups is unlocked: 3×12 easy twice. Apply it, or keep Diamond push-ups a bit longer.')
    trackerFinish(st, { day: THU, type: 'upper', now: Date.parse(THU + 'T19:00:00Z') })
    const rows = finishReport(trackerToday(st, THU))
    expect(rows[0]).toMatchObject({ ladder: 'push', name: 'Diamond push-ups', sets: '3 × 12', line: 'Unlocked: Decline push-ups, because 3×12 easy twice.' })
    // It never moves by itself: Sunday is still Diamond until he applies it.
    expect(trackerToday(st, SUN).items[0].name).toBe('Diamond push-ups')
    expect(applyOffer(st, { day: THU, type: 'upper', ladder: 'push', now: 5 })?.name).toBe('Decline push-ups')
    expect(st.trainLevels.push).toMatchObject({ level: 3, reached: { '2': TUE, '3': THU } })
    const sun = trackerToday(st, SUN).items[0]
    expect(sun).toMatchObject({ name: 'Decline push-ups', offer: null, status: { state: 'new' } })
    expect(sun.aim).toEqual([6, 6, 6])
    // History stays: both Diamond sessions are still in the log.
    expect(moveSessions(st, 'diamond_pushup')).toHaveLength(2)
    // Body → Training reads the same engine: the same move.
    expect(sessionItems(st, trainOf(st), 'upper', SUN)[0].name).toBe('Decline push-ups')
  })

  it('Keep stays on the level; the offer comes back after a newer session at the top', () => {
    const st = oldSetup()
    logAll(st, TUE, 12, 'ok')
    logAll(st, THU, 12, 'ok')
    expect(trackerToday(st, THU).items[0].offer?.reason).toBe('3×12 twice with 1–2 reps left')
    expect(keepOffer(st, { day: THU, type: 'upper', ladder: 'push', now: 5 })).toBe(true)
    expect(trackerToday(st, THU).items[0].offer).toBeNull()
    expect(trackerToday(st, SUN).items[0]).toMatchObject({ name: 'Diamond push-ups', offer: null })
    logAll(st, SUN, 12, 'ok')
    expect(trackerToday(st, SUN).items[0].offer?.name).toBe('Decline push-ups')
  })

  it('a Hard set or a broken-form set at the top does not count toward the unlock', () => {
    const hard = oldSetup()
    logAll(hard, TUE, 12, 'easy')
    logAll(hard, THU, 12, 'hard')
    expect(trackerToday(hard, THU).items[0]).toMatchObject({ offer: null, status: { state: 'building', hits: 0 } })
    const form = oldSetup()
    logAll(form, TUE, 12, 'easy')
    logAll(form, THU, 12, 'easy', { formOff: true })
    const it = trackerToday(form, THU).items[0]
    expect(it.offer).toBeNull()
    expect(requirementsOf(it).find((r) => r.id === 'form')).toMatchObject({ done: false, detail: 'form broke' })
  })

  it('what the next level needs, as ticks', () => {
    const st = oldSetup()
    expect(requirementsOf(trackerToday(st, TUE).items[0]).map((r) => r.done)).toEqual([false, false, false, false, false])
    logAll(st, TUE, 12, 'easy')
    const req = requirementsOf(trackerToday(st, TUE).items[0])
    expect(req).toEqual([
      { id: 'sessions', label: '2 sessions in a row at the top', done: false, detail: '1 of 2' },
      { id: 'reps', label: 'Every set at 12 (3 sets)', done: true, detail: '3 × 12' },
      { id: 'effort', label: 'Effort OK or Easy (1–2 reps left)', done: true, detail: 'easy' },
      { id: 'form', label: 'Form confirmed good on every set', done: true, detail: 'good' },
      { id: 'pain', label: 'No pain flagged', done: true, detail: 'none' }
    ])
  })
})

describe('Make easier / Make harder', () => {
  it('one move one level at once; history and progress stay', () => {
    const st = oldSetup()
    logAll(st, TUE, 12, 'easy')
    const easier = shiftMove(st, { day: TUE, ladder: 'push', delta: -1, now: 10 })
    expect(easier).toEqual({ ladder: 'push', from: 'Diamond push-ups', to: 'Push-ups' })
    expect(trackerToday(st, THU).items[0].name).toBe('Push-ups')
    // Today's Diamond sets are still logged.
    expect(moveSessions(st, 'diamond_pushup')).toHaveLength(1)
    // Back up: the Diamond session still counts (1 of 2 at the top), nothing lost.
    shiftMove(st, { day: THU, ladder: 'push', delta: 1, now: 11 })
    const back = trackerToday(st, THU).items[0]
    expect(back).toMatchObject({ name: 'Diamond push-ups', status: { hits: 1 } })
    expect(st.trainLevels.push.reached['2']).toBe(TUE)
    // The end of a ladder: nothing to shift.
    st.trainLevels.push.level = 7
    expect(shiftMove(st, { day: THU, ladder: 'push', delta: 1, now: 12 })).toBeNull()
  })

  it('the whole workout: every move one level', () => {
    const st = oldSetup()
    const before = trackerToday(st, TUE).items.map((i) => i.index)
    const out = shiftWorkout(st, { day: TUE, type: 'upper', delta: 1, now: 10 })
    expect(out.map((s) => s.ladder)).toEqual(['push', 'pull', 'shoulders'])
    expect(trackerToday(st, TUE).items.map((i) => i.index)).toEqual(before.map((i) => i + 1))
    shiftWorkout(st, { day: TUE, type: 'upper', delta: -1, now: 11 })
    expect(trackerToday(st, TUE).items.map((i) => i.index)).toEqual(before)
  })
})

describe('the week and the program', () => {
  it('weekly bars: planned sets from the split against logged sets; empty with no log', () => {
    const empty = weekBars(oldSetup(), TUE)
    expect(empty.days.map((d) => d.short)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
    expect(empty.days.map((d) => d.planned)).toEqual([0, 10, 12, 10, 0, 12, 10])
    expect(empty).toMatchObject({ done: 0, planned: 54, pct: 0 })
    const st = oldSetup()
    logAll(st, TUE, 10, 'ok')
    logAll(st, TUE, 10, 'easy', { ladder: 'pull' })
    const w = weekBars(st, TUE)
    expect(w.days[1]).toMatchObject({ done: 8, planned: 10, pct: 0.8, today: true })
    expect(w.hard).toEqual({ push: 3, pull: 0, legs: 0, core: 0 })
  })

  it('the 12-week program starts with the first session; levels gained since then', () => {
    expect(programPhases(oldSetup(), TUE)).toMatchObject({ week: null, start: null, levelsUp: 0 })
    const st = oldSetup()
    logAll(st, TUE, 12, 'easy')
    logAll(st, THU, 12, 'easy')
    applyOffer(st, { day: THU, type: 'upper', ladder: 'push', now: 5 })
    const p = programPhases(st, '2026-11-26')
    expect(p).toMatchObject({ week: 3, start: TUE, levelsUp: 1 })
    expect(p.phases.map((x) => x.state)).toEqual(['done', 'current', 'next', 'next', 'next'])
  })
})

describe('the Dashboard path and the Workout order', () => {
  it('shows at most 5 steps of a chain, the current one in the middle where it can be', () => {
    expect(stepWindow(8, 4)).toEqual([2, 7])
    expect(stepWindow(8, 0)).toEqual([0, 5])
    expect(stepWindow(8, 7)).toEqual([3, 8])
    expect(stepWindow(3, 1)).toEqual([0, 3])
    expect(stepWindow(0, 0)).toEqual([0, 0])
  })
  it('puts moves in the dragged order and keeps unknown ones at the end', () => {
    const it = (id: string) => ({ ladder: { id } })
    expect(orderItems([it('push'), it('pull'), it('shoulders')], ['shoulders', 'push']).map((x) => x.ladder.id)).toEqual(['shoulders', 'push', 'pull'])
    expect(orderItems([it('push'), it('pull')], null).map((x) => x.ladder.id)).toEqual(['push', 'pull'])
  })
})
