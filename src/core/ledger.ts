// The wallet. The ledger is append-only: balances are always the sum of the
// rows that are still in effect, and an undo is a new row, never a delete.

export type EntryKind = 'earn' | 'spend' | 'adjust' | 'undo'

export interface LedgerEntry {
  id: number
  ts: string // ISO instant
  day: string // local day key at write time
  module: string
  kind: EntryKind
  coins: number
  xp: number // never negative
  ruleId?: string | null
  ref?: string | null
  note?: string | null
  undoOf?: number | null
}

export type NewEntry = Omit<LedgerEntry, 'id'>

export class LedgerError extends Error {
  name = 'LedgerError'
}

/** Rows that still count: not undo rows and not undone. */
export function effective(entries: LedgerEntry[]): LedgerEntry[] {
  const undone = new Set<number>()
  for (const e of entries) if (e.kind === 'undo' && e.undoOf != null) undone.add(e.undoOf)
  return entries.filter((e) => e.kind !== 'undo' && !undone.has(e.id))
}

export function balance(entries: LedgerEntry[]): number {
  return effective(entries).reduce((s, e) => s + e.coins, 0)
}

/** XP only ever goes up; undoing an earn is the one way it is corrected. */
export function totalXp(entries: LedgerEntry[]): number {
  return effective(entries).reduce((s, e) => s + Math.max(0, e.xp), 0)
}

/**
 * Penalties dock coins but never push the balance below zero, so one bad day
 * can't wipe out the wallet.
 */
export function clampPenalty(currentBalance: number, coins: number): number {
  if (coins >= 0) return coins
  return Math.max(coins, -Math.max(0, currentBalance))
}

export function planSpend(entries: LedgerEntry[], price: number): void {
  if (!Number.isInteger(price) || price <= 0) throw new LedgerError('Price must be a positive whole number')
  const bal = balance(entries)
  if (bal < price) throw new LedgerError(`Not enough coins (${bal}/${price})`)
}

/** Validates an undo and returns the row to insert. */
export function planUndo(entries: LedgerEntry[], id: number, note: string, ts: string, day: string): NewEntry {
  if (!note.trim()) throw new LedgerError('An undo needs a reason')
  const target = entries.find((e) => e.id === id)
  if (!target) throw new LedgerError('Entry not found')
  if (target.kind === 'undo') throw new LedgerError('Cannot undo an undo')
  // Otherwise a low roll could be undone and the chest opened again.
  if (target.ref?.startsWith('chest:')) throw new LedgerError('Chest prizes are final')
  if (entries.some((e) => e.kind === 'undo' && e.undoOf === id)) throw new LedgerError('Already undone')
  if (balance(entries) - target.coins < 0) throw new LedgerError('Those coins were already spent')
  return { ts, day, module: target.module, kind: 'undo', coins: 0, xp: 0, ruleId: target.ruleId ?? null, ref: target.ref ?? null, note, undoOf: id }
}

/** Coins earned and spent per module, for the weekly review. */
export function byModule(entries: LedgerEntry[]): Record<string, { earned: number; spent: number; xp: number }> {
  const out: Record<string, { earned: number; spent: number; xp: number }> = {}
  for (const e of effective(entries)) {
    const m = (out[e.module] ??= { earned: 0, spent: 0, xp: 0 })
    if (e.coins >= 0) m.earned += e.coins
    else m.spent += -e.coins
    m.xp += e.xp
  }
  return out
}
