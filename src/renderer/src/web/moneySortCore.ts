// Money phase 5, "less typing" (pure; Finance Helper's own modules do the
// money parts). Three things wait for one tap on the Money page:
// - captured payments in To sort (Life setting `money_tosort`, written by
//   Phone payments, core/moneyToSort.ts; read here, never dropped): each with
//   its 3 best category chips. An unreadable one asks for the amount first;
//   a "Send test" one is dismissed, never filed. A tap files it (record `cap-<item id>`, `source: 'capture'`,
//   `confirmedAt` = the tap) and teaches a rule, so the next one from that
//   merchant is sure;
// - captures the rules are sure about are filed by themselves (`catBy:
//   'auto'`, no `confirmedAt`): shown under "Filed by itself" with OK, Change
//   and Undo (Undo puts it back in To sort and it never files itself again);
// - recurring bills that are due (Finance's recurring items that don't log
//   themselves): one tap books `rec-<rule>-<date>`, the id Finance's own Plan
//   uses, so it is never booked twice. Nothing is booked without that tap.
// Points: a capture or a bill counts as "logged on the day" only by its
// confirming tap on that day (core/moneyDays.ts logMoment).
// @ts-ignore plain JS modules from the embedded app
import { suggest, canAutoFile, addRule2, removeRule2, rulesView, merchantOf } from '../../public/apps/finance/js/learn.js'
// @ts-ignore
import { suggestCategory, category as catOf, normalizeState } from '../../public/apps/finance/js/model.js'
// @ts-ignore
import { dueItems, makeTx, markDone } from '../../public/apps/finance/js/recurring.js'
// @ts-ignore
import { rateToBase } from '../../public/apps/finance/js/fx.js'
// @ts-ignore
import { mergeStates, toCloud } from '../../public/apps/finance/js/sync.js'
import { mainAccountId } from '@core/moneyHub'
import { captureTxId, readToSort, TOSORT_KEY, type ToSort, type ToSortItem } from '@core/moneyToSort'

export { readToSort, TOSORT_KEY }
/** One item of `money_tosort` (core/moneyToSort.ts), as the card reads and writes it. */
export type ToSortRaw = ToSortItem & { account?: string }
export type ToSortList = ToSort

export interface Chip {
  id: string
  name: string
  emoji: string
}

export interface PendingItem {
  id: string
  amount: number
  currency: string
  merchant: string
  source: string
  at: number
  date: string
  type: 'expense' | 'income'
  chips: Chip[]
  level: 'sure' | 'maybe' | 'guess'
  confidence: number
  /** The notification could not be read: type the amount before a chip files it. */
  needsAmount: boolean
  /** The notification text (only for an unreadable one). */
  raw: string
  last4: string
}

export interface AutoItem {
  id: string
  txId: string
  amount: number
  currency: string
  merchant: string
  category: Chip
  chips: Chip[]
  at: number
  date: string
}

export interface BillItem {
  ruleId: string
  date: string
  amount: number
  currency: string
  note: string
  category: Chip
  /** Other due dates of the same bill after this one. */
  more: number
}

export interface SortView {
  pending: PendingItem[]
  auto: AutoItem[]
  bills: BillItem[]
  categories: (Chip & { type: string })[]
}

/** What a tap changed, enough to take it back exactly. */
export interface SortUndo {
  kind: 'file' | 'confirm' | 'dismiss' | 'bill' | 'skip' | 'undo-auto'
  itemId?: string
  txId?: string
  /** The rule as it was before the tap taught it (null: there was none). */
  rule?: { id: string; before: any | null }
  /** The record as it was (confirm / change of an auto-filed one). */
  txBefore?: any
  itemBefore?: ToSortRaw
  ruleId?: string
  lastDone?: string | null
}

/** Finance Helper's data: this device's copy and the synced one, merged (newest record wins, deletions stick). */
export function mergedFinance(localRaw: string | null, synced: any | null): any | null {
  let local: any = null
  try {
    const v = localRaw ? JSON.parse(localRaw) : null
    if (v && Array.isArray(v.tx)) local = normalizeState(v)
  } catch {
    local = null
  }
  if (!local) return synced
  if (!synced) return local
  try {
    return mergeStates(local, toCloud(synced, '')).state
  } catch {
    return synced
  }
}

const has = (state: any, id: string) => (state.tx ?? []).some((t: any) => t?.id === id)
const gone = (state: any, id: string) => !!state.deleted?.[id]
const typeOf = (it: ToSortRaw): 'expense' | 'income' => (it.kind === 'refund' ? 'income' : 'expense')
/** Unreadable (kept so you can type the amount): kind 'ignore', still 'new'. */
const unread = (it: ToSortRaw) => it.kind === 'ignore' || !(Number(it.amount) > 0) || !it.currency
const merchantText = (it: ToSortRaw) => String(it.merchant ?? it.raw ?? '').trim().slice(0, 80)

