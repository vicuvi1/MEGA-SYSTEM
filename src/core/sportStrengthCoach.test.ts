// The strength coach: best-set placement, strength as the default, "too easy / too hard", effort, rest and the plan.
// Made-up histories with a pinned date.
import { describe, expect, it } from 'vitest'
import { addSets, shiftDay, type SetLog } from './sportSets'
import { placeFamily, type HistoryInput } from './sportLevels'
import { addFeel, coachFor, effortAvg, mergeEffort, mergeFeel, resetFeel, setEffort, signalFor } from './sportCoach'
import { modeOf, needFor, rangeFor, restFor, strengthTarget } from './sportProgress'
import { moveById, FAMILIES } from './sportMoves'
import { buildSession } from './sportProgram'
import { migrateRoutine } from './sportRoutine'
import { heroLevel, placementFor, strengthTargetFor } from './sportKit'

const TODAY = '2026-11-07'
const ago = (n: number) => shiftDay(TODAY, -n)
const EX = [{ id: 'pu', name: 'Push-ups', target: 50, active: true }]

function hist(rows: [number, string, number[]][], exercises: any[] = EX): HistoryInput {
  let sets: SetLog = {}
  const days: Record<string, Record<string, number>> = {}
  for (const [n, id, reps] of rows) {
    sets = addSets(sets, ago(n), id, reps, Date.parse(ago(n) + 'T10:00:00Z'))
    days[ago(n)] = { ...(days[ago(n)] ?? {}), [id]: (days[ago(n)]?.[id] ?? 0) + reps.reduce((a, b) => a + b, 0) }
  }
  return { exercises, days, sets, today: TODAY }
}

describe('best set placement', () => {
  it('one set of 50 push-ups places you on a hard variation at once', () => {
    const p = placeFamily(hist([[0, 'pu', [50]]]), 'pushup')!
    expect(p.level).toBeGreaterThanOrEqual(10) // Diamond or harder
    expect(['diamond_pushup', 'decline_pushup', 'archer_pushup']).toContain(p.lv!.move)
    expect(p.best!.top).toBe(50)
  })
  it('a small single set stays near the start, and day totals alone are not read as one big set', () => {
    expect(placeFamily(hist([[0, 'pu', [8]]]), 'pushup')!.level).toBeLessThanOrEqual(5)
    const est = { exercises: EX, days: { [TODAY]: { pu: 50 } }, sets: {}, today: TODAY }
    expect(placeFamily(est, 'pushup')!.level).toBeLessThan(10)
  })
  it('the hero helper gives rank and places', () => {
    const h = heroLevel(hist([[0, 'pu', [50]]]))
    expect(h.top!.family).toBe('pushup')
    expect(h.rank.rank.name).toBeTruthy()
    expect(placementFor(hist([[0, 'pu', [50]]]), 'pushup')!.level).toBe(h.top!.level)
  })
  it('the ladders got harder steps at the top', () => {
    expect(FAMILIES.pushup.steps.at(-1)).toBe('one_arm_pushup')
    expect(FAMILIES.row.steps.at(-1)).toBe('one_arm_row')
    expect(FAMILIES.squat.steps.at(-1)).toBe('jumping_pistol')
    expect(FAMILIES.core.steps.at(-1)).toBe('dragon_flag_full')
  })
})

