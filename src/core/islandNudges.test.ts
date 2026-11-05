import { describe, expect, it } from 'vitest'
import {
  addMove,
  awayNudge,
  behindExercise,
  breathAt,
  challengeBonus,
  challengeLine,
  challengeView,
  cleanNudgeStore,
  dayOf,
  EMPTY_NUDGES,
  escalation,
  eyesNudge,
  fixMove,
  focusNudge,
  gratitudeNudge,
  learnAlert,
  makeChallenge,
  moodNudge,
  moveDoneAlert,
  moveNudge,
  movePill,
  moveStreak,
  noteAnswer,
  noteIdle,
  nudgeGate,
  personCalled,
  personNudge,
  postpone,
  postureNudge,
  snoozeChoices,
  snoozeUntil,
  startCount,
  stepCount,
  tally,
  tryMore,
  undoMove,
  type MoveLog,
  type NudgeStore
} from './islandNudges'
import { DEFAULT_RULES, planAward } from './rules'
import { canUndo } from './islandCommands'
import { momentsFrom } from './islandMoments'
import { EMPTY_ISLAND } from './islandModel'

const at = (s: string) => Date.parse(`2026-11-04T${s}:00`)
const DAY = '2026-11-04'
const EX = [
  { id: 'push', name: 'Push-ups', done: 40, target: 100 },
  { id: 'squat', name: 'Squats', done: 10, target: 60 },
  { id: 'plank', name: 'Plank', done: 0, target: 3, unit: 'min' }
]
const log = (o: Partial<MoveLog> = {}): MoveLog => ({ id: 'l1', at: at('14:00'), day: DAY, ex: 'push', name: 'Push-ups', n: 20, workoutId: 7, ledgerId: 11, coins: 3, ...o })
const moveIn = (now: number, extra: Partial<Parameters<typeof moveNudge>[0]> = {}) => ({ now, busy: false, idleSec: 10, activeSince: now - 65 * 60_000, lastMoveAt: 0, exercises: EX, store: EMPTY_NUDGES(), day: DAY, dismissed: {}, coins: 3, snooze: { now }, ...extra })

describe('Island 2: pick your count (IN1, IN14)', () => {
  it('defaults to the exercise furthest behind today (reps only)', () => {
    expect(behindExercise(EX)?.id).toBe('squat')
    expect(behindExercise([{ id: 'x', name: 'X', done: 5, target: 0 }])).toBeNull()
  })
  it('−/+ step by 1, 2 or 5 and never go below 1', () => {
    expect(stepCount(8, 1)).toBe(9)
    expect(stepCount(20, 1)).toBe(22)
    expect(stepCount(30, 1)).toBe(35)
    expect(stepCount(30, -1)).toBe(28)
    expect(stepCount(10, -1)).toBe(9)
    expect(stepCount(1, -1)).toBe(1)
  })
  it("last time's numbers, a small step up", () => {
    expect(tryMore(20)).toBe(22)
    expect(tryMore(8)).toBe(9)
    expect(tryMore(100)).toBe(105)
    expect(startCount(EX[0], { ex: 'push', name: 'Push-ups', n: 20 })).toEqual({ n: 22, hint: 'Last break: 20 push-ups. Try 22?' })
    expect(startCount(EX[1], null).n).toBe(20)
    expect(startCount({ id: 'a', name: 'A', done: 10, target: 10 }, null).n).toBe(10)
  })
  it('the move card has the picker, the count and the points', () => {
    const a = moveNudge(moveIn(at('14:00')))!
    expect(a.nudge?.type).toBe('move')
    if (a.nudge?.type !== 'move') throw new Error()
    expect(a.nudge.pick).toBe('squat')
    expect(a.nudge.options.map((o) => o.ex)).toEqual(['push', 'squat'])
    expect(a.nudge.coins).toBe(3)
    expect(a.actions[0].action).toEqual({ kind: 'nudge', op: { op: 'move', ex: 'squat', name: 'Squats', n: 20, alertId: a.id } })
    expect(canUndo(a.actions[0].action)).toBe(true)
    expect(canUndo({ kind: 'moveBreak', name: 'Squats', n: 20, alertId: 'x' })).toBe(true)
  })
  it('waits for your sitting minutes, and not when busy or away', () => {
    expect(moveNudge(moveIn(at('14:00'), { activeSince: at('13:30') }))).toBeNull()
    expect(moveNudge(moveIn(at('14:00'), { busy: true }))).toBeNull()
    expect(moveNudge(moveIn(at('14:00'), { idleSec: 400 }))).toBeNull()
    const s = cleanNudgeStore({ prefs: { sitMin: 30 } })
    expect(moveNudge(moveIn(at('14:00'), { activeSince: at('13:25'), store: s }))).not.toBeNull()
  })
})

