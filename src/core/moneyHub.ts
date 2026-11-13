/**
 * Night 11 (MO1–MF11): the Money hub's numbers, pure. Built on Finance
 * Helper's synced records (the adapter in web/moneyHub.ts turns its state
 * into these plain shapes). Amounts are in bani (1/100 lei).
 *
 * - sameDayCompare: this month against last month over the SAME days
 *   (1–5 Nov against 1–5 Oct), never a fresh month against a whole one.
 * - monthForecast: where the month ends at this pace, a dotted line to month
 *   end, and what you can spend a day and still end it even.
 * - budgetLevel / budgetEffect: the ring's colour at 80 % and over 100 %.
 * - goalPlan: a savings ring with an ETA and "put X lei a week".
 * - mainAccountId: quick add's default account (the main lei wallet).
 */
import { addDays, daysBetween } from './dates'
import { totalText } from './moneyText'

export interface HubTx {
  id: string
  date: string
  type: string
  /** In the main currency, bani. */
  amount: number
  category: string
  note?: string
  /** Day-to-day spending: not a bill, a repeating payment, a loan or a work cost. */
  everyday: boolean
  /** Money back for a purchase: kept as an expense row that lowers spending (amount stays positive). */
  refund?: boolean
}

export interface HubCat {
  id: string
  name: string
  emoji?: string
}

export const daysInMonth = (key: string): number => new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 0)).getUTCDate()
export const prevMonth = (key: string): string => {
  const d = new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 2, 1))
  return d.toISOString().slice(0, 7)
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const monthName = (key: string): string => MONTHS[Number(key.slice(5, 7)) - 1] ?? key

/** A total: "1 240 MDL" (whole units, rounded), Finance Helper's own formatter (core/moneyText). */
export const leiText = (bani: number, currency = 'MDL'): string => totalText(bani, currency)
const signed = (bani: number) => `${bani >= 0 ? '+' : '−'}${leiText(Math.abs(bani))}`

const isExpense = (t: HubTx) => t.type === 'expense'
/** What a spending row adds: a refund takes its amount off. */
const spend = (t: HubTx) => (t.refund ? -Math.abs(t.amount) : Math.abs(t.amount))
export function spent(tx: HubTx[], from: string, to: string, everydayOnly = false): number {
  let s = 0
  for (const t of tx) if (isExpense(t) && t.date >= from && t.date <= to && (!everydayOnly || t.everyday)) s += spend(t)
  return s
}
function earned(tx: HubTx[], from: string, to: string): number {
  let s = 0
  for (const t of tx) if (t.type === 'income' && t.date >= from && t.date <= to) s += Math.abs(t.amount)
  return s
}

/** A change in percent, or null when it would mislead (nothing on one side). */
export function changePct(now: number, before: number): number | null {
  if (now <= 0 || before <= 0) return null
  return Math.round(((now - before) / before) * 100)
}

export interface CatRow extends HubCat {
  now: number
  last: number
  diff: number
}

export interface SameDayCompare {
  month: string
  lastMonth: string
  /** Days compared on both sides (1..day; last month cut at its own end). */
  days: number
  thisTotal: number
  lastTotal: number
  pct: number | null
  /** This month by category, biggest first (the donut). */
  byCat: CatRow[]
  /** The top 3 changes, in plain words. */
  changes: string[]
}

/** This month so far against the same days of last month. */
export function sameDayCompare(tx: HubTx[], today: string, cats: HubCat[]): SameDayCompare {
  const month = today.slice(0, 7)
  const lastMonth = prevMonth(month)
  const day = Number(today.slice(8))
  const lastDay = Math.min(day, daysInMonth(lastMonth))
  const from = `${month}-01`
  const lastFrom = `${lastMonth}-01`
  const lastTo = `${lastMonth}-${String(lastDay).padStart(2, '0')}`
  const catOf = new Map(cats.map((c) => [c.id, c]))
  const rows = new Map<string, CatRow>()
  const row = (id: string) => {
    let r = rows.get(id)
    if (!r) {
      const c = catOf.get(id)
      r = { id, name: c?.name ?? (id || 'Other'), emoji: c?.emoji, now: 0, last: 0, diff: 0 }
      rows.set(id, r)
    }
    return r
  }
  for (const t of tx) {
    if (!isExpense(t)) continue
    if (t.date >= from && t.date <= today) row(t.category).now += spend(t)
    else if (t.date >= lastFrom && t.date <= lastTo) row(t.category).last += spend(t)
  }
  const all = [...rows.values()].map((r) => ({ ...r, diff: r.now - r.last }))
  const thisTotal = all.reduce((s, r) => s + r.now, 0)
  const lastTotal = all.reduce((s, r) => s + r.last, 0)
  const changes = all
    .filter((r) => Math.abs(r.diff) >= 1000) // 10 lei or more
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
    .slice(0, 3)
    .map((r) => changeLine(r, lastMonth))
  return { month, lastMonth, days: lastDay, thisTotal, lastTotal, pct: changePct(thisTotal, lastTotal), byCat: all.filter((r) => r.now > 0).sort((a, b) => b.now - a.now), changes }
}

