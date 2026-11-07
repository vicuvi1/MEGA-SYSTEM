import { describe, expect, it } from 'vitest'
import { moveById } from './sportMoves'
import { enduranceStep, growTarget, progressFor, rangeFor } from './sportProgress'
import { addSets, type SetLog } from './sportSets'

const T = Date.parse('2026-03-10T09:00:00Z')
const push = moveById('pushup')!
const log = (rows: [string, number[]][], id = 'ex') => rows.reduce<SetLog>((l, [d, r]) => addSets(l, d, id, r, T), {})
const prog = (rows: [string, number[]][], today: string, move = push) => progressFor({ log: log(rows), exId: 'ex', move, today })

describe('rep ranges', () => {
  it('pushing and pulling 8–15, legs and core 10–20, harder moves lower, holds in seconds', () => {
    expect(rangeFor(push)).toMatchObject({ lo: 8, hi: 15, sets: 3, unit: 'reps' })
    expect(rangeFor(moveById('squat')!)).toMatchObject({ lo: 10, hi: 20 })
    expect(rangeFor(moveById('archer_pushup')!)).toMatchObject({ lo: 5, hi: 12 })
    expect(rangeFor(moveById('plank')!)).toMatchObject({ lo: 30, hi: 60, unit: 'sec' })
  })
})

describe('double progression', () => {
  it('a first time starts at the bottom of the range', () => {
    const p = prog([], '2026-03-10')
    expect(p.status).toBe('new')
    expect(p.goal).toBe(8)
    expect(p.nextAt).toBe('3×15')
    expect(growTarget(p)).toBe(24)
  })

  it('aims one rep more than the weakest working set last time', () => {
    const p = prog([['2026-03-06', [12, 11, 10]]], '2026-03-08')
    expect(p.status).toBe('building')
    expect(p.goal).toBe(11)
  })

  it('2 sessions with every set at the top unlocks the next step', () => {
    const p = prog([['2026-03-04', [15, 15, 15]], ['2026-03-06', [16, 15, 15]]], '2026-03-08')
    expect(p.status).toBe('ready')
    expect(p.next?.id).toBe('wide_pushup')
    expect(p.line).toMatch(/Level up: Wide push-ups/)
  })

  it("today's sets count as soon as all 3 are logged; one session isn't enough", () => {
    expect(prog([['2026-03-06', [15, 15, 15]]], '2026-03-08').status).toBe('building')
    expect(prog([['2026-03-06', [15, 15, 15]]], '2026-03-08').hits).toBe(1)
    expect(prog([['2026-03-06', [15, 15, 15]], ['2026-03-08', [15, 15]]], '2026-03-08').status).toBe('building')
    expect(prog([['2026-03-06', [15, 15, 15]], ['2026-03-08', [15, 15, 15]]], '2026-03-08').status).toBe('ready')
  })

  it('way over the range on the first try: go up now', () => {
    expect(prog([['2026-03-06', [25, 20, 18]]], '2026-03-08').status).toBe('ready')
  })

  it('the top of a ladder says add a set or go slower', () => {
    const top = moveById('one_arm_pushup')!
    const p = prog([['2026-03-04', [12, 12, 12]], ['2026-03-06', [12, 12, 12]]], '2026-03-08', top)
    expect(p.status).toBe('top')
    expect(p.next).toBeNull()
  })

  it('missing the bottom twice suggests the easier step', () => {
    const p = prog([['2026-03-04', [7, 6, 5]], ['2026-03-06', [6, 6, 5]]], '2026-03-08')
    expect(p.status).toBe('stuck')
    expect(p.prev?.id).toBe('knee_pushup')
  })

  it('after a long break: about 70%, or one step easier when that is under the range', () => {
    const p = prog([['2026-01-20', [15, 14, 14]]], '2026-02-05')
    expect(p.status).toBe('comeback')
    expect(p.goal).toBe(10)
    const q = prog([['2026-01-01', [10, 9, 9]]], '2026-02-05')
    expect(q.status).toBe('comeback')
    expect(q.prev?.id).toBe('knee_pushup')
  })

  it('ramps up fast in the sessions after a break', () => {
    const p = prog([['2026-01-10', [15, 14, 14]], ['2026-01-30', [10, 10, 10]]], '2026-02-01')
    expect(p.status).toBe('building')
    expect(p.goal).toBe(13)
  })

  it('holds move in 5-second steps', () => {
    const p = prog([['2026-03-06', [40, 35, 35]]], '2026-03-08', moveById('plank')!)
    expect(p.goal).toBe(40)
    expect(p.nextAt).toBe('3×60 s')
  })

  it('endurance keeps the old +5% step-up', () => {
    expect(enduranceStep([100, 10, 1])).toEqual([105, 11, 2])
  })
})
