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

/** Starter rewards for the demo (made up; the real ones live in your database). */
export const DEFAULT_REWARDS: Omit<Reward, 'id'>[] = [
  { title: 'Coffee and a pastry out', price: 300, tier: 'bronze', realCost: 60, pinned: false, archived: false, note: 'A slow morning somewhere nice.', imageUrl: null, productUrl: null, currency: 'MDL' },
  { title: 'New paperback book', price: 600, tier: 'bronze', realCost: 150, pinned: true, archived: false, note: 'Any book from the wish list.', imageUrl: null, productUrl: 'https://shop.example.com/books', currency: 'MDL' },
  { title: 'Wireless earbuds', price: 1500, tier: 'silver', realCost: 600, pinned: false, archived: false, note: 'For runs and the bus.', imageUrl: null, productUrl: 'https://shop.example.com/earbuds', currency: 'MDL' },
  { title: 'Weekend trip fund', price: 20000, tier: 'legendary', realCost: 3000, pinned: false, archived: false, note: 'The big one. Keep stacking.', imageUrl: null, productUrl: null, currency: 'MDL' }
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
  // No levels any more: every reward is open; points and the money budget decide.
  void level
  if (balance < reward.price) return `You need ${reward.price - balance} more points`
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

/** Points you earn on an average day (last 30 days, days with any earning). */
export function earnPerDay(entries: { day: string; kind: string; coins: number }[], today: string): number {
  const from = new Date(`${today}T12:00:00Z`)
  from.setUTCDate(from.getUTCDate() - 30)
  const start = from.toISOString().slice(0, 10)
  const byDay = new Map<string, number>()
  for (const e of entries) if (e.kind === 'earn' && e.coins > 0 && e.day >= start && e.day <= today) byDay.set(e.day, (byDay.get(e.day) ?? 0) + e.coins)
  if (byDay.size < 3) return 0
  return Math.round([...byDay.values()].reduce((a, b) => a + b, 0) / byDay.size)
}

/** "About 3 days" of your usual earning for a price (null while there's too little history). */
export function priceInDays(price: number, perDay: number): string | null {
  if (!(perDay > 0) || !(price > 0)) return null
  const d = price / perDay
  return d < 0.75 ? 'less than a day' : d < 1.5 ? 'about a day' : `about ${Math.round(d)} days`
}
