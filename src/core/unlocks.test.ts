import { describe, expect, it } from 'vitest'
import { cleanUnlocks, unlockBlocker, unlockState } from './unlocks'

describe('unlock by doing', () => {
  const facts = (deeds: Record<string, number>) => ({ goals: [], streaks: {}, deeds })
  it('keeps deed locks', () => {
    expect(cleanUnlocks({ 2: { kind: 'deed', deed: 'focusHours', target: 10 }, 3: { kind: 'deed', deed: 'naps', target: 2 }, 4: { kind: 'deed', deed: 'workouts', target: 20 } })).toEqual({
      2: { kind: 'deed', deed: 'focusHours', target: 10 },
      4: { kind: 'deed', deed: 'workouts', target: 7 }
    })
  })
  it('shows live progress and opens at the target', () => {
    const u = { kind: 'deed' as const, deed: 'focusHours' as const, target: 10 }
    expect(unlockState(u, facts({ focusHours: 6.55 }))).toEqual({ met: false, text: 'Unlocks at 10 h of focus this week (now 6.5 h)', progress: 0.65 })
    expect(unlockState(u, facts({ focusHours: 10.2 }))).toMatchObject({ met: true, text: 'Unlocked: 10.2 h of focus this week' })
    expect(unlockBlocker({ kind: 'deed', deed: 'sleepNights', target: 5 }, facts({ sleepNights: 3 }))).toBe('Unlocks at 5 nights on time in the last 7 (now 3)')
    expect(unlockBlocker({ kind: 'deed', deed: 'sleepNights', target: 5 }, { goals: [], streaks: {} })).toMatch(/now 0/)
  })
})
