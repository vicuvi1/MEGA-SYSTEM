// Money's monthly check-up reminder (2026-11-18): one calm bell entry on the check-up day
// (settings.checkupDay in Finance Helper, js/checkup.js) while some account is not yet checked
// this month. It goes through the same daily push budget (slot 'checkup': one of the 4 a day,
// quiet hours and focus are the bell's) and is added once a month: this device remembers the month
// it sent, and an entry another device already added this month is not added again.
// No amounts in the text: notifications stay neutral and private.
import { slotNotifId } from './notifyBudget'
import type { Notif } from './notify'

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** An entry for this month's check-up is already in the bell, from any device. */
export const checkupInBell = (ids: readonly string[], month: string): boolean => ids.some((id) => typeof id === 'string' && id.startsWith(`budget:checkup:${month}-`))

/** The bell entry for today's check-up, or null (bad day, or this month's is already in the bell). */
export function checkupNotice(day: string, now: Date, bellIds: readonly string[]): Omit<Notif, 'readAt'> | null {
  if (!DAY.test(day) || checkupInBell(bellIds, day.slice(0, 7))) return null
  return {
    id: slotNotifId('checkup', day),
    at: now.toISOString(),
    kind: 'reminder',
    title: 'Time for your monthly Money check-up',
    body: null,
    action: { kind: 'page', page: 'money', label: 'Open Money' },
  }
}