function chip(state: any, id: string): Chip {
  const c = catOf(state, id)
  return { id, name: String(c?.name ?? id), emoji: String(c?.emoji ?? '') }
}

/**
 * Waiting for a tap: new (an unreadable one too, it asks for the amount), not
 * a second copy, not a test; or put back by Undo (`reopen`; its record is gone).
 */
export function isPending(it: ToSortRaw, state: any): boolean {
  if (it.dupOf || it.test) return false
  const st = it.state ?? 'new'
  if (st === 'new') return true
  if (it.reopen) return !it.txId || !has(state, it.txId)
  if (st === 'sorted' && it.auto && it.txId) return !has(state, it.txId)
  return false
}

/** Filed by itself and not yet confirmed or changed by you. */
function autoTx(it: ToSortRaw, state: any): any | null {
  if (it.state !== 'sorted' || !it.auto || it.reopen || !it.txId) return null
  const t = (state.tx ?? []).find((x: any) => x?.id === it.txId)
  return t && t.catBy === 'auto' ? t : null
}

export function suggestFor(state: any, note: string, type: 'expense' | 'income', now = Date.now()) {
  return suggest(state, { note, type }, { guess: suggestCategory(state, note, type), now })
}

/** The bills due up to today that wait for a tap (the earliest date of each). */
export function dueBills(state: any, today: string): BillItem[] {
  const out = new Map<string, BillItem>()
  for (const { rule, date } of dueItems(state, today)) {
    if (rule.type !== 'expense' || rule.auto) continue
    const prev = out.get(rule.id)
    if (prev) {
      prev.more++
      continue
    }
    out.set(rule.id, { ruleId: rule.id, date, amount: Number(rule.amount), currency: rule.currency || state.settings?.currency || 'MDL', note: String(rule.note ?? ''), category: chip(state, rule.category), more: 0 })
  }
  return [...out.values()]
}

export function sortView(state: any, list: ToSortList, today: string, dayOf: (ms: number) => string, now = Date.now()): SortView {
  const base = state?.settings?.currency || 'MDL'
  const categories = (state?.settings?.categories ?? []).filter((c: any) => !c.archived && (c.type === 'expense' || c.type === 'income')).map((c: any) => ({ ...chip(state, c.id), type: String(c.type) }))
  if (!state) return { pending: [], auto: [], bills: [], categories: [] }
  const pending: PendingItem[] = []
  const auto: AutoItem[] = []
  for (const it of list.items) {
    const merchant = merchantText(it)
    const type = typeOf(it)
    const at = Number(it.at) || now
    if (isPending(it, state)) {
      const s = suggestFor(state, merchant, type, now)
      const needsAmount = unread(it)
      pending.push({ id: it.id, amount: needsAmount ? 0 : Number(it.amount), currency: it.currency || base, merchant, source: String(it.source ?? ''), at, date: it.day || dayOf(at), type, chips: s.alternatives.map((id: string) => chip(state, id)), level: s.level, confidence: s.confidence, needsAmount, raw: needsAmount ? String(it.raw ?? '') : '', last4: String(it.last4 ?? '') })
      continue
    }
    const t = autoTx(it, state)
    if (t) {
      const s = suggestFor(state, merchant, type, now)
      auto.push({ id: it.id, txId: t.id, amount: Number(t.amount), currency: t.currency || base, merchant, category: chip(state, t.category), chips: s.alternatives.filter((id: string) => id !== t.category).slice(0, 2).map((id: string) => chip(state, id)), at, date: String(t.date) })
    }
  }
  pending.sort((a, b) => b.at - a.at)
  auto.sort((a, b) => b.at - a.at)
  return { pending, auto, bills: dueBills(state, today), categories }
}

// ---------------------------------------------------------------- writing

export class SortError extends Error {}

function accountFor(state: any, it: ToSortRaw, currency: string): string | null {
  const accounts: any[] = (state.settings?.accounts ?? []).filter((a: any) => !a.archived)
  const ok = (id: unknown) => accounts.some((a) => a.id === id && (a.currency || state.settings.currency) === currency)
  const mapped = state.settings?.captureAccounts?.[String(it.source ?? '')]
  if (ok(mapped)) return mapped
  if (ok(it.account)) return String(it.account)
  if (currency === (state.settings?.currency || 'MDL')) return mainAccountId(accounts, state.settings.currency) ?? accounts[0]?.id ?? null
  return accounts.find((a) => a.currency === currency && !a.savings)?.id ?? accounts.find((a) => a.currency === currency)?.id ?? null
}

