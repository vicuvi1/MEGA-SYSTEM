import { describe, expect, it } from 'vitest'
import {
  calculateHunterAttributes,
  computeHunterPerks,
  hunterDefFor,
  HUNTER_PERK_DEFINITIONS,
  levelInfo,
  nextHunterRank,
  RANKS,
  rankFor,
  totalStatPointsForLevel,
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
    expect(stats.unallocatedPoints).toBeGreaterThan(0)
    expect(stats.totalEarnedPoints).toBe(totalStatPointsForLevel(20))
  })

  it('computes allocatable stat points by level progression curve', () => {
    expect(totalStatPointsForLevel(1)).toBe(0)
    expect(totalStatPointsForLevel(2)).toBe(1)
    expect(totalStatPointsForLevel(10)).toBe(9) // 9 levels (2..10) * 1 = 9
    expect(totalStatPointsForLevel(11)).toBe(11) // 9 + 2 = 11
    expect(totalStatPointsForLevel(25)).toBe(39) // 9 + 15*2 = 39
    expect(totalStatPointsForLevel(26)).toBe(42) // 39 + 3 = 42
  })

  it('factors manually allocated stat points into hunter attributes', () => {
    const stats = calculateHunterAttributes(10, {
      workoutCount: 0,
      cleanStreakDays: 0,
      focusBlocksCount: 0,
      onTimeWakeups: 0,
      budgetDays: 0,
      allocated: { str: 4, int: 3, agi: 2 }
    })

    const base = Math.max(10, Math.floor(10 * 2.5)) // 25
    expect(stats.str).toBe(base + 4)
    expect(stats.int).toBe(base + 3)
    expect(stats.agi).toBe(base + 2)
    expect(stats.vit).toBe(base)
    expect(stats.sen).toBe(base)
    expect(stats.allocated.str).toBe(4)
    expect(stats.allocated.int).toBe(3)
    expect(stats.allocated.agi).toBe(2)
    expect(stats.allocated.vit).toBe(0)
    expect(stats.allocated.sen).toBe(0)
    expect(stats.totalEarnedPoints).toBe(9)
    expect(stats.unallocatedPoints).toBe(0) // 9 - (4+3+2) = 0
  })

  it('evaluates hunter perks unlocking according to level and attribute milestones', () => {
    const perksLv1 = computeHunterPerks(1, { str: 10, agi: 10, vit: 10, int: 10, sen: 10 })
    const awakening = perksLv1.find((p) => p.id === 'awakening_spark')
    const shadowMonarch = perksLv1.find((p) => p.id === 'shadow_monarch_extraction')
    const ironFocus = perksLv1.find((p) => p.id === 'iron_focus')

    expect(awakening?.unlocked).toBe(true)
    expect(awakening?.progressPct).toBe(100)
    expect(shadowMonarch?.unlocked).toBe(false)
    expect(shadowMonarch?.progressPct).toBe(2) // 1/50 = 2%
    expect(ironFocus?.unlocked).toBe(false)
    expect(ironFocus?.progressPct).toBe(40) // 10/25 = 40%

    // With upgraded stats:
    const perksUpgraded = computeHunterPerks(50, { str: 35, agi: 25, vit: 28, int: 30, sen: 32 })
    for (const perk of perksUpgraded) {
      expect(perk.unlocked).toBe(true)
      expect(perk.progressPct).toBe(100)
    }
  })

  it('returns full LevelInfo with rank, perks, and next milestone', () => {
    const info = levelInfo(1000)
    expect(info.level).toBeGreaterThan(1)
    expect(info.rank).toBeDefined()
    expect(info.hunterTitle).toBeDefined()
    expect(info.rankColor).toBeDefined()
    expect(info.rankPerk).toBeDefined()
    expect(info.attributes.totalCombatPower).toBeGreaterThan(0)
    expect(info.perks.length).toBe(HUNTER_PERK_DEFINITIONS.length)
    expect(info.allRanks.length).toBe(30)
  })
})
