// IN36: a recipe can show the move-break card; it never logs by itself.
import { describe, expect, it } from 'vitest'
import { moveCardAlert, MOVE_ASK_MS } from './islandMoveCard'
import { cleanAction, SAFE_LABEL } from './recipes'

describe('the move card from a recipe', () => {
  it('is a safe recipe action', () => {
    expect(cleanAction({ do: 'moveCard', n: 999 })).toEqual({ do: 'moveCard' })
    expect(SAFE_LABEL.moveCard).toMatch(/confirm/)
  })
  it('asks; every button is your own answer', () => {
    const a = moveCardAlert({ at: 1000, why: 'Study evenings' }, 2000, {})!
    expect(a.kind).toBe('move')
    expect(a.text).toContain('Study evenings')
    expect(a.actions.map((x) => x.action.kind)).toEqual(['moveBreak', 'moveBreak', 'dismiss'])
  })
  it('goes away after 10 minutes or once answered', () => {
    expect(moveCardAlert({ at: 1000, why: '' }, 1000 + MOVE_ASK_MS + 1, {})).toBeNull()
    expect(moveCardAlert({ at: 1000, why: '' }, 2000, { 'move:recipe:1000': 9e12 })).toBeNull()
    expect(moveCardAlert(null, 2000, {})).toBeNull()
  })
})
