// "I stayed in front of the PC for an hour and got no notification to get up
// and do push-ups or drink water." The owner's hour, simulated minute by
// minute with DEFAULT settings: Calm mode, default "Peek for", "Let Ben see
// what I'm doing" off, a Sunday afternoon, active at the PC, no meetings,
// behind on water, no move break yet. Every gate decision is logged.
// Made-up data only.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dayNudge, nudgeWhy, whyNoReminder, type DayNudgeInput } from './dayNudges'
import { cleanNudgeStore } from './islandNudges'
import { DEFAULT_ISLAND_PREFS, alertGate } from './islandModel'
import { firstSight, modeGate, presentAs, type IslandMode, type Presentation } from './islandCalm'
import { noteShown, type Queued, type Shown } from './healthyDay'
import { pushStyle } from './lifeFit'

const DAY = '2026-11-08' // a Sunday
const at = (hm: string) => new Date(`${DAY}T${hm}:00`).getTime()
const min = (n: number) => n * 60_000
const hm = (t: number) => new Date(t).toTimeString().slice(0, 5)

interface Step { at: string; id: string; kind: string; gate: string; shows: Presentation; why: { water: string; move: string } }
interface Ctx { call?: boolean; focus?: boolean; event?: boolean; quiet?: boolean }

/** Runs the island's chain and its gates like IslandFeed + DesktopIsland do, nothing answered. */
function ownerHour(o: { from: string; to: string; activeFrom: string; mode?: IslandMode; ctx?: Ctx; water?: number; lastWater?: string }) {
  const mode = o.mode ?? DEFAULT_ISLAND_PREFS.mode
  const push = pushStyle('push')
  const store = cleanNudgeStore(null)
  let shown: Shown[] = []
  let queue: Queued[] = []
  let lastId: string | null = null
  let lastPeek = 0
  let seen: Record<string, number> = {}
  const log: Step[] = []
  for (let now = at(o.from); now <= at(o.to); now += min(1)) {
    vi.setSystemTime(now)
    const c = o.ctx ?? {}
    const i: DayNudgeInput = {
      now,
      day: DAY,
      ctx: { now, call: !!c.call, focus: !!c.focus, event: !!c.event, asleep: false },
      shown,
      queue,
      dismissed: {},
      reminders: [],
      idleSec: 5,
      activeSince: at(o.activeFrom),
      firstActiveAt: at('09:30'),
      wakeLogged: true,
      wakeTime: '09:00',
      firstBlock: null,
      blockStarted: false,
      bedAuto: null,
      bedTarget: '23:30',
      bedLogged: false,
      push: { perHour: push.perHour, escalate: push.escalate },
      store,
      lastMoveAt: 0,
      lastEyesAt: 0,
      lastWaterAt: at(o.lastWater ?? '11:00'),
      exercises: [{ id: 'pushups', name: 'Push-ups', target: 50, done: 0, unit: 'reps' }],
      coins: 3,
      doing: null,
      eyeBreaks: false,
      running: null,
      moodSlots: ['noon', 'evening'],
      lowMood: false,
      snooze: { now },
      water: { ml: o.water ?? 500, target: 2500 },
      eveningAt: '21:00',
      recap: { mustDone: 0, mustTotal: 0, waterMl: 500, waterTarget: 2500, focusMin: 0, focusGoal: 100 },
      eveningSent: true
    }
    const r = dayNudge(i)
    queue = r.queue
    const a = r.alert
    const appeared = !!a && a.id !== lastId
    lastId = a?.id ?? null
    shown = noteShown(shown, a, 'island', now, appeared)
    if (!a || !appeared) continue
    const f = firstSight(seen, a.id, now)
    seen = f.seen
    if (!f.fresh) continue
    const base = alertGate({ kind: a.kind, dot: !!a.dot, prefs: DEFAULT_ISLAND_PREFS, quiet: !!c.quiet, call: !!c.call, lastPeekAt: lastPeek, now })
    const gate = modeGate({ mode, kind: a.kind, id: a.id, peekFor: DEFAULT_ISLAND_PREFS.peekFor, base })
    if (gate === 'peek') lastPeek = now
    const why = nudgeWhy(i, r)
    log.push({ at: hm(now), id: a.id, kind: a.kind, gate, shows: presentAs({ mode, kind: a.kind, id: a.id, gate }), why: { water: why.water, move: why.move } })
  }
  return log
}

