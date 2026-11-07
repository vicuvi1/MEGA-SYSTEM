// The three island fixes, with pinned clocks and default settings:
// - the screen-time break works without "Let Ben see what I'm doing";
// - water reminders come when you are behind the day's pace, never in a meeting;
// - no to-do shows twice.
import { describe, expect, it } from 'vitest'
import { decideCoach, newCoachState, type CoachInput } from './pcCoach'
import { dayNudge, nudgeWhy, type DayNudgeInput } from './dayNudges'
import { cleanNudgeStore } from './islandNudges'
import { DEFAULT_ISLAND_PREFS, alertGate } from './islandModel'
import { modeGate } from './islandCalm'
import { waterBehindPace } from './healthyDay'
import { dedupeTodos, normTitle } from './islandTodos'

const DAY = '2026-11-04'
const at = (hm: string) => Date.parse(`${DAY}T${hm}:00`)
const min = (n: number) => n * 60_000

describe('screen-time break with default settings (the app sensor is off)', () => {
  const coach = (now: number, more: Partial<CoachInput> = {}): CoachInput => ({
    now,
    day: DAY,
    on: false,
    desktop: true,
    sessions: [],
    idleSec: 5,
    activeSince: now - min(55),
    dayWork: { min: 0, by: {}, distractMin: 0 },
    workGoalMin: 120,
    push: 'push',
    focus: null,
    block: null,
    workHour: false,
    meeting: false,
    bedTarget: '23:30',
    wakeTime: '06:30',
    bedLogged: false,
    nextUp: null,
    lastMoveAt: 0,
    morningShown: true,
    eveningAt: '21:00',
    ...more
  })
  const fresh = () => ({ ...newCoachState(DAY), morning: true })

  it('says how long you have been on the screen after about 50 minutes of active time', () => {
    const now = at('15:00')
    const r = decideCoach(coach(now), fresh())
    expect(r.reaction?.kind).toBe('break')
    expect(r.reaction?.title).toBe('Screen break')
    expect(r.reaction?.text).toMatch(/55 min/)
    expect(decideCoach(coach(now, { activeSince: now - min(30) }), fresh()).reaction?.kind).not.toBe('break')
  })
  it('keeps still in meetings and focus timers, and waits after you moved', () => {
    const now = at('15:00')
    expect(decideCoach(coach(now, { meeting: true }), fresh()).reaction).toBeNull()
    expect(decideCoach(coach(now, { focus: { subject: 'Rust' } }), fresh()).reaction?.kind).not.toBe('break')
    expect(decideCoach(coach(now, { lastMoveAt: now - min(10) }), fresh()).reaction?.kind).not.toBe('break')
  })
  it('peeks in Calm, quietly, and is dropped in quiet hours', () => {
    const now = at('15:00')
    const kind = 'move' // coachAlertKind('break')
    const gate = (quiet: boolean) => alertGate({ kind, prefs: DEFAULT_ISLAND_PREFS, quiet, call: false, lastPeekAt: 0, now })
    expect(modeGate({ mode: 'calm', kind, peekFor: DEFAULT_ISLAND_PREFS.peekFor, base: gate(false) })).toBe('peek')
    expect(gate(true)).toBe('drop')
  })
  it('still asks once to switch the sensor on, when no break is due', () => {
    const now = at('11:00')
    expect(decideCoach(coach(now, { activeSince: now - min(10) }), fresh()).reaction?.kind).toBe('setup')
  })
})

