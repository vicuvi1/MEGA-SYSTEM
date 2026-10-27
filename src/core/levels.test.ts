import { describe, expect, it } from 'vitest'
import {
  calculateHunterAttributes,
  hunterDefFor,
  levelInfo,
  nextHunterRank,
  RANKS,
  rankFor,
  xpToNext
} from './levels'

describe('Solo Leveling Hunter Progression System', () => {
  it('defines 30 described hunter ranks spanning levels 1 to 150', () => {
    expect(RANKS.length).toBe(30)
    expect(RANKS[0].minLevel).toBe(1)
    expect(RANKS[RANKS.length - 1].minLevel).toBe(150)
    expect(RANKS[RANKS.length - 1].name).toContain('Apex Sovereign')
  })

  it('retrieves accurate Hunter rank definition for given level', () => {
    const r1 = hunterDefFor(1)
    expect(r1.grade).toBe('E-Rank')
    expect(r1.title).toBe('The Weakest Hunter')
    expect(r1.desc).toContain('bottom of the world')

    const r50 = hunterDefFor(50)
    expect(r50.grade).toBe('S-Rank')
    expect(r50.name).toContain('S-Rank')
    expect(r50.desc).toContain('S-Rank Hunters')

    const r95 = hunterDefFor(95)
    expect(r95.grade).toBe('Monarch')
    expect(r95.name).toBe('Shadow Monarch')
    expect(r95.desc).toContain('ARISE')
  })

  it('determines the next hunter rank milestone correctly', () => {
    const nextFrom1 = nextHunterRank(1)
    expect(nextFrom1?.minLevel).toBe(3)
    expect(nextFrom1?.name).toBe('E-Rank Scout')

    const nextFrom145 = nextHunterRank(145)
    expect(nextFrom145?.minLevel).toBe(150)

    const nextFrom150 = nextHunterRank(150)
    expect(nextFrom150).toBeNull()
  })

  it('calculates dynamic hunter attributes based on habits', () => {
    const stats = calculateHunterAttributes(20, {
      workoutCount: 30,
      cleanStreakDays: 14,
      focusBlocksCount: 25,
      onTimeWakeups: 10,
      budgetDays: 8
    })

    expect(stats.str).toBeGreaterThan(50)
    expect(stats.sen).toBeGreaterThan(50)
    expect(stats.int).toBeGreaterThan(50)
    expect(stats.agi).toBeGreaterThan(50)
    expect(stats.vit).toBeGreaterThan(50)
    expect(stats.totalCombatPower).toBeGreaterThan(500)
  })

  it('returns full LevelInfo with rank, perks, and next milestone', () => {
    const info = levelInfo(1000)
    expect(info.level).toBeGreaterThan(1)
    expect(info.rank).toBeDefined()
    expect(info.hunterTitle).toBeDefined()
    expect(info.rankColor).toBeDefined()
    expect(info.rankPerk).toBeDefined()
    expect(info.attributes.totalCombatPower).toBeGreaterThan(0)
    expect(info.allRanks.length).toBe(30)
  })
})
