import { describe, expect, it } from 'vitest'
import { moveById } from './sportMoves'
import { moveOf } from './sportLadders'
import { cleanLadders, DEFAULT_LADDERS, moveInfo, movesFor, rangeText, TRAIN_MOVES } from './trainLadders'

describe('the ladders', () => {
  it('every level is a real move with a rep range, easiest first', () => {
    expect(DEFAULT_LADDERS.map((l) => l.id)).toEqual(['push', 'pull', 'shoulders', 'single', 'hinge', 'core'])
    for (const l of DEFAULT_LADDERS) {
      expect(l.levels.length).toBeGreaterThanOrEqual(5)
      for (const v of l.levels) {
        const m = moveInfo(v.move)
        expect(m, v.move).not.toBeNull()
        expect(v.lo).toBeLessThanOrEqual(v.hi)
        expect(v.unit).toBe(m!.unit)
      }
    }
    expect(DEFAULT_LADDERS[0].levels.map((v) => moveInfo(v.move)!.name)).toEqual(['Knee push-ups', 'Push-ups', 'Diamond push-ups', 'Decline push-ups', 'Archer push-ups', 'Pseudo-planche push-ups', 'One-arm push-up negatives', 'One-arm push-ups'])
  })

  it('moves the library lacks have honest how-to text and are never mistaken for a library move', () => {
    for (const m of Object.values(TRAIN_MOVES)) {
      expect(moveById(m.id), m.id).toBeNull()
      expect(m.steps.length).toBeGreaterThanOrEqual(3)
      expect(m.mistake.length).toBeGreaterThan(10)
      // Sport Track guesses a move from an exercise's name: ours (move 't:<id>') never reads as another move.
      expect(moveOf({ name: m.name, move: `t:${m.id}` }), m.name).toBeNull()
    }
  })

  it('edited ladders are cleaned: unknown moves dropped, ranges fixed, a broken ladder is the default', () => {
    const out = cleanLadders([{ id: 'push', levels: [{ move: 'pushup', lo: 12, hi: 5 }, { move: 'nope', lo: 1, hi: 2 }, { move: 'archer_pushup', lo: 4, hi: 8 }] }, { id: 'pull', levels: [] }])
    expect(out[0].levels).toEqual([{ move: 'pushup', lo: 12, hi: 12, unit: 'reps' }, { move: 'archer_pushup', lo: 4, hi: 8, unit: 'reps' }])
    expect(out[1]).toEqual(DEFAULT_LADDERS[1])
    expect(out).toHaveLength(6)
  })

  it('lists moves per session for "add a level" and writes ranges', () => {
    expect(movesFor('upper').some((m) => m.id === 'pullup')).toBe(true)
    expect(movesFor('upper').some((m) => m.id === 'squat')).toBe(false)
    expect(rangeText({ lo: 20, hi: 45, unit: 'sec' })).toBe('20–45 s')
  })
})
