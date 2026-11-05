import { describe, expect, it } from 'vitest'
import { pickUrgeAction, urgeDrop } from './urgeAction'

describe('urge crusher action', () => {
  it('fits the action to your top trigger', () => {
    expect(pickUrgeAction('Phone in bed').kind).toBe('cold')
    expect(pickUrgeAction('Bored')).toMatchObject({ kind: 'focus', minutes: 25 })
    expect(pickUrgeAction('Alone').kind).toBe('walk')
    expect(pickUrgeAction('Stress')).toMatchObject({ kind: 'pushups', reps: 20 })
    expect(pickUrgeAction(null).kind).toBe('pushups')
  })
  it('how much it dropped', () => {
    expect(urgeDrop(8, 3)).toBe(5)
    expect(urgeDrop(null, 3)).toBeNull()
  })
})
