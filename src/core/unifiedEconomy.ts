/**
 * Pure domain logic for the Unified Rewarding & Financial Ecosystem.
 * Zero Electron/DOM dependencies.
 */

export interface MultiplierTier {
  minStreak: number
  multiplier: number
  label: string
}

export const DISCIPLINE_MULTIPLIERS: MultiplierTier[] = [
  { minStreak: 30, multiplier: 2.0, label: 'Ascendant (2.0x)' },
  { minStreak: 14, multiplier: 1.5, label: 'Spartan (1.5x)' },
  { minStreak: 7, multiplier: 1.25, label: 'Disciplined (1.25x)' },
  { minStreak: 3, multiplier: 1.1, label: 'Focused (1.1x)' },
  { minStreak: 0, multiplier: 1.0, label: 'Standard (1.0x)' }
]

export interface MultiplierInfo {
  rate: number
  cleanStreak: number
  budgetStreak: number
  budgetBonus: number
  totalRate: number
  label: string
}

/**
 * Computes active multiplier based on clean discipline streak and budget consistency.
 */
export function computeActiveMultiplier(cleanStreak: number, budgetStreak: number): MultiplierInfo {
  const safeClean = Math.max(0, cleanStreak || 0)
  const safeBudget = Math.max(0, budgetStreak || 0)

  const tier =
    DISCIPLINE_MULTIPLIERS.find((t) => safeClean >= t.minStreak) ||
    DISCIPLINE_MULTIPLIERS[DISCIPLINE_MULTIPLIERS.length - 1]

  // If under budget 3+ days in a row, grant a +15% financial multiplier bonus
  const budgetBonus = safeBudget >= 3 ? 0.15 : 0
  const totalRate = Math.round((tier.multiplier + budgetBonus) * 100) / 100

  let label = tier.label
  if (budgetBonus > 0) {
    label += ' + 💰 Budget Shield (+15%)'
  }

  return {
    rate: tier.multiplier,
    cleanStreak: safeClean,
    budgetStreak: safeBudget,
    budgetBonus,
    totalRate,
    label
  }
}

/**
 * Converts coins into equivalent real-world money value based on exchange rate.
 * e.g., ratePerHundred = 10 means 100 coins = 10.00 currency (1 coin = 0.10 currency).
 */
export function coinsToMoneyValue(coins: number, ratePerHundred = 10): number {
  const safeCoins = Math.max(0, coins || 0)
  const safeRate = Math.max(1, ratePerHundred || 10)
  return Math.round((safeCoins * (safeRate / 100)) * 100) / 100
}

/**
 * Converts real money cost to approximate coins target based on exchange rate.
 */
export function moneyToCoinsTarget(money: number, ratePerHundred = 10): number {
  const safeMoney = Math.max(0, money || 0)
  const safeRate = Math.max(1, ratePerHundred || 10)
  return Math.round(safeMoney / (safeRate / 100))
}

/**
 * Calculates surplus savings for a day:
 * If everyday spending is under daily budget, returns the positive surplus amount (in whole currency or bani).
 */
export function calculateDailySurplus(dailyBudget: number, everydaySpent: number): number {
  if (dailyBudget <= 0) return 0
  const diff = dailyBudget - everydaySpent
  return diff > 0 ? diff : 0
}

export type WishlistCategory = 'tech' | 'trip' | 'gear' | 'luxury' | 'emergency' | 'investment'

export interface WishlistGoal {
  id: number
  title: string
  targetCoins: number
  targetRealCost: number // in real currency units (e.g. MDL)
  allocatedCoins: number
  allocatedRealCost: number
  category: WishlistCategory
  pinned: boolean
  completed: boolean
  completedAt: string | null
  note: string | null
  createdAt: string
  imageUrl?: string | null
  currency?: string | null
}

export interface GoalProgress {
  coinsPercent: number
  realCostPercent: number
  overallPercent: number
  coinsRemaining: number
  realCostRemaining: number
  isReady: boolean
  etaDays: number | null
}

/**
 * Calculates comprehensive progress and estimated days to completion for a mega goal.
 */
export function computeGoalProgress(
  goal: WishlistGoal,
  weeklyCoinVelocity = 150, // average coins earned per week
  weeklySavingsVelocity = 200 // average real money surplus saved per week
): GoalProgress {
  const coinsPercent =
    goal.targetCoins > 0 ? Math.min(100, Math.round((goal.allocatedCoins / goal.targetCoins) * 100)) : 100

  const realCostPercent =
    goal.targetRealCost > 0
      ? Math.min(100, Math.round((goal.allocatedRealCost / goal.targetRealCost) * 100))
      : 100

  const overallPercent = Math.min(100, Math.round((coinsPercent + realCostPercent) / 2))

  const coinsRemaining = Math.max(0, goal.targetCoins - goal.allocatedCoins)
  const realCostRemaining = Math.max(0, goal.targetRealCost - goal.allocatedRealCost)

  const isReady = coinsRemaining === 0 && realCostRemaining === 0

  let etaDays: number | null = null
  if (!isReady) {
    const dailyCoinRate = weeklyCoinVelocity > 0 ? weeklyCoinVelocity / 7 : 10
    const dailySavingsRate = weeklySavingsVelocity > 0 ? weeklySavingsVelocity / 7 : 15

    const coinDays = coinsRemaining > 0 ? Math.ceil(coinsRemaining / dailyCoinRate) : 0
    const savingsDays = realCostRemaining > 0 ? Math.ceil(realCostRemaining / dailySavingsRate) : 0
    etaDays = Math.max(coinDays, savingsDays)
  }

  return {
    coinsPercent,
    realCostPercent,
    overallPercent,
    coinsRemaining,
    realCostRemaining,
    isReady,
    etaDays
  }
}