function changeLine(r: CatRow, lastMonth: string): string {
  const by = `by this day in ${monthName(lastMonth)}`
  if (r.last === 0) return `${r.name}: ${leiText(r.now)}, nothing ${by}`
  if (r.now === 0) return `${r.name}: nothing yet, ${leiText(r.last)} ${by}`
  return `${r.name}: ${leiText(Math.abs(r.diff))} ${r.diff > 0 ? 'more' : 'less'} than ${by}`
}

export interface WeekCompare {
  thisWeek: number
  lastWeek: number
  pct: number | null
  line: string
}

/** This week (Monday to today) against the same days of last week, everyday spending. */
export function weekCompare(tx: HubTx[], today: string): WeekCompare {
  const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7 // Monday = 0
  const monday = addDays(today, -dow)
  const thisWeek = spent(tx, monday, today, true)
  const lastWeek = spent(tx, addDays(monday, -7), addDays(today, -7), true)
  const pct = changePct(thisWeek, lastWeek)
  const line =
    lastWeek === 0
      ? `This week: ${leiText(thisWeek)} on everyday things.`
      : Math.abs(thisWeek - lastWeek) < 100
        ? `This week: ${leiText(thisWeek)}, the same as the same days last week.`
        : thisWeek < lastWeek
        ? `This week: ${leiText(thisWeek)}, ${leiText(lastWeek - thisWeek)} less than the same days last week.`
        : `This week: ${leiText(thisWeek)}, ${leiText(thisWeek - lastWeek)} more than the same days last week.`
  return { thisWeek, lastWeek, pct, line }
}

/** The last `n` days of everyday spending, oldest first (the hero's mini chart). */
export function lastDays(tx: HubTx[], today: string, n = 7): { day: string; spent: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const day = addDays(today, i - n + 1)
    return { day, spent: spent(tx, day, day, true) }
  })
}

export interface Upcoming {
  date: string
  /** Positive bani. */
  amount: number
  type: 'income' | 'expense'
  label?: string
}

export interface MonthForecast {
  month: string
  incomeSoFar: number
  spentSoFar: number
  /** Everyday spending a day at this pace. */
  pace: number
  /** Income minus spending at month end, at this pace (bani, can be negative). */
  endNet: number
  /** Spend up to this a day (today included) to end the month even. */
  safeDaily: number
  daysLeft: number
  line: string
  /** Net so far each day (1..today), then the projection (today..month end). */
  actual: { day: string; net: number }[]
  projected: { day: string; net: number }[]
}

/**
 * Where the month ends: income in so far plus income still due, minus what
 * you spent, the bills still due and your everyday pace for the days left.
 * The pace is this month's (from the 3rd on), else the last 30 days'.
 */
export function monthForecast(tx: HubTx[], today: string, upcoming: Upcoming[] = []): MonthForecast {
  const month = today.slice(0, 7)
  const dim = daysInMonth(month)
  const day = Number(today.slice(8))
  const end = `${month}-${String(dim).padStart(2, '0')}`
  const from = `${month}-01`
  const incomeSoFar = earned(tx, from, today)
  const spentSoFar = spent(tx, from, today)
  const everydaySoFar = spent(tx, from, today, true)
  const pace = day >= 3 ? Math.round(everydaySoFar / day) : Math.round(spent(tx, addDays(today, -30), addDays(today, -1), true) / 30)
  const ahead = upcoming.filter((u) => u.date > today && u.date <= end)
  const incomeDue = ahead.filter((u) => u.type === 'income').reduce((s, u) => s + u.amount, 0)
  const billsDue = ahead.filter((u) => u.type === 'expense').reduce((s, u) => s + u.amount, 0)
  const after = dim - day
  const endNet = incomeSoFar + incomeDue - spentSoFar - billsDue - pace * after
  const todaySpent = spent(tx, today, today, true)
  const left = incomeSoFar + incomeDue - spentSoFar - billsDue + todaySpent
  const safeDaily = Math.max(0, Math.floor(left / (after + 1) / 100) * 100)
  const actual: { day: string; net: number }[] = []
  let net = 0
  for (let d = 1; d <= day; d++) {
    const iso = `${month}-${String(d).padStart(2, '0')}`
    net += earned(tx, iso, iso) - spent(tx, iso, iso)
    actual.push({ day: iso, net })
  }
  const projected: { day: string; net: number }[] = [{ day: today, net }]
  let p = net
  for (let d = day + 1; d <= dim; d++) {
    const iso = `${month}-${String(d).padStart(2, '0')}`
    p -= pace
    for (const u of ahead) if (u.date === iso) p += u.type === 'income' ? u.amount : -u.amount
    projected.push({ day: iso, net: p })
  }
  const line = `At this pace you end ${monthName(month)} at ${signed(endNet)}`
  return { month, incomeSoFar, spentSoFar, pace, endNet, safeDaily, daysLeft: after + 1, line, actual, projected }
}

