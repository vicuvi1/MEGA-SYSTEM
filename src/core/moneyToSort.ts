// Money "to sort" (Money v2 plan D9, docs/design/money/money-v2-plan.md):
// payments the phone saw (MacroDroid → /api/cron?job=pay, or a notification
// pasted to the finance bot) wait here, in the Life setting `money_tosort`,
// OUTSIDE Finance Helper's data, until the owner taps a category. Only then
// does an item become a Finance record (id `cap-<itemId>`, source 'capture',
// confirmedAt = the tap). Nothing here ever writes to the books.
// Pure: no I/O. The shape is documented in docs/areas/rewards-money.md.
import { findTwin } from './payNotify'

export type ToSortSource = 'maib' | 'gwallet' | 'revolut' | 'paynet' | 'unknown'

export interface ToSortItem {
  /** Stable: the same notification gives the same id (captureId). */
  id: string
  /** When the payment happened (ms). */
  at: number
  /** Its calendar day in your time zone (YYYY-MM-DD). */
  day?: string
  /** The app that told about it first. */
  source: ToSortSource
  /** Every app that told about it (maib and Google Wallet for one tap). */
  sources?: ToSortSource[]
  /** Cents (bani) of `currency`; 0 when the text could not be read. */
  amount: number
  /** ISO code; '' when the text could not be read. */
  currency: string
  merchant: string
  last4?: string
  /** The rate to Finance Helper's main currency when it was caught (fx.js rateToBase; null: none known). Sorting converts again. */
  rate?: number | null
  /** The notification text, at most 200 characters; cleared once sorted or dismissed. */
  raw?: string
  /** debit: spending · refund: money back · ignore: declined, a code, money in, or unreadable (see `reason`). */
  kind: 'debit' | 'refund' | 'ignore'
  /** Why it is 'ignore' (plain words). */
  reason?: string
  /** new: waiting for a tap · sorted: a record was made (`txId`) · dismissed: "not mine" or not a payment. Only moves forward. */
  state: 'new' | 'sorted' | 'dismissed'
  txId?: string
  /** Set when this item is a second copy of another one. */
  dupOf?: string
  /** 'phone' (MacroDroid) or 'telegram' (pasted to the bot). */
  via?: 'phone' | 'telegram'
  /** "Send test" in Settings → Phone payments: never becomes a record. */
  test?: boolean
  updatedAt: number
}

export interface ToSort {
  items: ToSortItem[]
}

export const TOSORT_KEY = 'money_tosort'
/** Raw notification text kept per item. */
export const RAW_MAX = 200
/** Unreadable / ignored items kept for the review list (newest first). */
const IGNORED_KEEP = 50
const DAY = 86400_000
const DONE_KEEP_DAYS = 30
const WARN_DAYS = 50

const RANK = { new: 0, sorted: 1, dismissed: 1 } as const

/** The stored value, read safely (anything odd reads as empty). */
export function readToSort(raw: string | null | undefined): ToSort {
  try {
    const v = raw ? JSON.parse(raw) : null
    return { items: Array.isArray(v?.items) ? v.items.filter((x: any) => x && typeof x.id === 'string') : [] }
  } catch {
    return { items: [] }
  }
}

function newer(a: ToSortItem, b: ToSortItem): ToSortItem {
  // The state only moves forward (new → sorted / dismissed); inside a state the later edit wins.
  if (RANK[a.state] !== RANK[b.state]) return RANK[a.state] > RANK[b.state] ? a : b
  return (b.updatedAt ?? 0) > (a.updatedAt ?? 0) ? b : a
}

/** Two copies (two devices, or the server and a device): by id, nothing lost, a sorted item never comes back as new. */
export function mergeToSort(a: ToSort, b: ToSort): ToSort {
  const by = new Map<string, ToSortItem>()
  for (const it of [...a.items, ...b.items]) {
    const had = by.get(it.id)
    by.set(it.id, had ? newer(had, it) : it)
  }
  return { items: [...by.values()].sort((x, y) => x.at - y.at) }
}

export type AddStatus = 'saved' | 'merged' | 'duplicate' | 'ignored' | 'unparsed'

/**
 * Adds one caught notification. A payment the same as one already waiting
 * (same amount and currency within ±5 minutes, from another app, or the very
 * same text again) joins it: one item with both sources. Unreadable and
 * ignored notices are kept too (state 'new' when unreadable, so you can type
 * the amount; 'dismissed' when declined / a code / money in), so nothing is
 * dropped silently.
 */
