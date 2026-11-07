// Too easy means harder: the automatic variation, Too easy / Too hard, effort speed, best-set placement, Strength mode.
import { describe, expect, it } from 'vitest'
import { addSets, shiftDay, type SetLog } from './sportSets'
import { overallRank, placeAll, placeFamily, type HistoryInput } from './sportLevels'
import { coachFor } from './sportCoach'
import { autoVariation, balancedSet, levelBadge, rankLine, shiftLevel } from './sportBoost'

const TODAY = '2026-11-07'
const ago = (n: number) => shiftDay(TODAY, -n)
const PU = { id: 'pu', name: 'Push-ups', target: 63, active: true }

function withSets(rows: [number, number[]][], ex: any = PU): HistoryInput {
  let sets: SetLog = {}
  const days: Record<string, Record<string, number>> = {}
  for (const [n, reps] of rows) {
    sets = addSets(sets, ago(n), ex.id, reps, Date.parse(ago(n) + 'T10:00:00Z'))
    days[ago(n)] = { [ex.id]: reps.reduce((a, b) => a + b, 0) }
  }
  return { exercises: [ex], days, sets, today: TODAY }
}

describe('the automatic harder variation', () => {
  it('3×21 regular push-ups switch Today to diamond push-ups 3×8, with the warm-up note', () => {
    const h = withSets([[3, [20, 20, 20]], [1, [21, 21, 21]]])
    const v = autoVariation({ ...h, exId: 'pu' })!
    expect(v.to.id).toBe('diamond_pushup')
    expect(`${v.sets}×${v.reps}`).toBe('3×8')
    expect(v.text).toContain('Level up: Diamond push-ups 3×8 (your 3×')
    expect(v.text).toContain('are now your warm-up)')
  })
  it('does nothing while the target is inside the range, and respects "Not yet"', () => {
    expect(autoVariation({ ...withSets([[1, [12, 12, 12]]]), exId: 'pu' })).toBeNull()
    const over = withSets([[1, [21, 21, 21]]])
    expect(autoVariation({ ...over, exId: 'pu', notYet: { wide_pushup: ago(-3), diamond_pushup: ago(-3) } })).toBeNull()
  })
})

describe('too easy and too hard', () => {
  const h = withSets([[1, [15, 15, 15]]])
  it('one tap jumps one level and sets the new target; two taps in a week jump two', () => {
    const base = placeFamily(h, 'pushup')!.level
    const one = shiftLevel({ ...h, exId: 'pu' }, 'easy', 1)!
    const two = shiftLevel({ ...h, exId: 'pu' }, 'easy', 2)!
    expect(one.level.n).toBe(base + 1)
    expect(two.level.n).toBe(base + 2)
    expect(one.sets * one.reps).toBeGreaterThan(0)
  })
  it('too hard steps back one level', () => {
    const base = placeFamily(h, 'pushup')!.level
    expect(shiftLevel({ ...h, exId: 'pu' }, 'hard')!.level.n).toBe(base - 1)
  })
})

describe('effort speeds progress up', () => {
  const rows = withSets([[1, [15, 15, 15]]])
  it('one session at the top of the range is enough when it felt easy, else two are needed', () => {
    expect(coachFor({ ...rows, exId: 'pu' })!.status).not.toBe('ready')
    const hi = withSets([[1, [20, 20, 20]]])
    expect(coachFor({ ...hi, exId: 'pu' })!.status).not.toBe('ready')
    expect(coachFor({ ...hi, exId: 'pu', efforts: { [ago(1)]: 'easy' } })!.status).toBe('ready')
  })
  it('easy adds 2 reps next time, hard repeats', () => {
    const s = withSets([[1, [10, 10, 10]]])
    const g = (efforts?: any) => coachFor({ ...s, exId: 'pu', efforts })!.goal
    expect(g()).toBe(11)
    expect(g({ [ago(1)]: 'easy' })).toBe(12)
    expect(g({ [ago(1)]: 'hard' })).toBe(10)
  })
})

describe('a best set places you high', () => {
  const base: HistoryInput = { exercises: [PU], days: { [ago(2)]: { pu: 130 }, [ago(1)]: { pu: 130 } }, sets: {}, today: TODAY }
  const withBest: HistoryInput = { ...base, best: { pushup: { move: 'pushup', reps: 50, day: TODAY } } }
  it('a best set of 50 regular push-ups is an advanced level, far above Level 8', () => {
    expect(placeFamily(base, 'pushup')!.level).toBeLessThanOrEqual(8)
    expect(placeFamily(withBest, 'pushup')!.level).toBeGreaterThanOrEqual(12)
  })
  it('Today suggests a harder variation at 3×8–12, not regular push-ups at 3×21+', () => {
    const v = autoVariation({ ...withBest, exId: 'pu' })!
    expect(v.to.id).not.toBe('pushup')
    expect(v.reps).toBeGreaterThanOrEqual(8)
    expect(v.reps).toBeLessThanOrEqual(12)
    expect(v.sets).toBe(3)
  })
  it('Strength mode: a hard variation at 4×5–8, the next one after 3×8', () => {
    const v = autoVariation({ ...withBest, exId: 'pu', strength: true })!
    expect(v.sets).toBe(4)
    expect(v.reps).toBeGreaterThanOrEqual(5)
    expect(v.reps).toBeLessThanOrEqual(8)
    expect(v.to.id).toBe('archer_pushup')
    expect(v.after).toContain('after 3×8')
  })
  it('Strength mode moves up as soon as you hit 3×8', () => {
    const h = withSets([[1, [8, 8, 8, 6]]])
    const c = coachFor({ ...h, exId: 'pu', strength: true })!
    expect(c.sets).toBe(4)
    expect(c.status).toBe('ready')
    expect(autoVariation({ ...h, exId: 'pu', strength: true })!.to.id).toBe('wide_pushup')
  })
})

describe('the hero and a thin routine', () => {
  it('shows the rank and the level badge as plain text', () => {
    const places = placeAll(withSets([[1, [20, 20, 20]]]))
    expect(rankLine(overallRank(places))).toMatch(/→/)
    expect(levelBadge(places[0], 'Push-ups').title).toMatch(/^Push-ups · Level \d+ of 15 · /)
  })
  it('suggests 5–6 balanced moves for 3 or fewer', () => {
    const s = balancedSet([{ id: 'a', name: 'Push-ups', target: 40, active: true }, { id: 'b', name: 'Press', target: 30, active: true }, { id: 'c', name: 'Squats', target: 50, active: true }])
    expect(3 + s.length).toBeGreaterThanOrEqual(5)
    expect(3 + s.length).toBeLessThanOrEqual(6)
    expect(s.map((x) => x.move.id)).toContain('door_row')
    expect(balancedSet(Array.from({ length: 4 }, (_, i) => ({ id: 'x' + i, name: 'Push-ups', target: 10, active: true })))).toEqual([])
  })
})