describe('Island 2: undo and "I did fewer" (IN7)', () => {
  it('a break counts, an undo takes it out again', () => {
    let s = addMove(EMPTY_NUDGES(), log())
    expect(dayOf(s, DAY)).toMatchObject({ moves: 1, reps: 20, minutes: 2 })
    expect(s.last).toEqual({ ex: 'push', name: 'Push-ups', n: 20 })
    const r = undoMove(s, 'l1')
    expect(r.log?.ledgerId).toBe(11)
    s = r.store
    expect(dayOf(s, DAY)).toMatchObject({ moves: 0, reps: 0 })
    expect(s.last).toBeNull()
    expect(undoMove(s, 'l1').log).toBeNull()
  })
  it('"only did 12" corrects the count, and stays at least 1', () => {
    const s = addMove(EMPTY_NUDGES(), log())
    const r = fixMove(s, 'l1', 12)
    expect(r.delta).toBe(-8)
    expect(dayOf(r.store, DAY).reps).toBe(12)
    expect(r.store.last?.n).toBe(12)
    expect(fixMove(s, 'l1', 0).log?.n).toBe(1)
    expect(fixMove(s, 'nope', 5).log).toBeNull()
  })
  it('right after: +250 ml too, undo, done (3 minutes)', () => {
    const s = addMove(EMPTY_NUDGES(), log())
    const a = moveDoneAlert(s, at('14:01'), {}, DAY)!
    expect(a.title).toBe('✓ 20 Push-ups · +3')
    expect(a.actions.map((x) => x.label)).toEqual(['💧 +250 ml too?', '↶ Undo', 'Done'])
    expect(moveDoneAlert(s, at('14:04'), {}, DAY)).toBeNull()
    expect(moveDoneAlert({ ...s, logs: [{ ...log(), water: true }] }, at('14:01'), {}, DAY)!.actions[0].label).toBe('↶ Undo')
  })
})

describe('Island 2: fair points (caps)', () => {
  it('body.move_break pays 3, at most 5 a day; eye breaks 1, at most 3', () => {
    const rule = DEFAULT_RULES.find((r) => r.id === 'body.move_break')!
    expect(rule).toMatchObject({ coins: 3, dailyCap: 5 })
    const entries: any[] = []
    let t = at('09:00')
    for (let i = 0; i < 5; i++) {
      const e = planAward(rule, entries, new Date(t), DAY)
      entries.push({ ...e, id: i + 1 })
      t += 15 * 60_000
    }
    expect(() => planAward(rule, entries, new Date(t), DAY)).toThrow(/Daily limit/)
    expect(DEFAULT_RULES.find((r) => r.id === 'body.eye_break')).toMatchObject({ coins: 1, dailyCap: 3 })
    expect(DEFAULT_RULES.find((r) => r.id === 'body.challenge_done')).toMatchObject({ dailyCap: 1 })
  })
})

