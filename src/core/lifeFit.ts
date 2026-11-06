// "My life" (Settings → Ben): a few facts about your week that Ben and the
// planner use. Pure and tested (lifeFit.test.ts).
//
// - Sleep: the bedtime target and wake time live where they always did (the
//   sleep targets); here only the latest bedtime, the line after which the
//   late-night nudges get firm.
// - Work: the days and hours of a job (say an evening shift) and how much of
//   it you really work (it changes). The planner treats the window as partly
//   busy: no deep focus there, light tasks are fine. "Short shift tonight" or
//   "no work tonight" opens the free part up for that day only.
// - How hard Ben pushes: Gentle / Firm / Push, mapped onto the tone and the
//   nudge caps that already exist (never above them, never past quiet hours).

export type PushLevel = 'gentle' | 'firm' | 'push'
/** Tonight's shift: as usual, short (only the usual minimum is busy) or none. */
export type ShiftMode = 'normal' | 'short' | 'off'

export interface WorkWindow {
  on: boolean
  /** 0 = Sunday … 6 = Saturday. */
  days: number[]
  from: string
  /** "24:00" is midnight at the end of the day. */
  to: string
  /** How much of the window you really work, in hours (it changes). */
  minH: number
  maxH: number
}

export interface LifeFit {
  /** After this the late-night nudges get firm ("HH:MM", may be after midnight). */
  latestBed: string
  work: WorkWindow
  push: PushLevel
  /** A one-day change to the work window ("short shift tonight"). */
  tonight?: { day: string; mode: ShiftMode } | null
}

export const LIFE_FIT_KEY = 'life_fit'
export const DEFAULT_BED = '23:30'
/** The wake target when none is set (the sleep rule's long-standing default). */
export const DEFAULT_WAKE = '07:00'
export const DEFAULT_LIFE_FIT: LifeFit = {
  latestBed: '00:00',
  work: { on: false, days: [1, 2, 3, 4, 5], from: '18:00', to: '22:00', minH: 1, maxH: 3 },
  push: 'push',
  tonight: null
}

const HM = /^([01]\d|2[0-3]):[0-5]\d$/
const isHm = (x: unknown): x is string => typeof x === 'string' && HM.test(x)
const isEnd = (x: unknown): x is string => isHm(x) || x === '24:00'
export const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
const hm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const hours = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(0, Math.min(12, Math.round(x * 2) / 2)) : d)

export function cleanLifeFit(raw: unknown): LifeFit {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<LifeFit>
  const w = (o.work && typeof o.work === 'object' ? o.work : {}) as Partial<WorkWindow>
  const d = DEFAULT_LIFE_FIT.work
  const days = Array.isArray(w.days) ? [...new Set(w.days.filter((x) => Number.isInteger(x) && x >= 0 && x <= 6))].sort() : d.days
  const minH = hours(w.minH, d.minH)
  const t = o.tonight
  return {
    latestBed: isHm(o.latestBed) ? o.latestBed : DEFAULT_LIFE_FIT.latestBed,
    work: { on: w.on === true, days, from: isHm(w.from) ? w.from : d.from, to: isEnd(w.to) ? w.to : d.to, minH, maxH: Math.max(minH, hours(w.maxH, d.maxH)) },
    push: o.push === 'gentle' || o.push === 'firm' ? o.push : 'push',
    tonight: t && typeof t.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.day) && (t.mode === 'short' || t.mode === 'off' || t.mode === 'normal') ? { day: t.day, mode: t.mode } : null
  }
}

const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay()

/** Today's work window as the planner sees it, or null (no work today, or it's off). */
export interface WorkToday {
  from: string
  to: string
  mode: ShiftMode
  /** The part that is really busy (a short shift: the usual minimum from the start), or null. */
  busy: { from: string; to: string } | null
  /** The part where only light tasks go (never deep focus), or null. */
  light: { from: string; to: string } | null
}

export function workToday(fit: LifeFit, day: string): WorkToday | null {
  const w = fit.work
  if (!w.on || !w.days.includes(weekday(day)) || toMin(w.to) <= toMin(w.from)) return null
  const mode: ShiftMode = fit.tonight?.day === day ? fit.tonight.mode : 'normal'
  if (mode === 'off') return { from: w.from, to: w.to, mode, busy: null, light: null }
  if (mode === 'short') {
    const end = Math.min(toMin(w.to), toMin(w.from) + Math.round(Math.max(0.5, w.minH) * 60))
    return { from: w.from, to: w.to, mode, busy: { from: w.from, to: end >= 1440 ? '24:00' : hm(end) }, light: null }
  }
  return { from: w.from, to: w.to, mode, busy: null, light: { from: w.from, to: w.to } }
}

