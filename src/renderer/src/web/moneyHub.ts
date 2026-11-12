// The Money hub's view (MO1), from Finance Helper's own data and its own
// rules (safe to spend, bills, goals), turned into plain numbers by
// core/moneyHub.ts. Read only: quick add writes through financeBot.logMoney,
// the same path as the Telegram bot.
// @ts-ignore plain JS modules from the embedded app
import { safeToSpend, limitStatus, isEveryday } from '../../public/apps/finance/js/safespend.js'
// @ts-ignore
import { upcomingItems } from '../../public/apps/finance/js/recurring.js'
// @ts-ignore
import { rateToBase } from '../../public/apps/finance/js/fx.js'
// @ts-ignore
import { reconDue } from '../../public/apps/finance/js/reconcile.js'
// @ts-ignore
import { countsAsSpending, countsAsIncome } from '../../public/apps/finance/js/catshare.js'
// @ts-ignore
import { goalStatus, normalizeState, SCHEMA_VERSION, category as catOf, account as accOf } from '../../public/apps/finance/js/model.js'
import { addDays } from '@core/dates'
import {
  budgetLevel,
  goalPlan,
  lastDays,
  mainAccountId,
  monthForecast,
  sameDayCompare,
  weekCompare,
  type BudgetLevel,
  type GoalPlan,
  type HubTx,
  type MonthForecast,
  type NudgeFacts,
  type SameDayCompare,
  type Upcoming,
  type WeekCompare
} from '@core/moneyHub'

export interface MoneyHubView {
  ok: boolean
  today: string
  currency: string
  hero: {
    /** Safe to spend today (Finance Helper's rule) and what's left of it. */
    perDay: number
    spentToday: number
    leftToday: number
    tomorrow: number
    /** "X lei left for N days": the month's limit when set, else the money until payday. */
    left: number
    leftDays: number
    leftFor: 'limit' | 'payday'
    dayLevel: BudgetLevel
    monthLevel: BudgetLevel
    limit: { amount: number; spent: number } | null
    short: number
  }
  week: { day: string; spent: number }[]
  weekCompare: WeekCompare
  compare: SameDayCompare
  forecast: MonthForecast
  goals: GoalPlan[]
  accounts: { id: string; name: string; emoji: string }[]
  mainAccount: string | null
  recent: { id: string; date: string; type: string; amount: number; category: string; emoji: string; note: string; account: string }[]
  bills: { name: string; amount: number; date: string }[]
  loggedToday: boolean
  /** Accounts not reconciled for more than 31 days (Finance's reconcile.js). */
  reconcile: { id: string; name: string; days: number | null }[]
}

const B = (t: any) => (Number.isInteger(t?.base) ? t.base : Number(t?.amount) || 0)

/** Finance Helper's state in its current shape (null without data). */
export function cleanFinance(raw: any): any | null {
  if (!raw || !Array.isArray(raw.tx)) return null
  try {
    return normalizeState({ ...raw, version: raw.version ?? SCHEMA_VERSION })
  } catch {
    return null
  }
}

function hubTx(state: any): HubTx[] {
  return (state.tx as any[])
    // Spending is Finance's own rule (catshare.js countsAsSpending, the same as
    // its "Where your money goes" donut): a reward bought with points
    // (life-reward-…) is not real money and is left out here too.
    .filter((t) => t && !t.deleted && typeof t.date === 'string' && (countsAsSpending(t) || countsAsIncome(t)))
    .map((t) => ({ id: String(t.id), date: t.date.slice(0, 10), type: t.type, amount: Math.abs(B(t)), category: String(t.category ?? 'other'), note: t.note ? String(t.note) : undefined, everyday: t.type === 'expense' && isEveryday(state, t) }))
}

// A recurring item's amount in the main currency. Rules keep their own
// currency (a 10 USD subscription is 1000 cents of USD): it is converted with
// Finance's rate rule (fx.js rateToBase), never counted 1:1. With no rate at
// all it is left out (null).
function ruleInBase(state: any, rule: any): number | null {
  const amount = Math.abs(Number(rule.amount) || 0)
  const base = state.settings.currency || 'MDL'
  const cur = rule.currency || base
  if (cur === base) return amount
  const rate = rateToBase(state, cur)
  return rate > 0 ? Math.round(amount * rate) : null
}

function upcoming(state: any, today: string): Upcoming[] {
  try {
    return (upcomingItems(state, today, 31) as any[])
      .map((x) => ({ date: x.date, amount: ruleInBase(state, x.rule), type: (x.rule.type === 'income' ? 'income' : 'expense') as Upcoming['type'], label: x.rule.note || 'Bill' }))
      .filter((x) => x.amount != null) as Upcoming[]
  } catch {
    return []
  }
}

function reconcileDue(state: any, today: string): MoneyHubView['reconcile'] {
  try {
    return (reconDue(state, today) as any[]).map((x) => ({ id: String(x.account.id), name: String(x.account.name || 'Account'), days: x.days ?? null }))
  } catch {
    return []
  }
}