/** The rate of a currency to the main one (never 1 just because none is known). */
function rateFor(state: any, currency: string): number {
  if (currency === (state.settings?.currency || 'MDL')) return 1
  const r = rateToBase(state, currency)
  if (!r) throw new SortError(`No ${currency} rate yet: open Finance Helper once so it can fetch rates, then sort this one.`)
  return r
}

function freeId(state: any, base: string): string {
  let id = base
  for (let n = 2; has(state, id) || gone(state, id); n++) id = `${base}-${n}`
  return id
}

// The state only moves forward (core/moneyToSort.ts mergeToSort); sorting or
// dismissing clears the raw notification text.
function setItem(list: ToSortList, id: string, patch: Partial<ToSortRaw>, now: number): ToSortRaw | null {
  const i = list.items.findIndex((x) => x.id === id)
  if (i < 0) return null
  const before = list.items[i]
  const next: ToSortRaw = { ...before, ...patch, updatedAt: Math.max(now, (Number(before.updatedAt) || 0) + 1) }
  if (next.state !== 'new') delete next.raw
  list.items[i] = next
  return before
}

const touch = (t: any, now: number) => {
  t.updatedAt = Math.max(now, (Number(t.updatedAt) || 0) + 1)
  return t
}

/** Teaches "this merchant is this category" as a rule (marked learned), returning what to restore on Undo. */
function teach(state: any, note: string, type: string, category: string, now: number): SortUndo['rule'] | undefined {
  const m = merchantOf(note)
  if (!m) return undefined
  const before = (state.settings.rules ?? []).find((r: any) => r && r.match === m && r.type === type) ?? null
  if (before && before.category === category) return undefined
  const rule = addRule2(state, { match: m, type, category, learned: true }, now)
  return rule ? { id: rule.id, before: before ? { ...before } : null } : undefined
}

function untaught(state: any, r: SortUndo['rule'], now: number): void {
  if (!r) return
  if (!r.before) removeRule2(state, r.id, now)
  else state.settings.rules = [...(state.settings.rules ?? []).filter((x: any) => x?.id !== r.id), { ...r.before, updatedAt: now }]
}


/** What you typed for an unreadable one: the amount in bani and its currency (the main one when left out). */
export interface TypedAmount {
  amount: number
  currency?: string
}

/** Makes the record for a capture (converted at sort time; the item's own currency is kept). */
function captureTx(state: any, it: ToSortRaw, category: string, opts: { auto: boolean; now: number; dayOf: (ms: number) => string; typed?: TypedAmount }): any {
  const type = typeOf(it)
  if (unread(it)) {
    if (!opts.typed || !(Number(opts.typed.amount) > 0)) throw new SortError('Type the amount first: the notification could not be read')
    it = { ...it, amount: Math.round(Number(opts.typed.amount)), currency: opts.typed.currency || it.currency || state.settings?.currency || 'MDL' }
  }
  const currency = String(it.currency || state.settings?.currency || 'MDL').toUpperCase()
  const rate = rateFor(state, currency)
  const account = accountFor(state, it, currency)
  if (!account) throw new SortError(`No ${currency} account in Finance Helper for this payment yet: add one there first.`)
  if (!catOf(state, category) || catOf(state, category).type !== type) throw new SortError('That category is no longer there')
  const id = freeId(state, captureTxId(it.id))
  const amount = Math.round(Number(it.amount))
  const tx: any = { id, createdAt: opts.now, updatedAt: opts.now, type, amount, currency, rate, base: Math.round(amount * rate), date: it.day || opts.dayOf(Number(it.at) || opts.now), category, account, note: merchantText(it), source: 'capture', catBy: opts.auto ? 'auto' : 'you' }
  if (!opts.auto) tx.confirmedAt = opts.now
  const s = suggestFor(state, tx.note, type, opts.now)
  const accBook = (state.settings.accounts ?? []).find((a: any) => a.id === account)?.book ?? 'personal'
  if (s.category === category && s.book && s.book !== accBook) tx.book = s.book
  return tx
}

/** One tap on a chip: the capture becomes a record and the merchant's rule is taught. */
export function fileItem(state: any, list: ToSortList, itemId: string, category: string, now: number, dayOf: (ms: number) => string, typed?: TypedAmount): { tx: any; undo: SortUndo } {
  const it = list.items.find((x) => x.id === itemId)
  if (!it || !isPending(it, state)) throw new SortError('Already sorted')
  const tx = captureTx(state, it, category, { auto: false, now, dayOf, typed })
  state.tx.push(tx)
  const rule = teach(state, tx.note, tx.type, category, now)
  const itemBefore = setItem(list, itemId, { state: 'sorted', txId: tx.id, auto: false, reopen: false }, now) ?? undefined
  return { tx, undo: { kind: 'file', itemId, txId: tx.id, rule, itemBefore } }
}

