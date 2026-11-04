// Money and life (pure, tested): the spending coach (this week by category
// against your usual week, subscriptions you may have forgotten), "should I
// buy it?" from your budget, goals and price in work hours, and the sleep
// link that makes tomorrow's morning lighter after a short night.
// Amounts are integer bani (1 lei = 100) like Finance Helper.

import { addDays } from './dates'

export interface Tx {
  id?: string
  type: string
  date: string
  amount: number
  base?: number
  category?: string | null
  note?: string | null
  deleted?: boolean
  loan?: boolean
}
const B = (t: Tx) => Math.abs(Number(t.base ?? t.amount) || 0)
const lei = (bani: number) => `${Math.round(bani / 100).toLocaleString('en-US')} lei`
const expenses = (tx: Tx[]) => tx.filter((t) => t && t.type === 'expense' && !t.deleted && typeof t.date === 'string')

// ----------------------------------------------------------- spending coach

export interface CatPace {
  category: string
  week: number
  usual: number
  /** +30 = 30% over your usual week so far. */
  pct: number
}
export interface SpendPace {
  /** Days left in this week (today included), Mon–Sun. */
  daysLeft: number
  week: number
  usual: number
  cats: CatPace[]
  /** The one line Ben says, or null when all is normal. */
  line: string | null
}

/**
 * This week (Monday → today) by category against the same days of your
 * usual week (average of the 4 weeks before). Only categories with real
 * money in them; over by 25%+ and 100+ lei gets a line.
 */
export function spendPace(tx: Tx[], catName: (id: string) => string, today: string): SpendPace {
  const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7 // Mon=0
  const monday = addDays(today, -dow)
  const exp = expenses(tx)
  const byCat = (from: string, to: string) => {
    const m = new Map<string, number>()
    for (const t of exp) if (t.date >= from && t.date <= to) m.set(catName(String(t.category ?? 'Other')), (m.get(catName(String(t.category ?? 'Other'))) ?? 0) + B(t))
    return m
  }
  const now = byCat(monday, today)
  const past = [1, 2, 3, 4].map((w) => byCat(addDays(monday, -7 * w), addDays(today, -7 * w)))
  const cats = new Set([...now.keys(), ...past.flatMap((m) => [...m.keys()])])
  const list: CatPace[] = [...cats]
    .map((c) => {
      const week = now.get(c) ?? 0
      const usual = Math.round(past.reduce((s, m) => s + (m.get(c) ?? 0), 0) / 4)
      return { category: c, week, usual, pct: usual ? Math.round(((week - usual) / usual) * 100) : week ? 100 : 0 }
    })
    .filter((c) => c.week + c.usual > 0)
    .sort((a, b) => b.week - b.usual - (a.week - a.usual))
  const week = [...now.values()].reduce((s, x) => s + x, 0)
  const usual = Math.round(past.reduce((s, m) => s + [...m.values()].reduce((a, x) => a + x, 0), 0) / 4)
  const daysLeft = 7 - dow
  const worst = list.find((c) => c.usual >= 5000 && c.pct >= 25 && c.week - c.usual >= 10000)
  const line = worst ? `You're ${worst.pct}% over on ${worst.category.toLowerCase()} this week (${lei(worst.week)} vs your usual ${lei(worst.usual)} by now), ${daysLeft} day${daysLeft === 1 ? '' : 's'} left.` : null
  return { daysLeft, week, usual, cats: list.slice(0, 6), line }
}

export interface Recurring {
  key: string
  name: string
  amount: number
  /** Months it showed up in (of the last 4). */
  months: number
  last: string
  /** Likely next charge. */
  next: string
}

/**
 * Charges that repeat every month with about the same amount and note
 * (subscriptions). Ones already marked as repeating in Finance Helper are
 * left out: these are the ones you may have forgotten.
 */
export function recurringCharges(tx: (Tx & { repeat?: unknown; recurringId?: unknown })[], catName: (id: string) => string, today: string): Recurring[] {
  const from = addDays(today, -125)
  const groups = new Map<string, Tx[]>()
  for (const t of expenses(tx)) {
    if (t.date < from || (t as any).repeat || (t as any).recurringId) continue
    const name = String(t.note || '').trim() || catName(String(t.category ?? ''))
    if (!name) continue
    const key = `${name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()}|${Math.round(B(t) / 500)}`
    groups.set(key, [...(groups.get(key) ?? []), t])
  }
  const out: Recurring[] = []
  for (const [key, list] of groups) {
    const months = new Set(list.map((t) => t.date.slice(0, 7)))
    if (months.size < 3) continue
    const days = list.map((t) => Number(t.date.slice(8, 10)))
    const spread = Math.max(...days) - Math.min(...days)
    if (spread > 8) continue
    const last = list.map((t) => t.date).sort().pop()!
    const d = new Date(`${last}T12:00:00Z`)
    d.setUTCMonth(d.getUTCMonth() + 1)
    out.push({ key, name: String(list[0].note || '').trim() || catName(String(list[0].category ?? '')), amount: Math.round(list.reduce((s, t) => s + B(t), 0) / list.length), months: months.size, last, next: d.toISOString().slice(0, 10) })
  }
  return out.sort((a, b) => b.amount - a.amount).slice(0, 8)
}

// ----------------------------------------------------------- purchase check

