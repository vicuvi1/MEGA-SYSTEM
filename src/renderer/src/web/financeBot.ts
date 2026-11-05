// Money messages from Telegram, understood the way Finance Helper's own bot
// does ("taxi 45 maib", "120+45 groceries", "coffee 35 yesterday", "+500
// salary"): its parser, its learned categories and its "the account you
// used last for this" — plus Life System's keyword list when it can only
// guess "Other". The record goes straight into Finance Helper's synced data
// in Turso (settings.app_sync_finance), so every device gets it; buttons
// under the reply change the account or category, or undo it.
// @ts-ignore plain JS modules from the embedded app
import { parseQuick, recordFromMessage, recordDay, loggedText } from '../../public/apps/finance/js/telegram.js'
// @ts-ignore
import { normalizeState, SCHEMA_VERSION, category as catOf, account as accOf } from '../../public/apps/finance/js/model.js'
// @ts-ignore
import { toCloud } from '../../public/apps/finance/js/sync.js'
import { detectExpenseCategory } from '@core/botCommands'
import { mainAccountId } from '@core/moneyHub'
import { getSetting, setSetting } from '../../../main/settings'

const SETTING = 'app_sync_finance'
type Db = Parameters<typeof getSetting>[0]

/** Finance Helper's data as every device last synced it (null: never synced). */
export function financeState(db: Db): any | null {
  try {
    const saved = JSON.parse(getSetting(db, SETTING) || 'null')
    if (saved?.data) return normalizeState({ ...saved.data, version: SCHEMA_VERSION })
    const legacy = JSON.parse(getSetting(db, 'finance_backup_json') || 'null')
    return legacy ? normalizeState(legacy) : null
  } catch {
    return null
  }
}

function save(db: Db, state: any): void {
  setSetting(db, SETTING, JSON.stringify({ savedAt: Date.now(), data: toCloud(state, '').data }))
}

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** "Other" is only a last resort: Life System's keyword list (EN/RO/RU) may know better. */
function betterCategory(state: any, f: any): string {
  const fallback = f.type === 'income' ? 'other-in' : 'other'
  if (f.category && f.category !== fallback) return f.category
  const guess = detectExpenseCategory(fold(String(f.note || '')))
  const hit = state.settings.categories.find((c: any) => c.id === guess && c.type === f.type && !c.archived)
  return hit ? hit.id : f.category || fallback
}

/**
 * Quick add in the app (MF1): no account named in the text → the main lei
 * wallet (not "the account you used last", which the Telegram bot keeps).
 */
function toMainAccount(state: any, text: string, f: any): void {
  const NONE = '__none__'
  const probe = parseQuick(text, { ...state, tx: [], settings: { ...state.settings, accounts: [{ id: NONE, name: '', archived: true }, ...state.settings.accounts] } })
  if (probe && probe.account !== NONE) return // an account was named ("45 food maib")
  const main = mainAccountId(state.settings.accounts, state.settings.currency)
  if (main) f.account = main
}

export interface LoggedMoney {
  tx: any
  reply: string
  keyboard: any
}

const baseAccounts = (state: any) =>
  state.settings.accounts.filter((a: any) => !a.archived && (a.currency || state.settings.currency) === state.settings.currency)

/** The buttons under a logged record: its account, category, undo. */
export function moneyKeyboard(state: any, t: any, extra = ''): any {
  const accs = baseAccounts(state).slice(0, 6)
  const rows: any[][] = []
  for (let i = 0; i < accs.length; i += 3) {
    rows.push(accs.slice(i, i + 3).map((a: any) => ({ text: `${a.id === t.account ? '✓ ' : ''}${a.emoji ? a.emoji + ' ' : ''}${a.name}`, callback_data: `fa|${t.id}|${a.id}` })))
  }
  rows.push([
    { text: `📂 ${catOf(state, t.category)?.name || 'Category'}`, callback_data: `fc|${t.id}` },
    { text: '↩️ Undo', callback_data: `fu|${t.id}${extra ? '|' + extra : ''}` }
  ])
  return { inline_keyboard: rows }
}

function categoryKeyboard(state: any, t: any): any {
  const cats = state.settings.categories.filter((c: any) => c.type === t.type && !c.archived).slice(0, 18)
  const rows: any[][] = []
  for (let i = 0; i < cats.length; i += 3) {
    rows.push(cats.slice(i, i + 3).map((c: any) => ({ text: `${c.id === t.category ? '✓ ' : ''}${c.emoji ? c.emoji + ' ' : ''}${c.name}`, callback_data: `fk|${t.id}|${c.id}` })))
  }
  rows.push([{ text: '⬅️ Back', callback_data: `fb|${t.id}` }])
  return { inline_keyboard: rows }
}

