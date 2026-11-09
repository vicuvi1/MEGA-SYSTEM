import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { growthLevel, LEVELS, levelOfXp, levelOn, newLevel, XP } from './growthLevels'
import { at, fixture } from './growthFixture.test-helpers'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 9, 9, 0))
})
afterEach(() => vi.useRealTimers())

const kinds = (l: ReturnType<typeof growthLevel>) => l.events.reduce<Record<string, number>>((m, e) => ((m[e.kind] = (m[e.kind] ?? 0) + 1), m), {})

describe('growth levels', () => {
  it('names levels from Seedling to Legend', () => {
    expect(LEVELS[0].name).toBe('Seedling')
    expect(LEVELS[LEVELS.length - 1].name).toBe('Legend')
    expect(levelOfXp(0)).toBe(0)
    expect(levelOfXp(149)).toBe(0)
    expect(levelOfXp(150)).toBe(1)
    expect(levelOfXp(99999)).toBe(LEVELS.length - 1)
  })

  it('earns XP from real milestones logged at the time', () => {
    const l = growthLevel(fixture())
    const k = kinds(l)
    // +0.35 kg a week for 16 weeks: about 5.3 kg over the first full week → 10 steps of 0.5 kg (waist +0.8 cm).
    expect(k.lean).toBe(10)
    // 4 sessions a week, the default split asks for 5: never a full week; 4 months with 12+ sessions (Aug, Sep, Oct and July has 11).
    expect(k.week).toBeUndefined()
    expect(k.month).toBe(3)
    // 150 g every day up to today: 16 full weeks of protein streak.
    expect(k.protein).toBe(16)
    // 7.5 h every night: 16 full weeks, plus this week is too young.
    expect(k.sleep).toBe(16)
    expect(k.strength).toBeGreaterThan(3)
    expect(l.xp).toBe(l.events.reduce((t, e) => t + e.xp, 0))
    expect(l.xp).toBe(10 * XP.lean + 3 * XP.month + 16 * XP.protein + 16 * XP.sleep + k.strength * XP.strength)
    expect(l.name).toBe(LEVELS[levelOfXp(l.xp)].name)
  })

  it('back-dated logs never earn a level', () => {
    const l = growthLevel(fixture({ late: 3 }))
    expect(l.events).toEqual([])
    expect(l.xp).toBe(0)
    expect(l.name).toBe('Seedling')
  })

  it('adding back-dated rows to an honest history changes nothing', () => {
    const g = fixture()
    const base = growthLevel(g)
    const extra = { ...g, sport: { ...g.sport, sets: { ...g.sport.sets, '2026-07-01': { e1: [{ reps: 40, at: at('2026-11-08') }] } } }, food: [{ day: '2026-07-01', kcal: 3000, protein: 200, proteinOnTime: 0 }, ...g.food] }
    expect(growthLevel(extra).xp).toBe(base.xp)
  })

  it('a waist rising faster than the gain stops the lean milestones', () => {
    expect(kinds(growthLevel(fixture({ gainPerWeek: 0.35, waistPerWeek: 0.8 }))).lean ?? 0).toBeLessThan(3)
  })

  it('counts full weeks against the plan', () => {
    const g = fixture()
    // A 3-day split: every week with 4 sessions is full.
    const l = growthLevel({ ...g, sport: { ...g.sport, trainWeek: { days: ['rest', 'upper', 'rest', 'legs', 'rest', 'upper', 'rest'], updatedAt: 1 } } })
    expect(kinds(l).week).toBe(16)
    expect(l.events.find((e) => e.kind === 'week')!.day).toBe('2026-07-25') // the 3rd session of the first week
  })

  it('counts a roadmap level-up only after a session on the level before it', () => {
    const g = fixture()
    const sport = {
      ...g.sport,
      trainLevels: { push: { level: 2, reached: { '1': '2026-10-01', '2': '2026-10-20' }, at: 1 } },
      trainLog: [{ id: 's1', date: '2026-09-29', type: 'upper', startedAt: at('2026-09-29', 18), durationSec: 1800, exercises: [{ ladder: 'push', move: 'knee_pushup', exId: 'x', sets: [{ reps: 15 }] }] }]
    }
    const l = growthLevel({ ...g, sport })
    expect(l.events.filter((e) => e.kind === 'roadmap')).toEqual([{ day: '2026-10-01', kind: 'roadmap', xp: XP.roadmap, text: 'Roadmap: up to Push-ups' }])
  })

  it('is the same every time (recomputed, nothing stored)', () => {
    const g = fixture()
    expect(growthLevel(g)).toEqual(growthLevel(g))
  })

  it('keeps a level history with dates and the level on any day', () => {
    const l = growthLevel(fixture(), '2026-07-20')
    expect(l.history[0]).toEqual({ index: 0, name: 'Seedling', day: '2026-07-20' })
    expect(l.history.length).toBe(l.index + 1)
    for (let i = 1; i < l.history.length; i++) expect(l.history[i].day >= l.history[i - 1].day).toBe(true)
    expect(levelOn(l, '2026-07-19')).toBe('Seedling')
    expect(levelOn(l, '2026-11-09')).toBe(l.name)
    const sprout = l.history.find((h) => h.name === 'Sprout')!
    expect(levelOn(l, sprout.day)).toBe('Sprout')
  })

  it('tells you what to do for the next level', () => {
    const l = growthLevel(fixture())
    expect(l.next).not.toBeNull()
    expect(l.toNext).toBe(l.next!.xp - l.xp)
    expect(l.progress).toBeGreaterThanOrEqual(0)
    expect(l.progress).toBeLessThan(1)
    expect(l.steps.length).toBeGreaterThan(0)
    expect(l.steps.length).toBeLessThanOrEqual(4)
    // Monday: 0 of 5 sessions this week.
    expect(l.steps[0]).toEqual({ kind: 'week', xp: XP.week, text: 'Train 5 more times this week to finish your plan' })
  })

  it('celebrates a level only once per device', () => {
    const l = growthLevel(fixture())
    expect(newLevel(l, null)).toBeNull()
    expect(newLevel(l, l.index)).toBeNull()
    expect(newLevel(l, l.index - 1)).toEqual(l.history[l.index])
  })
})
