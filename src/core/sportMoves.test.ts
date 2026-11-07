import { describe, expect, it } from 'vitest'
import { BONES, FLOOR, boxOf, dist, frameAt, ik, loopLength, stillFrame } from './sportFigure'
import { FAMILIES, GROUPS, MOVES, matchMove, moveById } from './sportMoves'

describe('exercise library', () => {
  it('has real, complete entries', () => {
    expect(MOVES.length).toBeGreaterThanOrEqual(45)
    const ids = new Set<string>()
    for (const m of MOVES) {
      expect(ids.has(m.id), m.id).toBe(false)
      ids.add(m.id)
      expect(m.steps.length, m.id).toBeGreaterThanOrEqual(2)
      expect(m.steps.length, m.id).toBeLessThanOrEqual(3)
      expect(m.mistake.length, m.id).toBeGreaterThan(10)
      expect(m.muscles.length, m.id).toBeGreaterThan(0)
      expect([1, 2, 3, 4, 5]).toContain(m.diff)
      expect(GROUPS.map((g) => g.id)).toContain(m.group)
      expect(m.set, m.id).toBeLessThanOrEqual(m.start)
      expect(FAMILIES[m.family]?.steps, m.id).toContain(m.id)
      expect(m.anim.keys.length, m.id).toBeGreaterThan(0)
    }
    for (const g of GROUPS) expect(MOVES.some((m) => m.group === g.id), g.id).toBe(true)
  })

  it('ladders go from easier to harder and name only real moves', () => {
    for (const [f, fam] of Object.entries(FAMILIES)) {
      const diffs = fam.steps.map((id) => moveById(id)!.diff)
      expect(fam.steps.every((id) => moveById(id)?.family === f), f).toBe(true)
      for (let i = 1; i < diffs.length; i++) expect(diffs[i], `${f} step ${i}`).toBeGreaterThanOrEqual(diffs[i - 1])
    }
    expect(FAMILIES.pushup.steps).toEqual(['incline_pushup', 'knee_pushup', 'pushup', 'wide_pushup', 'diamond_pushup', 'decline_pushup', 'archer_pushup', 'planche_pushup', 'one_arm_pushup'])
    expect(FAMILIES.squat.steps).toContain('pistol_squat')
  })

  it('finds the move for names people type', () => {
    expect(matchMove('Push-ups')?.id).toBe('pushup')
    expect(matchMove('pushups')?.id).toBe('pushup')
    expect(matchMove('Sit-ups')?.id).toBe('situp')
    expect(matchMove('press')?.id).toBe('crunch')
    expect(matchMove('Diamond Push Ups')?.id).toBe('diamond_pushup')
    expect(matchMove('my squats (slow)')?.id).toBe('squat')
    expect(matchMove('Bench press 3x8')).toBeNull()
    expect(matchMove('')).toBeNull()
  })
})

describe('animated demos', () => {
  it('two-bone IK keeps both bones their length', () => {
    const [j, e] = ik([0, 0], [10, 10], 8, 8, 1)
    expect(dist([0, 0], j)).toBeCloseTo(8, 5)
    expect(dist(j, e)).toBeCloseTo(8, 5)
    expect(dist(e, [10, 10])).toBeLessThan(0.05)
    // Out of reach: straight towards it.
    const [, far] = ik([0, 0], [100, 0], 8, 8, 1)
    expect(far[0]).toBeCloseTo(16, 1)
  })

  it('every demo keeps limb lengths, stays in its box and on the floor', () => {
    for (const m of MOVES) {
      const total = loopLength(m.anim)
      expect(total, m.id).toBeGreaterThan(0)
      for (let i = 0; i <= 40; i++) {
        const f = frameAt(m.anim, (total * i) / 40)
        expect(dist(f.torso[0], f.torso[2]), m.id).toBeCloseTo(BONES.torso, 3)
        for (const a of f.arms) {
          expect(dist(a[0], a[1]), m.id).toBeCloseTo(BONES.upperArm, 3)
          expect(dist(a[1], a[2]), m.id).toBeCloseTo(BONES.foreArm, 3)
        }
        for (const l of f.legs) {
          expect(dist(l[0], l[1]), m.id).toBeCloseTo(BONES.thigh, 3)
          expect(dist(l[1], l[2]), m.id).toBeCloseTo(BONES.shin, 3)
        }
        // Nothing sinks into the floor (a little stroke overlap is fine).
        const low = Math.max(f.head[1] + BONES.head - 3, ...f.legs.flatMap((l) => [l[2][1], l[3][1]]), ...f.arms.map((a) => a[2][1]))
        expect(low, `${m.id} at ${i}`).toBeLessThan(FLOOR + 2.5)
        for (const p of [f.head, ...f.arms.flat(), ...f.legs.flat()]) expect(Number.isFinite(p[0]) && Number.isFinite(p[1]), m.id).toBe(true)
      }
      const still = stillFrame(m.anim)
      expect(still.head.every(Number.isFinite)).toBe(true)
      const [x, y, w, h] = boxOf(m.anim, 1.25)
      expect(w / h).toBeCloseTo(1.25, 1)
      expect(y + h).toBeGreaterThanOrEqual(FLOOR)
      expect(x).toBeLessThan(still.head[0])
    }
  })

  it('loops back to where it started', () => {
    const m = moveById('pushup')!
    const a = frameAt(m.anim, 0)
    const b = frameAt(m.anim, loopLength(m.anim))
    expect(dist(a.head, b.head)).toBeLessThan(0.01)
  })
})