/** Everything the Money hub shows (pure read of Finance Helper's data). */
export function hubView(raw: any, today: string): MoneyHubView | null {
  const state = cleanFinance(raw)
  if (!state) return null
  const tx = hubTx(state)
  const cats = state.settings.categories.map((c: any) => ({ id: String(c.id), name: String(c.name), emoji: c.emoji ? String(c.emoji) : undefined }))
  let safe: any = null
  try {
    safe = safeToSpend(state, today)
  } catch {
    safe = null
  }
  const limit = (() => {
    try {
      return limitStatus(state, today)
    } catch {
      return null
    }
  })()
  const perDay = Math.max(0, Number(safe?.perDay) || 0)
  const spentToday = Number(safe?.spentToday) || 0
  const month = today.slice(0, 7)
  const leftFor: 'limit' | 'payday' = limit ? 'limit' : 'payday'
  const hero = {
    perDay,
    spentToday,
    leftToday: perDay - spentToday,
    tomorrow: Math.max(0, Number(safe?.tomorrow) || 0),
    left: limit ? limit.left : Math.max(0, (Number(safe?.pool) || 0) - spentToday),
    leftDays: limit ? limit.daysLeft : Math.max(1, Number(safe?.days) || 1),
    leftFor,
    dayLevel: budgetLevel(spentToday, perDay),
    monthLevel: limit ? budgetLevel(limit.spent, limit.amount) : ('none' as BudgetLevel),
    limit: limit ? { amount: limit.amount, spent: limit.spent } : null,
    short: Number(safe?.short) || 0
  }
  const ups = upcoming(state, today)
  const goals = ((state.goals ?? []) as any[])
    .filter((g) => g && !g.archived && !g.deleted && Number(g.target) > 0)
    .slice(0, 6)
    .map((g) => {
      let st: any = null
      try {
        st = goalStatus(state, today, g)
      } catch {
        st = null
      }
      return goalPlan({ id: String(g.id), name: String(g.name || 'Goal'), emoji: g.emoji || '🎯', target: Number(g.target), current: Math.max(0, Number(st?.current ?? g.saved ?? 0)), deadline: g.deadline ?? null, pacePerMonth: st?.pace ?? null, source: 'finance' }, today)
    })
  const accounts = (state.settings.accounts as any[]).filter((a) => !a.archived).map((a) => ({ id: String(a.id), name: String(a.name), emoji: String(a.emoji ?? '') }))
  const recent = [...(state.tx as any[])]
    .filter((t) => t && !t.deleted && typeof t.date === 'string' && t.type !== 'transfer')
    .sort((a, b) => (b.date === a.date ? (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0) : b.date.localeCompare(a.date)))
    .slice(0, 6)
    .map((t) => {
      const c = catOf(state, t.category)
      return { id: String(t.id), date: t.date, type: t.type, amount: Math.abs(B(t)), category: c?.name ?? 'Other', emoji: c?.emoji ?? (t.type === 'income' ? '💰' : '💸'), note: String(t.note ?? ''), account: accOf(state, t.account)?.name ?? '' }
    })
  const bills = ups.filter((u) => u.type === 'expense' && u.date <= addDays(today, 7)).map((u) => ({ name: u.label ?? 'Bill', amount: u.amount, date: u.date }))
  return {
    ok: true,
    today,
    currency: state.settings.currency || 'MDL',
    hero,
    week: lastDays(tx, today, 7),
    weekCompare: weekCompare(tx, today),
    compare: sameDayCompare(tx, today, cats),
    forecast: monthForecast(tx, today, ups),
    goals,
    accounts,
    mainAccount: mainAccountId(state.settings.accounts, state.settings.currency),
    recent,
    bills,
    loggedToday: tx.some((t) => t.date === today && month === today.slice(0, 7)),
    reconcile: reconcileDue(state, today)
  }
}

/** Sunday: this week against the same days last week (null without data). */
export function weekMoneyLine(raw: any, today: string): string | null {
  const v = hubView(raw, today)
  return v && (v.weekCompare.thisWeek > 0 || v.weekCompare.lastWeek > 0) ? v.weekCompare.line : null
}

/** What Ben's money lines need (null without Finance Helper data). */
export function nudgeFacts(raw: any, today: string): NudgeFacts | null {
  const v = hubView(raw, today)
  if (!v) return null
  const big = v.bills.find((b) => b.date <= addDays(today, 2) && b.amount >= 10000) ?? null
  return {
    perDay: v.hero.perDay > 0 ? v.hero.perDay : null,
    leftToday: v.hero.perDay > 0 ? v.hero.leftToday : null,
    limit: v.hero.limit ? { amount: v.hero.limit.amount, spent: v.hero.limit.spent, daysLeft: v.hero.leftDays } : null,
    loggedToday: v.loggedToday,
    bill: big
  }
}
