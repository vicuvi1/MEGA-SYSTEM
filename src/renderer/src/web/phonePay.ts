// Phone payments: one bank / wallet notification (MacroDroid's {app, title,
// text}, or a text pasted to the finance bot) → an item in the Life setting
// `money_tosort` (core/moneyToSort.ts), outside Finance Helper's data. It
// becomes a Finance record only when the owner taps a category (Money v2
// plan D9). Pays no points here. Read → merge → write, inside one change.
import { parsePayNotification, type PayNotice, type PaySource } from '@core/payNotify'
import { addCapture, keepToSort, readToSort, TOSORT_KEY, RAW_MAX, type AddStatus, type ToSort, type ToSortItem, type ToSortSource } from '@core/moneyToSort'
import { getSetting, setSetting } from '../../../main/settings'
import { financeState } from './financeBot'
// @ts-ignore plain JS module from the embedded app
import { rateToBase } from '../../public/apps/finance/js/fx.js'

type Db = Parameters<typeof financeState>[0]

export interface PayCapture {
  /** saved: a new item to sort · merged: joined the same payment from another app · duplicate: the same text again · ignored: declined / a code / money in · unparsed: no amount or currency (kept to sort by hand) */
  status: AddStatus
  /** Why it was ignored or not read (plain words). */
  reason?: string
  id: string
  amount?: number
  currency?: string
  merchant?: string
  source?: string
  refund?: boolean
  test?: boolean
}

const srcOf = (s: PaySource): ToSortSource => (s === 'generic' ? 'unknown' : s)

/** Stable id: source, the minute, the text (the same notification twice → the same id). */
export function captureId(source: string, at: number, raw: string): string {
  let h = 0x811c9dc5
  for (const ch of `${source}|${Math.floor(at / 60_000)}|${raw}`) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0
  return `${Math.floor(at / 60_000).toString(36)}${h.toString(36)}`
}

/** The to-sort list as stored. */
export function readToSortDb(db: Db): ToSort {
  return readToSort(getSetting(db, TOSORT_KEY))
}

/**
 * Reads the notification and keeps it in `money_tosort` (call inside a
 * change). `at`: when it happened; `day`: its calendar day (your time zone).
 */
export function capturePayment(db: Db, n: PayNotice & { test?: boolean }, opts: { at: number; day: string; now?: number; via?: 'phone' | 'telegram' }): PayCapture {
  const now = opts.now ?? Date.now()
  const p = parsePayNotification(n, { at: opts.at })
  const raw = p.raw.slice(0, RAW_MAX)
  const test = n.test === true ? { test: true as const } : {}
  const base: Omit<ToSortItem, 'amount' | 'currency' | 'merchant' | 'kind' | 'state'> = { id: captureId(p.source, opts.at, p.raw), at: opts.at, day: opts.day, source: srcOf(p.source), sources: [srcOf(p.source)], raw, via: opts.via ?? 'phone', updatedAt: now, ...test }
  let item: ToSortItem
  if (!p.ok) {
    // Unreadable stays 'new' (you can still type the amount); declined, codes and money in are kept as dismissed.
    item = { ...base, amount: 0, currency: '', merchant: '', kind: 'ignore', reason: p.reason, state: p.kind === 'unreadable' ? 'new' : 'dismissed' }
  } else {
    const state = financeState(db)
    const main = state?.settings?.currency || 'MDL'
    const rate = p.currency === main ? 1 : (rateToBase(state, p.currency) ?? null)
    item = { ...base, amount: p.amount, currency: p.currency, merchant: p.merchant, ...(p.last4 ? { last4: p.last4 } : {}), rate, kind: p.refund ? 'refund' : 'debit', state: 'new' }
  }
  const finance = financeState(db)
  const list = keepToSort(readToSortDb(db), finance, now)
  const r = addCapture(list, item, now)
  if (r.status !== 'duplicate') setSetting(db, TOSORT_KEY, JSON.stringify(r.list))
  return {
    status: r.status,
    id: r.item.id,
    ...(p.ok ? { amount: p.amount, currency: p.currency, merchant: r.item.merchant || p.merchant, ...(p.refund ? { refund: true } : {}) } : { reason: p.reason }),
    source: srcOf(p.source),
    ...test
  }
}

/** The made-up notification "Send test" sends (Settings → Phone payments). */
export const TEST_NOTICE = { app: 'maib', title: 'maib', text: 'Plată: 1,00 MDL la TEST SHOP. Card *0000' }

// How a bank / wallet notification looks (a masked card, or its own phrases), unlike "taxi 45 maib".
const NOTICE_SHAPE = /(card\s*(?:visa|mastercard)?\s*\*\d{4}|\*\d{4}(?!\d)|[•·]{2,}\s?\d{4}|карт[аы]\s*\*|\bplat[aă]\s*:|tranzac[tț]i|achitare\s+la|оплата\s|покупка\s|you paid|payment (?:to|of|at)|paid (?:at|to|with)|refund of|rambursare|возврат\s+\d)/iu

/**
 * A text pasted to the bot that is clearly a bank / wallet notification (its
 * wording, with an amount and a currency), or null. Plain money messages
 * ("taxi 45 maib", "coffee 35 lei") are left to the usual money parser.
 */
export function pastedNotice(text: string): PayNotice | null {
  const t = String(text ?? '').trim()
  if (t.length < 12 || t.length > 1500 || t.startsWith('/') || !NOTICE_SHAPE.test(t)) return null
  const r = parsePayNotification({ text: t }, { at: 0 })
  // Shaped like one but no amount with a currency: the usual money parser may still read it.
  if (!r.ok && r.kind === 'unreadable') return null
  return { app: '', title: '', text: t }
}

/** The bot's answer to a pasted notification. */
export function pastedReply(r: PayCapture): string {
  const amt = r.amount != null ? `${(r.amount / 100).toFixed(2).replace('.', ',')} ${r.currency}` : ''
  if (r.status === 'saved') return `📲 Saved ${amt}${r.merchant ? ` at ${r.merchant}` : ''} to sort. Tap what it was for in the app; it goes into Finance Helper then.`
  if (r.status === 'merged' || r.status === 'duplicate') return `📲 Already have ${amt}${r.merchant ? ` at ${r.merchant}` : ''}: kept as one payment.`
  return `📲 Not saved as a payment: ${r.reason ?? 'not a payment'}.`
}
