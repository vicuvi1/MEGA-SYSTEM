// The island clock's other time zones: tap the clock and it shows the next
// zone you picked (local → zone 1 → zone 2 → … → local). Pure and tested
// (worldClock.test.ts). The zone math is Intl.DateTimeFormat with a
// timeZone; the formatters are made once per zone and kept.

/** One extra zone on the clock: an IANA id ("America/New_York") and an optional short name ("NYC"). */
export interface ClockZone {
  tz: string
  label: string
}

export const ZONES_MAX = 5
export const ZONE_LABEL_MAX = 12
/** How long another zone stays before the clock goes back to your time (when that switch is on). */
export const ZONE_BACK_MS = 30_000

/** For engines without Intl.supportedValuesOf: the big cities, one per zone people usually want. */
export const FALLBACK_ZONES = [
  'UTC',
  'Pacific/Honolulu', 'America/Anchorage', 'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York',
  'America/Toronto', 'America/Mexico_City', 'America/Bogota', 'America/Sao_Paulo', 'America/Argentina/Buenos_Aires',
  'Atlantic/Reykjavik', 'Europe/London', 'Europe/Dublin', 'Europe/Lisbon', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid',
  'Europe/Rome', 'Europe/Amsterdam', 'Europe/Stockholm', 'Europe/Warsaw', 'Europe/Athens', 'Europe/Bucharest', 'Europe/Kyiv',
  'Europe/Istanbul', 'Europe/Moscow', 'Africa/Cairo', 'Africa/Lagos', 'Africa/Johannesburg', 'Africa/Nairobi', 'Asia/Dubai',
  'Asia/Karachi', 'Asia/Kolkata', 'Asia/Dhaka', 'Asia/Bangkok', 'Asia/Jakarta', 'Asia/Singapore', 'Asia/Hong_Kong',
  'Asia/Shanghai', 'Asia/Taipei', 'Asia/Seoul', 'Asia/Tokyo', 'Australia/Perth', 'Australia/Adelaide', 'Australia/Sydney',
  'Pacific/Auckland'
]

const fmts = new Map<string, Intl.DateTimeFormat | null>()
/** The formatter for a zone ('' = this computer's), or null when the zone doesn't exist. Made once. */
function fmt(tz: string): Intl.DateTimeFormat | null {
  let f = fmts.get(tz)
  if (f !== undefined) return f
  try {
    f = new Intl.DateTimeFormat('en-GB', { ...(tz ? { timeZone: tz } : {}), year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  } catch {
    f = null
  }
  fmts.set(tz, f)
  return f
}

/** Is this a time zone this computer knows? */
export function isZone(tz: unknown): tz is string {
  return typeof tz === 'string' && tz.length > 0 && tz.length <= 64 && fmt(tz) !== null
}

/** This computer's own zone id ("Europe/Berlin"), or '' when it can't tell. */
export function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  } catch {
    return ''
  }
}

/** Every zone id this computer knows (the fallback list when it can't say). */
export function allZones(): string[] {
  try {
    const list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone')
    if (Array.isArray(list) && list.length > 0) return list
  } catch {
    /* older engine */
  }
  return FALLBACK_ZONES.filter((z) => isZone(z))
}

/** A saved list → at most 5 valid zones, no doubles, short labels. Anything else is dropped. */
export function cleanZones(v: unknown): ClockZone[] {
  const out: ClockZone[] = []
  for (const x of Array.isArray(v) ? v : []) {
    const tz = typeof x === 'string' ? x : (x as { tz?: unknown } | null)?.tz
    if (!isZone(tz) || out.some((z) => z.tz === tz)) continue
    const raw = typeof x === 'object' && x ? (x as { label?: unknown }).label : ''
    const label = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, ZONE_LABEL_MAX) : ''
    out.push({ tz, label })
    if (out.length >= ZONES_MAX) break
  }
  return out
}

