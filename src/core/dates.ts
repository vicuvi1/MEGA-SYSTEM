// A "day" starts at 04:00 local time, so a study block finished at 01:30
// still counts for the evening it belongs to.
export const DAY_START_HOUR = 4

const fmtCache = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = fmtCache.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
    fmtCache.set(timeZone, f)
  }
  return f
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** YYYY-MM-DD of an instant: in `timeZone`, or in the local zone when none is given.
 * The local case reads the Date's own fields, so it follows a process.env.TZ set at
 * runtime (a cached Intl formatter would keep the zone it was made in). */
function ymdOf(t: Date, timeZone?: string): string {
  if (timeZone) return formatter(timeZone).format(t)
  return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`
}

/** The APP day (YYYY-MM-DD) for an instant: it turns at DAY_START_HOUR (04:00), so
 * 01:30 still belongs to the evening before. Use this for anything you "did today":
 * points, habits, focus, water, Ben's once-a-day counters. */
export function dayKey(at: Date | string, timeZone?: string, startHour = DAY_START_HOUR): string {
  const t = typeof at === 'string' ? new Date(at) : at
  return ymdOf(new Date(t.getTime() - startHour * 3600_000), timeZone)
}

/** The CALENDAR date (YYYY-MM-DD) for an instant: it turns at midnight. Use this only
 * where the real date matters: the calendar grid, an event's date, a date you type,
 * file and snapshot names. For "today" in the app's sense use dayKey. */
export function calendarDay(at: Date | string = new Date(), timeZone?: string): string {
  return ymdOf(typeof at === 'string' ? new Date(at) : at, timeZone)
}

function toUtc(day: string): number {
  const [y, m, d] = day.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000)
}

export function addDays(day: string, n: number): string {
  return new Date(toUtc(day) + n * 86_400_000).toISOString().slice(0, 10)
}

export function monthKey(day: string): string {
  return day.slice(0, 7)
}

/** The hour on the app's clock: 00:00–03:59 still belong to the evening before (25, 26, 27). */
export const appHour = (now = new Date()) => {
  const h = now.getHours()
  return h < DAY_START_HOUR ? h + 24 : h
}

/** One way to show a day everywhere (V11): "Thu 5 Nov" (no weekday: "5 Nov"). */
export function dayLabel(day: string, weekday = true): string {
  const d = new Date(`${day}T12:00:00Z`)
  return d.toLocaleDateString('en-GB', { ...(weekday ? { weekday: 'short' as const } : {}), day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(',', '')
}
/** "30 Oct – 5 Nov" (V11). */
export const dayRange = (from: string, to: string) => `${dayLabel(from, false)} – ${dayLabel(to, false)}`
