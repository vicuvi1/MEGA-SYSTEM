/**
 * Night 11 (RL1–RL7): the monthly fun budget and what rewards really cost.
 *
 * - `fun_budget` (settings): {lei, source}. 'manual' = you typed it;
 *   'finance' = taken from a Finance Helper category limit named Fun or
 *   Entertainment (read live, the stored lei is the fallback).
 * - What you spent on fun this month: the rewards you bought (what you
 *   really paid, in lei) plus, with a Finance Helper budget, that category's
 *   other spending (reward records it already holds are not counted twice).
 * - Prices from real cost (suggestPoints), hours of work, the saving streak.
 * Pure: no database here.
 */
import { pointsForLei, type PointValue } from './pointValue'

export interface FunBudgetSetting {
  lei: number
  source: 'manual' | 'finance'
}

export function parseFunBudget(raw: string | null | undefined): FunBudgetSetting | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw)
    const lei = Number(v?.lei)
    if (!Number.isFinite(lei) || lei < 0) return null
    return { lei: Math.round(lei), source: v?.source === 'finance' ? 'finance' : 'manual' }
  } catch {
    return null
  }
}

/**
 * The old `reward_budget` (whole lei, 0 = none) becomes the fun budget once.
 * Returns what to store (null = nothing to move).
 */
export function migrateRewardBudget(funRaw: string | null | undefined, oldRaw: string | null | undefined): FunBudgetSetting | null {
  if (parseFunBudget(funRaw)) return null
  const old = Math.round(Number(oldRaw ?? 0))
  return Number.isFinite(old) && old > 0 ? { lei: old, source: 'manual' } : null
}

const FUN_NAME = /^(fun|entertainment|distrac|divertisment|развлеч)/i

/** Finance Helper's Fun / Entertainment category with a monthly limit (lei), if there is one. */
export function financeFunCategory(finance: any): { id: string; name: string; lei: number } | null {
  const cats: any[] = Array.isArray(finance?.settings?.categories) ? finance.settings.categories : []
  const hit = cats.find((c) => c && c.type === 'expense' && !c.archived && Number(c.budget) > 0 && (FUN_NAME.test(String(c.name ?? '').trim()) || c.id === 'fun'))
  return hit ? { id: String(hit.id), name: String(hit.name ?? 'Fun'), lei: Math.round(Number(hit.budget) / 100) } : null
}

/** The monthly fun budget in lei now (null = none). */
export function funBudgetLei(setting: FunBudgetSetting | null, finance: any): number | null {
  if (!setting) return null
  if (setting.source === 'finance') {
    const cat = financeFunCategory(finance)
    if (cat) return cat.lei
  }
  return setting.lei > 0 ? setting.lei : null
}

// Rough lei per unit, only when Finance Helper has no rates on this device.
const FALLBACK_LEI: Record<string, number> = { MDL: 1, LEI: 1, USD: 17.5, EUR: 19.5, RON: 3.9, GBP: 23, UAH: 0.42 }

/** An amount in some currency, in lei (Finance Helper's rates when it has them). null = unknown currency. */
export function toLei(amount: number, currency: string | null | undefined, rates?: any): number | null {
  const cur = String(currency || 'MDL').toUpperCase()
  if (cur === 'MDL' || cur === 'LEI') return amount
  const usd = rates?.usd
  if (usd && Number(usd[cur]) > 0 && Number(usd.MDL) > 0) return Math.round((amount / Number(usd[cur])) * Number(usd.MDL) * 100) / 100
  const k = FALLBACK_LEI[cur]
  return k ? Math.round(amount * k * 100) / 100 : null
}

/** A Finance Helper record's value in lei (its own base value, else converted; never a foreign amount as lei). */
export function txLei(t: any, rates?: any, baseCurrency = 'MDL'): number {
  if (Number.isFinite(Number(t?.amountMdl))) return Math.abs(Number(t.amountMdl)) / 100
  if (Number.isInteger(t?.base)) return Math.abs(t.base) / 100
  const cur = t?.currency || baseCurrency
  const v = toLei(Math.abs(Number(t?.amount) || 0) / 100, cur, rates)
  return v ?? 0
}