/** "America/New_York" → "New York", "America/Argentina/Buenos_Aires" → "Buenos Aires", "Etc/GMT+5" → "UTC−5". */
export function cityOf(tz: string): string {
  const etc = /^Etc\/GMT([+-])(\d{1,2})$/.exec(tz)
  // The Etc zones have the sign the other way round (Etc/GMT+5 is five hours behind).
  if (etc) return `UTC${etc[1] === '+' ? '−' : '+'}${etc[2]}`
  if (/^(Etc\/)?(UTC|GMT|UCT|Zulu|Universal|Greenwich)$/.test(tz)) return 'UTC'
  const last = tz.split('/').pop() ?? tz
  return last.replace(/_/g, ' ')
}

/** What the clock calls a zone: your label, or the city. */
export const zoneName = (z: ClockZone): string => z.label || cityOf(z.tz)

/** Which entry comes after `cur` (0 = your time, 1… = your zones in order), back to 0 after the last. */
export function nextZoneIndex(cur: number, count: number): number {
  if (count <= 0 || !Number.isInteger(cur) || cur < 0 || cur >= count) return 0
  return cur + 1
}

interface Parts { y: number; m: number; d: number; h: number; min: number }
/** The date and time in a zone ('' = this computer's). */
export function zoneParts(at: Date, tz = ''): Parts {
  const f = fmt(tz) ?? fmt('')
  const p: Record<string, number> = {}
  for (const x of f!.formatToParts(at)) if (x.type !== 'literal') p[x.type] = Number(x.value)
  return { y: p.year, m: p.month, d: p.day, h: p.hour % 24, min: p.minute }
}

const two = (n: number) => String(n).padStart(2, '0')
/** "08:05" in that zone ('' = this computer's). */
export function zoneTime(at: Date, tz = ''): string {
  const p = zoneParts(at, tz)
  return `${two(p.h)}:${two(p.min)}`
}

/** How many days that zone is ahead (+1), behind (−1) or the same (0) compared with here. */
export function dayOffset(at: Date, tz: string, here = ''): number {
  const a = zoneParts(at, tz)
  const b = zoneParts(at, here)
  return Math.round((Date.UTC(a.y, a.m - 1, a.d) - Date.UTC(b.y, b.m - 1, b.d)) / 864e5)
}

/** "+1" / "−1" (a real minus sign), or '' on the same day. */
export const dayMark = (n: number): string => (n === 0 ? '' : `${n > 0 ? '+' : '−'}${Math.abs(n)}`)
/** The day marker in words, for screen readers and tooltips. */
export const dayWords = (n: number): string => (n === 0 ? '' : n === 1 ? 'tomorrow there' : n === -1 ? 'yesterday there' : `${Math.abs(n)} days ${n > 0 ? 'ahead' : 'behind'}`)

/** All of them at once: "Local 14:05 · NYC 08:05 · Tokyo 22:05 +1". */
export function worldLine(at: Date, zones: ClockZone[], here = ''): string {
  return [`Local ${zoneTime(at, here)}`, ...zones.map((z) => {
    const mark = dayMark(dayOffset(at, z.tz, here))
    return `${zoneName(z)} ${zoneTime(at, z.tz)}${mark ? ` ${mark}` : ''}`
  })].join(' · ')
}

/** The zones whose id or city has the words typed (spaces and underscores alike), best first. */
export function searchZones(q: string, all: string[], limit = 30): string[] {
  const words = q.toLowerCase().replace(/[_/]+/g, ' ').split(/\s+/).filter(Boolean)
  if (!words.length) return all.slice(0, limit)
  const hits: { tz: string; score: number }[] = []
  for (const tz of all) {
    const hay = tz.toLowerCase().replace(/[_/]+/g, ' ')
    if (!words.every((w) => hay.includes(w))) continue
    const city = cityOf(tz).toLowerCase()
    hits.push({ tz, score: city.startsWith(words[0]) ? 0 : hay.split(' ').some((p) => p.startsWith(words[0])) ? 1 : 2 })
  }
  return hits.sort((a, b) => a.score - b.score || a.tz.localeCompare(b.tz)).slice(0, limit).map((h) => h.tz)
}
