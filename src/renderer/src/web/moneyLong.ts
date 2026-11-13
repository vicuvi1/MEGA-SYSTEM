// The Money page's long-view card: net worth, its change this year, this
// year's savings rate and the runway, from Finance Helper's own long view
// (public/apps/finance/js/longview.js). Read only.
// @ts-ignore plain JS module from the embedded app
import { longCard } from '../../public/apps/finance/js/longview.js'

export interface LongCard {
  currency: string
  /** Net worth today (Finance's own total: open accounts, coins, known rates). */
  netWorth: number
  /** Change since 31 December (or since your first record this year). */
  changeThisYear: number
  /** Accounts that could not be converted (no rate). */
  missing: number
  /** (income − spending) ÷ income this year so far; null without income. */
  savingsRate: number | null
  /** Last 3 full months against the 3 before, in percentage points. */
  trend: number | null
  /** Months your liquid savings would last at the last 6 months' spending. */
  runway: number | null
  runwayText: string
  spendPerMonth: number
}

/** The card's numbers from a normalized Finance Helper state (null when they can't be worked out). */
export function longCardView(state: any, today: string): LongCard | null {
  try {
    return longCard(state, today) as LongCard
  } catch {
    return null
  }
}
