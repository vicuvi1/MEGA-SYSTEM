// Money's reality check reminder, app side (2026-11-19, was the monthly check-up). Reads this device's
// Money data (plain only: locked Money is never opened here), asks Finance Helper
// (apps/finance/js/checkup.js) whether a check is due by now (every 2 weeks by default, from the chosen
// time) and adds one bell entry per cycle, plus one gentle reminder 2 days later (core/checkupNotice.ts).
// Runs a little after start, after every app sync, and every 30 minutes. Settings → Reality check in
// Money switches it off (settings.checkupOn).
import { dayKey } from '@core/dates'
import { checkupNotice } from '@core/checkupNotice'
import type { Notif } from '@core/notify'
// @ts-ignore plain JS module from the embedded app
import { normalizeState } from '../../public/apps/finance/js/model.js'
// @ts-ignore plain JS module from the embedded app
import { checkupDue } from '../../public/apps/finance/js/checkup.js'
import { hostStore } from '../web/bigStore'

/** What this device sent for the running cycle: { cycle, days }. */
export const CHECKUP_SENT_KEY = 'life_checkup_sent'
const FINANCE_KEY = 'finance-helper.state'

export interface CheckupDeps {
  store: Pick<Storage, 'getItem' | 'setItem'> | null
  add: (n: Omit<Notif, 'readAt'>) => Promise<void>
  bellIds: () => Promise<string[]>
  now: Date
}

/** One check. Returns the entry added (none when off, locked, not due, or already sent this month). */
export async function checkCheckup(d: CheckupDeps): Promise<Omit<Notif, 'readAt'> | null> {
  const store = d.store
  if (!store) return null
  let raw: unknown = null
  try { raw = JSON.parse(store.getItem(FINANCE_KEY) || 'null') } catch { return null }
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { tx?: unknown }).tx)) return null
  const day = dayKey(d.now)
  const hhmm = `${String(d.now.getHours()).padStart(2, '0')}:${String(d.now.getMinutes()).padStart(2, '0')}`
  const due = checkupDue(normalizeState(raw), day, hhmm) as { cycle: string } | null
  if (!due) return null
  // What this device already sent this cycle counts like what is in the bell (the bell may have been cleared).
  let sent: { cycle?: string; days?: string[] } = {}
  try { sent = JSON.parse(store.getItem(CHECKUP_SENT_KEY) || '{}') || {} } catch { /* an old month value: start fresh */ }
  const mine = sent.cycle === due.cycle && Array.isArray(sent.days) ? sent.days : []
  const ids = [...(await d.bellIds().catch(() => [] as string[])), ...mine.map((x) => `budget:checkup:${x}`)]
  const n = checkupNotice(due.cycle, d.now, ids, day)
  if (!n) return null
  await d.add(n)
  try { store.setItem(CHECKUP_SENT_KEY, JSON.stringify({ cycle: due.cycle, days: [...mine, day] })) } catch { /* private window */ }
  return n
}

let busy = false
async function runOnce(): Promise<void> {
  if (busy) return
  busy = true
  try {
    const { life } = await import('../bridge')
    if (!life.notifications?.add) return
    let store: Storage | null = null
    try { store = hostStore() ?? window.localStorage } catch { /* blocked */ }
    await checkCheckup({
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
export function startCheckupReminder(): () => void {
  if (typeof window === 'undefined') return () => {}
  let soon: ReturnType<typeof setTimeout> | null = null
  const later = (ms = 5000) => {
    if (soon) clearTimeout(soon)
    soon = setTimeout(() => { soon = null; void runOnce() }, ms)
  }
  const onSync = () => later(8000)
  window.addEventListener('life-app-sync', onSync)
  const first = setTimeout(() => void runOnce(), 25000)
  const every = setInterval(() => void runOnce(), 30 * 60000)
  return () => {
    window.removeEventListener('life-app-sync', onSync)
    clearTimeout(first)
    clearInterval(every)
    if (soon) clearTimeout(soon)
  }
}
