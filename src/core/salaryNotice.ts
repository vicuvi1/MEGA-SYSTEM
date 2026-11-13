// Money's "salary not in yet" message (2026-11-13). Finance Helper tells Life once
// the pay day + 2 days has passed with no matching income; this builds the one
// bell entry. It goes through the same daily push budget as everything else
// (slot 'salary': at most 4 pushes a day, quiet hours and focus respected by the
// bell and the desktop), and it is sent at most once a month.
// No amount in the text: notifications stay neutral and private.
import { slotNotifId } from './notifyBudget'
import type { Notif } from './notify'

const MONTH = /^\d{4}-\d{2}$/
const DAY = /^\d{4}-\d{2}-\d{2}$/
const NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-11-10" -> "10 Nov". */
export const shortDue = (iso: string): string => `${Number(iso.slice(8))} ${NAMES[Number(iso.slice(5, 7)) - 1]}`

/**
 * The bell entry for a late salary, or null when it must not be sent: a bad
 * message, or this month's was already sent (`lastMonth`).
 */
export function salaryNotice(payload: unknown, day: string, now: Date, lastMonth: string | null): { notif: Omit<Notif, 'readAt'>; month: string } | null {
  const p = (payload ?? {}) as { month?: unknown; due?: unknown }
  if (typeof p.month !== 'string' || typeof p.due !== 'string' || !MONTH.test(p.month) || !DAY.test(p.due) || !p.due.startsWith(p.month)) return null
  if (lastMonth === p.month) return null
  return {
    month: p.month,
    notif: { id: slotNotifId('salary', day), at: now.toISOString(), kind: 'reminder', title: `Your salary is not in yet (due ${shortDue(p.due)})`, body: null, action: { kind: 'page', page: 'money', label: 'Open Money' } },
  }
}
