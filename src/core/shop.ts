import { LedgerError } from './ledger'

// Tiers unlock with level, adapted from Waky's game.py tiers.
export type Tier = 'bronze' | 'silver' | 'gold' | 'legendary'

export const TIERS: Record<Tier, { label: string; minLevel: number; color: string }> = {
  bronze: { label: 'Bronze', minLevel: 1, color: '#D59A6A' },
  silver: { label: 'Silver', minLevel: 5, color: '#C9D3E3' },
  gold: { label: 'Gold', minLevel: 10, color: '#F5C84B' },
  legendary: { label: 'Legendary', minLevel: 20, color: '#B892FF' }
}

export function isTier(t: string): t is Tier {
  return t in TIERS
}

export interface Reward {
  id: number
  title: string
  price: number // coins
  tier: Tier
  realCost: number // real money, whole units of the chosen currency
  pinned: boolean
  archived: boolean
  note: string | null
  imageUrl?: string | null
  productUrl?: string | null
  currency?: string | null
}

export const DEFAULT_REWARDS: Omit<Reward, 'id'>[] = [
  {
    title: 'Face cream & skincare',
    price: 300,
    tier: 'bronze',
    realCost: 30,
    pinned: false,
    archived: false,
    note: 'Premium facial cleanser & hydration moisturizer.',
    imageUrl: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=600&auto=format&fit=crop&q=80',
    productUrl: 'https://farmaciafamiliei.md/skincare',
    currency: 'MDL'
  },
  {
    title: 'New phone case & screen armor',
    price: 600,
    tier: 'bronze',
    realCost: 60,
    pinned: true,
    archived: false,
    note: 'Sleek matte shockproof protection.',
    imageUrl: 'https://images.unsplash.com/photo-1584438784894-089d6a62b8fa?w=600&auto=format&fit=crop&q=80',
    productUrl: 'https://darwin.md/huse-accesorii-telefoane',
    currency: 'MDL'
  },
  {
    title: 'Pro grooming shaver machine',
    price: 1500,
    tier: 'silver',
    realCost: 150,
    pinned: false,
    archived: false,
    note: 'Precision cordless beard & hair trimmer.',
    imageUrl: 'https://images.unsplash.com/photo-1621607512214-68297480165e?w=600&auto=format&fit=crop&q=80',
    productUrl: 'https://darwin.md/aparate-de-tuns-barbierit',
    currency: 'MDL'
  },
  {
    title: 'Kaaba spiritual trip fund',
    price: 20000,
    tier: 'legendary',
    realCost: 2000,
    pinned: false,
    archived: false,
    note: 'The big spiritual milestone. Keep stacking and building.',
    imageUrl: 'https://images.unsplash.com/photo-1591604129939-f1efa4d9f7fa?w=600&auto=format&fit=crop&q=80',
    productUrl: 'https://www.visitsaudi.com/en/umrah',
    currency: 'MDL'
  }
]

export function tierUnlocked(tier: Tier, level: number): boolean {
  return level >= TIERS[tier].minLevel
}

export interface RedeemCheck {
  reward: Reward
  balance: number
  level: number
  monthSpent: number // real money already used on rewards this month
  budget: number // monthly real-money cap, 0 = no cap
}

/** Why a reward can't be bought right now, or null if it can. */
export function redeemBlocker(c: RedeemCheck): string | null {
  const { reward, balance, level, monthSpent, budget } = c
  if (reward.archived) return 'This reward is archived'
  if (!tierUnlocked(reward.tier, level)) return `${TIERS[reward.tier].label} rewards unlock at level ${TIERS[reward.tier].minLevel}`
  if (balance < reward.price) return `You need ${reward.price - balance} more coins`
  if (budget > 0 && monthSpent + reward.realCost > budget) {
    return `Over this month's reward budget (${budget - monthSpent} left)`
  }
  return null
}

export function planRedeem(c: RedeemCheck): void {
  const why = redeemBlocker(c)
  if (why) throw new LedgerError(why)
}

export function validateReward(r: Omit<Reward, 'id'>): void {
  if (!r.title.trim()) throw new LedgerError('A reward needs a name')
  if (!Number.isInteger(r.price) || r.price <= 0) throw new LedgerError('Price must be a whole number of coins above 0')
  if (!Number.isInteger(r.realCost) || r.realCost < 0) throw new LedgerError('Real cost must be a whole number, 0 or more')
  if (!isTier(r.tier)) throw new LedgerError('Unknown tier')
}

// ---- Chests: one per level reached, opened for a random coin bonus ----

export function chestRef(level: number): string {
  return `chest:L${level}`
}

/** Levels whose chest is earned (level 2 and up) but not opened yet. */
export function unopenedChests(level: number, openedRefs: Iterable<string>): number[] {
  const opened = new Set(openedRefs)
  const out: number[] = []
  for (let l = 2; l <= level; l++) if (!opened.has(chestRef(l))) out.push(l)
  return out
}

/** Bigger chests at higher levels. `rand` is 0..1. */
export function rollChest(level: number, rand: number): number {
  const min = 10 + level * 2
  const max = 40 + level * 5
  return Math.round(min + rand * (max - min))
}

export interface EffortEquivalence {
  coins: number
  workouts: number // at 10 coins / workout
  studyBlocks: number // at 15 coins / focus block
  cleanDays: number // at 20 coins / clean checkin
  dailyRitualsDays: number // at 41 coins / all 5 daily rituals
  summaryText: string
}

export function calculateEffortEquivalence(coins: number): EffortEquivalence {
  const safeCoins = Math.max(1, coins || 1)
  const workouts = Math.ceil(safeCoins / 10)
  const studyBlocks = Math.ceil(safeCoins / 15)
  const cleanDays = Math.ceil(safeCoins / 20)
  const dailyRitualsDays = Math.ceil(safeCoins / 41)
  return {
    coins: safeCoins,
    workouts,
    studyBlocks,
    cleanDays,
    dailyRitualsDays,
    summaryText: `~${cleanDays} clean days or ~${workouts} workouts`
  }
}
