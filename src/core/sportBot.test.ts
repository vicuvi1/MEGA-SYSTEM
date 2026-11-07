import { describe, expect, it } from 'vitest'
import { parseTelegramText } from './botCommands'
import { logBotSets } from './sportBot'
import { addSets } from './sportSets'

const T = Date.parse('2026-03-10T09:00:00Z')

describe('the sport bot logs sets', () => {
  it('reads "3x15 push-ups" and "push-ups 15 14 12" as sets with their total; one number stays a total', () => {
    expect(parseTelegramText('3x15 push-ups')).toMatchObject({ type: 'workout', exerciseName: 'push-ups', exerciseAmount: 45, exerciseSets: [15, 15, 15] })
    expect(parseTelegramText('push-ups 15 14 12')).toMatchObject({ type: 'workout', exerciseAmount: 41, exerciseSets: [15, 14, 12] })
    expect(parseTelegramText('plank 3x45s')).toMatchObject({ exerciseUnit: 'sec', exerciseSets: [45, 45, 45] })
    expect(parseTelegramText('50 pushups')).toMatchObject({ type: 'workout', exerciseAmount: 50 })
    expect(parseTelegramText('50 pushups').exerciseSets).toBeUndefined()
    expect(parseTelegramText('room 12 13').type).not.toBe('workout')
  })

  it('adds the sets to Sport Track and says the best set and the next level', () => {
    const st = { exercises: [{ id: 'ex_p', name: 'Push-ups', target: 45 }], sets: addSets({}, '2026-03-08', 'ex_p', [12, 11, 10], T) }
    const r = logBotSets(st, 'pushups', [13, 12, 12], '2026-03-10', T)!
    expect(r.st.sets['2026-03-10'].ex_p.map((s: any) => s.reps)).toEqual([13, 12, 12])
    expect(r.line).toMatch(/New best set: <b>13<\/b> \(was 12\)/)
    expect(r.line).toMatch(/Next level at <b>3×15<\/b>/)
    expect(st.sets['2026-03-10']).toBeUndefined()
    expect(logBotSets(st, 'squats', [10], '2026-03-10')).toBeNull()
  })

  it('says when the next step unlocks', () => {
    const st = { exercises: [{ id: 'ex_p', name: 'Push-ups', target: 45 }], sets: addSets({}, '2026-03-08', 'ex_p', [15, 15, 15], T) }
    expect(logBotSets(st, 'push-ups', [15, 15, 16], '2026-03-10', T)!.line).toMatch(/Level up: <b>Wide push-ups<\/b>/)
  })
})
