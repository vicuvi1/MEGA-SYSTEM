// Ben's one job (feature freeze, 2026-11-11). Pure and tested (benOneJob.test.ts).
//   21:15  he asks for tomorrow's 3 must-dos (core/mustDoRule.ts checks them).
//   23:15+ any activity in the app or on Telegram gets ONE "go to sleep" a night.
//   Sunday 18:00 the week's 3 numbers (core/threeNumbers.ts weekSummaryText).
// Everything else he used to say on his own is off by default (core/notifyBudget.ts).

export const NIGHT_FROM_MIN = 23 * 60 + 15
/** How long the 21:15 question stays open for a plain reply (3 hours). */
export const PICK_OPEN_MS = 3 * 3600_000

/** True from 23:15 until the day turns at 04:00. */
export function lateNow(d: Date): boolean {
  const m = d.getHours() * 60 + d.getMinutes()
  return m >= NIGHT_FROM_MIN || m < 4 * 60
}

/** One "go to sleep" a night: late now, and not said yet for this app day. */
export function nightNudgeDue(d: Date, lastDay: string | null | undefined, appDay: string): boolean {
  return lateNow(d) && lastDay !== appDay
}

export function nightText(d: Date): string {
  const m = d.getHours() * 60 + d.getMinutes()
  return m >= 23 * 60 + 30 || m < 4 * 60 ? 'It is past 23:30. Go to sleep now: phone away, lights off.' : 'It is 23:15. Time to go to sleep: phone away, asleep by 23:30.'
}

/** The bell id that marks tonight's "go to sleep" as said (shared by the app and Telegram). */
export const nightNotifId = (appDay: string): string => `night:${appDay}`

/** Is the 21:15 question still open for a plain reply? */
export function pickOpen(pick: { day?: string; at?: string } | null | undefined, now: Date): boolean {
  if (!pick?.at) return false
  const at = Date.parse(pick.at)
  return Number.isFinite(at) && now.getTime() >= at && now.getTime() - at < PICK_OPEN_MS
}
