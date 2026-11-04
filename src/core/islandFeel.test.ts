import { describe, expect, it } from 'vitest'
import { bestStreak, dayHighlight, dayPart, rewardAlert, runOf } from './islandFeel'

const at = (s: string) => Date.parse(`2026-11-04T${s}:00`)
const base = { focusMin: 0, focusBefore: [30, 50, 90, 0], mustDone: 0, mustTotal: 0, waterMl: 0, waterTarget: 2700, workoutDone: false, sportStreak: 0 }

describe("the island's feel", () => {
  it('knows the time of day', () => {
    expect(dayPart(at('07:00'))).toBe('morning')
    expect(dayPart(at('14:00'))).toBe('day')
    expect(dayPart(at('20:00'))).toBe('evening')
    expect(dayPart(at('23:30'))).toBe('night')
  })
  it('counts streaks, and says when today puts one at risk', () => {
    const r = runOf([{ day: '2026-11-01', ok: true }, { day: '2026-11-02', ok: true }, { day: '2026-11-03', ok: true }], '2026-11-04')
    expect(r).toEqual({ days: 3, todayDone: false })
    expect(bestStreak({ now: at('19:00'), sport: r, focus: { days: 1, todayDone: true } })).toEqual({ days: 3, kind: 'sport', atRisk: true })
    expect(bestStreak({ now: at('10:00'), sport: r, focus: { days: 1, todayDone: true } })?.atRisk).toBe(false)
    expect(bestStreak({ now: at('10:00'), sport: { days: 1, todayDone: true }, focus: { days: 0, todayDone: false } })).toBeNull()
  })
  it("picks today's best moment", () => {
    expect(dayHighlight({ ...base, focusMin: 130 })).toBe('Best focus day this week: 2h 10m 🔥')
    expect(dayHighlight({ ...base, focusMin: 40, mustDone: 3, mustTotal: 3 })).toBe('Every must-do done (3/3) ✅')
    expect(dayHighlight({ ...base, workoutDone: true, sportStreak: 5 })).toBe('Training streak: 5 days in a row 💪')
    expect(dayHighlight(base)).toBeNull()
  })
  it('celebrates a reward once', () => {
    const goal = { title: '1h manga', price: 400 }
    expect(rewardAlert({ balance: 410, goal, celebrated: [], now: 0, dismissed: {} })?.kind).toBe('reward')
    expect(rewardAlert({ balance: 410, goal, celebrated: ['reward:1h manga:400'], now: 0, dismissed: {} })).toBeNull()
    expect(rewardAlert({ balance: 300, goal, celebrated: [], now: 0, dismissed: {} })).toBeNull()
  })
})
