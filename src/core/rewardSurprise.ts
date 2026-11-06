// Surprises that stay honest (pure, tested). A level chest gives the small
// coin bonus it always gave, or a coupon: a free small treat from your own
// list, or a discount on your next reward. The weekly mystery reward opens
// once your week's top 3 are all done and gives a coupon too. Coupons create
// no points: they only make one reward cheaper (or free) when you buy it, and
// undoing that buy gives the coupon back.
import { addDays, daysBetween } from './dates'
import { rollChest } from './shop'

export const REWARD_COUPONS = 'reward_coupons'
/** A small treat: the most a free coupon can cover. */
export const SMALL_TREAT_MAX = 150
export const COUPON_DAYS = 14

export interface Coupon {
  id: string
  kind: 'free' | 'off'
  /** free: the reward it is for. */
  rewardId?: number
  title?: string
  /** off: percent off one reward. */
  pct?: number
  /** Where it came from: "chest:L4" or "mystery:2026-11-02". */
  from: string
  made: string
  expires: string
  /** The buy that used it (a ledger id); it comes back if that buy is undone. */
  usedBy?: number | null
}

export function cleanCoupons(v: any): Coupon[] {
  if (!Array.isArray(v)) return []
  const out: Coupon[] = []
  for (const c of v) {
    if (!c || typeof c.id !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(String(c.made)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(c.expires))) continue
    if (c.kind === 'free' && Number(c.rewardId) > 0)
      out.push({ id: c.id.slice(0, 40), kind: 'free', rewardId: Number(c.rewardId), title: String(c.title ?? '').slice(0, 80), from: String(c.from ?? '').slice(0, 40), made: c.made, expires: c.expires, usedBy: Number(c.usedBy) > 0 ? Number(c.usedBy) : null })
    else if (c.kind === 'off' && Number(c.pct) > 0)
      out.push({ id: c.id.slice(0, 40), kind: 'off', pct: Math.min(50, Math.round(Number(c.pct))), from: String(c.from ?? '').slice(0, 40), made: c.made, expires: c.expires, usedBy: Number(c.usedBy) > 0 ? Number(c.usedBy) : null })
  }
  return out.slice(-40)
}

/** Coupons you can still use today. `liveIds`: ledger ids that still count (an undone buy frees its coupon). */
export function openCoupons(all: Coupon[], today: string, liveIds?: Set<number>): Coupon[] {
  return all.filter((c) => c.expires >= today && (!c.usedBy || (liveIds != null && !liveIds.has(c.usedBy))))
}

/** The coupon a buy of this reward would use (a free one for it first, then the biggest % off), and the price after it. */
export function couponFor(reward: { id: number; price: number }, open: Coupon[]): { coupon: Coupon | null; price: number } {
  const free = open.find((c) => c.kind === 'free' && c.rewardId === reward.id)
  if (free) return { coupon: free, price: 0 }
  const off = [...open].filter((c) => c.kind === 'off').sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0) || (a.expires < b.expires ? -1 : 1))[0]
  if (off) return { coupon: off, price: Math.max(0, Math.round(reward.price * (1 - (off.pct ?? 0) / 100))) }
  return { coupon: null, price: reward.price }
}

/** "Free: Pizza night" / "25% off one reward" and "12 days left". */
export function couponText(c: Coupon, today: string): { title: string; left: string } {
  const d = daysBetween(today, c.expires)
  return { title: c.kind === 'free' ? `Free: ${c.title || 'a small treat'}` : `${c.pct}% off one reward`, left: d <= 0 ? 'Last day' : d === 1 ? '1 day left' : `${d} days left` }
}

// ---------- What's in a chest ----------

export type ChestPrize = { kind: 'coins'; coins: number } | { kind: 'free'; rewardId: number; title: string } | { kind: 'off'; pct: number }

/** Small treats from your own list a free coupon can be for (repeatable, at most SMALL_TREAT_MAX points). */
export function smallTreats<T extends { id: number; price: number; oneTime?: boolean; archived?: boolean }>(rewards: T[]): T[] {
  return rewards.filter((r) => !r.archived && !r.oneTime && r.price > 0 && r.price <= SMALL_TREAT_MAX)
}

/**
 * The prize for one chest. `a` picks the kind, `b` the size or the treat
 * (both 0..1): 30% a free small treat from your list (when you have one),
 * 20% 25% off, else the coins chests always gave (rollChest).
 */
export function rollChestPrize(level: number, a: number, b: number, treats: { id: number; title: string }[]): ChestPrize {
  if (a < 0.3 && treats.length) {
    const t = treats[Math.min(treats.length - 1, Math.floor(b * treats.length))]
    return { kind: 'free', rewardId: t.id, title: t.title }
  }
  if (a < 0.5) return { kind: 'off', pct: 25 }
  return { kind: 'coins', coins: rollChest(level, b) }
}

/** A coupon for a prize (none for coins). */
export function prizeCoupon(p: ChestPrize, from: string, today: string, id: string): Coupon | null {
  if (p.kind === 'coins') return null
  const base = { id, from, made: today, expires: addDays(today, COUPON_DAYS), usedBy: null }
  return p.kind === 'free' ? { ...base, kind: 'free', rewardId: p.rewardId, title: p.title } : { ...base, kind: 'off', pct: p.pct }
}

export const prizeText = (p: ChestPrize) => (p.kind === 'coins' ? `+${p.coins} points` : p.kind === 'free' ? `Free: ${p.title}` : `${p.pct}% off your next reward`)

// ---------- The weekly mystery reward ----------

export interface MysteryState {
  week: string | null
  /** How many of the week's top 3 are done (0 when no top 3 this week). */
  done: number
  total: number
  ready: boolean
  claimed: boolean
}

/** Open once a week, when all of this week's top 3 are done. */
export function mysteryState(plan: { week: string; big3: { done: boolean }[] } | null, week: string, coupons: Coupon[]): MysteryState {
  const active = plan && plan.week === week ? plan : null
  const total = active?.big3.length ?? 0
  const done = active?.big3.filter((b) => b.done).length ?? 0
  const claimed = coupons.some((c) => c.from === `mystery:${week}`)
  return { week: active ? week : null, done, total, ready: total >= 3 && done >= total && !claimed, claimed }
}

/** The mystery prize: 60% a free small treat from your list (when you have one), else 30% off. Never coins. */
export function rollMystery(a: number, b: number, treats: { id: number; title: string }[]): ChestPrize {
  if (a < 0.6 && treats.length) {
    const t = treats[Math.min(treats.length - 1, Math.floor(b * treats.length))]
    return { kind: 'free', rewardId: t.id, title: t.title }
  }
  return { kind: 'off', pct: 30 }
}
