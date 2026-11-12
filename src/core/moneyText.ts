/**
 * One way to write money everywhere: Finance Helper's own formatter
 * (public/apps/finance/js/money.js formatMoney), so the Money page, quick add
 * and Finance Helper show the same thing: "12,50 MDL", "1 240 MDL".
 * - moneyText: a single amount, with its bani when it has any ("12,50 MDL").
 * - totalText: a total, rounded to whole units the same way Finance's
 *   headline totals are ("1 240 MDL").
 * The currency is the one Finance Helper uses (its settings.currency, MDL by
 * default); the label is always the code (MDL), never "lei".
 */
// @ts-ignore plain JS module from the embedded app
import { formatMoney } from '../renderer/public/apps/finance/js/money.js'

const fmt = formatMoney as (cents: number, currency?: string, opts?: { sign?: boolean; compact?: boolean }) => string

export const DEFAULT_CURRENCY = 'MDL'

/** A single amount in bani: "12,50 MDL" (no ",00" for whole amounts). */
export function moneyText(bani: number, currency: string = DEFAULT_CURRENCY, opts: { sign?: boolean } = {}): string {
  return fmt(Math.round(Number(bani) || 0), currency || DEFAULT_CURRENCY, opts)
}

/** A total in bani, rounded to whole units: "1 240 MDL". */
export function totalText(bani: number, currency: string = DEFAULT_CURRENCY): string {
  return fmt(Math.round((Number(bani) || 0) / 100) * 100, currency || DEFAULT_CURRENCY)
}

/** The number of a total without the currency (for a big figure with the code beside it). */
export function totalNumber(bani: number): string {
  return fmt(Math.round((Number(bani) || 0) / 100) * 100, '')
}

/** The number of a single amount without the currency ("12,50"). */
export function moneyNumber(bani: number): string {
  return fmt(Math.round(Number(bani) || 0), '')
}
