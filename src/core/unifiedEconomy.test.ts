import { describe, expect, it } from 'vitest'
import {
  calculateDailySurplus,
  coinsToMoneyValue,
  computeActiveMultiplier,
  computeGoalProgress,
  convertCurrency,
  formatDualCurrency,
  CURRENCY_CONFIGS,
  moneyToCoinsTarget,
  rollEnhancedChest,
  type WishlistGoal
, computeMaxStakingCap,
  computeDailyInterestRate,
  computeDailyDividend,
  calculateAccruedInterest,
  CONSUMABLE_CATALOG
} from './unifiedEconomy'

describe('Unified Economy Core Domain Logic', () => {
  describe('Discipline & Financial Multipliers', () => {
    it('calculates standard 1.0x for streaks under 3 days', () => {
      const res = computeActiveMultiplier(2, 1)
      expect(res.rate).toBe(1.0)
      expect(res.totalRate).toBe(1.0)
      expect(res.budgetBonus).toBe(0)
    })

    it('calculates focused 1.1x for 3-6 day clean streak', () => {
      const res = computeActiveMultiplier(4, 0)
      expect(res.rate).toBe(1.1)
      expect(res.totalRate).toBe(1.1)
    })

    it('calculates disciplined 1.25x for 7-13 day clean streak', () => {
      const res = computeActiveMultiplier(8, 0)
      expect(res.rate).toBe(1.25)
      expect(res.totalRate).toBe(1.25)
    })

    it('calculates spartan 1.5x for 14-29 day clean streak', () => {
      const res = computeActiveMultiplier(14, 0)
      expect(res.rate).toBe(1.5)
      expect(res.totalRate).toBe(1.5)
    })

    it('calculates ascendant 2.0x for 30+ day clean streak', () => {
      const res = computeActiveMultiplier(35, 0)
      expect(res.rate).toBe(2.0)
      expect(res.totalRate).toBe(2.0)
    })

    it('adds +15% budget shield bonus when under budget 3+ days in a row', () => {
      const res = computeActiveMultiplier(14, 3)
      expect(res.rate).toBe(1.5)
      expect(res.budgetBonus).toBe(0.15)
      expect(res.totalRate).toBe(1.65)
      expect(res.label).toContain('Budget Shield')
    })
  })

  describe('Coin-to-Real-Money Valuation & Conversion', () => {
    it('converts coins to real money value accurately', () => {
      // 100 coins = 10 MDL (1 coin = 0.10 MDL)
      expect(coinsToMoneyValue(100, 10)).toBe(10)
      expect(coinsToMoneyValue(1500, 10)).toBe(150)
      expect(coinsToMoneyValue(350, 10)).toBe(35)
      expect(coinsToMoneyValue(0, 10)).toBe(0)
    })

    it('converts real money target to coins target', () => {
      // At 10 per 100 (0.10 per coin), 250 MDL = 2500 coins
      expect(moneyToCoinsTarget(250, 10)).toBe(2500)
      expect(moneyToCoinsTarget(900, 10)).toBe(9000)
    })
  })

  describe('Surplus Vault Calculations', () => {
    it('calculates positive surplus when everyday spending is strictly under daily budget', () => {
      expect(calculateDailySurplus(200, 120)).toBe(80)
      expect(calculateDailySurplus(150, 50)).toBe(100)
    })

    it('returns zero surplus when spent equals or exceeds budget or budget is zero', () => {
      expect(calculateDailySurplus(200, 200)).toBe(0)
      expect(calculateDailySurplus(200, 250)).toBe(0)
      expect(calculateDailySurplus(0, 50)).toBe(0)
    })
  })

  describe('Mega Wishlist Goal Progression & ETA', () => {
    const sampleGoal: WishlistGoal = {
      id: 1,
      title: 'Kaaba Trip Fund',
      targetCoins: 20000,
      targetRealCost: 15000,
      allocatedCoins: 5000,
      allocatedRealCost: 3000,
      category: 'trip',
      pinned: true,
      completed: false,
      completedAt: null,
      note: 'Long-term spiritual milestone',
      createdAt: '2026-10-27T00:00:00Z'
    }

    it('computes accurate percentage breakdown', () => {
      const progress = computeGoalProgress(sampleGoal)
      expect(progress.coinsPercent).toBe(25) // 5000 / 20000
      expect(progress.realCostPercent).toBe(20) // 3000 / 15000
      expect(progress.overallPercent).toBe(23)
      expect(progress.isReady).toBe(false)
      expect(progress.coinsRemaining).toBe(15000)
      expect(progress.realCostRemaining).toBe(12000)
      expect(progress.etaDays).toBeGreaterThan(0)
    })

    it('marks goal ready when both coins and real-money targets are met', () => {
      const completedGoal: WishlistGoal = {
        ...sampleGoal,
        allocatedCoins: 20000,
        allocatedRealCost: 15000
      }
      const progress = computeGoalProgress(completedGoal)
      expect(progress.coinsPercent).toBe(100)
      expect(progress.realCostPercent).toBe(100)
      expect(progress.overallPercent).toBe(100)
      expect(progress.isReady).toBe(true)
      expect(progress.etaDays).toBeNull()
    })
  })

  describe('Enhanced Mystery Chest Loot Table', () => {
    it('rolls coins jackpot for rolls under 60', () => {
      const loot = rollEnhancedChest(5, 0.3) // 30% roll
      expect(loot.type).toBe('coins')
      expect(loot.value).toBeGreaterThan(0)
    })

    it('rolls streak shield for rolls between 60 and 80', () => {
      const loot = rollEnhancedChest(5, 0.7) // 70% roll
      expect(loot.type).toBe('shield')
      expect(loot.value).toBe(1)
      expect(loot.label).toContain('Streak Shield')
    })

    it('rolls vault cash boost for rolls between 80 and 95', () => {
      const loot = rollEnhancedChest(5, 0.88) // 88% roll
      expect(loot.type).toBe('vault_boost')
      expect(loot.value).toBeGreaterThanOrEqual(25)
    })

    it('rolls 24h 2x super multiplier for rolls 95+', () => {
      const loot = rollEnhancedChest(5, 0.98) // 98% roll
      expect(loot.type).toBe('multiplier_24h')
      expect(loot.value).toBe(2)
      expect(loot.label).toContain('2x Super Multiplier')
    })
  })

  describe('Multi-Currency & Real-Life Dual Comparisons', () => {
    it('converts between MDL and USD accurately', () => {
      expect(convertCurrency(180, 'MDL', 'USD')).toBe(10)
      expect(convertCurrency(50, 'USD', 'MDL')).toBe(900)
    })

    it('converts between USD and EUR accurately', () => {
      expect(convertCurrency(100, 'USD', 'EUR')).toBe(92)
    })

    it('formats dual currency comparisons for Lei and USD', () => {
      const dualLei = formatDualCurrency(900, 'MDL')
      expect(dualLei.primaryText).toBe('900 MDL')
      expect(dualLei.secondaryText).toBe('$50')
      expect(dualLei.combinedText).toBe('900 MDL (~$50)')

      const dualUsd = formatDualCurrency(100, 'USD')
      expect(dualUsd.primaryText).toBe('$100')
      expect(dualUsd.secondaryText).toBe('1800 MDL')
      expect(dualUsd.combinedText).toBe('$100 (~1800 MDL)')
    })
  })

  describe('Iron Bank Staking & Accrued Interest', () => {
    it('scales max staking cap with hunter level', () => {
      expect(computeMaxStakingCap(1)).toBe(500)
      expect(computeMaxStakingCap(2)).toBe(750)
      expect(computeMaxStakingCap(10)).toBe(2750)
    })

    it('determines interest rate tiers based on clean streak', () => {
      expect(computeDailyInterestRate(0).percent).toBe(0.5)
      expect(computeDailyInterestRate(6).percent).toBe(0.5)
      expect(computeDailyInterestRate(7).percent).toBe(0.8)
      expect(computeDailyInterestRate(14).percent).toBe(1.2)
      expect(computeDailyInterestRate(30).percent).toBe(1.5)
      expect(computeDailyInterestRate(30).streakBonusActive).toBe(true)
    })

    it('computes daily dividends with minimum yield threshold', () => {
      // 100 staked @ 0.5% = 0.5 -> rounded down to 0 without threshold, but staked >= 50 so minimum 1
      expect(computeDailyDividend(100, 0)).toBe(1)
      // 1000 staked @ 0.5% = 5
      expect(computeDailyDividend(1000, 0)).toBe(5)
      // 1000 staked @ 1.5% (30-day streak) = 15
      expect(computeDailyDividend(1000, 30)).toBe(15)
    })

    it('calculates accrued interest over multiple days passed', () => {
      const res = calculateAccruedInterest(1000, '2026-10-20', '2026-10-25', 0)
      expect(res.daysPassed).toBe(5)
      expect(res.pendingInterest).toBe(25) // 5 coins/day * 5 days

      // Same day returns 0
      const sameDay = calculateAccruedInterest(1000, '2026-10-25', '2026-10-25', 0)
      expect(sameDay.pendingInterest).toBe(0)
    })

    it('contains all 4 tactical consumables in catalog', () => {
      expect(CONSUMABLE_CATALOG.length).toBe(4)
      const ids = CONSUMABLE_CATALOG.map((c) => c.id)
      expect(ids).toContain('focus_elixir')
      expect(ids).toContain('xp_booster')
      expect(ids).toContain('streak_shield')
      expect(ids).toContain('fatigue_neutralizer')
    })
  })

})