describe('strength is the default', () => {
  it('modeOf: nothing saved is strength, a saved choice is kept', () => {
    expect(modeOf({})).toBe('strength')
    expect(modeOf(null)).toBe('strength')
    expect(modeOf({ progressMode: 'grow' })).toBe('grow')
    expect(modeOf({ progressMode: 'endurance' })).toBe('endurance')
  })
  it('5–8 reps, 3 sets, 2–3 min rest; holds stay in seconds; grow is unchanged', () => {
    const pu = moveById('pushup')!
    expect(rangeFor(pu, 'strength')).toMatchObject({ lo: 5, hi: 8, unit: 'reps' })
    expect(rangeFor(pu, 'grow')).toMatchObject({ lo: 8, hi: 15 })
    expect(rangeFor(moveById('plank')!, 'strength').unit).toBe('sec')
    const t = strengthTarget(pu)
    expect(t.sets).toBe(3)
    expect(t.label).toBe('3×5–8')
    for (const m of ['incline_pushup', 'pushup', 'archer_pushup', 'pistol_squat']) {
      const r = restFor(moveById(m)!, 'strength')
      expect(r).toBeGreaterThanOrEqual(120)
      expect(r).toBeLessThanOrEqual(180)
    }
    expect(needFor('strength')).toBe(1)
    expect(needFor('grow')).toBe(2)
  })
  it('the coach aims in 5–8 and one session of 3×8 unlocks the next variation', () => {
    const c = coachFor({ ...hist([[2, 'pu', [6, 6, 5]]]), exId: 'pu' })!
    expect(c.mode).toBe('strength')
    expect(c.goal).toBe(6)
    expect(c.hi).toBe(8)
    expect(c.rest).toBeGreaterThanOrEqual(120)
    const ready = coachFor({ ...hist([[2, 'pu', [8, 8, 8]]]), exId: 'pu' })!
    expect(ready.status).toBe('ready')
    expect(ready.ready!.to.id).toBe('wide_pushup')
    expect(ready.ready!.reps).toBe(5)
    const grow = coachFor({ ...hist([[2, 'pu', [8, 8, 8]]]), exId: 'pu', mode: 'grow' })!
    expect(grow.status).not.toBe('ready')
  })
  it('a set far above the range jumps to the move your best set places you on', () => {
    const c = coachFor({ ...hist([[1, 'pu', [50]]]), exId: 'pu' })!
    expect(c.status).toBe('ready')
    expect(FAMILIES.pushup.steps.indexOf(c.ready!.to.id)).toBeGreaterThan(FAMILIES.pushup.steps.indexOf('wide_pushup'))
  })
  it('strengthTargetFor gives the page what it needs', () => {
    const t = strengthTargetFor({ ...hist([[2, 'pu', [6, 6, 5]]]), exId: 'pu' })!
    expect(t.label).toBe('3×6')
    expect(t.restLabel).toMatch(/min$/)
  })
  it('migration: unset becomes strength, a saved choice stays', () => {
    expect(migrateRoutine({ exercises: [], sportySettings: {} as any }).sportySettings.progressMode).toBe('strength')
    expect(migrateRoutine({ exercises: [], sportySettings: { routineV: 3, progressMode: 'grow' } as any }).sportySettings.progressMode).toBe('grow')
  })
})

