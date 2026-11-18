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

/** A source name for the title: no control characters, at most 40 characters. */
const cleanName = (v: unknown): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) : '')

/**
 * The bell entry for a late salary, or null when it must not be sent: a bad
 * message, or this month's was already sent (`lastMonth`).
 * An income source (Money -> Settings -> Income sources) uses the same slot: the message may also
 * carry `tag` (the source's id, so each source is sent once a month), `source` (its name) and `kind`
 * ('late' or 'low'). The returned `month` is then "YYYY-MM:tag", which Life keeps as the last one sent.
 */
export function salaryNotice(payload: unknown, day: string, now: Date, lastMonth: string | null): { notif: Omit<Notif, 'readAt'>; month: string } | null {
  const p = (payload ?? {}) as { month?: unknown; due?: unknown; tag?: unknown; source?: unknown; kind?: unknown }
  if (typeof p.month !== 'string' || typeof p.due !== 'string' || !MONTH.test(p.month) || !DAY.test(p.due) || !p.due.startsWith(p.month)) return null
  const tag = typeof p.tag === 'string' && /^[\w-]{1,60}$/.test(p.tag) ? p.tag : ''
  const key = tag ? `${p.month}:${tag}` : p.month
  if (lastMonth === key) return null
  const name = tag ? cleanName(p.source) : ''
  const title = !name ? `Your salary is not in yet (due ${shortDue(p.due)})`
    : p.kind === 'low' ? `Income from ${name} is lower than usual`
      : `Income from ${name} is not in yet (due ${shortDue(p.due)})`
  return {
    month: key,
    notif: { id: slotNotifId('salary', day), at: now.toISOString(), kind: 'reminder', title, body: null, action: { kind: 'page', page: 'money', label: 'Open Money' } },
  }
}
