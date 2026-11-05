import { calendarDay } from './dates'
// Type the time instead of picking it (pure, D4): "fri 18:00", "tomorrow
// 9-10:30", "in 2h", "today 14:00 for 45m", "every mon 8:00", "12 nov 10:00".
// English plus a few Romanian words. Returns null when it doesn't read as a time.

export interface When {
  day: string
  /** Minutes from midnight. */
  start: number
  end: number | null
  /** Weekday numbers (0 = Sunday) for "every …". */
  every: number[] | null
}

const DAYS: Record<string, number> = { sun: 0, sunday: 0, dum: 0, mon: 1, monday: 1, lun: 1, tue: 2, tues: 2, tuesday: 2, mar: 2, wed: 3, wednesday: 3, mie: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, joi: 4, fri: 5, friday: 5, vin: 5, sat: 6, saturday: 6, sam: 6 }
const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11, ian: 0, mai: 4, iun: 5, iul: 6, noi: 10 }
const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => calendarDay(d)

/** "18", "18:30", "6pm", "6:30pm", "18.30" → minutes, or null. */
function time(t: string): number | null {
  const m = /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/i.exec(t.trim())
  if (!m) return null
  let h = Number(m[1])
  const min = Number(m[2] ?? 0)
  const ap = m[3]?.toLowerCase()
  if (ap === 'pm' && h < 12) h += 12
  if (ap === 'am' && h === 12) h = 0
  if (h > 24 || min > 59) return null
  return h * 60 + min
}

export function parseWhen(input: string, now = new Date()): When | null {
  let s = input.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!s) return null
  // "in 2h", "in 30 min", "in 1h30"
  const rel = /^in (\d+(?:[.,]\d+)?)\s*(h|hours?|ore|m|min|mins|minutes?)(?:\s*(\d+)\s*(?:m|min)?)?$/.exec(s)
  if (rel) {
    const n = Number(rel[1].replace(',', '.'))
    const mins = /^h|^ore/.test(rel[2]) ? n * 60 + Number(rel[3] ?? 0) : n
    const at = new Date(now.getTime() + mins * 60_000)
    const start = Math.round((at.getHours() * 60 + at.getMinutes()) / 5) * 5
    return { day: ymd(at), start, end: null, every: null }
  }
  let day = new Date(now)
  let every: number[] | null = null
  // "for 45m" / "for 2h" at the end: a length.
  let len: number | null = null
  const forM = /\s+for (\d+(?:[.,]\d+)?)\s*(h|m|min|mins|minutes|hours?)$/.exec(s)
  if (forM) {
    const n = Number(forM[1].replace(',', '.'))
    len = /^h/.test(forM[2]) ? Math.round(n * 60) : Math.round(n)
    s = s.slice(0, forM.index).trim()
  }
  const words = s.split(' ')
  // every mon / every mon,wed
  if (words[0] === 'every' || words[0] === 'fiecare') {
    const list = (words[1] ?? '').split(',').map((w) => DAYS[w]).filter((x) => x != null)
    if (!list.length) return null
    every = list
    const next = (list.map((d) => (d - now.getDay() + 7) % 7).sort((a, b) => a - b)[0] ?? 0)
    day.setDate(day.getDate() + next)
    words.splice(0, 2)
  } else if (words[0] === 'today' || words[0] === 'azi' || words[0] === 'astazi') words.shift()
  else if (words[0] === 'tomorrow' || words[0] === 'tmr' || words[0] === 'maine' || words[0] === 'mâine') {
    day.setDate(day.getDate() + 1)
    words.shift()
  } else if (words[0] in DAYS) {
    const d = DAYS[words.shift()!]
    day.setDate(day.getDate() + (((d - now.getDay() + 7) % 7) || 7))
  } else if (/^\d{1,2}$/.test(words[0]) && words[1] && words[1].slice(0, 4) in MONTHS) {
    // "12 nov"
    const d = new Date(now.getFullYear(), MONTHS[words[1].slice(0, 4)] ?? MONTHS[words[1].slice(0, 3)], Number(words[0]), 12)
    if (d.getTime() < now.getTime() - 86400_000) d.setFullYear(d.getFullYear() + 1)
    day = d
    words.splice(0, 2)
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(words[0])) {
    day = new Date(`${words.shift()}T12:00:00`)
  }
  const rest = words.join(' ').replace(/^at /, '')
  if (!rest) return null
  // "9-10:30", "9:00–10:30", "18:00"
  const range = rest.split(/\s*[-–]\s*/)
  const start = time(range[0])
  if (start == null) return null
  let end = range[1] != null ? time(range[1]) : null
  if (range[1] != null && end == null) return null
  // "9-1" means 13:00; "22:30-01:00" runs past midnight (end over 24 h).
  if (end != null && end <= start) end += end < 12 * 60 && end + 12 * 60 > start ? 12 * 60 : 24 * 60
  if (end == null && len) end = start + len
  return { day: ymd(day), start, end: end != null && end > start ? end : null, every }
}