describe('Island 2: snooze (IN30) and escalation (IN31)', () => {
  it('snooze choices and when they end', () => {
    const now = at('10:00')
    expect(snoozeUntil('5', { now })).toBe(now + 5 * 60_000)
    expect(snoozeUntil('task', { now, taskEnd: at('10:40') })).toBe(at('10:40'))
    expect(snoozeUntil('meeting', { now, meetingEnd: at('11:00') })).toBe(at('11:00'))
    expect(snoozeUntil('lunch', { now })).toBe(at('12:30'))
    expect(snoozeUntil('lunch', { now: at('14:00') })).toBe(at('15:00'))
    expect(snoozeChoices({ now }).map((c) => c.c)).toEqual(['5', '15', 'lunch'])
    expect(snoozeChoices({ now, taskEnd: at('10:30'), meetingEnd: at('10:45') }).map((c) => c.c)).toEqual(['5', '15', 'task', 'meeting', 'lunch'])
    expect(snoozeChoices({ now: at('13:00') }).map((c) => c.c)).toEqual(['5', '15'])
  })
  it('postponing counts, the card says so, and the snooze hides it', () => {
    let s = postpone(EMPTY_NUDGES(), DAY, 'move', at('14:15'))
    s = postpone(s, DAY, 'move', at('14:15'))
    expect(dayOf(s, DAY).postponed.move).toBe(2)
    const a = moveNudge(moveIn(at('14:00'), { store: s, activeSince: at('12:40') }))!
    expect(a.text).toContain('Postponed 2 times today')
    expect(learnAlert(a, s, 'move', at('14:05'))).toBeNull()
    expect(learnAlert(a, s, 'move', at('14:20'))).not.toBeNull()
  })
  it('a dot, then a peek, then a sound, then Ben (never a lock)', () => {
    expect(escalation(52, 50)).toBe('dot')
    expect(escalation(65, 50)).toBe('peek')
    expect(escalation(80, 50)).toBe('sound')
    expect(escalation(90, 50)).toBe('ben')
    expect(moveNudge(moveIn(at('14:00'), { activeSince: at('13:05') }))?.dot).toBe(true)
    const ben = moveNudge(moveIn(at('14:00'), { activeSince: at('12:25') }))!
    expect(ben.dot).toBeUndefined()
    expect(ben.title).toBe('95 min in that chair. Up, now.')
    expect(ben.actions.some((x) => x.action.kind === 'lockPc')).toBe(true)
    expect(ben.actions[0].action.kind).toBe('nudge')
  })
  it('each step is a new alert (a dot can become a peek); dismissing the sitting hides every step', () => {
    const since = at('13:00')
    const dot = moveNudge(moveIn(at('13:55'), { activeSince: since }))!
    const peek = moveNudge(moveIn(at('14:05'), { activeSince: since }))!
    expect(dot.id).not.toBe(peek.id)
    expect(moveNudge(moveIn(at('14:05'), { activeSince: since, dismissed: { [dot.id]: at('20:00') } }))).toBeNull()
  })
})

describe('Island 2: learning (IN26)', () => {
  it('skipped 4 in a row: a quiet dot; 3 no at an hour: another hour', () => {
    let st = {}
    for (let i = 0; i < 4; i++) st = noteAnswer(st, 'water', false, 10 + i)
    expect(nudgeGate(st, 'water', 15)).toBe('dot')
    st = noteAnswer(st, 'water', true, 15)
    expect(nudgeGate(st, 'water', 15)).toBe('peek')
    let h = {}
    for (let i = 0; i < 3; i++) h = noteAnswer(h, 'move', false, 9)
    expect(nudgeGate(h, 'move', 9)).toBe('skip')
    expect(nudgeGate(h, 'move', 11)).toBe('peek')
    const s: NudgeStore = { ...EMPTY_NUDGES(), stats: h }
    const a = moveNudge(moveIn(at('09:30'), { activeSince: at('08:20') }))
    expect(learnAlert(a, s, 'move', at('09:30'))).toBeNull()
  })
  it('a nudge you turned off never shows', () => {
    const s = cleanNudgeStore({ prefs: { on: { move: false } } })
    expect(learnAlert(moveNudge(moveIn(at('14:00'))), s, 'move', at('14:00'))).toBeNull()
  })
})

