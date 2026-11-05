// A "day" starts at 04:00 local time, so a study block finished at 01:30
// still counts for the evening it belongs to.
export const DAY_START_HOUR = 4

const fmtCache = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone?: string): Intl.DateTimeFormat {
  const key = timeZone ?? ''
  let f = fmtCache.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
    fmtCache.set(key, f)
  }
  return f
}

/** Local day key (YYYY-MM-DD) for an instant, shifted by DAY_START_HOUR. */
export function dayKey(at: Date | string, timeZone?: string, startHour = DAY_START_HOUR): string {
  const t = typeof at === 'string' ? new Date(at) : at
  const shifted = new Date(t.getTime() - startHour * 3600_000)
  return formatter(timeZone).format(shifted)
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
