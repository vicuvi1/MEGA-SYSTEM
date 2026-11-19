// Money's reality check reminder (2026-11-19, was the monthly check-up): one calm bell entry when a
// check is due (every 2 weeks by default, from the chosen time; Finance Helper js/checkup.js), and if it
// is still not done, one gentle reminder 2 days later. Then nothing until the next cycle. It goes
// through the same daily push budget (slot 'checkup': one of the 4 a day, quiet hours and focus are
// the bell's). Entries already in the bell from any device count, so two devices send it once.
// No amounts in the text: notifications stay neutral and private.
import { slotNotifId } from './notifyBudget'
import type { Notif } from './notify'

const DAY = /^\d{4}-\d{2}-\d{2}$/
const ID = /^budget:checkup:(\d{4}-\d{2}-\d{2})/

const daysBetween = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5)

/** The days this cycle's entries were added (from any device), oldest first. */
export const checkupSentDays = (ids: readonly string[], cycle: string): string[] =>
  ids.map((id) => (typeof id === 'string' ? ID.exec(id)?.[1] : undefined)).filter((d): d is string => !!d && d >= cycle).sort()

/** An entry for this cycle is already in the bell, from any device. */
export const checkupInBell = (ids: readonly string[], cycle: string): boolean => checkupSentDays(ids, cycle).length > 0

/**
 * The bell entry for a due reality check, or null. `cycle` = the start of the running cycle
 * (checkupDue().cycle), `day` = today. First entry: none yet this cycle. Reminder: exactly one,
 * at least 2 days old. Never more than 2 a cycle.
 */
export function checkupNotice(cycle: string, now: Date, bellIds: readonly string[], day: string = cycle): Omit<Notif, 'readAt'> | null {
  if (!DAY.test(cycle) || !DAY.test(day) || day < cycle) return null
  const sent = checkupSentDays(bellIds, cycle)
  if (sent.length >= 2 || sent.includes(day)) return null
  const reminder = sent.length === 1
  if (reminder && daysBetween(sent[0], day) < 2) return null
  return {
    id: slotNotifId('checkup', day),
    at: now.toISOString(),
    kind: 'reminder',
    title: reminder ? 'Your reality check is still waiting' : 'Time for your reality check: compare your accounts with your bank',
    body: reminder ? 'It takes a few minutes: type what your bank shows for each account.' : null,
    action: { kind: 'page', page: 'money', label: 'Open Money' },
  }
}