describe('water reminders', () => {
  const input = (now: number, more: Partial<DayNudgeInput> = {}): DayNudgeInput => ({
    now,
    day: DAY,
    ctx: { now, call: false, focus: false, event: false, asleep: false },
    shown: [],
    queue: [],
    dismissed: {},
    reminders: [],
    idleSec: 5,
    activeSince: now - min(20),
    firstActiveAt: now - min(300),
    wakeLogged: true,
    wakeTime: '06:40',
    firstBlock: null,
    blockStarted: true,
    bedAuto: null,
    bedTarget: '23:00',
    bedLogged: false,
    store: cleanNudgeStore(null),
    lastMoveAt: now - min(10),
    lastEyesAt: 0,
    lastWaterAt: 0,
    exercises: [],
    coins: 3,
    eyeBreaks: false,
    running: null,
    moodSlots: ['noon', 'evening'],
    lowMood: false,
    snooze: { now },
    water: { ml: 250, target: 2500 },
    eveningAt: '21:00',
    recap: { mustDone: 0, mustTotal: 0, waterMl: 250, waterTarget: 2500, focusMin: 0, focusGoal: 100 },
    eveningSent: true,
    ...more
  })

  it('knows when you are behind the day pace', () => {
    expect(waterBehindPace(at('15:00'), 250, 2500)).toBe(true)
    expect(waterBehindPace(at('15:00'), 1500, 2500)).toBe(false)
    expect(waterBehindPace(at('15:00'), 2500, 2500)).toBe(false)
  })
  it('reminds when behind, after 60 minutes, and a logged glass clears it', () => {
    const now = at('15:00')
    const r = dayNudge(input(now, { lastWaterAt: now - min(65) }))
    expect(r.alert?.kind).toBe('water')
    // Not yet 60 minutes since the last glass.
    expect(dayNudge(input(now, { lastWaterAt: now - min(45) })).alert?.kind).not.toBe('water')
    // A glass just logged (and the total up): nothing.
    expect(dayNudge(input(now, { lastWaterAt: now - min(1), water: { ml: 500, target: 2500 } })).alert?.kind).not.toBe('water')
    // Peeks in Calm.
    const kind = r.alert!.kind
    const base = alertGate({ kind, prefs: DEFAULT_ISLAND_PREFS, quiet: false, call: false, lastPeekAt: 0, now })
    expect(modeGate({ mode: 'calm', kind, peekFor: DEFAULT_ISLAND_PREFS.peekFor, base })).toBe('peek')
  })
  it('is held back in a meeting, with the reason', () => {
    const now = at('15:00')
    const i = input(now, { lastWaterAt: now - min(120), ctx: { now, call: true, focus: false, event: false, asleep: false } })
    const r = dayNudge(i)
    expect(r.alert?.kind).not.toBe('water')
    expect(r.queue.some((q) => q.topic === 'water')).toBe(true)
    expect(nudgeWhy(i, r).water).toMatch(/call/)
  })
  it('stays quiet at night (quiet hours drop it)', () => {
    const now = at('22:30')
    expect(dayNudge(input(now, { lastWaterAt: 0 })).alert?.kind).not.toBe('water')
    expect(alertGate({ kind: 'water', prefs: DEFAULT_ISLAND_PREFS, quiet: true, call: false, lastPeekAt: 0, now })).toBe('drop')
  })
  it('says why when it is too soon', () => {
    const now = at('15:00')
    const i = input(now, { lastWaterAt: now - min(20) })
    expect(nudgeWhy(i, dayNudge(i)).water).toMatch(/20 min ago/)
  })
})

describe('no to-do twice', () => {
  it('ignores case, emoji and end punctuation in a title', () => {
    expect(normTitle('  📚 Read Chapter 3! ')).toBe(normTitle('read chapter 3'))
  })
  it('shows a task once across must-dos, top 3, Todoist and the plan', () => {
    const r = dedupeTodos({
      mustdos: [{ i: 0, text: 'Call the bank', done: false }, { i: 1, text: 'call the bank.', done: false }, { i: 2, text: 'Gym', done: false }],
      top: [{ i: 0, text: 'GYM', done: false }, { i: 1, text: 'Finish essay', done: false }],
      todoist: [
        { id: 't1', content: 'Finish essay', time: null },
        { id: 't2', content: 'Buy milk', time: '17:00' },
        { id: 't2', content: 'Buy milk (again)', time: '17:00' },
        { id: 't3', content: '🥛 buy MILK', time: null },
        { id: 't4', content: 'Plan trip', time: null },
        { id: 't5', content: 'Water plants', time: null },
        { id: 't6', content: 'Email Sam', time: null }
      ],
      plan: ['Water plants']
    })
    expect(r.mustdos.map((m) => m.i)).toEqual([0, 2])
    expect(r.top.map((m) => m.text)).toEqual(['Finish essay'])
    expect(r.todoist.map((t) => t.id)).toEqual(['t2', 't4', 't6'])
    const all = [...r.mustdos.map((m) => m.text), ...r.top.map((m) => m.text), ...r.todoist.map((t) => t.content)].map(normTitle)
    expect(new Set(all).size).toBe(all.length)
  })
})
