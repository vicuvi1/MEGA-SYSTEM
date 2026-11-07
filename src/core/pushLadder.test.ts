// DX4: the push ladder climbs in 3 steps with its own sounds, follows the
// area's push level, holds in quiet hours and meetings, resets on start, and
// never follows a Skip. Made-up blocks, pinned clock.
import { describe, expect, it } from 'vitest'
import { cleanLadder, DEFAULT_LADDER, ladderKey, ladderTick, ladderTrigger, ladderTuning, type LadderState } from './pushLadder'

const T0 = new Date('2026-03-10T10:00:00').getTime()
const min = (m: number) => T0 + m * 60_000
const trig = { key: 'ev1', title: 'Lab 4', why: 'late' as const, since: T0 }
const base = { prefs: DEFAULT_LADDER, level: 'normal' as const, trigger: trig, started: false, quiet: false, meeting: false }

function climb(level: 'soft' | 'normal' | 'hard', minutes: number[]) {
  let state: LadderState | null = null
  const fired: { at: number; step: number; sound: string }[] = []
  for (const m of minutes) {
    const r = ladderTick({ ...base, level, now: min(m), state })
    state = r.state
    if (r.fire) fired.push({ at: m, step: r.fire.step, sound: r.fire.sound })
  }
  return { fired, state }
}

describe('push ladder', () => {
  it('climbs chime → alarm → Ben (normal: 8 min apart), each step its own sound, once each', () => {
    const { fired } = climb('normal', Array.from({ length: 40 }, (_, i) => i))
    expect(fired).toEqual([
      { at: 0, step: 1, sound: 'push1' },
      { at: 8, step: 2, sound: 'push2' },
      { at: 16, step: 3, sound: 'push3' }
    ])
  })

  it('hard climbs sooner; soft waits, starts later and stops at step 2 (no stake, no Telegram)', () => {
    expect(climb('hard', Array.from({ length: 30 }, (_, i) => i)).fired.map((f) => f.at)).toEqual([0, 5, 10])
    const soft = climb('soft', Array.from({ length: 60 }, (_, i) => i)).fired
    expect(soft.map((f) => [f.at, f.step])).toEqual([[2, 1], [17, 2]])
    expect(ladderTuning('soft').top).toBe(2)
  })

  it('step 3 has the voice line (no emoji) and the Telegram text with a stake offer', () => {
    let state: LadderState | null = { key: 'ev1', title: 'Lab 4', why: 'late', step: 2, at: min(8) }
    const r = ladderTick({ ...base, now: min(16), state })
    expect(r.fire?.step).toBe(3)
    expect(r.fire?.voice).toBeTruthy()
    expect(r.fire?.voice).not.toMatch(/😤/)
    expect(r.fire?.telegram).toMatchObject({ stake: true })
    expect(r.fire?.telegram?.text).toMatch(/Lab 4/)
    state = r.state
    // Without voice / Telegram / stake.
    const quietBen = ladderTick({ ...base, prefs: { ...DEFAULT_LADDER, voice: false, telegram: false }, now: min(16), state: { ...state!, step: 2, at: min(8) } })
    expect(quietBen.fire?.voice).toBeNull()
    expect(quietBen.fire?.telegram).toBeNull()
  })

  it('resets the moment you start, or when the trigger is gone; a new block starts over', () => {
    const s: LadderState = { key: 'ev1', title: 'Lab 4', why: 'late', step: 2, at: min(8) }
    expect(ladderTick({ ...base, now: min(9), state: s, started: true })).toEqual({ state: null, fire: null })
    expect(ladderTick({ ...base, now: min(9), state: s, trigger: null })).toEqual({ state: null, fire: null })
    const other = ladderTick({ ...base, now: min(30), state: s, trigger: { ...trig, key: 'ev2', title: 'Essay', since: min(30) } })
    expect(other.fire?.step).toBe(1)
    expect(other.fire?.title).toBe('Essay')
  })

  it('holds in quiet hours and meetings, then fires one step (not several) and waits the full gap', () => {
    let state: LadderState | null = null
    state = ladderTick({ ...base, now: min(0), state, meeting: true }).state
    expect(state?.step).toBe(0)
    const after = ladderTick({ ...base, now: min(30), state })
    expect(after.fire?.step).toBe(1)
    expect(ladderTick({ ...base, now: min(31), state: after.state }).fire).toBeNull()
    expect(ladderTick({ ...base, now: min(38), state: after.state }).fire?.step).toBe(2)
    expect(ladderTick({ ...base, now: min(0), state: null, quiet: true }).fire).toBeNull()
  })

  it('off means nothing', () => {
    expect(ladderTick({ ...base, prefs: { ...DEFAULT_LADDER, on: false }, now: min(0), state: null })).toEqual({ state: null, fire: null })
  })

  it('finds the trigger: drift first; a block 12+ min in with no timer; never after Skip, start, or during "10 min later"', () => {
    const blocks = [{ id: 'ev1', title: 'Lab 4', start: min(0), end: min(60), focus: true }]
    expect(ladderTrigger({ now: min(5), drift: null, blocks, running: false, answers: {} })).toBeNull()
    expect(ladderTrigger({ now: min(13), drift: null, blocks, running: false, answers: {} })).toEqual({ key: 'ev1', title: 'Lab 4', why: 'late', since: min(12) })
    expect(ladderTrigger({ now: min(13), drift: null, blocks, running: true, answers: {} })).toBeNull()
    expect(ladderTrigger({ now: min(13), drift: null, blocks, running: false, answers: { 'checkin:ev1': { ans: 'skip' } } })).toBeNull()
    expect(ladderTrigger({ now: min(13), drift: null, blocks, running: false, answers: { 'checkin:ev1': { ans: 'later', until: min(20) } } })).toBeNull()
    expect(ladderTrigger({ now: min(21), drift: null, blocks, running: false, answers: { 'checkin:ev1': { ans: 'later', until: min(20) } } })?.key).toBe('ev1')
    // An event (not a focus block) or one ending in under 10 minutes: no ladder.
    expect(ladderTrigger({ now: min(13), drift: null, blocks: [{ ...blocks[0], focus: false }], running: false, answers: {} })).toBeNull()
    expect(ladderTrigger({ now: min(55), drift: null, blocks, running: false, answers: {} })).toBeNull()
    expect(ladderTrigger({ now: min(13), drift: { title: 'Essay', since: min(3) }, blocks, running: true, answers: {} })).toEqual({ key: 'drift:Essay', title: 'Essay', why: 'drift', since: min(3) })
  })

  it('cleans saved settings and keeps the Telegram key short', () => {
    expect(cleanLadder({ on: false, stake: 'x' })).toEqual({ ...DEFAULT_LADDER, on: false })
    expect(cleanLadder(null)).toEqual(DEFAULT_LADDER)
    expect(ladderKey('x'.repeat(100)).length).toBeLessThanOrEqual(60)
  })
})