export const REWARD_FIN_PREFIX = 'life-reward-'
/** The stable id of a reward buy's record in Finance Helper (RL4). */
export const rewardFinId = (ledgerId: number) => `${REWARD_FIN_PREFIX}${ledgerId}`

export interface FunSpendInput {
  month: string // YYYY-MM
  /** Rewards bought this month and not undone: what you paid, in lei. */
  rewardBuysLei: number[]
  finance: any
  setting: FunBudgetSetting | null
}

/** Lei spent on fun this month. */
export function funSpentLei(i: FunSpendInput): number {
  let sum = i.rewardBuysLei.reduce((a, b) => a + (b > 0 ? b : 0), 0)
  const cat = i.setting?.source === 'finance' ? financeFunCategory(i.finance) : null
  if (cat && Array.isArray(i.finance?.tx)) {
    for (const t of i.finance.tx) {
      if (!t || t.deleted || t.type !== 'expense' || t.loan || String(t.category) !== cat.id) continue
      if (typeof t.date !== 'string' || !t.date.startsWith(i.month)) continue
      if (String(t.id ?? '').startsWith(REWARD_FIN_PREFIX)) continue // counted from the buy itself
      sum += txLei(t, i.finance?.rates, i.finance?.settings?.currency)
    }
  }
  return Math.round(sum * 100) / 100
}

/** RL5: how many hours of your work a price is (null when your hourly rate is unknown). */
export function hoursOfWork(lei: number, hourlyLei: number | null | undefined): number | null {
  if (!(Number(hourlyLei) > 0) || !(lei >= 0)) return null
  return Math.round((lei / Number(hourlyLei)) * 10) / 10
}

/** RL2: a fair price in points for a real cost in lei. */
export function suggestPoints(lei: number, v: PointValue): number {
  return pointsForLei(Math.max(0, lei), v)
}

export interface RepriceRow {
  id: number
  title: string
  price: number
  suggested: number
  lei: number
  /** 'points÷10' = the old forced price from migration 012 (price = 10 × cost). */
  why: 'old-fixed' | 'off'
}

/**
 * RL2: rewards whose price is far from their real cost in today's point
 * value. Only suggests (you choose to apply each one). Rewards with no real
 * cost are left alone; the old forced points = 10 × lei price is always listed.
 */
export function repriceSuggestions(rewards: { id: number; title: string; price: number; realCost: number; currency?: string | null; archived?: boolean }[], v: PointValue, rates?: any): RepriceRow[] {
  const out: RepriceRow[] = []
  for (const r of rewards) {
    if (r.archived || !(r.realCost > 0)) continue
    const lei = toLei(r.realCost, r.currency, rates)
    if (lei == null) continue
    const suggested = suggestPoints(lei, v)
    const oldFixed = r.price === r.realCost * 10
    const off = Math.abs(suggested - r.price) / Math.max(1, r.price) > 0.15
    if (suggested === r.price) continue
    if (oldFixed || off) out.push({ id: r.id, title: r.title, price: r.price, suggested, lei, why: oldFixed ? 'old-fixed' : 'off' })
  }
  return out
}

export interface JudgedDay {
  day: string
  /** At least one record made on the day itself (not back-dated, not imported). */
  logged: boolean
  under: boolean
}

/** RL6: consecutive judged days under budget, newest first; a day without a live log breaks it. */
export function savingStreak(days: JudgedDay[]): number {
  const sorted = [...days].sort((a, b) => (a.day < b.day ? 1 : -1))
  let n = 0
  for (const d of sorted) {
    if (!d.logged || !d.under) break
    n++
  }
  return n
}

export const SAVING_STREAK_BONUS: { days: number; points: number }[] = [
  { days: 3, points: 10 },
  { days: 7, points: 25 },
  { days: 14, points: 50 }
]

/** RL7: what is left of a month's budget to move to savings (whole lei, 0 = nothing). */
export function leftoverLei(budgetLei: number | null, spentLei: number): number {
  if (!(Number(budgetLei) > 0)) return 0
  return Math.max(0, Math.floor(Number(budgetLei) - Math.max(0, spentLei)))
}