/** What a money message would log, without logging it (X5): "45 lei · Food", or null. */
export function previewMoney(db: Db, text: string, opts: { mainAccount?: boolean } = {}): { amount: number; label: string; type: string; category: string; account: string; daysAgo: number } | null {
  const state = financeState(db)
  if (!state) return null
  const f = parseQuick(text, state)
  if (!f || !(f.amount > 0)) return null
  f.category = betterCategory(state, f)
  if (opts.mainAccount) toMainAccount(state, text, f)
  const c = catOf(state, f.category)
  const cur = accOf(state, f.account)?.currency || state.settings.currency
  const a = accOf(state, f.account)
  return { amount: f.amount, label: `${Math.round(f.amount) / 100} ${cur}${c?.name ? ` · ${c.name}` : ''}${f.type === 'income' ? ' (income)' : ''}`, type: f.type, category: `${c?.emoji ? c.emoji + ' ' : ''}${c?.name ?? 'Other'}`, account: `${a?.emoji ? a.emoji + ' ' : ''}${a?.name ?? ''}`, daysAgo: Number(f.daysAgo) || 0 }
}

const ASK_KEY = 'money_ask'
/** Keeps an unclear money message for its [Log it] / [Not money] buttons; returns its id. */
export function keepMoneyAsk(db: Db, text: string, now = Date.now()): string {
  let all: Record<string, { text: string; at: number }> = {}
  try {
    all = JSON.parse(getSetting(db, ASK_KEY) || '{}')
  } catch {
    all = {}
  }
  const id = now.toString(36)
  all[id] = { text, at: now }
  const keep = Object.entries(all).filter(([, v]) => now - v.at < 3 * 86400_000).slice(-20)
  setSetting(db, ASK_KEY, JSON.stringify(Object.fromEntries(keep)))
  return id
}
/** Takes back a kept message (once). */
export function takeMoneyAsk(db: Db, id: string): string | null {
  try {
    const all = JSON.parse(getSetting(db, ASK_KEY) || '{}')
    const v = all[id]
    if (!v) return null
    delete all[id]
    setSetting(db, ASK_KEY, JSON.stringify(all))
    return String(v.text)
  } catch {
    return null
  }
}

/**
 * Logs a money message into Finance Helper's data, or returns null when it
 * isn't one (no amount) or Finance Helper was never synced yet.
 */
export function logMoney(db: Db, text: string, key: string, today: string, now = Date.now(), opts: { mainAccount?: boolean } = {}): LoggedMoney | null {
  const state = financeState(db)
  if (!state) return null
  const f = parseQuick(text, state)
  if (!f || !(f.amount > 0)) return null
  f.category = betterCategory(state, f)
  if (opts.mainAccount) toMainAccount(state, text, f)
  const acc = accOf(state, f.account)
  const currency = acc?.currency || state.settings.currency
  const rate = currency === state.settings.currency ? 1 : Number(state.rates?.[currency]) || 1
  const tx = recordFromMessage(f, { updateId: key.replace(/[^\w-]/g, '-'), date: recordDay(today, f), rate, currency, now })
  if (state.tx.some((x: any) => x.id === tx.id)) return null
  state.tx.push(tx)
  save(db, state)
  return { tx, reply: loggedText(state, tx, today), keyboard: moneyKeyboard(state, tx) }
}

/** A button under a logged record was tapped: returns the new text and buttons. */
export function moneyButton(db: Db, data: string, today: string): { text: string; keyboard?: any; toast: string; undoExpense?: number } | null {
  const [kind, id, arg] = data.split('|')
  const state = financeState(db)
  const t = state?.tx.find((x: any) => x.id === id)
  if (!state || !t) return { text: '↩️ This record is no longer in Finance Helper.', toast: 'Already removed' }
  const now = Date.now()
  if (kind === 'fc') return { text: loggedText(state, t, today), keyboard: categoryKeyboard(state, t), toast: 'Pick a category' }
  if (kind === 'fb') return { text: loggedText(state, t, today), keyboard: moneyKeyboard(state, t), toast: '' }
  if (kind === 'fu') {
    state.tx = state.tx.filter((x: any) => x.id !== id)
    state.deleted = { ...(state.deleted || {}), [id]: now }
    save(db, state)
    return { text: `↩️ <s>${loggedText(state, t, null).split('\n')[0].replace(/<[^>]+>/g, '')}</s>\nRemoved from Finance Helper.`, toast: 'Undone', undoExpense: Number(arg) || undefined }
  }
  if (kind === 'fa' && accOf(state, arg)) t.account = arg
  else if (kind === 'fk' && catOf(state, arg)) t.category = arg
  else return null
  t.updatedAt = now
  save(db, state)
  const what = kind === 'fa' ? `From ${accOf(state, arg).name}` : catOf(state, arg).name
  return { text: loggedText(state, t, today), keyboard: moneyKeyboard(state, t), toast: `✓ ${what}` }
}

