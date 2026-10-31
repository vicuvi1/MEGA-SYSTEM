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

/**
 * Logs a money message into Finance Helper's data, or returns null when it
 * isn't one (no amount) or Finance Helper was never synced yet.
 */
export function logMoney(db: Db, text: string, key: string, today: string, now = Date.now()): LoggedMoney | null {
  const state = financeState(db)
  if (!state) return null
  const f = parseQuick(text, state)
  if (!f || !(f.amount > 0)) return null
  f.category = betterCategory(state, f)
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
