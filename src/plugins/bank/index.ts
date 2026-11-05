// MC9 Bank statement import: a CSV from your bank (uploaded in Money, or
// sent to Ben on Telegram) is read in memory, repeats are removed (same
// date + amount + description), and the payments go to Finance Helper's
// inbox (financeInbox.ts), which adds them on the next device that has
// Finance Helper open. The file itself is never stored.
import { getSetting } from '../../main/settings'
import { inboxIds, queueFinanceEntries, type InboxEntry } from '../../renderer/src/web/financeInbox'
import { definePlugin, type PluginDb } from '../types'
import { guessCategory, parseBankCsv, rowHash, uniqueRows } from './csv'

export const BANK = 'bank'

export interface BankImport {
  added: number
  /** Already in the inbox or in Finance Helper. */
  known: number
  /** Repeats inside the file. */
  repeats: number
  bad: number
  allPositive: boolean
}

/** Finance Helper's records (its synced copy): "date|bani|type" for each. */
function financeKeys(db: PluginDb): Set<string> {
  try {
    const st = JSON.parse(getSetting(db, 'app_sync_finance') || 'null')?.data
    return new Set((Array.isArray(st?.tx) ? st.tx : []).map((t: any) => `${t.date}|${Math.abs(Number(t.amount) || 0)}|${t.type === 'income' ? 'income' : 'expense'}`))
  } catch {
    return new Set()
  }
}

/** Reads a statement and queues the new payments for Finance Helper. */
export function importBank(db: PluginDb, text: string, now = new Date()): BankImport {
  const parsed = parseBankCsv(text)
  const rows = uniqueRows(parsed.rows)
  const inbox = inboxIds(db)
  const fin = financeKeys(db)
  const entries: InboxEntry[] = []
  let known = 0
  for (const r of rows) {
    const id = `tg-life-bank-${rowHash(r)}`
    // A single positive column is read as spending (most statements list what you paid).
    const type: 'expense' | 'income' = r.amount < 0 || parsed.allPositive ? 'expense' : 'income'
    const bani = Math.round(Math.abs(r.amount) * 100)
    if (inbox.has(id) || fin.has(`${r.date}|${bani}|${type}`)) {
      known++
      continue
    }
    entries.push({ id, amount: bani, category: type === 'expense' ? guessCategory(r.description) : 'other', note: r.description.slice(0, 80) || 'Bank', date: r.date, at: now.getTime(), type })
  }
  const added = queueFinanceEntries(db, entries, now.getTime()).length
  return { added, known: known + entries.length - added, repeats: parsed.rows.length - rows.length, bad: parsed.bad, allPositive: parsed.allPositive }
}

export function importText(r: BankImport): string {
  if (!r.added && !r.known) return '⚠️ No payments found in that file. Send the CSV export from your bank (date, amount, description).'
  const bits = [`🏦 ${r.added} new payment${r.added === 1 ? '' : 's'} sent to Finance Helper`]
  if (r.known) bits.push(`${r.known} already there`)
  if (r.repeats) bits.push(`${r.repeats} repeat${r.repeats === 1 ? '' : 's'} in the file skipped`)
  if (r.bad) bits.push(`${r.bad} line${r.bad === 1 ? '' : 's'} couldn't be read`)
  return `${bits.join(' · ')}.${r.allPositive ? ' All amounts were positive, so they count as spending.' : ''} They appear when Finance Helper opens on a device. The file wasn't kept.`
}

export default definePlugin({
  id: BANK,
  title: 'Bank statement import',
  icon: 'coin',
  about: 'Upload a bank CSV in Money (or send it to Ben on Telegram). Repeats are skipped; the payments go to Finance Helper. The file is never stored.',
  file: {
    accepts: (name, mime) => /\.csv$/i.test(name) || /text\/csv|comma-separated/i.test(mime),
    run: ({ db, now }, text) => importText(importBank(db, text, now))
  }
})