// ---- The coach fixes money records (M1, M2… in its prompt) ---------------

export interface MoneyRef {
  id: string
  line: string
}

/** The last records (newest first, last 3 days) the coach can point at. */
export function recentMoney(db: Db, today: string, n = 8): MoneyRef[] {
  const state = financeState(db)
  if (!state) return []
  const from = new Date(Date.parse(`${today}T12:00:00Z`) - 3 * 86400000).toISOString().slice(0, 10)
  return state.tx
    .filter((t: any) => typeof t.date === 'string' && t.date >= from)
    .sort((a: any, b: any) => (b.date + String(b.createdAt ?? 0)).localeCompare(a.date + String(a.createdAt ?? 0)) || Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0))
    .slice(0, n)
    .map((t: any) => ({
      id: String(t.id),
      line: `${t.date.slice(5)} ${t.type === 'income' ? '+' : '−'}${Math.round(Number(t.amount) / 100)} ${t.currency || state.settings.currency} · ${catOf(state, t.category)?.name || 'Other'}${t.note ? ` "${String(t.note).slice(0, 40)}"` : ''} · ${accOf(state, t.account)?.name || ''}`
    }))
}

/** Removes a record (it syncs as deleted to every device). */
export function deleteMoney(db: Db, id: string): string | null {
  const state = financeState(db)
  const t = state?.tx.find((x: any) => x.id === id)
  if (!state || !t) return null
  state.tx = state.tx.filter((x: any) => x.id !== id)
  state.deleted = { ...(state.deleted || {}), [id]: Date.now() }
  save(db, state)
  return `${t.type === 'income' ? '+' : '−'}${Math.round(Number(t.amount) / 100)} ${t.currency || state.settings.currency} ${t.note || catOf(state, t.category)?.name || ''}`.trim()
}

const fuzzy = (list: any[], name: string) => {
  const w = fold(name).replace(/[^\p{L}\p{N} ]/gu, '').trim()
  if (!w) return null
  return list.find((x) => fold(x.name).replace(/[^\p{L}\p{N} ]/gu, '').trim() === w) ?? list.find((x) => fold(x.name).includes(w) || w.includes(fold(x.name))) ?? null
}

/** Changes a record: amount (in whole units), category, account (by name), note, date. */
export function editMoney(db: Db, id: string, patch: { amount?: number; category?: string; account?: string; note?: string; date?: string }): { ok: boolean; text: string } {
  const state = financeState(db)
  const t = state?.tx.find((x: any) => x.id === id)
  if (!state || !t) return { ok: false, text: 'That record is no longer there' }
  const changed: string[] = []
  if (patch.amount != null && patch.amount > 0) {
    t.amount = Math.round(patch.amount * 100)
    t.base = Math.round(t.amount * (Number(t.rate) || 1))
    changed.push(`${patch.amount} ${t.currency || state.settings.currency}`)
  }
  if (patch.category) {
    const c = fuzzy(state.settings.categories.filter((x: any) => x.type === t.type && !x.archived), patch.category)
    if (!c) return { ok: false, text: `No category called "${patch.category}"` }
    t.category = c.id
    changed.push(c.name)
  }
  if (patch.account) {
    const a = fuzzy(state.settings.accounts.filter((x: any) => !x.archived), patch.account)
    if (!a) return { ok: false, text: `No account called "${patch.account}"` }
    t.account = a.id
    changed.push(`from ${a.name}`)
  }
  if (patch.note != null) {
    t.note = patch.note
    changed.push(`"${patch.note}"`)
  }
  if (patch.date && /^\d{4}-\d{2}-\d{2}$/.test(patch.date)) {
    t.date = patch.date
    changed.push(patch.date)
  }
  if (!changed.length) return { ok: false, text: 'Nothing to change' }
  t.updatedAt = Date.now()
  save(db, state)
  return { ok: true, text: changed.join(' · ') }
}