describe("the owner's hour at the PC (default settings, Sunday afternoon)", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }))
  afterEach(() => vi.useRealTimers())

  it('shows a real move-break card and a real water card, not only a faint line or a dot', () => {
    const log = ownerHour({ from: '14:00', to: '15:30', activeFrom: '14:00' })
    // The timeline (SIM_LOG=1 npx vitest run src/core/islandOwnerHour.test.ts --silent=false).
    if (process.env.SIM_LOG) console.log(log.map((s) => `${s.at} ${s.kind.padEnd(5)} ${s.gate.padEnd(6)} → ${s.shows.padEnd(4)} (${s.id}) · move: ${s.why.move} · water: ${s.why.water}`).join('\n'))
    const move = log.filter((s) => s.kind === 'move')
    const water = log.filter((s) => s.kind === 'water')
    expect(move.some((s) => s.shows === 'card')).toBe(true)
    expect(water.some((s) => s.shows === 'card')).toBe(true)
    // The first move card within 45–60 minutes of active time.
    const firstMove = move.find((s) => s.shows === 'card')!
    const minutesIn = (Number(firstMove.at.slice(0, 2)) * 60 + Number(firstMove.at.slice(3))) - 14 * 60
    expect(minutesIn).toBeGreaterThanOrEqual(45)
    expect(minutesIn).toBeLessThanOrEqual(60)
  })

  it('stays calm: at most 3 different cards an hour, no card twice, a step up only after 15 minutes', () => {
    const log = ownerHour({ from: '13:00', to: '17:00', activeFrom: '13:00', lastWater: '10:00' })
    const cards = log.filter((s) => s.shows === 'card' || s.shows === 'line')
    const family = (id: string) => id.replace(/:(?:dot|peek|sound|ben)$/, '')
    expect(new Set(cards.map((c) => c.id)).size).toBe(cards.length)
    for (const c of cards) {
      const t = at(c.at)
      const hour = cards.filter((x) => at(x.at) > t - min(60) && at(x.at) <= t)
      expect(new Set(hour.map((x) => family(x.id))).size).toBeLessThanOrEqual(3)
      const sameFamily = cards.filter((x) => x !== c && family(x.id) === family(c.id) && Math.abs(at(x.at) - t) < min(15))
      expect(sameFamily).toEqual([])
    }
  })

  it('still keeps still in a call, a focus timer, a class and quiet hours', () => {
    for (const ctx of [{ call: true }, { focus: true }, { event: true }]) {
      const log = ownerHour({ from: '14:00', to: '15:30', activeFrom: '14:00', ctx })
      expect(log.filter((s) => (s.kind === 'move' || s.kind === 'water') && s.shows !== 'none' && s.shows !== 'dot')).toEqual([])
    }
    const quiet = ownerHour({ from: '14:00', to: '15:30', activeFrom: '14:00', ctx: { quiet: true } })
    expect(quiet.filter((s) => s.kind === 'move' || s.kind === 'water').every((s) => s.shows === 'none')).toBe(true)
  })

  it('Calm stays calm for everything else (an eye break or the pulse is never a card)', () => {
    expect(presentAs({ mode: 'calm', kind: 'eyes', gate: 'peek' })).toBe('line')
    expect(presentAs({ mode: 'calm', kind: 'ben', gate: 'peek' })).toBe('line')
    expect(presentAs({ mode: 'calm', kind: 'pulse', gate: 'silent' })).toBe('dot')
    // Posture shares the move colour but stays the slim line.
    expect(presentAs({ mode: 'calm', kind: 'move', id: 'posture:2026-11-08:14', gate: 'peek' })).toBe('line')
    expect(presentAs({ mode: 'calm', kind: 'move', id: 'move:123:peek', gate: 'peek' })).toBe('card')
    expect(presentAs({ mode: 'calm', kind: 'move', id: 'coach:break:3', gate: 'peek' })).toBe('card')
  })

  it('Balanced shows the move break and water card too (never quieter than Calm), but not posture', () => {
    const peekFor = DEFAULT_ISLAND_PREFS.peekFor
    expect(modeGate({ mode: 'balanced', kind: 'move', id: 'move:1:peek', peekFor, base: 'peek' })).toBe('peek')
    expect(modeGate({ mode: 'balanced', kind: 'water', id: 'water:x:9', peekFor, base: 'peek' })).toBe('peek')
    expect(modeGate({ mode: 'balanced', kind: 'move', id: 'posture:x', peekFor, base: 'peek' })).toBe('silent')
    // "Peek for → Move breaks" off still wins.
    expect(modeGate({ mode: 'calm', kind: 'move', id: 'move:1:peek', peekFor: { ...peekFor, move: false }, base: 'peek' })).toBe('silent')
  })

  it('an unanswered card that comes back after another card waits as its dot', () => {
    let seen: Record<string, number> = {}
    const t = at('14:50')
    const a = firstSight(seen, 'move:1:peek', t)
    seen = a.seen
    expect(a.fresh).toBe(true)
    seen = firstSight(seen, 'water:x:10', t + min(10)).seen
    expect(firstSight(seen, 'move:1:peek', t + min(13)).fresh).toBe(false)
    // The next step of the same sitting is new.
    expect(firstSight(seen, 'move:1:sound', t + min(25)).fresh).toBe(true)
  })
})

describe('"Why no reminder?" in the panel', () => {
  it('says the move break and water reasons in one line, and nothing while both are showing', () => {
    expect(whyNoReminder({ move: 'at the PC 12 min (break after 50)', water: 'last glass or reminder 20 min ago (next after 60 min)' })).toBe('Move break: at the PC 12 min (break after 50) · Water: last glass or reminder 20 min ago (next after 60 min)')
    expect(whyNoReminder({ move: 'showing now', water: 'showing now' })).toBeNull()
    expect(whyNoReminder({ move: 'showing now as a dot' })).toBe('Move break: showing now as a dot')
  })
})