export function addCapture(list: ToSort, item: ToSortItem, now: number): { list: ToSort; status: AddStatus; item: ToSortItem } {
  const items = list.items
  if (items.some((x) => x.id === item.id)) return { list, status: 'duplicate', item: items.find((x) => x.id === item.id)! }
  if (item.kind !== 'ignore') {
    const open = items.filter((x) => x.kind === item.kind && !x.test === !item.test)
    const i = findTwin(
      open.map((x) => ({ amount: x.amount, currency: x.currency, at: x.at, sources: x.sources ?? [x.source], raw: x.raw ? [x.raw] : [] })),
      { amount: item.amount, currency: item.currency, at: item.at, source: item.source, raw: item.raw ?? '' }
    )
    if (i >= 0) {
      const twin = open[i]
      const sources = [...new Set([...(twin.sources ?? [twin.source]), item.source])]
      if (sources.length === (twin.sources ?? [twin.source]).length) return { list, status: 'duplicate', item: twin }
      const merged: ToSortItem = { ...twin, sources, merchant: twin.merchant || item.merchant, last4: twin.last4 ?? item.last4, rate: twin.rate ?? item.rate ?? null, updatedAt: now }
      return { list: { items: items.map((x) => (x.id === twin.id ? merged : x)) }, status: 'merged', item: merged }
    }
  }
  const status: AddStatus = item.kind !== 'ignore' ? 'saved' : item.state === 'new' ? 'unparsed' : 'ignored'
  return { list: { items: capIgnored([...items, { ...item, raw: item.raw?.slice(0, RAW_MAX) }]) }, status, item }
}

/** At most 50 ignored items (the oldest go first); a payment is never dropped here. */
function capIgnored(items: ToSortItem[]): ToSortItem[] {
  const ignored = items.filter((x) => x.kind === 'ignore' && x.state !== 'new').sort((a, b) => b.at - a.at)
  if (ignored.length <= IGNORED_KEEP) return items
  const drop = new Set(ignored.slice(IGNORED_KEEP).map((x) => x.id))
  return items.filter((x) => !drop.has(x.id))
}

/**
 * Clean-up: a 'new' item is never dropped. Sorted or dismissed items go after
 * 30 days, a sorted one only once Finance Helper has its record (or deleted it).
 */
export function keepToSort(list: ToSort, finance: { tx?: { id: string }[]; deleted?: Record<string, unknown> } | null, now: number): ToSort {
  const has = (id?: string) => !!id && (!!finance?.tx?.some((t) => t && t.id === id) || !!finance?.deleted?.[id])
  return {
    items: list.items.filter((x) => {
      if (x.state === 'new') return true
      if (now - (x.updatedAt ?? x.at) < DONE_KEEP_DAYS * DAY) return true
      if (x.state === 'dismissed') return false
      return !has(x.txId)
    })
  }
}

/** Items waiting for a tap, newest first (the "To sort" card). Test items included, marked `test`. */
export function waitingToSort(list: ToSort): ToSortItem[] {
  return list.items.filter((x) => x.state === 'new').sort((a, b) => b.at - a.at)
}

/** The last `n` notifications that came in, whatever happened to them (Settings → Phone payments). */
export function lastReceived(list: ToSort, n = 5): ToSortItem[] {
  return [...list.items].sort((a, b) => b.at - a.at || (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).slice(0, n)
}

/** Items waiting 50 days or more (the Money page warns, like the Telegram inbox). */
export function toSortWarning(list: ToSort, now: number): { count: number; oldestDays: number } | null {
  const old = list.items.filter((x) => x.state === 'new' && !x.test && now - x.at >= WARN_DAYS * DAY)
  if (!old.length) return null
  return { count: old.length, oldestDays: Math.floor((now - Math.min(...old.map((x) => x.at))) / DAY) }
}

/** After the tap made record `txId`: sorted, raw text cleared. */
export function markSorted(list: ToSort, id: string, txId: string, now: number): ToSort {
  return { items: list.items.map((x) => (x.id === id && x.state === 'new' ? { ...x, state: 'sorted' as const, txId, raw: undefined, updatedAt: now } : x)) }
}

/** "Not mine" / not a payment: dismissed, raw text cleared. */
export function dismissItem(list: ToSort, id: string, now: number): ToSort {
  return { items: list.items.map((x) => (x.id === id && x.state === 'new' ? { ...x, state: 'dismissed' as const, raw: undefined, updatedAt: now } : x)) }
}

/** The Finance record id a sorted item gets (two devices sorting it make one record). */
export const captureTxId = (itemId: string) => `cap-${itemId}`
