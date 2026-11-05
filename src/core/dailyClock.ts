// When the daily messages are due, in YOUR time (LT2). Vercel's crons run in
// UTC, so with daylight saving they drift an hour, and they are the only
// thing that calls them. Now the tick (every few minutes) sends each one once
// its local time has come, and Vercel's crons are only the backup. Both use
// the same once-a-day slot (sys_gate `daily:<job>`), so nothing goes twice.
export type ClockJob = 'morning' | 'reask' | 'midday' | 'evening'

/** Local start time (minutes after midnight) of each daily message. */
export const DAILY_AT: Record<ClockJob, number> = {
  morning: 8 * 60 + 30,
  reask: 10 * 60,
  midday: 13 * 60,
  evening: 21 * 60 + 30
}
/** A tick this long after the start still sends it (the timer may be late); never past midnight. */
export const DAILY_WINDOW_MIN = 150

/** The jobs whose local time has come (and not yet passed its window), for this minute of the day. */
export function dailyDue(minuteOfDay: number): ClockJob[] {
  return (Object.keys(DAILY_AT) as ClockJob[]).filter((j) => minuteOfDay >= DAILY_AT[j] && minuteOfDay < Math.min(DAILY_AT[j] + DAILY_WINDOW_MIN, 24 * 60))
}

/** Minutes after local midnight in a time zone (Europe/Chisinau when none is given). */
export function localMinute(now: Date, timeZone = 'Europe/Chisinau'): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  return n('hour') * 60 + n('minute')
}

/** The gate name both the tick and Vercel's cron claim (api/cron.mjs, BG16). */
export const dailyGate = (job: string) => `daily:${job}`
/** At most once per this long (the same as api/cron.mjs). */
export const DAILY_GAP_MS = 20 * 3600_000
