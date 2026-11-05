// Lei, euro and dollar rates from Finance Helper, for the rest of Life System
// (the Money hub, Rewards). They come with its synced data
// (settings.app_sync_finance → data.lastRates: units per 1 USD and the day),
// or from this device's own copy (finance-helper.state → rates).
import { calendarDay } from '@core/dates'

export interface FinanceRates {
  /** The day the rates are from (YYYY-MM-DD), or null when none are known. */
  date: string | null
  /** Lei for one unit: { USD: 17.6, EUR: 19.1 }. */
  lei: Record<string, number>
  /** Older than a day and a half (show "rates from <date>"). */
  stale: boolean
}

const day = (ms: number) => calendarDay(new Date(ms))

/** `data`: the synced Finance Helper data or the full local state. */
export function financeRates(data: any, now = Date.now()): FinanceRates {
  const shared = data?.lastRates
  const local = data?.rates
  let usd: Record<string, number> | null = null
  let date: string | null = null
  let at = 0
  if (local?.usd?.MDL > 0 && local.fetchedAt) {
    usd = local.usd
    at = Number(local.fetchedAt)
    date = day(at)
  }
  if (shared?.usd?.MDL > 0 && /^\d{4}-\d{2}-\d{2}$/.test(shared.date ?? '') && (!date || shared.date > date)) {
    usd = shared.usd
    date = shared.date
    at = Date.parse(`${shared.date}T12:00:00`)
  }
  const lei: Record<string, number> = {}
  if (usd) for (const [c, v] of Object.entries(usd)) if (v > 0 && c !== 'MDL') lei[c] = Math.round((usd.MDL / v) * 1e4) / 1e4
  return { date, lei, stale: !at || now - at > 36 * 3600e3 }
}

/** Integer cents in `currency` to lei cents, or null without a rate. */
export function toLei(cents: number, currency: string, rates: FinanceRates): number | null {
  if (!currency || currency === 'MDL') return cents
  const r = rates.lei[currency]
  return r ? Math.round(cents * r) : null
}
