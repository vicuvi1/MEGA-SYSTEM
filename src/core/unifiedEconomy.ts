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
  const safeAmount = Number.isFinite(amount) ? amount : 0
  if (from === to || safeAmount === 0) return safeAmount
  const fromCfg = CURRENCY_CONFIGS[from as SupportedCurrency] || CURRENCY_CONFIGS.MDL
  const toCfg = CURRENCY_CONFIGS[to as SupportedCurrency] || CURRENCY_CONFIGS.USD

  const fromRate = from === 'MDL' && customUsdRate && customUsdRate > 0 ? customUsdRate : fromCfg.rateToUsd
  const toRate = to === 'MDL' && customUsdRate && customUsdRate > 0 ? customUsdRate : toCfg.rateToUsd

  const safeFromRate = Math.max(0.0001, fromRate || 1)
  const safeToRate = Math.max(0.0001, toRate || 1)

  // Convert from -> USD -> to
  const inUsd = safeAmount / safeFromRate
  const converted = inUsd * safeToRate
  return Math.round(converted)
}

export function formatDualCurrency(
  amount: number,
  primaryCurrency = 'MDL',
  customUsdRate = 18.0
): { primaryText: string; secondaryText: string; combinedText: string } {
  const safeAmount = Number.isFinite(amount) ? amount : 0
  const isLei = primaryCurrency === 'MDL' || primaryCurrency === 'RON'
  const secondary = isLei ? 'USD' : 'MDL'
  const secondaryAmount = convertCurrency(safeAmount, primaryCurrency, secondary, customUsdRate)

  const pSymbol = CURRENCY_CONFIGS[primaryCurrency as SupportedCurrency]?.symbol ?? primaryCurrency
  const sSymbol = CURRENCY_CONFIGS[secondary as SupportedCurrency]?.symbol ?? secondary

  const primaryText = pSymbol === '$' || pSymbol === '€' ? `${pSymbol}${safeAmount}` : `${safeAmount} ${primaryCurrency}`
  const secondaryText = sSymbol === '$' || sSymbol === '€' ? `${sSymbol}${secondaryAmount}` : `${secondaryAmount} ${secondary}`

  return {
    primaryText,
    secondaryText,
    combinedText: `${primaryText} (~${secondaryText})`
  }
}


// --- SHADOW ECONOMY 2.0: THE IRON BANK & STAKING ENGINE ---

export interface BankState {
  stakedCoins: number
  maxStakingCap: number
  dailyRatePercent: number
  pendingInterest: number
  totalInterestEarned: number
  lastClaimDay: string | null
  streakBonusActive: boolean
  cleanStreak: number
}

/**
 * Calculates staking cap based on hunter level:
 * Formula: 250 + (level * 250) coins.
 */
export function computeMaxStakingCap(level: number): number {
  const safeLevel = Math.max(1, Math.floor(level || 1))
  return 250 + safeLevel * 250
}

/**
 * Computes daily dividend interest rate for staked coins:
 * - Base rate: 0.5% daily (0.005)
 * - 7+ day clean streak: 0.8% daily (0.008)
 * - 14+ day clean streak: 1.2% daily (0.012)
 * - 30+ day clean streak: 1.5% daily (0.015)
 */
export function computeDailyInterestRate(cleanStreak: number): {
  rate: number
  percent: number
  streakBonusActive: boolean
} {
  const safeStreak = Math.max(0, cleanStreak || 0)
  if (safeStreak >= 30) {
    return { rate: 0.015, percent: 1.5, streakBonusActive: true }
  }
  if (safeStreak >= 14) {
    return { rate: 0.012, percent: 1.2, streakBonusActive: true }
  }
  if (safeStreak >= 7) {
    return { rate: 0.008, percent: 0.8, streakBonusActive: true }
  }
  return { rate: 0.005, percent: 0.5, streakBonusActive: false }
}

/**
 * Computes estimated daily coin dividend from staked amount:
 * If staked >= 50 coins, minimum yield is 1 coin/day.
 */
export function computeDailyDividend(stakedCoins: number, cleanStreak: number): number {
  if (stakedCoins <= 0) return 0
  const { rate } = computeDailyInterestRate(cleanStreak)
  const calculated = Math.floor(stakedCoins * rate)
  return stakedCoins >= 50 ? Math.max(1, calculated) : calculated
}

