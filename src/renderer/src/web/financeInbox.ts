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
/** From this age the Money page warns about entries not in Finance Helper yet. */
export const WARN_DAYS = 50
const DAY = 86400_000

export interface InboxEntry {
  id: string
  amount: number // bani
  category: string // Life System's category (food, transit, bills…)
  note: string
  date: string // YYYY-MM-DD
  at: number
  type?: 'expense' | 'income' | 'saving' // expense when missing
  /** RL7 ('saving'): the Finance Helper goal the money goes to. */
  goalId?: string
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

/** What Finance Helper already has, from its synced copy (null: never synced, so nothing is known to be in it). */
function syncedFinance(db: DbLike): any | null {
  const saved = parse<any>(getSetting(db, 'app_sync_finance'), null)
  return saved?.data && Array.isArray(saved.data.tx) ? saved.data : null
}

/** An inbox entry Finance Helper already took (added, removed, or deleted there). */
export function isApplied(e: InboxEntry, state: any | null): boolean {
  if (!state || !Array.isArray(state.tx)) return false
  const inTx = state.tx.some((t: any) => t && t.id === e.id)
  const deleted = !!(state.deleted && typeof state.deleted === 'object' && state.deleted[e.id])
  if (e.remove) return !inTx
  if (inTx || deleted) return true
  return e.type === 'saving' && (state.goals ?? []).some((g: any) => (g?.history ?? []).some((h: any) => h && h.id === e.id))
}

/**
 * The inbox after clean-up: entries older than 60 days go only once Finance
 * Helper has them. One it doesn't have yet is never dropped silently: it
 * stays, and the Money page warns from day 50 (inboxWarning).
 */
export function keepInbox(list: InboxEntry[], now: number, finance: any | null): InboxEntry[] {
  const cutoff = now - KEEP_DAYS * DAY
  return list.filter((e) => e.at >= cutoff || !isApplied(e, finance))
}

/** Adds an expense to the inbox (call inside the bot's change). */
export function queueFinanceExpense(db: DbLike, entry: InboxEntry): void {
  const list = keepInbox(parse<InboxEntry[]>(getSetting(db, SETTING), []), entry.at, syncedFinance(db)).filter((e) => e.id !== entry.id)
  list.push(entry)
  setSetting(db, SETTING, JSON.stringify(list))
}

/** Adds many records at once (a bank statement); returns the ids that were new. */
export function queueFinanceEntries(db: DbLike, entries: InboxEntry[], now = Date.now()): string[] {
  const list = keepInbox(parse<InboxEntry[]>(getSetting(db, SETTING), []), now, syncedFinance(db))
  const have = new Set(list.map((e) => e.id))
  const fresh = entries.filter((e) => !have.has(e.id))
  if (!fresh.length) return []
  setSetting(db, SETTING, JSON.stringify([...list, ...fresh]))
  return fresh.map((e) => e.id)
}

export interface InboxWarning {
  /** Entries not in Finance Helper yet that are WARN_DAYS (50) days old or more. */
  count: number
  /** Days the oldest of them has waited. */
  oldestDays: number
  /** Days until the oldest is 60 days old (0: already past). */
  daysLeft: number
  line: string
}

/**
 * Entries from Telegram still waiting for Finance Helper after 50 days
 * (null when there are none). `state`: Finance Helper's data on this device
 * (or its synced copy).
 */
export function inboxWarning(inbox: InboxEntry[], state: any | null, now = Date.now()): InboxWarning | null {
  const old = inbox.filter((e) => Number.isFinite(e.at) && now - e.at >= WARN_DAYS * DAY && !isApplied(e, state))
  if (!old.length) return null
  const oldestDays = Math.floor((now - Math.min(...old.map((e) => e.at))) / DAY)
  const daysLeft = Math.max(0, KEEP_DAYS - oldestDays)
  const n = old.length
  const what = `${n} ${n === 1 ? 'entry' : 'entries'} waiting from Telegram`
  const line = daysLeft > 0 ? `${what} will expire in ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}: apply now` : `${what} ${n === 1 ? 'is' : 'are'} over ${KEEP_DAYS} days old: apply now (kept until you do)`
  return { count: n, oldestDays, daysLeft, line }
}

/** The inbox as it is now (read only). */
export function readInbox(db: DbLike): InboxEntry[] {
  return parse<InboxEntry[]>(getSetting(db, SETTING), [])
}

/** The ids already waiting in the inbox. */
export function inboxIds(db: DbLike): Set<string> {
  return new Set(parse<InboxEntry[]>(getSetting(db, SETTING), []).map((e) => e.id))
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

/**
 * RL7: where money for a savings goal goes. A goal you fill by hand
 * ('manual') gets the amount added; a goal that counts a savings account gets
 * a transfer into that account (from the account you usually pay from).
 * null = this goal can't take a move (it counts all your money).
 */
export function savingTarget(state: any, goalId?: string): { goal: { id: string; name: string }; mode: 'manual' | 'transfer'; from?: string; to?: string } | null {
  const goals: any[] = (Array.isArray(state?.goals) ? state.goals : []).filter((g: any) => g && !g.deleted && !g.doneAt && !g.archived)
  const goal = goalId ? goals.find((g) => g.id === goalId) : goals.find((g) => g.account === 'manual' || g.account === 'savings' || isAccount(state, g.account)) ?? goals[0]
  if (!goal) return null
  const out = { id: String(goal.id), name: String(goal.name ?? 'Goal') }
  if (goal.account === 'manual') return { goal: out, mode: 'manual' }
  const accounts: any[] = (state.settings?.accounts ?? []).filter((a: any) => !a.archived)
  const saving = (a: any) => a && (a.savings || a.kind === 'savings')
  const to = isAccount(state, goal.account) ? goal.account : goal.account === 'savings' ? (accounts.find((a) => a.id === state.settings?.savingsAccount && saving(a)) ?? accounts.find(saving))?.id : null
  const from = financeAccount(state)?.id
  if (!to || !from || to === from) return null
  return { goal: out, mode: 'transfer', from, to }
}
const isAccount = (state: any, id: unknown) => typeof id === 'string' && (state?.settings?.accounts ?? []).some((a: any) => a.id === id && !a.archived)

/** A move to savings (RL7) into Finance Helper, or null when it can't go anywhere. */
function applySaving(state: any, e: InboxEntry, now: number): any | null {
  const t = savingTarget(state, e.goalId)
  if (!t) return null
  if (t.mode === 'manual') {
    const goals = state.goals.map((g: any) => {
      if (g.id !== t.goal.id) return g
      const history = Array.isArray(g.history) ? g.history : []
      if (history.some((h: any) => h && h.id === e.id)) return g
      return { ...g, saved: (Number(g.saved) || 0) + e.amount, history: [...history, { id: e.id, date: e.date, amount: e.amount, note: e.note }], updatedAt: now }
    })
    return { ...state, goals }
  }
  const tx = { id: e.id, createdAt: e.at, updatedAt: now, type: 'transfer', amount: e.amount, currency: state.settings?.currency || 'MDL', rate: 1, base: e.amount, date: e.date, from: t.from, to: t.to, note: e.note, source: 'telegram' }
  return { ...state, tx: [...state.tx, tx] }
}

/** Takes a move to savings back out of a goal you fill by hand. */
function removeSaving(state: any, ids: Set<string>, now: number): { state: any; n: number } {
  let n = 0
  const goals = (Array.isArray(state.goals) ? state.goals : []).map((g: any) => {
    const history: any[] = Array.isArray(g?.history) ? g.history : []
    const gone = history.filter((h) => h && ids.has(h.id))
    if (!gone.length) return g
    n += gone.length
    return { ...g, saved: Math.max(0, (Number(g.saved) || 0) - gone.reduce((a, h) => a + (Number(h.amount) || 0), 0)), history: history.filter((h) => !(h && ids.has(h.id))), updatedAt: now }
  })
  return { state: n ? { ...state, goals } : state, n }
}

/** Finance Helper's data with the inbox expenses it doesn't have yet. */
export function applyInbox(state: any, inbox: InboxEntry[], now = Date.now()): { state: any; added: number } {
  if (!state || !Array.isArray(state.tx) || !inbox.length) return { state, added: 0 }
  let moved = 0
  // Moves to savings that were undone: out of the goal's own list too.
  {
    const r = removeSaving(state, new Set(inbox.filter((e) => e.remove).map((e) => e.id)), now)
    state = r.state
    moved += r.n
  }
  // Moves to savings not there yet (once each: a transfer by id, a goal's list by id).
  const goneIds = new Set(inbox.filter((e) => e.remove).map((e) => e.id))
  for (const e of inbox.filter((x) => x.type === 'saving' && !x.remove && !goneIds.has(x.id))) {
    const inGoals = (state.goals ?? []).some((g: any) => (g?.history ?? []).some((h: any) => h && h.id === e.id))
    if (inGoals || state.tx.some((t: any) => t.id === e.id) || state.deleted?.[e.id]) continue
    const next = applySaving(state, e, now)
    if (next) {
      state = next
      moved++
    }
  }
  inbox = inbox.filter((e) => e.type !== 'saving')
  const r = applyEntries(state, inbox, now)
  return { state: r.state, added: r.added + moved }
}

function applyEntries(state: any, inbox: InboxEntry[], now: number): { state: any; added: number } {
  if (!inbox.length) return { state, added: 0 }
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