export type LootType = 'coins' | 'shield' | 'vault_boost' | 'multiplier_24h'

export interface ChestLootDrop {
  type: LootType
  value: number
  label: string
  description: string
}

/**
 * Enhanced chest roll engine with tiered mystery loot drops:
 * - 60% chance: Coins Jackpot (scaled with level)
 * - 20% chance: Streak Shield (free shield added to inventory)
 * - 15% chance: Reward Vault Real-Money Boost (+25..+100 real currency)
 * - 5% chance: 24h 2x Super Multiplier
 */
export function rollEnhancedChest(level: number, rand = Math.random()): ChestLootDrop {
  const roll = rand * 100

  if (roll < 60) {
    // Coins jackpot
    const baseMin = 15 + level * 3
    const baseMax = 50 + level * 8
    const coins = Math.round(baseMin + Math.random() * (baseMax - baseMin))
    return {
      type: 'coins',
      value: coins,
      label: `+${coins} Coins Jackpot!`,
      description: `Discipline dividends credited directly to your points wallet.`
    }
  }

  if (roll < 80) {
    // Streak Shield drop!
    return {
      type: 'shield',
      value: 1,
      label: '🛡️ Legendary Streak Shield!',
      description: 'Added 1 Streak Shield to your inventory. Your streaks are protected!'
    }
  }

  if (roll < 95) {
    // Real-Money Reward Vault Cash Boost
    const boost = 25 + Math.floor(Math.random() * 4) * 25 // 25, 50, 75, or 100
    return {
      type: 'vault_boost',
      value: boost,
      label: `💰 +${boost} Vault Cash Bonus!`,
      description: `Real money surplus credited to your Reward Vault for real-world rewards.`
    }
  }

  // 5% Epic: 24h 2x Super Multiplier
  return {
    type: 'multiplier_24h',
    value: 2,
    label: '⚡ 24h 2x Super Multiplier Shard!',
    description: 'Double all coin earnings across all tasks and workouts for the next 24 hours!'
  }
}

export type SupportedCurrency = 'MDL' | 'USD' | 'EUR' | 'RON'

export interface CurrencyConfig {
  code: SupportedCurrency
  name: string
  symbol: string
  /** Standard rate relative to 1 USD */
  rateToUsd: number
}

export const CURRENCY_CONFIGS: Record<SupportedCurrency, CurrencyConfig> = {
  MDL: { code: 'MDL', name: 'Moldovan Leu (Lei)', symbol: 'MDL', rateToUsd: 18.0 },
  USD: { code: 'USD', name: 'US Dollar', symbol: '$', rateToUsd: 1.0 },
  EUR: { code: 'EUR', name: 'Euro', symbol: '€', rateToUsd: 0.92 },
  RON: { code: 'RON', name: 'Romanian Leu (Lei)', symbol: 'RON', rateToUsd: 4.6 }
}

export function convertCurrency(
  amount: number,
  from: string,
  to: string,
  customUsdRate?: number
): number {
  if (from === to || amount === 0) return amount
  const fromCfg = CURRENCY_CONFIGS[from as SupportedCurrency] || CURRENCY_CONFIGS.MDL
  const toCfg = CURRENCY_CONFIGS[to as SupportedCurrency] || CURRENCY_CONFIGS.USD

  const fromRate = from === 'MDL' && customUsdRate ? customUsdRate : fromCfg.rateToUsd
  const toRate = to === 'MDL' && customUsdRate ? customUsdRate : toCfg.rateToUsd

  // Convert from -> USD -> to
  const inUsd = amount / fromRate
  const converted = inUsd * toRate
  return Math.round(converted)
}

export function formatDualCurrency(
  amount: number,
  primaryCurrency = 'MDL',
  customUsdRate = 18.0
): { primaryText: string; secondaryText: string; combinedText: string } {
  const isLei = primaryCurrency === 'MDL' || primaryCurrency === 'RON'
  const secondary = isLei ? 'USD' : 'MDL'
  const secondaryAmount = convertCurrency(amount, primaryCurrency, secondary, customUsdRate)

  const pSymbol = CURRENCY_CONFIGS[primaryCurrency as SupportedCurrency]?.symbol ?? primaryCurrency
  const sSymbol = CURRENCY_CONFIGS[secondary as SupportedCurrency]?.symbol ?? secondary

  const primaryText = pSymbol === '$' || pSymbol === '€' ? `${pSymbol}${amount}` : `${amount} ${primaryCurrency}`
  const secondaryText = sSymbol === '$' || sSymbol === '€' ? `${sSymbol}${secondaryAmount}` : `${secondaryAmount} ${secondary}`

  return {
    primaryText,
    secondaryText,
    combinedText: `${primaryText} (~${secondaryText})`
  }
}