/** Files every capture the rules are sure about (and that Undo never put back). Returns the records made. */
export function autoFile(state: any, list: ToSortList, now: number, dayOf: (ms: number) => string): any[] {
  const made: any[] = []
  for (const it of list.items) {
    if (!isPending(it, state) || it.reopen || unread(it)) continue
    const s = suggestFor(state, merchantText(it), typeOf(it), now)
    if (!canAutoFile(s)) continue
    try {
      const tx = captureTx(state, it, s.category, { auto: true, now, dayOf })
      state.tx.push(tx)
      setItem(list, it.id, { state: 'sorted', txId: tx.id, auto: true }, now)
      made.push(tx)
    } catch {
      /* no rate or account yet: it stays in To sort */
    }
  }
  return made
}

/** "Send test" payments (Settings → Phone payments) are dismissed, never filed. Returns how many. */
export function dismissTests(list: ToSortList, now: number): number {
  let n = 0
  for (const it of list.items) if (it.test && (it.state ?? 'new') === 'new' && setItem(list, it.id, { state: 'dismissed' }, now)) n++
  return n
}

/** "OK" on a capture filed by itself: it is yours now (confirmedAt; learned from from now on). */
export function confirmAuto(state: any, list: ToSortList, itemId: string, now: number, category?: string): { tx: any; undo: SortUndo } {
  const it = list.items.find((x) => x.id === itemId)
  const t = it ? autoTx(it, state) : null
  if (!it || !t) throw new SortError('Already confirmed')
  const txBefore = { ...t }
  let rule: SortUndo['rule']
  if (category && category !== t.category) {
    if (catOf(state, category)?.type !== t.type) throw new SortError('That category is no longer there')
    t.category = category
    delete t.sub
    rule = teach(state, t.note, t.type, category, now)
  }
  t.catBy = 'you'
  t.confirmedAt = now
  touch(t, now)
  return { tx: t, undo: { kind: 'confirm', itemId, txId: t.id, txBefore, rule } }
}

/** "Undo" on a capture filed by itself: the record goes (with its deletion marker) and it is back in To sort, for a tap. */
export function undoAuto(state: any, list: ToSortList, itemId: string, now: number): SortUndo {
  const it = list.items.find((x) => x.id === itemId)
  const t = it ? autoTx(it, state) : null
  if (!it || !t) throw new SortError('Already changed')
  state.tx = state.tx.filter((x: any) => x.id !== t.id)
  state.deleted = { ...(state.deleted ?? {}), [t.id]: now }
  const itemBefore = setItem(list, itemId, { reopen: true }, now) ?? undefined
  return { kind: 'undo-auto', itemId, txId: t.id, txBefore: { ...t }, itemBefore }
}

/** "Not mine": the capture leaves To sort (kept in the list as dismissed). */
export function dismissItem(state: any, list: ToSortList, itemId: string, now: number): SortUndo {
  const it = list.items.find((x) => x.id === itemId)
  if (!it || !isPending(it, state)) throw new SortError('Already sorted')
  const itemBefore = setItem(list, itemId, { state: 'dismissed', reopen: false }, now) ?? undefined
  return { kind: 'dismiss', itemId, itemBefore }
}

/** One tap on a due bill: booked as the record Finance's Plan would make (`rec-<rule>-<date>`), confirmed now. */
export function confirmBill(state: any, ruleId: string, date: string, now: number): { tx: any; undo: SortUndo } {
  const rule = (state.recurring ?? []).find((r: any) => r.id === ruleId)
  if (!rule) throw new SortError('That bill is no longer there')
  const due = dueBills(state, '9999-12-31').find((b) => b.ruleId === ruleId)
  if (!due || due.date !== date) throw new SortError('Already booked')
  const rate = rateFor(state, rule.currency || state.settings.currency)
  const id = freeId(state, `rec-${rule.id}-${date}`)
  const tx = { ...makeTx(rule, date, { id, now, rate }), source: 'auto', catBy: 'rule', confirmedAt: now }
  state.tx.push(tx)
  const lastDone = rule.lastDone ?? null
  markDone(rule, date, now)
  return { tx, undo: { kind: 'bill', ruleId, txId: id, lastDone } }
}

