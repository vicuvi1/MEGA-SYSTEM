// Money's budget warnings (2026-11-17, #8): one calm bell entry when a category's
// spending this month reaches 80%, and one when it reaches 100%, of its budget.
// The crossings come from Finance Helper's own budget numbers (apps/finance/js/budgetwarn.js);
// this builds the entries. Each goes through the daily push budget (slot 'budgetwarn': one of
// the 4 a day, at most one budget push a day; quiet hours and focus are the bell's), and each
// warning is sent once per category and month: this device remembers the keys it sent, and an
// entry another device already added this month (same category and level) is not added again.
// With amounts hidden in Money, the text has the percentage only.
import { slotNotifId } from './notifyBudget'
import type { Notif } from './notify'
import { totalText } from './moneyText'

export interface BudgetCrossing {
  month: string
  cat: string
  name: string
  level: 80 | 100
  pct: number
  spent: number
  budget: number
}

const MONTH = /^\d{4}-\d{2}$/
const safeCat = (cat: string) => String(cat).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'cat'

/** The bell id: budget:budgetwarn:<day>:<category>:<level> (the slot and day stay where the push budget reads them). */
export const budgetNotifId = (day: string, cat: string, level: number): string => `${slotNotifId('budgetwarn', day)}:${safeCat(cat)}:${level}`

/** An entry for this month's warning (same category and level) is already in the bell, from any device. */
export function alreadyInBell(ids: readonly string[], month: string, cat: string, level: number): boolean {
  const pre = `budget:budgetwarn:${month}-`
  const end = `:${safeCat(cat)}:${level}`
  return ids.some((id) => typeof id === 'string' && id.startsWith(pre) && id.endsWith(end))
}

/** "Food: 80% of this month's budget used (1 600 of 2 000 MDL)"; amounts left out when hidden. */
export function budgetNoticeText(c: BudgetCrossing, currency: string, hideAmounts: boolean): string {
  const pct = Math.max(c.level, Math.floor(c.pct))
  const head = `${c.name}: ${pct}% of this month's budget used`
  if (hideAmounts) return head
  const spent = totalText(c.spent, currency).replace(/\s*[A-Z]{3}$/, '')
  return `${head} (${spent} of ${totalText(c.budget, currency)})`
}

/** The bell entries to add now (one per crossing not yet in the bell). */
export function budgetNotices(
  warn: readonly BudgetCrossing[],
  o: { day: string; now: Date; currency: string; hideAmounts: boolean; bellIds: readonly string[] },
): Omit<Notif, 'readAt'>[] {
  const out: Omit<Notif, 'readAt'>[] = []
  for (const c of warn) {
    if (!c || !MONTH.test(c.month) || !o.day.startsWith(c.month) || (c.level !== 80 && c.level !== 100) || !(c.budget > 0)) continue
    if (alreadyInBell(o.bellIds, c.month, c.cat, c.level)) continue
    out.push({
      id: budgetNotifId(o.day, c.cat, c.level),
      at: o.now.toISOString(),
      kind: 'reminder',
      title: budgetNoticeText(c, o.currency, o.hideAmounts),
      body: null,
      action: { kind: 'page', page: 'money', label: 'Open Money' },
    })
  }
  return out
}