export interface PurchaseInput {
  price: number
  what: string
  /** Bani one hour of your work earns, or null. */
  hourly: number | null
  /** Safe to spend today (bani), or null. */
  safeToday: number | null
  /** Left of this month's limit (bani), or null when there's no limit. */
  limitLeft: number | null
  /** Usual spending a day (bani, last 30 days). */
  perDay: number
  /** Balance on spending accounts (bani), or null. */
  balance: number | null
  /** Savings goals (bani). */
  goals: { title: string; left: number }[]
}
export interface PurchaseVerdict {
  verdict: 'buy' | 'wait' | 'skip'
  title: string
  lines: string[]
  hours: number | null
}

/** "Should I buy X?" from your own numbers. Waits 48 h on anything ≥ 3 days of normal spending. */
export function purchaseCheck(p: PurchaseInput): PurchaseVerdict {
  const lines: string[] = []
  const hours = p.hourly && p.hourly > 0 ? p.price / p.hourly : null
  if (hours != null) lines.push(`It costs you ${hours < 1 ? `${Math.round(hours * 60)} min` : `${hours.toFixed(1)} h`} of work.`)
  const days = p.perDay > 0 ? p.price / p.perDay : null
  if (days != null && days >= 1) lines.push(`That's ${days.toFixed(1)} days of your normal spending.`)
  let score = 0
  if (p.limitLeft != null) {
    if (p.price > p.limitLeft) {
      lines.push(`It's more than the ${lei(Math.max(0, p.limitLeft))} left of this month's limit.`)
      score -= 3
    } else lines.push(`It leaves ${lei(p.limitLeft - p.price)} of this month's limit.`)
  }
  if (p.safeToday != null) {
    if (p.price <= p.safeToday) {
      lines.push(`Fits in today's safe-to-spend (${lei(p.safeToday)}).`)
      score += 2
    } else score -= p.price > p.safeToday * 3 ? 2 : 1
  }
  if (p.balance != null && p.price > p.balance * 0.25) {
    lines.push(`It's ${Math.round((p.price / Math.max(1, p.balance)) * 100)}% of the money on your cards.`)
    score -= 2
  }
  const g = p.goals.filter((x) => x.left > 0).sort((a, b) => a.left - b.left)[0]
  if (g && p.price >= g.left * 0.1) {
    lines.push(`It delays "${g.title}" by ${Math.round((p.price / g.left) * 100)}%.`)
    score -= 1
  }
  const big = days != null && days >= 3
  const verdict: PurchaseVerdict['verdict'] = score <= -4 ? 'skip' : score < 1 || big ? 'wait' : 'buy'
  const title = verdict === 'buy' ? `Go for it: ${p.what} fits your budget.` : verdict === 'wait' ? `Wait 48 hours on ${p.what}. If you still want it, buy it.` : `Skip ${p.what} for now.`
  return { verdict, title, lines, hours }
}

/** "should I buy headphones 1200" / "merită să cumpăr X 500 lei" → {what, price bani}. */
export function readPurchase(text: string): { what: string; price: number } | null {
  const t = String(text ?? '').trim()
  const m = /^(?:should i (?:buy|get)|can i afford|is it ok to buy|să cumpăr|sa cumpar|merită să cumpăr|merita sa cumpar|pot să cumpăr|pot sa cumpar)\s+(.+?)\s+(?:for\s+)?(\d+(?:[.,]\d{1,2})?)\s*(?:lei|mdl)?\s*\??$/i.exec(t)
  if (!m) return null
  const price = Math.round(Number(m[2].replace(',', '.')) * 100)
  const what = m[1].replace(/^(a|an|the|un|o)\s+/i, '').trim()
  return price > 0 && what ? { what: what.slice(0, 60), price } : null
}

// --------------------------------------------------------------- sleep link

export interface SleepLink {
  /** Minutes slept last night, or null when unknown. */
  slept: number | null
  level: 'ok' | 'short' | 'very short'
  title: string
  tips: string[]
  /** Hard blocks before this hour should move later. */
  lightUntil: string | null
}

/** How last night changes today: a lighter morning after a short night. */
export function sleepLink(bed: string | null | undefined, wake: string | null | undefined, target = 450): SleepLink {
  const m = (t?: string | null) => (t && /^\d{1,2}:\d{2}/.test(t) ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : null)
  const b = m(bed)
  const w = m(wake)
  const slept = b != null && w != null ? (w - b + 1440) % 1440 : null
  if (slept == null || slept < 120 || slept > 840) return { slept: null, level: 'ok', title: 'Log your bedtime to get a plan that fits your sleep.', tips: [], lightUntil: null }
  const h = `${Math.floor(slept / 60)}h${String(slept % 60).padStart(2, '0')}`
  if (slept >= target - 30) return { slept, level: 'ok', title: `${h} of sleep: full power today.`, tips: ['Hard work in your best hours.'], lightUntil: null }
  if (slept >= 330)
    return { slept, level: 'short', title: `${h} of sleep: a lighter morning.`, tips: ['Easy tasks until 11:00, hard work after.', 'Coffee before 14:00 only.', 'In bed 30 min earlier tonight.'], lightUntil: '11:00' }
  return { slept, level: 'very short', title: `Only ${h} of sleep: protect the day.`, tips: ['Light morning until 12:00; one deep block after lunch.', 'A 20-min nap at 14:00–15:00 if you can.', 'No new big tasks today. Bed by your target tonight.'], lightUntil: '12:00' }
}