export type BudgetLevel = 'none' | 'ok' | 'warn' | 'over'

/** 80 % of the budget turns the ring amber; past 100 % it is over. */
export function budgetLevel(spentBani: number, budgetBani: number | null | undefined): BudgetLevel {
  if (!budgetBani || budgetBani <= 0) return 'none'
  if (spentBani > budgetBani) return 'over'
  if (spentBani >= budgetBani * 0.8) return 'warn'
  return 'ok'
}

const RANK: Record<BudgetLevel, number> = { none: 0, ok: 1, warn: 2, over: 3 }
/** What the ring does when the level changes: one amber flash at 80 %, a soft shake when you go over. */
export function budgetEffect(prev: BudgetLevel, next: BudgetLevel): 'flash' | 'shake' | null {
  if (RANK[next] <= RANK[prev]) return null
  if (next === 'over') return 'shake'
  if (next === 'warn') return 'flash'
  return null
}

/** The worse of the day's and the month's levels. */
export const worstLevel = (a: BudgetLevel, b: BudgetLevel): BudgetLevel => (RANK[a] >= RANK[b] ? a : b)

/** Ben's line when you go over (short, honest, one push). */
export function overLine(overBy: number, tomorrow: number | null): string {
  return `Over today by ${leiText(overBy)}.${tomorrow != null ? ` Tomorrow ${leiText(tomorrow)} keeps the month on track.` : ' Keep tomorrow light.'}`
}

/**
 * Days you stayed under the day's budget, counting back from yesterday
 * (finished days only). A day with no budget breaks the run.
 */
export function underStreak(days: { day: string; spent: number; budget: number | null }[], today: string): number {
  let n = 0
  const byDay = new Map(days.map((d) => [d.day, d]))
  for (let d = addDays(today, -1); ; d = addDays(d, -1)) {
    const x = byDay.get(d)
    if (!x || !x.budget || x.spent > x.budget) break
    n++
    if (n > 60) break
  }
  return n
}

export interface GoalIn {
  id: string
  name: string
  emoji?: string
  target: number
  current: number
  deadline?: string | null
  /** Average added a month (null: unknown). */
  pacePerMonth?: number | null
  source: 'finance' | 'rewards'
}

export interface GoalPlan extends GoalIn {
  ratio: number
  left: number
  /** "Mar 2027", "done", or null when unknown. */
  eta: string | null
  /** Put this a week (bani, whole 10 lei) to reach it by the deadline (or in 12 weeks). */
  perWeek: number
  by: string
  line: string
}

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const shortDate = (iso: string) => `${Number(iso.slice(8))} ${SHORT[Number(iso.slice(5, 7)) - 1]}`
const monthYear = (iso: string) => `${SHORT[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`

/** A savings goal as a ring: how far, when at this pace, and what a week takes. */
export function goalPlan(g: GoalIn, today: string): GoalPlan {
  const left = Math.max(0, g.target - g.current)
  const ratio = g.target > 0 ? Math.min(1, Math.max(0, g.current / g.target)) : 0
  let eta: string | null = left === 0 && g.target > 0 ? 'done' : null
  if (!eta && g.pacePerMonth && g.pacePerMonth > 0) {
    const months = Math.ceil(left / g.pacePerMonth)
    eta = monthYear(addDays(today, Math.round(months * 30.4)))
  }
  const deadline = g.deadline && g.deadline > today ? g.deadline : null
  const by = deadline ?? addDays(today, 84)
  const weeks = Math.max(1, Math.ceil(daysBetween(today, by) / 7))
  const perWeek = left > 0 ? Math.ceil(left / weeks / 1000) * 1000 : 0
  const line = left === 0 ? 'Reached' : `Put ${leiText(perWeek)} a week to get there by ${shortDate(by)}`
  return { ...g, ratio, left, eta, perWeek, by, line }
}

/** One list for Finance Helper's goals and the Rewards wishlist (same name: shown once). */
export function mergeGoals(finance: GoalIn[], rewards: GoalIn[]): GoalIn[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const seen = new Set(finance.map((g) => norm(g.name)))
  return [...finance, ...rewards.filter((g) => !seen.has(norm(g.name)))]
}

