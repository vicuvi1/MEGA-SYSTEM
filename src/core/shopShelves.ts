// The Rewards shop (pure logic): shelves, rarity by price, today's featured
// pick, the monthly budget meter and a starter list for empty shelves.
// Nothing here makes points: it only decides how rewards are shown. Points
// still come only from real, logged work, and buying spends them in Shop.redeem.
import type { Reward, RewardCategory } from './shop'

/** The owner's rule: 10 points = 1 lei, on every card and starter item. */
export const POINTS_PER_LEI = 10

export type ShelfId = 'big' | 'food' | 'games' | 'media' | 'tech' | 'skin' | 'people' | 'treat'
export const SHELVES: { id: ShelfId; label: string; emoji: string; cats: RewardCategory[]; blurb: string }[] = [
  { id: 'big', label: 'Big goals', emoji: '🏔️', cats: ['big'], blurb: 'Worth saving up for' },
  { id: 'food', label: 'Food', emoji: '🍕', cats: ['food'], blurb: 'Meals out, sweets and snacks' },
  { id: 'games', label: 'Games and screen', emoji: '🕹️', cats: ['games', 'fun'], blurb: 'Game time, guilt-free' },
  { id: 'media', label: 'Movies and anime', emoji: '🎬', cats: ['media', 'experience'], blurb: 'Series, anime, manga, YouTube' },
  { id: 'tech', label: 'Tech', emoji: '🎧', cats: ['gear'], blurb: 'Audio, parts, learning gear' },
  { id: 'skin', label: 'Skincare and grooming', emoji: '🧴', cats: ['selfcare'], blurb: 'Basics that look after you' },
  { id: 'people', label: 'People', emoji: '💬', cats: ['people'], blurb: 'Time with people you like' },
  { id: 'treat', label: 'Treat yourself small', emoji: '🍬', cats: ['treat'], blurb: 'Little rewards for a good day' }
]