/**
 * Calculates accrued pending interest between lastClaimDay and currentDay.
 */
export function calculateAccruedInterest(
  stakedCoins: number,
  lastClaimDay: string | null,
  currentDay: string,
  cleanStreak: number
): { pendingInterest: number; daysPassed: number } {
  if (stakedCoins <= 0 || !currentDay) {
    return { pendingInterest: 0, daysPassed: 0 }
  }
  if (!lastClaimDay) {
    // Staked today; first dividend matures next day
    return { pendingInterest: 0, daysPassed: 0 }
  }
  if (lastClaimDay >= currentDay) {
    return { pendingInterest: 0, daysPassed: 0 }
  }

  const lastTime = Date.parse(`${lastClaimDay}T00:00:00Z`);
  const currTime = Date.parse(`${currentDay}T00:00:00Z`);
  if (isNaN(lastTime) || isNaN(currTime) || currTime <= lastTime) {
    return { pendingInterest: 0, daysPassed: 0 }
  }

  const msPerDay = 86400000;
  const daysPassed = Math.floor((currTime - lastTime) / msPerDay);
  if (daysPassed <= 0) {
    return { pendingInterest: 0, daysPassed: 0 }
  }

  const dailyYield = computeDailyDividend(stakedCoins, cleanStreak);
  const pendingInterest = dailyYield * daysPassed;
  return { pendingInterest, daysPassed };
}

// --- SHADOW ECONOMY 2.0: HUNTER CONSUMABLES & ACTIVE BUFFS ---

export type ConsumableId = 'focus_elixir' | 'xp_booster' | 'streak_shield' | 'fatigue_neutralizer'

export type BuffEffectKind = 'multiplier_boost' | 'xp_boost' | 'streak_shield' | 'workout_cap_reset'

export interface ConsumableItem {
  id: ConsumableId
  name: string
  title: string
  description: string
  costCoins: number
  durationHours: number
  icon: string
  effectKind: BuffEffectKind
  effectValue: number
  rarity: 'common' | 'rare' | 'epic' | 'legendary'
  quote: string
}

export const CONSUMABLE_CATALOG: ConsumableItem[] = [
  {
    id: 'focus_elixir',
    name: 'Focus Elixir of the Shadow Monarch',
    title: 'Focus Elixir',
    description: 'Doubles (2.0x) all coin earnings on completed tasks and schedule blocks for 2 hours.',
    costCoins: 20,
    durationHours: 2,
    icon: '🧪',
    effectKind: 'multiplier_boost',
    effectValue: 2.0,
    rarity: 'rare',
    quote: '"Your senses sharpen into absolute, unbroken focus."'
  },
  {
    id: 'xp_booster',
    name: 'Grand Hunter Awakening Draught',
    title: 'XP Booster',
    description: 'Increases all XP earned from tasks, blocks, and workouts by +50% for 3 hours.',
    costCoins: 25,
    durationHours: 3,
    icon: '⚡',
    effectKind: 'xp_boost',
    effectValue: 1.5,
    rarity: 'rare',
    quote: '"The flow of mana accelerates your cellular ascension."'
  },
  {
    id: 'streak_shield',
    name: 'Aegis of the Immortal Vanguard',
    title: 'Streak Aegis Shield',
    description: 'Adds +1 Streak Shield to your inventory. Protects all streaks from resetting if you miss a day.',
    costCoins: 50,
    durationHours: 0,
    icon: '🛡️',
    effectKind: 'streak_shield',
    effectValue: 1,
    rarity: 'epic',
    quote: '"An unyielding barrier shielding your hard-won discipline from rupture."'
  },
  {
    id: 'fatigue_neutralizer',
    name: 'System Fatigue Recovery Capsule',
    title: 'Fatigue Neutralizer',
    description: 'Instantly cleanses workout muscle exhaustion and resets daily workout coin caps.',
    costCoins: 15,
    durationHours: 0,
    icon: '💊',
    effectKind: 'workout_cap_reset',
    effectValue: 1,
    rarity: 'common',
    quote: '"Lactic acid dissolved. Physical vitality restored to baseline."'
  }
];

export interface ActiveBuff {
  id: string
  itemId: string
  title: string
  expiresAt: string
  effectKind: BuffEffectKind | string
  effectVal: number
  icon: string
  remainingSeconds: number
}
