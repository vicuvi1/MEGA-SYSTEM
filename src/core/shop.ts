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
}

export const DEFAULT_REWARDS: Omit<Reward, 'id'>[] = [
  { title: 'Face cream', price: 300, tier: 'bronze', realCost: 250, pinned: false, archived: false, note: null },
  { title: 'New phone case', price: 600, tier: 'bronze', realCost: 300, pinned: true, archived: false, note: null },
  { title: 'Shaver machine', price: 1500, tier: 'silver', realCost: 900, pinned: false, archived: false, note: null },
  { title: 'Kaaba trip fund', price: 20000, tier: 'legendary', realCost: 0, pinned: false, archived: false, note: 'The big one. Keep stacking.' }
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
