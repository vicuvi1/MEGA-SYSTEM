// Expenses sent to the Life System bot also belong in Finance Helper. The bot
// puts each one in an inbox in Turso (settings.finance_inbox_json, in the same
// change as the expense); every device that has Finance Helper's data adds
// the ones it doesn't have yet as normal Finance records ("tg-life-…" ids,
// so nothing is added twice). Finance Helper's own backup and sync carry it on.
import { getSetting, setSetting } from '../../../main/settings'
import type { Mirror } from './mirror'

const SETTING = 'finance_inbox_json'
const FINANCE_KEY = 'finance-helper.state'
const KEEP_DAYS = 60

export interface InboxEntry {
  id: string
  amount: number // bani
  category: string // Life System's category (food, transit, bills…)
  note: string
  date: string // YYYY-MM-DD
  at: number
  type?: 'expense' | 'income' // expense when missing
  /** Take this record back out of Finance Helper (you deleted it in Life System). */
  remove?: boolean
}

type DbLike = Parameters<typeof getSetting>[0]

const parse = <T>(raw: string | null, fallback: T): T => {
  try {
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

/** Adds an expense to the inbox (call inside the bot's change). */
export function queueFinanceExpense(db: DbLike, entry: InboxEntry): void {
  const cutoff = entry.at - KEEP_DAYS * 86400_000
  const list = parse<InboxEntry[]>(getSetting(db, SETTING), []).filter((e) => e.at >= cutoff && e.id !== entry.id)
  list.push(entry)
  setSetting(db, SETTING, JSON.stringify(list))
}

// Life System's categories → Finance Helper's (by id, else by name).
const CATEGORY_MAP: Record<string, string[]> = {
  food: ['food'],
  groceries: ['food', 'groceries'],
  transit: ['transport', 'transit'],
  shopping: ['clothes', 'shopping', 'other'],
  bills: ['home', 'bills'],
  health: ['health'],
  other: ['other']
}

function financeCategory(state: any, cat: string): string {
  const cats: any[] = (state.settings?.categories ?? []).filter((c: any) => c.type === 'expense' && !c.archived)
  const want = CATEGORY_MAP[cat] ?? [cat, 'other']
  for (const id of want) {
    const hit = cats.find((c) => c.id === id) ?? cats.find((c) => String(c.name ?? '').toLowerCase().includes(id))
    if (hit) return hit.id
  }
  return cats.find((c) => c.id === 'other')?.id ?? cats[cats.length - 1]?.id ?? 'other'
}

function financeIncomeCategory(state: any, note: string): string {
  const cats: any[] = (state.settings?.categories ?? []).filter((c: any) => c.type === 'income' && !c.archived)
  const want = /\b(salary|salariu|зарплата|work|job|freelance|bonus)\b/i.test(note) ? ['work', 'other-in'] : ['other-in']
  for (const id of want) {
    const hit = cats.find((c) => c.id === id)
    if (hit) return hit.id
  }
  return cats[cats.length - 1]?.id ?? 'other-in'
}

/** The account you last paid from in your main currency (else the first one in it). */
function financeAccount(state: any): { id: string; currency: string } | null {
  const base = state.settings?.currency || 'MDL'
  const accounts: any[] = (state.settings?.accounts ?? []).filter((a: any) => !a.archived)
  const inBase = (a: any) => (a?.currency || base) === base
  const last = [...(state.tx ?? [])]
    .filter((t: any) => t.type === 'expense')
    .sort((a: any, b: any) => (a.date === b.date ? (b.createdAt || 0) - (a.createdAt || 0) : a.date < b.date ? 1 : -1))
    .map((t: any) => accounts.find((a) => a.id === t.account))
    .find((a: any) => a && inBase(a))
  const acc = last ?? accounts.find((a) => inBase(a) && !a.savings) ?? accounts.find(inBase)
  return acc ? { id: acc.id, currency: base } : null
}

/** Finance Helper's data with the inbox expenses it doesn't have yet. */
export function applyInbox(state: any, inbox: InboxEntry[], now = Date.now()): { state: any; added: number } {
  if (!state || !Array.isArray(state.tx) || !inbox.length) return { state, added: 0 }
  // Deleted in Life System: removed here too (with Finance Helper's own deletion marker).
  const gone = new Set(inbox.filter((e) => e.remove).map((e) => e.id))
  const removing = state.tx.filter((t: any) => gone.has(t.id))
  if (removing.length) {
    const deleted = { ...(state.deleted ?? {}) }
    for (const t of removing) deleted[t.id] = now
    state = { ...state, tx: state.tx.filter((t: any) => !gone.has(t.id)), deleted }
  }
  inbox = inbox.filter((e) => !e.remove && !gone.has(e.id))
  const have = new Set(state.tx.map((t: any) => t.id))
  // Deleted in Finance Helper (id → when): don't bring it back.
  if (state.deleted && typeof state.deleted === 'object') Object.keys(state.deleted).forEach((id) => have.add(id))
  const acc = financeAccount(state)
  if (!acc) return { state, added: removing.length }
  const fresh = inbox.filter((e) => !have.has(e.id))
  if (!fresh.length) return { state, added: removing.length }
  const tx = fresh.map((e) => ({
    id: e.id,
    createdAt: e.at,
    updatedAt: now,
    type: e.type === 'income' ? 'income' : 'expense',
    amount: e.amount,
    currency: acc.currency,
    rate: 1,
    base: e.amount,
    date: e.date,
    category: e.type === 'income' ? financeIncomeCategory(state, e.note) : financeCategory(state, e.category),
    account: acc.id,
    note: e.note,
    source: 'telegram'
  }))
  return { state: { ...state, tx: [...state.tx, ...tx] }, added: tx.length + removing.length }
}

export function createFinanceInbox(mirror: Mirror, store: Storage | null = typeof localStorage !== 'undefined' ? localStorage : null) {
  /** Adds new inbox expenses to Finance Helper on this device, if it's here. */
  const apply = async (): Promise<number> => {
    if (!store) return 0
    let raw: string | null
    try {
      raw = store.getItem(FINANCE_KEY)
    } catch {
      return 0
    }
    if (!raw) return 0 // no Finance Helper on this device, or its data is locked
    const inbox = await mirror.read((db) => parse<InboxEntry[]>(getSetting(db as any, SETTING), []))
    // Read Finance Helper again after the wait: it may have saved meanwhile (Y4).
    try {
      raw = store.getItem(FINANCE_KEY) ?? raw
    } catch {
      /* keep the first read */
    }
    const { state, added } = applyInbox(parse<any>(raw, null), inbox)
    if (!added) return 0
    try {
      store.setItem(FINANCE_KEY, JSON.stringify(state))
    } catch {
      return 0
    }
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('life-finance-changed'))
    return added
  }
  return { apply }
}
