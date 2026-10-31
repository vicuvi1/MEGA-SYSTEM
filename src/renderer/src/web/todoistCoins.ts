// Coins for completed Todoist tasks: each task pays once (ref todoist:<id>),
// within the rule's daily limit, wherever it was completed.
import { LedgerError } from '@core/ledger'
import { TODOIST_RULE, type TodoCompleted } from '@core/todoist'
import type { Services } from './webServices'

export function payTodoist(s: Services, done: Pick<TodoCompleted, 'id' | 'content'>[]): number {
  const paid = new Set(s.wallet.entries().map((e) => e.ref ?? '').filter((r) => r.startsWith('todoist:')))
  let n = 0
  for (const t of done) {
    const ref = `todoist:${t.id}`
    if (paid.has(ref)) continue
    try {
      s.wallet.awardRule(TODOIST_RULE, { ref, note: t.content.slice(0, 120) })
      paid.add(ref)
      n++
    } catch (e) {
      if (!(e instanceof LedgerError)) throw e // daily limit reached or rule off: no coins
    }
  }
  return n
}
