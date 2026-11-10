import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ALL_GEAR, allowed, cleanGear, needText, pickToday, setGear, type Gear } from './trainGear'
import { applyOffer, trackerLog, trackerToday } from './sportTrain'
import { gearPlan, makeStep, swapView } from './trainSwap'
import { sessionItems, trainOf, mergeTrain } from './trainLog'

// Made-up data only. 2026-11-10 is a Tuesday (Upper in the default week).
const TUE = '2026-11-10'
const NONE: Omit<Gear, 'at'> = { table: 'none', chair: false, bed: false, wall: false, towel: false, backpack: false, bar: false, bands: false, dumbbells: false, rings: false }
const gear = (o: Partial<Omit<Gear, 'at'>>): Gear => ({ ...NONE, ...o, at: 1 })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${TUE}T08:30:00Z`))
})
afterEach(() => vi.useRealTimers())

/** The pull move a fresh plan picks for this gear. */
const pullFor = (g: Gear | null) => {
  const st: any = { trainGear: g }
  return sessionItems(st, trainOf(st), 'upper', TUE).find((i) => i.ladder.id === 'pull')!.level.move
}

describe('the plan only uses moves your gear allows', () => {
  it('not set yet: nothing is ruled out (table rows, as before)', () => {
    expect(pullFor(null)).toBe('table_row')
    expect(allowed('pullup', null)).toBe(true)
  })

  it('a sturdy table: table rows', () => {
    expect(pullFor(gear({ table: 'sturdy' }))).toBe('table_row')
  })

  it('a weak desk or no table never means table rows: bar, then bands, then door towel, then backpack, then floor pulls', () => {
    for (const table of ['weak', 'none'] as const) {
      expect(pullFor(gear({ table, bar: true, bands: true, towel: true, backpack: true }))).toBe('neg_pullup')
      expect(pullFor(gear({ table, bands: true, towel: true, backpack: true }))).toBe('band_row')
      expect(pullFor(gear({ table, towel: true, backpack: true }))).toBe('towel_row')
      expect(pullFor(gear({ table, backpack: true }))).toBe('backpack_row')
      expect(pullFor(gear({ table }))).toBe('floor_pull')
    }
  })

  it('a sturdy table and no bar: the chain stops before the pull-ups, never on one', () => {
    const st: any = { trainGear: gear({ table: 'sturdy' }), trainLevels: { pull: { level: 4, reached: { 4: '2026-10-01' }, at: 1 } } }
    const it = sessionItems(st, trainOf(st), 'upper', TUE).find((i) => i.ladder.id === 'pull')!
    expect(it.level.move).toBe('feet_row')
    expect(it.swapped).toBe(true)
  })

  it('push: decline push-ups need a bed or a chair; with neither, the plan stays on the floor', () => {
    const at = (g: Gear) => {
      const st: any = { trainGear: g, trainLevels: { push: { level: 3, reached: { 3: '2026-10-01' }, at: 1 } } }
      return sessionItems(st, trainOf(st), 'upper', TUE).find((i) => i.ladder.id === 'push')!.level.move
    }
    expect(at(gear({ bed: true }))).toBe('decline_pushup')
    expect(at(gear({ chair: true }))).toBe('decline_pushup')
    expect(at(gear({}))).toBe('diamond_pushup')
  })

  it('legs: Bulgarian squats need a chair or a bed; wall handstands need a wall', () => {
    const st: any = { trainGear: gear({}), trainLevels: { single: { level: 2, reached: { 2: '2026-10-01' }, at: 1 }, shoulders: { level: 3, reached: { 3: '2026-10-01' }, at: 1 } } }
    const d = trainOf(st)
    expect(sessionItems(st, d, 'legs', TUE).find((i) => i.ladder.id === 'single')!.level.move).toBe('split_squat')
    expect(sessionItems(st, d, 'upper', TUE).find((i) => i.ladder.id === 'shoulders')!.level.move).toBe('pike_pushup')
    const st2: any = { ...st, trainGear: gear({ chair: true, wall: true }) }
    expect(sessionItems(st2, trainOf(st2), 'legs', TUE).find((i) => i.ladder.id === 'single')!.level.move).toBe('bulgarian_squat')
    expect(sessionItems(st2, trainOf(st2), 'upper', TUE).find((i) => i.ladder.id === 'shoulders')!.level.move).toBe('wall_hspu_neg')
  })

  it('no plan row ever needs gear you do not own, for every combination of the main gear', () => {
    const flags = ['chair', 'bed', 'wall', 'bar', 'bands', 'backpack'] as const
    for (const table of ['sturdy', 'weak', 'none'] as const)
      for (let m = 0; m < 1 << flags.length; m++) {
        const g = gear({ table, ...Object.fromEntries(flags.map((f, i) => [f, !!(m & (1 << i))])) })
        for (const r of gearPlan({}, g, TUE)) expect(allowed(r.move, g), `${JSON.stringify(g)} -> ${r.move}`).toBe(true)
      }
  })

  it('needText says it in words', () => {
    expect(needText('pushup')).toBe('floor')
    expect(needText('decline_pushup')).toBe('chair or bed')
    expect(needText('band_pullup')).toBe('pull-up bar + bands')
  })

  it('cleanGear: nothing saved is null; a saved value is made valid', () => {
    expect(cleanGear(undefined)).toBeNull()
    expect(cleanGear({ table: 'oops', bar: 1, at: 'x' })).toMatchObject({ table: 'sturdy', bar: true, chair: true, at: 0 })
    expect(ALL_GEAR.table).toBe('sturdy')
  })
})

describe('the Gear page shows your plan with this gear', () => {
  it('a weak desk turns the pull row from table rows into a bar move, and says so', () => {
    const before = gearPlan({}, gear({ table: 'sturdy', bar: true }), TUE).find((r) => r.ladder === 'pull')!
    const after = gearPlan({}, gear({ table: 'weak', bar: true }), TUE).find((r) => r.ladder === 'pull')!
    expect(before).toMatchObject({ move: 'table_row', tag: 'uses sturdy table' })
    expect(after).toMatchObject({ move: 'neg_pullup', tag: 'desk skipped' })
    const none = gearPlan({}, gear({ table: 'weak' }), TUE).find((r) => r.ladder === 'pull')!
    expect(none).toMatchObject({ move: 'floor_pull', tag: 'desk skipped' })
  })
  it('setGear saves it on the state with the time, and the engine follows', () => {
    const st: any = {}
    setGear(st, { ...NONE, table: 'weak', bar: true }, 5)
    expect(st.trainGear).toMatchObject({ table: 'weak', bar: true, at: 5 })
    expect(trackerToday(st, TUE).items.find((i) => i.ladder.id === 'pull')!.name).toBe('Slow negative pull-ups')
  })
  it('gear merges between devices: the newer edit wins', () => {
    const a = { trainGear: { ...NONE, bar: true, at: 1 } }
    const b = { trainGear: { ...NONE, bands: true, at: 2 } }
    expect((mergeTrain(a, b).trainGear as any).bands).toBe(true)
    expect((mergeTrain(b, a).trainGear as any).bands).toBe(true)
  })
})

describe('the swap sheet', () => {
  const st0 = (): any => ({ trainLevels: { push: { level: 2, reached: { 2: '2026-11-05' }, at: 1 } } })

  it('lists easier steps, your step, the next one and a side option, with the locked ones only named', () => {
    const v = swapView(st0(), 'push', TUE)!
    expect(v.options.map((o) => `${o.kind}:${o.move}`)).toEqual(['easier:knee_pushup', 'easier:pushup', 'yours:diamond_pushup', 'next:decline_pushup', 'side:wide_pushup'])
    expect(v.options.find((o) => o.kind === 'yours')!.label).toBe('Your step · 3')
    expect(v.options.find((o) => o.kind === 'next')!.label).toMatch(/^Next · step 4/)
    expect(v.locked).toEqual(['Archer push-ups', 'Pseudo-planche push-ups', 'One-arm push-up negatives'])
    expect(v.options.every((o) => !!o.name && !!o.line && o.rest > 0)).toBe(true)
  })

  it('hides moves that need gear you do not have (never listed: the next step is the next one you can do)', () => {
    const st = { ...st0(), trainGear: gear({}) }
    const v = swapView(st, 'push', TUE)!
    expect(v.options.map((o) => o.move)).not.toContain('decline_pushup')
    expect(v.options.map((o) => o.move)).toEqual(['knee_pushup', 'pushup', 'diamond_pushup', 'archer_pushup', 'wide_pushup'])
    // The pull chain with a weak desk: no table rows or feet rows anywhere.
    const p = swapView({ trainGear: gear({ table: 'weak', bands: true, towel: true }) }, 'pull', TUE)!
    expect(p.options.map((o) => o.move).filter((m) => m === 'table_row' || m === 'feet_row')).toEqual([])
    expect(p.yours.move).toBe('band_row')
  })

  it('"Use today" changes today only: your step and the logs stay, tomorrow is your step again', () => {
    const st = st0()
    pickToday(st, { day: TUE, ladder: 'push', level: { move: 'decline_pushup', lo: 6, hi: 12, unit: 'reps' }, now: 10 })
    expect(trackerToday(st, TUE).items[0]).toMatchObject({ name: 'Decline push-ups', picked: true, offer: null })
    expect(st.trainLevels.push.level).toBe(2)
    expect(trackerToday(st, '2026-11-12').items[0].name).toBe('Diamond push-ups')
    // A set logged today goes to the picked move.
    trackerLog(st, { day: TUE, type: 'upper', ladder: 'push', reps: 8, feel: 'ok', now: Date.parse(`${TUE}T09:00:00Z`) })
    expect(trackerToday(st, TUE).items[0].done.map((s) => s.reps)).toEqual([8])
    expect(swapView(st, 'push', TUE)!.picked).toBe(true)
  })

  it('"Make it my step" moves your level (history stays) and ends today\'s pick; going down waits for a newer session', () => {
    const st = st0()
    pickToday(st, { day: TUE, ladder: 'push', level: { move: 'decline_pushup', lo: 6, hi: 12, unit: 'reps' }, now: 10 })
    expect(makeStep(st, { day: TUE, ladder: 'push', index: 3, now: 11 })).toBe(true)
    expect(st.trainLevels.push.level).toBe(3)
    expect(st.trainLevels.push.reached['2']).toBe('2026-11-05')
    expect(trackerToday(st, TUE).items[0]).toMatchObject({ name: 'Decline push-ups', picked: false })
    expect(makeStep(st, { day: TUE, ladder: 'push', index: 1, now: 12 })).toBe(true)
    expect(st.trainLevels.push.declinedOn).toBe(TUE)
    // A move you cannot do with your gear is refused.
    const g = { ...st0(), trainGear: gear({}) }
    expect(makeStep(g, { day: TUE, ladder: 'push', index: 3, now: 1 })).toBe(false)
  })

  it('Apply from next workout keeps today on the move you started', () => {
    const st: any = { trainLevels: { push: { level: 2, reached: { 2: '2026-11-03' }, at: 1 } }, exercises: [{ id: 'ex_d', name: 'Diamond push-ups', target: 18, unit: 'reps', active: false, doneToday: 0, move: 'diamond_pushup' }], sets: {} }
    for (const day of ['2026-11-05', '2026-11-08']) st.sets[day] = { ex_d: [12, 12, 12].map((r, i) => ({ reps: r, at: Date.parse(`${day}T10:00:00Z`) + i, id: `${day}${i}`, feel: 'easy', rir: 4 })) }
    const it = sessionItems(st, trainOf(st), 'upper', TUE).find((i) => i.ladder.id === 'push')!
    expect(it.offer?.move).toBe('decline_pushup')
    expect(applyOffer(st, { day: TUE, type: 'upper', ladder: 'push', now: 20, fromNext: true })).not.toBeNull()
    expect(st.trainLevels.push.level).toBe(3)
    expect(trackerToday(st, TUE).items[0].name).toBe('Diamond push-ups')
    expect(trackerToday(st, '2026-11-12').items[0].name).toBe('Decline push-ups')
  })
})
