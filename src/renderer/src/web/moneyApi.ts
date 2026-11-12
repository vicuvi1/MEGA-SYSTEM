// life.finance (MO1, MF1): the Money hub's numbers and one-line quick add.
// Quick add writes through financeBot.logMoney, the path the Telegram bot
// uses, so the record lands in Finance Helper's synced data; then this
// device's copy of Finance Helper is synced so its page shows it too.
// The heavy parts (Finance Helper's rules) load on first use.
import { LedgerError } from '@core/ledger'
import { financeStateFrom } from './botBrain'
import type { MoneyHubView } from './moneyHub'
import { inboxWarning, readInbox, type InboxWarning } from './financeInbox'
import type { WebServices } from './webServices'

export interface QuickPreview {
  amount: number
  /** The record's own currency (the account's), e.g. EUR for "10 food euro card". */
  currency?: string
  label: string
  type: string
  category: string
  account: string
  daysAgo: number
}

export interface QuickAdded {
  /** One plain line: "−45 lei · Food · Wallet". */
  line: string
  type: string
  amount: number
  /** The record's own currency. */
  currency?: string
  txId: string
  /** Points paid for the day's first log (0 when not). */
  paid: number
  ledgerId: number | null
  view: MoneyHubView | null
}

export interface MoneyApi {
  hub(): Promise<MoneyHubView | null>
  preview(text: string): Promise<QuickPreview | null>
  quickAdd(text: string): Promise<QuickAdded>
  undo(txId: string, ledgerId?: number | null): Promise<MoneyHubView | null>
  /** Days you said nothing was spent ("Nothing spent today"), for Finance Helper's day list. */
  freeDays(): Promise<string[]>
  /** Entries from Telegram still not in Finance Helper after 50 days (null: none). */
  inboxWarning(): Promise<InboxWarning | null>
  /** "Apply now": adds the waiting entries to Finance Helper on this device; returns how many and what still waits. */
  applyInbox(): Promise<{ added: number; warning: InboxWarning | null }>
}

const store = () => (typeof localStorage !== 'undefined' ? localStorage : null)
const W = 'life-wallet-changed'

export function createMoneyApi(svcP: Promise<WebServices>, syncFinance: () => Promise<unknown>, applyFinanceInbox: () => Promise<number> = async () => 0): MoneyApi {
  const hubMod = () => import('./moneyHub')
  const botMod = () => import('./financeBot')
  const hub = async (preferTx?: string): Promise<MoneyHubView | null> => {
    const [{ hubView }, { financeState }] = await Promise.all([hubMod(), botMod()])
    return (await svcP).read((s) => {
      const today = s.wallet.today()
      let state = financeStateFrom(s.db, store())
      // This device's copy may not have the new record yet (Finance Helper locked here): use the synced one.
      if (preferTx && !(state?.tx ?? []).some((t: any) => t?.id === preferTx)) state = financeState(s.db as any) ?? state
      return hubView(state, today)
    })
  }
  const freeDays = async () => (await svcP).read((s) => s.money.marks().nothingSpent)
  const warning = async () => (await svcP).read((s) => inboxWarning(readInbox(s.db as any), financeStateFrom(s.db, store())))
  return {
    hub: () => hub(),
    freeDays,
    inboxWarning: warning,
    applyInbox: async () => {
      const added = await applyFinanceInbox().catch(() => 0)
      if (added) await syncFinance().catch(() => null)
      return { added, warning: await warning() }
    },
    preview: async (text) => {
      const t = text.trim()
      if (!t || t.length > 120) return null
      const { previewMoney } = await botMod()
      return (await svcP).read((s) => previewMoney(s.db as any, t, { mainAccount: true }))
    },
    quickAdd: async (text) => {
      const t = text.trim()
      if (!t) throw new Error('Type an amount, like "45 food"')
      const { logMoney } = await botMod()
      const key = `app-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      const out = await (await svcP).write((s) => {
        const today = s.wallet.today()
        const r = logMoney(s.db as any, t, key, today, Date.now(), { mainAccount: true })
        if (!r) return null
        // The day's first spending log pays, once (same ref as the Finance Helper sync, so never twice).
        let paid = 0
        let ledgerId: number | null = null
        const day = String(r.tx.date)
        const ref = `fin:logged:${day}`
        if (r.tx.type === 'expense' && day === today && !s.wallet.effective().some((e) => e.ref === ref)) {
          try {
            const before = s.wallet.summary().balance
            ledgerId = s.wallet.awardRule('money.logged', { day, ref, note: 'Spending logged (Finance Helper)' })
            paid = s.wallet.summary().balance - before
          } catch (e) {
            if (!(e instanceof LedgerError)) throw e
          }
        }
        const plain = r.reply.split('\n')[0].replace(/<[^>]+>/g, '').replace(/^✅\s*/, '')
        return { line: plain, type: String(r.tx.type), amount: Number(r.tx.amount), currency: String(r.tx.currency || ''), txId: String(r.tx.id), paid, ledgerId }
      }, W)
      if (!out) throw new Error(`No amount in "${t.slice(0, 40)}". Try "45 food", "120+45 groceries yesterday" or "+500 salary".`)
      await syncFinance().catch(() => null)
      return { ...out, view: await hub(out.txId).catch(() => null) }
    },
    undo: async (txId, ledgerId) => {
      const { deleteMoney } = await botMod()
      await (await svcP).write((s) => {
        deleteMoney(s.db as any, txId)
        // Points paid for this log go back too (honest points).
        if (ledgerId) {
          try {
            s.wallet.undo(ledgerId, 'Spending log undone')
          } catch (e) {
            if (!(e instanceof LedgerError)) throw e
          }
        }
      }, W)
      await syncFinance().catch(() => null)
      return hub()
    }
  }
}