describe('Island 2: the other nudges', () => {
  const ctx = (now: number, extra: Record<string, unknown> = {}) => ({ now, day: DAY, busy: false, idleSec: 10, activeSince: now - 70 * 60_000, store: EMPTY_NUDGES(), dismissed: {}, snooze: { now }, ...extra })
  it('eye break: a real 20 s countdown, only when eye breaks are on', () => {
    expect(eyesNudge({ ...ctx(at('14:00')), eyeBreaks: false, lastEyesAt: 0 })).toBeNull()
    const a = eyesNudge({ ...ctx(at('14:00')), eyeBreaks: true, lastEyesAt: 0 })!
    expect(a.nudge).toMatchObject({ type: 'timer', kind: 'eyes', seconds: 20 })
  })
  it('posture: at most 4 a day, an hour apart; a quiet tally', () => {
    expect(postureNudge(ctx(at('14:00')))?.text).toBe('Shoulders back, feet flat?')
    let s = tally(EMPTY_NUDGES(), DAY, 'posture', at('13:30'))
    expect(postureNudge(ctx(at('14:00'), { store: s }))).toBeNull()
    for (let i = 0; i < 4; i++) s = tally(s, DAY, 'postureFix', at('08:00'))
    expect(postureNudge(ctx(at('16:00'), { store: s }))).toBeNull()
  })
  it('breathing: box or 4-7-8 steps', () => {
    expect(breathAt('box', 0)).toMatchObject({ say: 'Breathe in', grow: true })
    expect(breathAt('box', 5)).toMatchObject({ say: 'Hold', grow: true })
    expect(breathAt('box', 9)).toMatchObject({ say: 'Breathe out', grow: false })
    expect(breathAt('478', 12)).toMatchObject({ say: 'Breathe out' })
    expect(breathAt('478', 19)).toMatchObject({ say: 'Breathe in' })
  })
  it('mood: twice a day at most, once per slot', () => {
    expect(moodNudge({ ...ctx(at('12:00')), moodSlotsDone: [] })?.nudge?.type).toBe('mood')
    expect(moodNudge({ ...ctx(at('12:00')), moodSlotsDone: ['noon'] })).toBeNull()
    expect(moodNudge({ ...ctx(at('16:00')), moodSlotsDone: [] })).toBeNull()
  })
  it('gratitude: in the evening, once', () => {
    expect(gratitudeNudge(ctx(at('20:30')))?.nudge?.type).toBe('gratitude')
    expect(gratitudeNudge(ctx(at('20:30'), { store: tally(EMPTY_NUDGES(), DAY, 'gratitude', at('20:00')) }))).toBeNull()
    expect(gratitudeNudge(ctx(at('15:00')))).toBeNull()
  })
  it('focus check-in: halfway through a timer, once', () => {
    const running = { subject: 'Algebra', startedAt: at('14:00'), endsAt: at('14:50') }
    expect(focusNudge({ now: at('14:20'), running, store: EMPTY_NUDGES(), day: DAY, dismissed: {} })).toBeNull()
    const a = focusNudge({ now: at('14:26'), running, store: EMPTY_NUDGES(), day: DAY, dismissed: {} })!
    expect(a.title).toBe('Still on Algebra?')
    expect(a.actions.map((x) => x.label)).toEqual(['✓ Yes', 'Drifted', 'Switch'])
    expect(focusNudge({ now: at('14:40'), running, store: EMPTY_NUDGES(), day: DAY, dismissed: {} })).toBeNull()
  })
  it('people: "Call Mom? Last call 9 days ago", Done records today', () => {
    const s = cleanNudgeStore({ prefs: { people: [{ id: 'm', name: 'Mom', everyDays: 7, last: '2026-10-26' }, { id: 'a', name: 'Alex', everyDays: 30, last: '2026-10-30' }] } })
    const a = personNudge(ctx(at('12:00'), { store: s }))!
    expect(a.title).toBe('Call Mom?')
    expect(a.text).toBe('Last call 9 days ago.')
    const done = personCalled(s, 'm', DAY)
    expect(done.prefs.people[0].last).toBe(DAY)
    expect(personNudge(ctx(at('12:00'), { store: done }))).toBeNull()
    expect(personNudge(ctx(at('21:00'), { store: s }))).toBeNull()
  })
  it('back after 5+ minutes away: "Moved?" once', () => {
    let st = { maxIdle: 0 }
    for (const sec of [30, 200, 420, 610]) st = { maxIdle: noteIdle(st, sec, 0).maxIdle }
    const r = noteIdle(st, 5, at('14:00'))
    expect(r.back).toEqual({ min: 10, at: at('14:00') })
    expect(noteIdle({ maxIdle: 120 }, 5, 0).back).toBeNull()
    const s = { ...EMPTY_NUDGES(), away: r.back }
    expect(awayNudge({ now: at('14:01'), store: s, dismissed: {}, busy: false })?.actions[0].label).toBe('✓ Walked 10 min')
    expect(awayNudge({ now: at('14:20'), store: s, dismissed: {}, busy: false })).toBeNull()
  })
})