export interface AccountLike {
  id: string
  name: string
  currency?: string
  kind?: string
  savings?: boolean
  archived?: boolean
}

/**
 * Quick add's default account: the main wallet in your main currency (lei).
 * A cash account called Wallet first, then any cash, then any card, never a
 * savings, crypto or business one.
 */
export function mainAccountId(accounts: AccountLike[], base = 'MDL'): string | null {
  const ok = accounts.filter((a) => !a.archived && (a.currency || base) === base && a.kind !== 'savings' && a.kind !== 'crypto' && a.kind !== 'business')
  const wallet = ok.find((a) => /wallet|portofel|кошел/i.test(`${a.id} ${a.name}`) && (a.kind === 'cash' || !a.kind))
  return (wallet ?? ok.find((a) => a.kind === 'cash') ?? ok.find((a) => !a.savings) ?? ok[0])?.id ?? null
}

// ---- Ben's money nudges (MF10): lines that ride along existing messages ----

export interface NudgeFacts {
  /** Safe to spend today and what's left of it (bani); null without Finance Helper numbers. */
  perDay: number | null
  leftToday: number | null
  /** The monthly limit's state, when one is set. */
  limit: { amount: number; spent: number; daysLeft: number } | null
  loggedToday: boolean
  /** A repeating bill in the next 2 days. */
  bill: { name: string; amount: number; date: string } | null
}

/** Morning (inside the plan): "💸 Safe to spend today: 180 lei". */
export function morningMoneyLine(f: NudgeFacts): string | null {
  if (f.perDay == null) return null
  const parts = [`💸 Safe to spend today: ${leiText(f.perDay)}`]
  if (f.limit) parts.push(`${leiText(Math.max(0, f.limit.amount - f.limit.spent))} left for ${f.limit.daysLeft} days`)
  const warn = warnLine(f)
  return parts.join(' · ') + (warn ? `\n${warn}` : '')
}

/** The 80 % warning and the big bill heads-up (null when neither). */
export function warnLine(f: NudgeFacts, today?: string): string | null {
  const out: string[] = []
  if (f.limit && f.limit.amount > 0) {
    const ratio = f.limit.spent / f.limit.amount
    if (ratio > 1) out.push(`⚠️ Over your monthly limit by ${leiText(f.limit.spent - f.limit.amount)}.`)
    else if (ratio >= 0.8) out.push(`⚠️ ${Math.round(ratio * 100)}% of this month's limit is used, ${f.limit.daysLeft} days to go.`)
  }
  if (f.bill) out.push(`📅 ${f.bill.name} (${leiText(f.bill.amount)}) is due ${today && f.bill.date === today ? 'today' : today && f.bill.date === addDays(today, 1) ? 'tomorrow' : shortDate(f.bill.date)}.`)
  return out.length ? out.join(' ') : null
}

/** Evening: asked only when nothing was logged today. */
export const EVENING_ASK = 'Nothing logged today — anything spent?'
/** Its buttons: "Nothing spent" closes it; "Log it" asks for the line (Telegram's quick add). */
export const MONEY_ASK_ROW = [
  { text: '🙅 Nothing spent', callback_data: 'mz|0' },
  { text: '✍️ Log it', callback_data: 'mz|add' }
]
export function eveningMoneyAsk(f: NudgeFacts): string | null {
  return f.loggedToday ? null : EVENING_ASK
}

/**
 * A quick-add line's shape, for previews where Finance Helper's own parser
 * isn't loaded (the island's command bar): "120+45 groceries yesterday",
 * "+500 salary", "45 food maib". The real record is still made by its parser.
 */
export function quickMoneyShape(text: string): { amount: number; note: string; income: boolean; yesterday: boolean } | null {
  let t = text.trim().replace(/\s+/g, ' ')
  const yesterday = /(^|\s)(yesterday|ieri|вчера)(?=\s|$)/i.test(t)
  t = t.replace(/(^|\s)(yesterday|ieri|вчера)(?=\s|$)/gi, ' ').trim()
  const income = t.startsWith('+')
  if (income) t = t.slice(1).trim()
  const m = /^(\d+(?:[.,]\d{1,2})?(?:\s*\+\s*\d+(?:[.,]\d{1,2})?)*)\s*(?:lei|mdl)?\s+(\D.*)$/i.exec(t)
  if (!m) return null
  const amount = m[1].split('+').reduce((s, x) => s + Number(x.trim().replace(',', '.')), 0)
  if (!(amount > 0) || amount > 1_000_000) return null
  return { amount: Math.round(amount * 100) / 100, note: m[2].trim(), income, yesterday }
}