/** Which shelf a reward sits on. A reward with no category goes to "Treat yourself small". */
export function shelfOf(r: Pick<Reward, 'category'>): ShelfId {
  return SHELVES.find((s) => r.category != null && s.cats.includes(r.category))?.id ?? 'treat'
}

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary'
export const RARITY_LABEL: Record<Rarity, string> = { common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' }
/** By price in points (10 points = 1 lei): under 50 lei common, under 150 rare, under 500 epic, then legendary. */
export function rarityOf(points: number): Rarity {
  if (points < 500) return 'common'
  if (points < 1500) return 'rare'
  if (points < 5000) return 'epic'
  return 'legendary'
}

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/** Today's featured reward: the same one all day, a different one most days. Not random, and it changes no price. */
export function featuredPick<T extends { id: number }>(candidates: T[], day: string): T | null {
  if (!candidates.length) return null
  const sorted = [...candidates].sort((a, b) => a.id - b.id)
  return sorted[hash(day) % sorted.length]
}

export type BudgetState = 'ok' | 'close' | 'over'
export interface BudgetMeter {
  state: BudgetState
  /** 0..1 for the bar. */
  frac: number
  left: number
  line: string
}
export const DEFAULT_MONTH_BUDGET_LEI = 500
/** A soft meter only: it warns, it never blocks a buy. */
export function budgetMeter(spentLei: number, budgetLei: number | null | undefined): BudgetMeter {
  const budget = budgetLei != null && budgetLei > 0 ? budgetLei : DEFAULT_MONTH_BUDGET_LEI
  const spent = Math.max(0, spentLei)
  const frac = Math.min(1, spent / budget)
  const left = Math.round(budget - spent)
  if (spent > budget) return { state: 'over', frac, left, line: `${Math.round(spent - budget)} lei over this month's budget. Still your call.` }
  if (spent >= budget * 0.8) return { state: 'close', frac, left, line: `Getting close: ${left} lei left this month.` }
  return { state: 'ok', frac, left, line: `${left} lei left this month.` }
}

/** Lei spent on rewards in a month, from the history (undone buys do not count). */
export function monthSpendLei(recent: { day: string; realCost?: number | null; undone?: boolean }[], month: string): number {
  return recent.reduce((n, x) => (!x.undone && x.day.slice(0, 7) === month ? n + Math.max(0, x.realCost ?? 0) : n), 0)
}

export interface StarterItem {
  title: string
  /** Points. Paid items: points = real price in lei x 10. Free time items cost points only (realCost 0). The owner edits it. */
  price: number
  realCost: number
  emoji: string
  note: string
  category: RewardCategory
}
/** Made-up starter rewards for an empty shelf. One tap adds them; the owner edits prices. */
export const STARTERS: Record<ShelfId, StarterItem[]> = {
  big: [{ title: 'Big goal: new gear', price: 8000, realCost: 800, emoji: '🏔️', note: 'Name it, then save up in your jar.', category: 'big' }],
  food: [
    { title: 'Pizza night', price: 1500, realCost: 150, emoji: '🍕', note: 'Your favourite pizza.', category: 'food' },
    { title: 'High-protein dinner out', price: 1800, realCost: 180, emoji: '🥩', note: 'A good meal after a hard week.', category: 'food' },
    { title: 'Sweets and snacks', price: 300, realCost: 30, emoji: '🍫', note: 'A small guilt-free snack.', category: 'food' }
  ],
  games: [
    { title: '1 hour of gaming', price: 150, realCost: 0, emoji: '🎮', note: 'Time-boxed, guilt-free.', category: 'games' },
    { title: 'New PC game', price: 2500, realCost: 250, emoji: '🕹️', note: 'One game from the wish list.', category: 'games' }
  ],
  media: [
    { title: 'Movie night', price: 1000, realCost: 100, emoji: '🎬', note: 'Cinema or a film at home.', category: 'media' },
    { title: 'Anime or YouTube, 1 hour', price: 100, realCost: 0, emoji: '📺', note: 'Guilt-free, then stop.', category: 'media' },
    { title: 'Manga volume', price: 1200, realCost: 120, emoji: '📖', note: 'The next volume.', category: 'media' }
  ],
  tech: [
    { title: 'Headphones', price: 6000, realCost: 600, emoji: '🎧', note: 'Good sound for focus and play.', category: 'gear' },
    { title: 'SSD', price: 5000, realCost: 500, emoji: '💾', note: 'More fast storage.', category: 'gear' },
    { title: 'Book or course', price: 2500, realCost: 250, emoji: '📚', note: 'Something that teaches you.', category: 'gear' }
  ],
  skin: [
    { title: 'SPF 50 sunscreen', price: 2500, realCost: 250, emoji: '🧴', note: 'The one skincare habit that matters most.', category: 'selfcare' },
    { title: 'Hydrating gel-cream', price: 2000, realCost: 200, emoji: '💧', note: 'Daily moisturiser.', category: 'selfcare' },
    { title: 'Retinol night cream', price: 2200, realCost: 220, emoji: '🌙', note: 'For the night routine.', category: 'selfcare' },
    { title: 'Niacinamide serum', price: 1500, realCost: 150, emoji: '🧪', note: 'A light daily serum.', category: 'selfcare' },
    { title: 'Haircut', price: 1200, realCost: 120, emoji: '💈', note: 'Fresh cut.', category: 'selfcare' }
  ],
  people: [{ title: 'Chat with her, 1 hour', price: 200, realCost: 0, emoji: '💬', note: 'Earned time, no guilt.', category: 'people' }],
  treat: [
    { title: 'Coffee and a pastry', price: 400, realCost: 40, emoji: '☕', note: 'A slow break.', category: 'treat' },
    { title: 'A walk and a podcast', price: 80, realCost: 0, emoji: '🎧', note: 'Small and free.', category: 'treat' }
  ]
}
