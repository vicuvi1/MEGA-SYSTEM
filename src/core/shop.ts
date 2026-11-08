import { daysBetween } from './dates'
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
  /** Night 11 (RF1–RF4): a cover emoji, a category, repeat rules, order, goals, bundles, a savings jar. */
  emoji?: string | null
  category?: RewardCategory | null
  /** Days to wait after a buy before you can buy it again (0 = no wait). */
  cooldownDays?: number
  /** At most this many buys a month (0 = no limit). */
  monthLimit?: number
  /** Bought once and gone: it archives itself after you buy it. */
  oneTime?: boolean
  /** Your own order on the page (drag to reorder). */
  sort?: number
  /** 1–3 when it is one of your "saving for" goals (1 shows on Today), else 0. */
  goalRank?: number
  /** A bundle: the rewards it is made of (e.g. "Gaming night"). */
  bundle?: number[] | null
  /** Points set aside in its savings jar (a wishlist goal), not spendable elsewhere. */
  jar?: number
  /** The wishlist goal that holds the jar. */
  jarGoalId?: number | null
  /** false: the points follow the real price (auto); true: keep the points as typed. */
  priceLocked?: boolean
}

/** The kinds of reward (RF1, then the shop shelves). */
export const REWARD_CATEGORIES = [
  { id: 'fun', label: 'Fun', emoji: '🎮' },
  { id: 'food', label: 'Food', emoji: '🍕' },
  { id: 'gear', label: 'Gear', emoji: '🎧' },
  { id: 'experience', label: 'Experience', emoji: '🎟️' },
  { id: 'selfcare', label: 'Self-care', emoji: '🧴' },
  { id: 'big', label: 'Big goal', emoji: '🏔️' },
  // Shop shelves (2026-11): the older six stay, these four are new.
  { id: 'games', label: 'Games and screen', emoji: '🕹️' },
  { id: 'media', label: 'Movies and anime', emoji: '🎬' },
  { id: 'people', label: 'People', emoji: '💬' },
  { id: 'treat', label: 'Small treat', emoji: '🍬' }
] as const
export type RewardCategory = (typeof REWARD_CATEGORIES)[number]['id']
export const isRewardCategory = (c: unknown): c is RewardCategory => REWARD_CATEGORIES.some((x) => x.id === c)
/** The cover emoji: its own, else its category's, else a gift. */
export const rewardEmoji = (r: Pick<Reward, 'emoji' | 'category'>): string => r.emoji?.trim() || REWARD_CATEGORIES.find((c) => c.id === r.category)?.emoji || '🎁'

/** Why a repeatable reward can't be bought again yet (RF2), or null. `buys`: days of your buys that still count. */
export function repeatBlocker(r: Pick<Reward, 'cooldownDays' | 'monthLimit'>, buys: string[], today: string): string | null {
  const cd = Math.max(0, Math.floor(r.cooldownDays ?? 0))
  if (cd > 0 && buys.length) {
    const last = [...buys].sort().at(-1)!
    const wait = cd - daysBetween(last, today)
    if (wait > 0) return wait === 1 ? 'You can get it again tomorrow' : `You can get it again in ${wait} days`
  }
  const lim = Math.max(0, Math.floor(r.monthLimit ?? 0))
  if (lim > 0) {
    const used = buys.filter((d) => d.slice(0, 7) === today.slice(0, 7)).length
    if (used >= lim) return `Used ${used} of ${lim} this month`
  }
  return null
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
  /** Days of this reward's buys that still count, and today (for cooldowns and monthly limits). */
  buys?: string[]
  today?: string
}

/** Why a reward can't be bought right now, or null if it can. */
export function redeemBlocker(c: RedeemCheck): string | null {
  const { reward, balance, level, monthSpent, budget } = c
  if (reward.archived) return 'This reward is archived'
  // No levels any more: every reward is open; points and the money budget decide.
  void level
  if (c.today) {
    const again = repeatBlocker(reward, c.buys ?? [], c.today)
    if (again) return again
  }
  // Points already in its savings jar count toward it.
  const have = balance + Math.max(0, reward.jar ?? 0)
  if (have < reward.price) return `You need ${reward.price - have} more points`
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
  if (r.category != null && !isRewardCategory(r.category)) throw new LedgerError('Unknown category')
  for (const n of [r.cooldownDays ?? 0, r.monthLimit ?? 0]) if (!Number.isInteger(n) || n < 0 || n > 365) throw new LedgerError('Cooldown and monthly limit are whole numbers from 0 to 365')
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