describe('too easy / too hard and effort', () => {
  const base = (rows: [number, string, number[]][] = [[3, 'pu', [6, 6, 5]]]) => ({ ...hist(rows), exId: 'pu' })
  it('one tap does nothing for "easy", two taps in a row suggest a harder variation now', () => {
    const one = coachFor({ ...base(), feel: addFeel({}, 'pu', 'easy', ago(3)) })!
    expect(one.signal.kind).toBeNull()
    const two = coachFor({ ...base(), feel: addFeel(addFeel({}, 'pu', 'easy', ago(3)), 'pu', 'easy', ago(1)) })!
    expect(two.signal).toMatchObject({ kind: 'easy', strong: true })
    expect(two.status).toBe('ready')
    expect(two.ready!.to.id).toBe('wide_pushup')
  })
  it('too easy with no harder move gives more reps, then more sets', () => {
    const top = [{ id: 'op', name: 'One-arm push-ups', target: 20, active: true }]
    const feel = addFeel(addFeel({}, 'op', 'easy', ago(3)), 'op', 'easy', ago(1))
    const h = { ...hist([[3, 'op', [5, 5, 5]]], top), exId: 'op', feel }
    const c = coachFor(h)!
    expect(c.goal).toBe(8)
    const full = { ...hist([[3, 'op', [8, 8, 8]]], top), exId: 'op', feel }
    const d = coachFor(full)!
    expect(d.sets).toBeGreaterThanOrEqual(5)
  })
  it('too hard: fewer reps once, an easier step when twice', () => {
    const feel1 = addFeel({}, 'pu', 'hard', ago(1))
    const c1 = coachFor({ ...base([[3, 'pu', [7, 7, 6]]]), feel: feel1 })!
    expect(c1.status).toBe('eased')
    expect(c1.goal).toBe(5)
    const feel2 = addFeel(feel1, 'pu', 'hard', ago(0))
    const c2 = coachFor({ ...base([[3, 'pu', [7, 7, 6]]]), feel: feel2 })!
    expect(c2.status).toBe('stuck')
    expect(c2.stepBack!.to!.id).toBe('knee_pushup')
  })
  it('the coach acts, then resetFeel starts the count again', () => {
    const feel = resetFeel(addFeel(addFeel({}, 'pu', 'easy', ago(3)), 'pu', 'easy', ago(2)), 'pu', ago(1))
    expect(signalFor({ feel, exId: 'pu', today: TODAY }).kind).toBeNull()
    expect(signalFor({ feel: addFeel(feel, 'pu', 'hard', TODAY), exId: 'pu', today: TODAY }).kind).toBe('hard')
  })
  it('taps older than four weeks are forgotten', () => {
    const feel = addFeel(addFeel({}, 'pu', 'easy', ago(60)), 'pu', 'easy', ago(50))
    expect(signalFor({ feel, exId: 'pu', today: TODAY }).kind).toBeNull()
  })
  it('effort: 1–2 twice means easy, 5 twice means hard, and ratings are clamped', () => {
    let e = setEffort({}, ago(3), 2, 'pu')
    e = setEffort(e, ago(1), 1, 'pu')
    expect(signalFor({ effort: e, exId: 'pu', today: TODAY })).toMatchObject({ kind: 'easy', from: 'effort' })
    let h = setEffort({}, ago(3), 9, 'pu')
    expect(h[`${ago(3)}:pu`]).toBe(5)
    h = setEffort(h, ago(1), 5, 'pu')
    expect(signalFor({ effort: h, exId: 'pu', today: TODAY }).kind).toBe('hard')
    expect(effortAvg(h, 'pu', TODAY)).toBe(5)
    expect(setEffort({}, ago(1), 0)[ago(1)]).toBe(1)
  })
  it('both devices merge: taps are joined, efforts follow the newer device', () => {
    const a = addFeel({}, 'pu', 'easy', ago(3))
    const b = addFeel({}, 'pu', 'easy', ago(1))
    const m = mergeFeel(a, b)
    expect(m.pu.map((x) => x.d)).toEqual([ago(3), ago(1)])
    expect(signalFor({ feel: m, exId: 'pu', today: TODAY }).kind).toBe('easy')
    expect(mergeFeel(m, m).pu).toHaveLength(2)
    const eff = mergeEffort({ [ago(2)]: 2, [ago(5)]: 3 }, { [ago(2)]: 4 })
    expect(eff).toEqual({ [ago(2)]: 4, [ago(5)]: 3 })
  })
})

describe('the plan follows strength', () => {
  it.each([20, 30, 45])('a %i-minute strength session fits: 3–5 sets, 2–3 min rest', (min) => {
    const ex = [
      { id: 'p', name: 'Push-ups', target: 45, move: 'pushup' },
      { id: 's', name: 'Squats', target: 60, move: 'squat' }
    ]
    for (const kind of ['full_a', 'full_b', 'upper', 'lower'] as const) {
      const s = buildSession(kind, ex, { minutes: min, perWeek: 3 })
      expect(s.minutes, `${kind} ${min}`).toBeLessThanOrEqual(min)
      expect(s.items.length).toBeGreaterThanOrEqual(3)
      for (const it of s.items) {
        expect(it.sets).toBeGreaterThanOrEqual(3)
        expect(it.sets).toBeLessThanOrEqual(5)
        if (it.unit === 'reps') expect([it.lo, it.hi]).toEqual([5, 8])
        expect(it.rest).toBeGreaterThanOrEqual(120)
        expect(it.rest).toBeLessThanOrEqual(180)
      }
    }
  })
})
