// Money's budget warnings, app side (2026-11-17, #8). Reads this device's Money data (plain only:
// locked Money is never opened here), asks Finance Helper's budget numbers which categories reached
// 80% or 100% this month (apps/finance/js/budgetwarn.js), and adds one bell entry per new crossing
// (core/budgetNotice.ts). Runs a little after start, after every Money save and app sync, and every
// 30 minutes, so a record from the bot or another device counts too. Settings → Budget warnings in
// Money switches it off (settings.budgetWarn).
import { dayKey } from '@core/dates'
import { budgetNotices, type BudgetCrossing } from '@core/budgetNotice'
import type { Notif } from '@core/notify'
// @ts-ignore plain JS module from the embedded app
import { normalizeState } from '../../public/apps/finance/js/model.js'
import './privacy' // loads the shared privacy state (hidden until Space)
// @ts-ignore plain JS module from the embedded app
import { budgetCrossings, newWarnings, thisMonthKeys, warningsOn, amountsHidden } from '../../public/apps/finance/js/budgetwarn.js'

/** This device's warnings already sent: { month, keys }. */
export const SENT_KEY = 'life_budget_warned'
const FINANCE_KEY = 'finance-helper.state'

export interface WarnDeps {
  store: Pick<Storage, 'getItem' | 'setItem'> | null
  add: (n: Omit<Notif, 'readAt'>) => Promise<void>
  bellIds: () => Promise<string[]>
  now: Date
}

/** One check. Returns the entries added (none when off, locked, or nothing new). */
export async function checkBudgetWarnings(d: WarnDeps): Promise<Omit<Notif, 'readAt'>[]> {
  const store = d.store
  if (!store) return []
  let raw: unknown = null
  try { raw = JSON.parse(store.getItem(FINANCE_KEY) || 'null') } catch { return [] }
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { tx?: unknown }).tx)) return []
  const state = normalizeState(raw)
  if (!warningsOn(state)) return []
  const day = dayKey(d.now)
  const month = day.slice(0, 7)
  let sent: string[] = []
  try { sent = thisMonthKeys(JSON.parse(store.getItem(SENT_KEY) || 'null')?.keys, month) } catch { /* start over */ }
  const { warn, keys } = newWarnings(budgetCrossings(state, day), sent) as { warn: BudgetCrossing[]; keys: string[] }
  if (!warn.length) return []
  const ids = await d.bellIds().catch(() => [] as string[])
  const out = budgetNotices(warn, { day, now: d.now, currency: state.settings.currency || 'MDL', hideAmounts: !!amountsHidden(), bellIds: ids })
  for (const n of out) await d.add(n)
  try { store.setItem(SENT_KEY, JSON.stringify({ month, keys })) } catch { /* private window: the bell's own check still stops a repeat */ }
  return out
}

let busy = false
async function runOnce(): Promise<void> {
  if (busy) return
  busy = true
  try {
    const { life } = await import('../bridge')
    if (!life.notifications?.add) return
    let store: Storage | null = null
    try { store = window.localStorage } catch { /* blocked */ }
    await checkBudgetWarnings({
      store,
      add: (n) => life.notifications!.add!(n),
      bellIds: async () => ((await life.notifications?.list().catch(() => [])) ?? []).map((n) => n.id),
      now: new Date(),
    })
  } catch {
    /* the next run tries again */
  } finally {
    busy = false
  }
}

/** Starts the checks; returns a stop function. */
export function startBudgetWarnings(): () => void {
  if (typeof window === 'undefined') return () => {}
  let soon: ReturnType<typeof setTimeout> | null = null
  const later = (ms = 2000) => {
    if (soon) clearTimeout(soon)
    soon = setTimeout(() => { soon = null; void runOnce() }, ms)
  }
  const onMessage = (e: MessageEvent) => {
    if (e.origin !== window.location.origin) return
    const t = (e.data as { type?: string; action?: string } | null) ?? null
    if (t?.type === 'FINANCE_TRANSACTION_LOGGED' || (t?.type === 'LIFE_SYSTEM_BRIDGE' && t.action === 'FINANCE_TRANSACTION_LOGGED')) later()
  }
  const onSync = () => later(5000)
  window.addEventListener('message', onMessage)
  window.addEventListener('life-app-sync', onSync)
  const first = setTimeout(() => void runOnce(), 20000)
  const every = setInterval(() => void runOnce(), 30 * 60000)
  return () => {
    window.removeEventListener('message', onMessage)
    window.removeEventListener('life-app-sync', onSync)
    clearTimeout(first)
    clearInterval(every)
    if (soon) clearTimeout(soon)
  }
}
