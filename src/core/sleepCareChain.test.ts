// Sleep care inside the island's one chain (dayNudges.ts): the after-shift
// night replaces the bedtime wind-down (no duplicates), the morning light
// comes after the morning card, the eye break follows the screen-time
// interval and the posture nudge offers the desk drill. A made-up Thursday
// with an evening job 17:00–24:00 and a 23:30 bedtime.
import { describe, expect, it } from 'vitest'
import { dayNudge, type DayNudgeInput } from './dayNudges'
import { cleanNudgeStore } from './islandNudges'
import { afterShiftPlan } from './afterShift'
import { cleanLifeFit } from './lifeFit'
import { lightCard } from './sleepCare'
import { dayKey } from './dates'

const at = (h: number, m = 0, d = 0) => new Date(2026, 10, 5 + d, h, m).getTime() // Thursday 5 Nov 2026
const fit = cleanLifeFit({ latestBed: '00:00', work: { on: true, days: [1, 2, 3, 4, 5], from: '17:00', to: '24:00' } })

function input(now: number, o: Partial<DayNudgeInput> = {}): DayNudgeInput {
  const day = dayKey(new Date(now))
  return {
    now,
    day,
    ctx: { now, call: false, focus: false, event: false, asleep: false },
    shown: [],
    queue: [],
    dismissed: {},
    reminders: [],
    idleSec: 10,
    activeSince: now - 40 * 60_000,
    firstActiveAt: null,
    wakeLogged: true,
    wakeTime: '06:35',
    firstBlock: null,
    blockStarted: true,
    bedAuto: null,
    bedTarget: '23:30',
    bedLogged: false,
    latestBed: '00:00',
    store: cleanNudgeStore({ prefs: { on: { move: false, water: false, people: false, mood: false, gratitude: false, tidy: false, breathe: false, away: false, focus: false } } }),
    lastMoveAt: now,
    lastEyesAt: now - 13 * 60_000,
    lastWaterAt: now,
    exercises: [],
    coins: 0,
    eyeBreaks: false,
    running: null,
    moodSlots: [],
    lowMood: false,
    snooze: { now },
    water: { ml: 2500, target: 2500 },
    eveningAt: '21:00',
    recap: { mustDone: 0, mustTotal: 0, waterMl: 0, waterTarget: 2500, focusMin: 0, focusGoal: 50 },
    eveningSent: true,
    ...o
  }
}

describe('sleep care in the island chain', () => {
  const plan = afterShiftPlan(fit, '2026-11-05', '23:30')
  const care = (_now: number) => ({ afterShift: { plan, done: [], ctf: false } })
  it('a late-shift night: no bedtime wind-down at 23:00, the after-shift card at 00:05, nothing "still up" before lights out', () => {
    expect(dayNudge(input(at(23, 0))).alert?.kind).toBe('winddown') // without the plan: the usual wind-down
    expect(dayNudge(input(at(23, 0), { care: care(at(23, 0)) })).alert).toBeNull()
    const a = dayNudge(input(at(0, 5, 1), { care: care(at(0, 5, 1)) })).alert
    expect(a?.id).toBe('aftershift:2026-11-05')
    expect(dayNudge(input(at(0, 5, 1))).alert?.kind).toBe('late') // without the plan: "Still up?" at your latest bedtime
    // From lights out (00:20) the late nudges count: "Still up?" at +30.
    expect(dayNudge(input(at(0, 30, 1), { care: care(at(0, 30, 1)) })).alert).toBeNull()
    expect(dayNudge(input(at(0, 52, 1), { care: care(at(0, 52, 1)) })).alert?.title).toBe('Still up?')
  })
  it('the morning light comes after the wake-up, once the morning card is done', () => {
    const now = at(7, 10)
    const light = lightCard({ now, day: '2026-11-05', wakeTime: '06:35', wakeTarget: '06:30', done: false, dismissed: {} })
    expect(dayNudge(input(now, { care: { light } })).alert?.id).toBe('light:2026-11-05')
  })
  it('eye breaks follow the screen-time interval; the posture nudge becomes the drill', () => {
    const now = at(15, 0)
    const noPosture = cleanNudgeStore({ prefs: { on: { move: false, water: false, people: false, mood: false, gratitude: false, tidy: false, breathe: false, away: false, focus: false, posture: false } } })
    const eyes = dayNudge(input(now, { store: noPosture, eyeBreaks: true, care: { eyes: { everyMin: 12, tip: { kind: 'blink', title: 'Eyes · blink and look far', text: 'Blink.' } } } })).alert
    expect(eyes?.title).toBe('Eyes · blink and look far')
    expect(dayNudge(input(now, { store: noPosture, eyeBreaks: true, care: { eyes: { everyMin: 20, tip: null } } })).alert).toBeNull()
    const drill = dayNudge(input(now, { care: { drill: true } })).alert
    expect(drill?.nudge?.type).toBe('drill')
  })
})