/** "Didn't happen" on a due bill: that date is marked done, nothing is booked. */
export function skipBill(state: any, ruleId: string, date: string, now: number): SortUndo {
  const rule = (state.recurring ?? []).find((r: any) => r.id === ruleId)
  if (!rule) throw new SortError('That bill is no longer there')
  const lastDone = rule.lastDone ?? null
  markDone(rule, date, now)
  return { kind: 'skip', ruleId, lastDone }
}

/** Takes a tap back exactly (a record made by it goes, with its deletion marker; a rule it taught is restored). */
export function undoSort(state: any, list: ToSortList, u: SortUndo, now: number): void {
  const dropTx = (id?: string) => {
    if (!id || !has(state, id)) return
    state.tx = state.tx.filter((x: any) => x.id !== id)
    state.deleted = { ...(state.deleted ?? {}), [id]: now }
  }
  const restoreItem = (extra: Partial<ToSortRaw> = {}) => {
    if (!u.itemId) return
    const i = list.items.findIndex((x) => x.id === u.itemId)
    if (i < 0) return
    const cur = list.items[i]
    // The state only moves forward (two devices merge it that way): back to To sort = "reopen".
    list.items[i] = { ...cur, ...extra, updatedAt: Math.max(now, (Number(cur.updatedAt) || 0) + 1) }
  }
  const restoreRule = () => {
    const rule = (state.recurring ?? []).find((r: any) => r.id === u.ruleId)
    if (!rule) return
    rule.lastDone = u.lastDone ?? null
    rule.updatedAt = Math.max(now, (Number(rule.updatedAt) || 0) + 1)
  }
  if (u.kind === 'file') {
    dropTx(u.txId)
    untaught(state, u.rule, now)
    restoreItem({ reopen: true })
  } else if (u.kind === 'confirm') {
    const t = (state.tx ?? []).find((x: any) => x.id === u.txId)
    if (t && u.txBefore) Object.assign(t, { ...u.txBefore, updatedAt: Math.max(now, (Number(t.updatedAt) || 0) + 1) })
    if (t && u.txBefore && !('confirmedAt' in u.txBefore)) delete t.confirmedAt
    untaught(state, u.rule, now)
  } else if (u.kind === 'undo-auto') {
    // Back as it was filed: the same record again under a fresh id (the old one stays deleted).
    if (u.txBefore) {
      const id = freeId(state, u.itemId ? captureTxId(u.itemId) : String(u.txBefore.id))
      state.tx.push({ ...u.txBefore, id, updatedAt: now })
      restoreItem({ txId: id, reopen: false })
    }
  } else if (u.kind === 'dismiss') restoreItem({ reopen: true })
  else if (u.kind === 'bill') {
    dropTx(u.txId)
    restoreRule()
  } else if (u.kind === 'skip') restoreRule()
}

// ------------------------------------------------------------------ rules

export interface RuleRow {
  id: string
  match: string
  type: string
  category: string
  categoryName: string
  book: string | null
  learned: boolean
}
export interface LearnedRow {
  merchant: string
  label: string
  type: string
  category: string
  categoryName: string
  confidence: number
  level: 'sure' | 'maybe' | 'guess'
  n: number
}
export interface RulesView {
  rules: RuleRow[]
  learned: LearnedRow[]
  categories: (Chip & { type: string })[]
}

export function rulesOf(state: any, now = Date.now()): RulesView {
  if (!state) return { rules: [], learned: [], categories: [] }
  const v = rulesView(state, now)
  const categories = (state.settings?.categories ?? []).filter((c: any) => !c.archived && (c.type === 'expense' || c.type === 'income')).map((c: any) => ({ ...chip(state, c.id), type: String(c.type) }))
  return { rules: v.rules, learned: v.learned, categories }
}

/** Makes or changes a rule ("contains linella → Food"). An edit of the text replaces the old rule. */
export function saveRule(state: any, r: { id?: string; match: string; type: string; category: string }, now: number): any {
  const match = String(r.match ?? '').trim()
  if (match.length < 2) throw new SortError('Type at least 2 letters')
  const type = r.type === 'income' ? 'income' : 'expense'
  if (catOf(state, r.category)?.type !== type) throw new SortError('Pick a category of that kind')
  const old = r.id ? (state.settings.rules ?? []).find((x: any) => x?.id === r.id) : null
  const rule = addRule2(state, { match, type, category: r.category, book: old?.book }, now)
  if (old && rule && old.id !== rule.id) removeRule2(state, old.id, now)
  return rule
}

export function deleteRule(state: any, id: string, now: number): void {
  if (!removeRule2(state, id, now)) throw new SortError('That rule is already gone')
}