/** "short shift tonight", "no work tonight", "normal shift" (English, Romanian, Russian), or null. */
export function readShift(text: string): ShiftMode | null {
  const t = text.toLowerCase().replace(/\s+/g, ' ').trim()
  if (t.length > 80) return null
  if (/\b(no work|not working|day off|no shift|off work|free tonight)\b/.test(t) || /(nu lucrez|liber azi|liber diseară|не работаю|выходной)/.test(t)) return 'off'
  if (/\b(short shift|shorter shift|short work)\b/.test(t) || /(tura scurt|lucrez pu[tț]in|короткая смена)/.test(t)) return 'short'
  if (/\b(normal shift|full shift|working as usual|work as usual)\b/.test(t) || /(tura normal|обычная смена)/.test(t)) return 'normal'
  return null
}

/** Sets (or clears, with 'normal') tonight's change. */
export function setTonight(fit: LifeFit, day: string, mode: ShiftMode): LifeFit {
  return { ...fit, tonight: mode === 'normal' ? null : { day, mode } }
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const daysText = (days: number[]) => (days.length === 7 ? 'every day' : days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d)) ? 'Mon–Fri' : days.map((d) => DAY_NAMES[d]).join(', ') || 'no days')
export const usualText = (w: WorkWindow) => (w.minH === w.maxH ? `${w.minH} h` : `${w.minH}–${w.maxH} h`)

/** The reply when you tell Ben about tonight. */
export function shiftReply(fit: LifeFit, day: string, mode: ShiftMode): string {
  const w = workToday({ ...fit, tonight: { day, mode } }, day)
  if (!w) return mode === 'normal' ? 'Ok, the usual plan.' : 'Noted. There is no work window set for today (Settings → Ben → My life).'
  if (mode === 'off') return `No work tonight: ${w.from}–${w.to} is free for real work today.`
  if (mode === 'short') return `Short shift: ${w.busy!.from}–${w.busy!.to} is work, the rest until ${w.to} is free today.`
  return `Normal shift: ${w.from}–${w.to} stays for light tasks only.`
}

/** One line for Ben's prompt: the sleep window, the work window and tonight. */
export function lifeFitLine(fit: LifeFit, day: string, sleep: { bed: string; wake: string }): string {
  const parts = [`MY LIFE: bed by ${sleep.bed} (latest ${fit.latestBed}), up at ${sleep.wake}.`]
  const w = fit.work
  if (w.on) {
    parts.push(`Work: ${daysText(w.days)} ${w.from}–${w.to}, but he usually works only ${usualText(w)} of it (it changes). Treat that window as partly busy: never deep focus there, light tasks and quick wins are fine.`)
    const t = workToday(fit, day)
    if (t?.mode === 'off') parts.push(`Today: no work tonight, so ${t.from}–${t.to} is free.`)
    else if (t?.mode === 'short') parts.push(`Today: a short shift (${t.busy!.from}–${t.busy!.to}), the rest of the window is free.`)
    else if (t) parts.push(`Today is a work day. If he says "short shift tonight" or "no work tonight", the free part opens up.`)
  }
  return parts.join(' ')
}

// ---- how hard Ben pushes ----

export interface PushStyle {
  /** Ben's tone (1 gentle … 5 drill sergeant). */
  tone: number
  /** Messages a day on his own (never more than the app-wide cap). */
  messagesPerDay: number
  /** Island interruptions an hour (never more than the governor's cap). */
  perHour: number
  /** The move break may end in a firmer Ben line. */
  escalate: boolean
  label: string
  hint: string
}
export const PUSH_LEVELS: PushLevel[] = ['gentle', 'firm', 'push']

/** Each level within the existing caps (`maxMessages`, `maxPerHour`): Push is the most, never more. */
export function pushStyle(level: PushLevel, caps: { maxMessages: number; maxPerHour: number } = { maxMessages: 15, maxPerHour: 3 }): PushStyle {
  const m = caps.maxMessages
  const h = caps.maxPerHour
  if (level === 'gentle') return { tone: 2, messagesPerDay: Math.min(m, Math.round(m * 0.5)), perHour: Math.min(h, Math.max(1, h - 1)), escalate: false, label: 'Gentle', hint: 'Warm, fewer messages, no firm follow-ups' }
  if (level === 'firm') return { tone: 3, messagesPerDay: Math.min(m, Math.round(m * 0.8)), perHour: h, escalate: false, label: 'Firm', hint: 'Honest and direct, a normal number of nudges' }
  return { tone: 4, messagesPerDay: m, perHour: h, escalate: true, label: 'Push', hint: 'Tough love, all the nudges, firmer follow-ups (still within quiet hours)' }
}