describe("Island 2: Ben's challenge (IN49) and the move streak (IN51)", () => {
  it('the challenge comes from the biggest Sport Track target, with lines as you go and one bonus', () => {
    const ch = makeChallenge(EX)!
    expect(ch).toMatchObject({ ex: 'push', name: 'Push-ups', target: 100 })
    let s = EMPTY_NUDGES()
    s = addMove(s, log({ id: 'a', n: 30 }))
    expect(challengeView(ch, s, DAY)).toMatchObject({ done: 30, complete: false, text: 'Today: 100 push-ups in breaks · 30 so far' })
    expect(challengeLine(ch, 30)?.mark).toBe(25)
    expect(challengeLine({ ...ch, said: [25] }, 30)).toBeNull()
    expect(challengeLine(ch, 55)?.line).toBe('Halfway: 55 of 100 push-ups.')
    s = addMove(s, log({ id: 'b', n: 70 }))
    expect(challengeView(ch, s, DAY).complete).toBe(true)
    expect(challengeBonus(ch, 100)).toBe('pay')
    expect(challengeBonus({ ...ch, paid: 5 }, 100)).toBeNull()
    // An undo below the target takes the bonus back.
    expect(challengeBonus({ ...ch, paid: 5 }, undoMove(s, 'b').store.logs.filter((l) => !l.undone).reduce((t, l) => t + l.n, 0))).toBe('undo')
  })
  it('streak: days with 3+ breaks', () => {
    const s = cleanNudgeStore({ days: { '2026-11-01': { moves: 3 }, '2026-11-02': { moves: 4 }, '2026-11-03': { moves: 3 }, '2026-11-04': { moves: 1 } } })
    expect(moveStreak(s, DAY)).toBe(3)
    const s2 = cleanNudgeStore({ ...s, days: { ...s.days, [DAY]: { moves: 3 } } })
    expect(moveStreak(s2, DAY)).toBe(4)
    expect(moveStreak(cleanNudgeStore({ days: { '2026-11-02': { moves: 3 } } }), DAY)).toBe(0)
  })
  it('the pill: ring, challenge bar, streak, "+3" for a few seconds, and a moment on a new best', () => {
    let s = cleanNudgeStore({ days: { '2026-11-02': { moves: 3 }, '2026-11-03': { moves: 3 } }, best: 2 })
    s = { ...s, days: { ...s.days, [DAY]: { ...dayOf(s, DAY), challenge: makeChallenge(EX) } } }
    s = addMove(addMove(addMove(s, log({ id: 'a' })), log({ id: 'b' })), log({ id: 'c', at: at('14:30') }))
    const p = movePill(s, DAY, at('14:30') + 2000)
    expect(p).toMatchObject({ done: 60, goal: 100, unit: 'reps', breaks: 3, streak: 3, best: 3, challenge: { name: 'Push-ups', done: 60, target: 100 } })
    expect(p.plus?.coins).toBe(3)
    expect(movePill(s, DAY, at('14:31')).plus).toBeNull()
    const prev = { ...EMPTY_ISLAND, at: 1, locked: false, move: { ...p, best: 2, streak: 2 } }
    const cur = { ...EMPTY_ISLAND, at: 2, locked: false, move: p }
    expect(momentsFrom(prev, cur, at('14:30')).map((m) => m.text)).toContain('Best move streak: 3 days')
  })
  it('the saved store is cleaned (old logs dropped, bad values fixed)', () => {
    const s = cleanNudgeStore({ prefs: { sitMin: 5, ringGoal: 'x', people: [{ name: '  Mom ', everyDays: 400 }] }, logs: [log({ day: '2026-10-01' }), log()] }, DAY)
    expect(s.prefs.sitMin).toBe(20)
    expect(s.prefs.ringGoal).toBe(100)
    expect(s.prefs.people[0]).toMatchObject({ name: 'Mom', everyDays: 90 })
    expect(s.logs.length).toBe(1)
  })
})
