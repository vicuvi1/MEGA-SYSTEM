// Sleep care (pure, tested in sleepCare.test.ts): the small daily things that
// make the night work, kept in one synced setting (`sleep_care`).
//
// - BD4 Morning light: after the wake-up, one card asks for 10 minutes of
//   outdoor light (15–20 on a cloudy or rainy morning, from the weather
//   plugin when it is on). Tapped "done" by you, never ticked by itself.
// - BD4 Caffeine curfew: a coffee log ("coffee" on Telegram, ☕ on Sleep)
//   and a "last caffeine" time 8–10 h before bedtime (default 9.5 h: 14:00
//   for a 23:30 bed). After the curfew the island says it once, softly.
// - BD6 Sleep debt: the last 7 nights against a need you set (default 8 h),
//   from the bed and wake times Waky and the app log. When you're behind:
//   one 20-minute nap before 15:00 and an earlier night on the next free
//   evening (no work window that day).
//
// No points here: nothing in this file pays anything.
import type { IslandAlert } from './islandModel'
import type { SleepLog } from './sleep'
import { addDays } from './dates'
import { nightMinutes } from './readiness'

export const SLEEP_CARE_KEY = 'sleep_care'

/** A tap on a sleep-care card on the island (IslandAction 'care'). Each logs only what you say you did. */
export type CareOp =
  | { op: 'light' }
  | { op: 'coffee' }
  | { op: 'warm' }
  /** After-shift checklist (afterShift.ts). */
  | { op: 'shiftStep'; step: string; on: boolean }

export interface CareDay {
  /** You said you got your morning light (ms). */
  light?: number
  /** Coffees (and other caffeine) logged today (ms each). */
  coffee?: number[]
  /** After-shift checklist steps ticked tonight (afterShift.ts). */
  shift?: string[]
  /** You turned the warm screen (Night light) on after sunset (eyeCare.ts). */
  warm?: number
}

export interface SleepCare {
  /** Hours of sleep you need a night (6–10, half hours). */
  needH: number
  /** Last caffeine this many hours before bedtime (8–10, half hours). */
  curfewH: number
  days: Record<string, CareDay>
}

export const DEFAULT_CARE: SleepCare = { needH: 8, curfewH: 9.5, days: {} }

const HM = /^([01]\d|2[0-3]):[0-5]\d$/
const isHm = (v: unknown): v is string => typeof v === 'string' && HM.test(v)
const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
export const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
export const hmOf = (m: number) => `${String(Math.floor((((m % 1440) + 1440) % 1440) / 60)).padStart(2, '0')}:${String((((m % 1440) + 1440) % 1440) % 60).padStart(2, '0')}`
const clockOf = (ms: number) => {
  const d = new Date(ms)
  return d.getHours() * 60 + d.getMinutes()
}
const halves = (v: unknown, d: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v * 2) / 2)) : d)
const times = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)).slice(-12) : [])

/** Saved value → valid; keeps the last 21 days. */
export function cleanCare(raw: unknown): SleepCare {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<SleepCare>
  const days: Record<string, CareDay> = {}
  const src = o.days && typeof o.days === 'object' ? (o.days as Record<string, any>) : {}
  for (const k of Object.keys(src).filter(isDay).sort().slice(-21)) {
    const d = src[k] ?? {}
    const coffee = times(d.coffee)
    const shift: string[] = Array.isArray(d.shift) ? [...new Set<string>(d.shift.filter((x: unknown): x is string => typeof x === 'string' && x.length <= 20))].slice(0, 8) : []
    days[k] = {
      ...(Number.isFinite(d.light) ? { light: d.light } : {}),
      ...(coffee.length ? { coffee } : {}),
      ...(shift.length ? { shift } : {}),
      ...(Number.isFinite(d.warm) ? { warm: d.warm } : {})
    }
  }
  return { needH: halves(o.needH, DEFAULT_CARE.needH, 6, 10), curfewH: halves(o.curfewH, DEFAULT_CARE.curfewH, 8, 10), days }
}

export const careDay = (c: SleepCare, day: string): CareDay => c.days[day] ?? {}
const withDay = (c: SleepCare, day: string, f: (d: CareDay) => CareDay): SleepCare => ({ ...c, days: { ...c.days, [day]: f(careDay(c, day)) } })

export const markLight = (c: SleepCare, day: string, at: number) => withDay(c, day, (d) => ({ ...d, light: at }))
export const markWarm = (c: SleepCare, day: string, at: number) => withDay(c, day, (d) => ({ ...d, warm: at }))
export const addCoffee = (c: SleepCare, day: string, at: number, cups = 1) => withDay(c, day, (d) => ({ ...d, coffee: [...(d.coffee ?? []), ...Array.from({ length: Math.max(1, Math.min(4, Math.round(cups))) }, () => at)].slice(-12) }))
/** After-shift checklist (afterShift.ts SHIFT_STEPS): tick or untick one step for the night of `day`. */
export const toggleShiftStep = (c: SleepCare, day: string, step: string, on: boolean) =>
  withDay(c, day, (d) => {
    const cur = new Set(d.shift ?? [])
    if (on) cur.add(step)
    else cur.delete(step)
    return { ...d, shift: [...cur].slice(0, 8) }
  })
/** Your sleep need and caffeine curfew (Sleep page). */
export const setCarePrefs = (c: SleepCare, p: { needH?: number; curfewH?: number }) => cleanCare({ ...c, ...(p.needH != null ? { needH: p.needH } : {}), ...(p.curfewH != null ? { curfewH: p.curfewH } : {}) })
/** Takes the last coffee back (a mistaken tap). */
export const undoCoffee = (c: SleepCare, day: string) => withDay(c, day, (d) => ({ ...d, coffee: (d.coffee ?? []).slice(0, -1) }))

// ---- BD4: morning light -------------------------------------------------------

/** Today's weather as the island has it (core/widgets/weatherPill.ts), plus cloud cover when the plugin knows it. */
export interface CareWeather {
  rain: { from: string; to: string; prob: number }[]
  sunrise: string | null
  sunset?: string | null
  /** Morning cloud cover, % (08–12), when known. */
  cloud?: number | null
}

/** How long outside: 10 min, 15 on a cloudy morning, 20 when it's overcast or raining (less light gets through). */
export function lightMinutes(w: CareWeather | null | undefined): { min: number; why: string | null } {
  if (!w) return { min: 10, why: null }
  const wet = w.rain.some((r) => r.prob >= 50 && toMin(r.from) < 11 * 60 && (r.to === '24:00' ? 1440 : toMin(r.to)) > 6 * 60)
  if (wet) return { min: 20, why: 'rainy morning' }
  if (w.cloud != null && w.cloud >= 80) return { min: 20, why: 'overcast' }
  if (w.cloud != null && w.cloud >= 50) return { min: 15, why: 'cloudy' }
  return { min: 10, why: null }
}

export interface LightInput {
  now: number
  day: string
  /** This morning's logged wake-up ("HH:MM"), else null. */
  wakeTime: string | null
  /** Your wake target (My life). */
  wakeTarget: string
  done: boolean
  weather?: CareWeather | null
  dismissed: Record<string, number>
}

/**
 * From your wake-up (or sunrise, when it comes later) for 3 hours, once a
 * day, until you say you got it. A card, not a dot: it's the cheapest sleep
 * fix there is.
 */
export function lightCard(i: LightInput): IslandAlert | null {
  if (i.done) return null
  const wake = isHm(i.wakeTime) ? i.wakeTime : isHm(i.wakeTarget) ? i.wakeTarget : null
  if (!wake) return null
  const sunrise = i.weather?.sunrise && isHm(i.weather.sunrise) ? toMin(i.weather.sunrise) : null
  const from = Math.max(toMin(wake), sunrise ?? 0)
  const cur = clockOf(i.now)
  if (cur < from || cur >= from + 180 || cur >= 13 * 60) return null
  const id = `light:${i.day}`
  if ((i.dismissed[id] ?? 0) > i.now) return null
  const l = lightMinutes(i.weather)
  return {
    id,
    kind: 'morning',
    title: `Morning light · ${l.min} min outside`,
    text: `${l.why ? `It's a ${l.why}, so ${l.min} min today. ` : ''}Daylight in your eyes now sets tonight's sleep: you fall asleep faster and wake up sharper. No sunglasses, a window doesn't count.`,
    face: '☀️',
    actions: [
      { label: '✓ I got my light', action: { kind: 'care', op: { op: 'light' }, alertId: id }, primary: true },
      { label: 'In 30 min', action: { kind: 'dismiss', id, snoozeMin: 30 } },
      { label: 'Not today', action: { kind: 'dismiss', id, snoozeMin: 720 } }
    ]
  }
}

// ---- BD4: caffeine curfew -----------------------------------------------------

/** The last time for caffeine: `hours` before bedtime ("23:30", 9.5 → "14:00"). */
export function caffeineCurfew(bed: string, hours = DEFAULT_CARE.curfewH): string {
  return hmOf(toMin(isHm(bed) ? bed : '23:30') - Math.round(hours * 60))
}

/** "coffee", "2 coffees", "had an espresso", "☕", "cafea", "кофе" → cups; anything else → null. */
export function parseCoffee(text: string): number | null {
  const t = String(text ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
  if (!t || t.length > 40 || /\?|\b(no|not|without|skip|decaf|stop|undo)\b/.test(t)) return null
  if (/^(☕\s*)+$/u.test(t)) return Math.min(4, [...t].filter((c) => c === '☕').length)
  const drink = '(coffees?|espressos?|lattes?|cappuccinos?|americanos?|flat whites?|energy drinks?|red bulls?|cafea|cafele|кофе)'
  // "just drunk a cup of coffee", "I've had 2 espressos", "drinking a latte" (was missed: Ben guessed instead of logging).
  const m = new RegExp(`^(?:(?:i(?:'ve| have)?|i'm|i am)\\s+)?(?:just\\s+)?(?:(?:had|drank|drunk|got|grabbed|finished|having|drinking)\\s+)?(?:(a|an|one|1|two|2|three|3|o|un|una|două|doua)\\s+)?(?:cup of |cups of |mug of |ceașcă de |ceasca de )?${drink}(?: now| just now)?[.!]*$`).exec(t)
  if (!m) return null
  const n = m[1]
  return n === 'two' || n === '2' || n === 'două' || n === 'doua' ? 2 : n === 'three' || n === '3' ? 3 : 1
}

export interface CaffeineView {
  curfew: string
  cups: number
  /** Last coffee today ("HH:MM"), or null. */
  last: string | null
  /** Coffees logged after the curfew today. */
  late: number
  /** Minutes until the curfew (negative: past it). */
  left: number
  line: string
}

export function caffeineView(c: SleepCare, day: string, now: number, bed: string): CaffeineView {
  const curfew = caffeineCurfew(bed, c.curfewH)
  const cs = careDay(c, day).coffee ?? []
  const cm = toMin(curfew)
  // The curfew is an afternoon time: a cup after midnight (still the same app day) is late too.
  const isLate = (ms: number) => {
    const m = clockOf(ms)
    return m >= cm || m < 4 * 60
  }
  const late = cs.filter(isLate).length
  const cur = clockOf(now)
  const left = (cur < 4 * 60 ? cur + 1440 : cur) >= cm ? -((cur < 4 * 60 ? cur + 1440 : cur) - cm) : cm - cur
  const last = cs.length ? hmOf(clockOf(cs[cs.length - 1])) : null
  const line = left > 0 ? `Last caffeine by ${curfew}${cs.length ? ` · ${cs.length} today, last ${last}` : ''}` : `Caffeine curfew passed (${curfew})${late ? ` · ${late} after it today` : cs.length ? ` · ${cs.length} today, all before it` : ''}`
  return { curfew, cups: cs.length, last, late, left, line }
}

/** The reply to a coffee log (Telegram, Ben's chat, the Sleep page). */
export function coffeeReply(v: CaffeineView, bed: string): string {
  const nth = v.cups === 1 ? 'first' : v.cups === 2 ? '2nd' : v.cups === 3 ? '3rd' : `${v.cups}th`
  if (v.left <= 0) return `☕ Logged (${nth} today). That one is after your ${v.curfew} curfew: about half of it is still in you at ${bed}. Water from here on.`
  return `☕ Logged (${nth} today). Last caffeine by ${v.curfew} (bed ${bed}).`
}

/**
 * The soft island warning: a coffee logged after the curfew (within 20 min
 * of logging it), or once at the curfew on a day you had coffee.
 */
export function caffeineAlert(o: { now: number; day: string; care: SleepCare; bed: string; dismissed: Record<string, number> }): IslandAlert | null {
  const v = caffeineView(o.care, o.day, o.now, o.bed)
  if (!v.cups) return null
  const cs = careDay(o.care, o.day).coffee ?? []
  const lastAt = cs[cs.length - 1]
  if (v.late > 0 && o.now - lastAt < 20 * 60_000) {
    const id = `caffeine:late:${o.day}:${v.late}`
    if ((o.dismissed[id] ?? 0) > o.now) return null
    return {
      id,
      kind: 'suggest',
      title: 'That coffee is after your curfew',
      text: `Your curfew was ${v.curfew}. Half of it is still in you at ${o.bed}: water or herbal tea from here on.`,
      face: '☕',
      actions: [{ label: 'Got it', action: { kind: 'dismiss', id, snoozeMin: 1440 }, primary: true }]
    }
  }
  if (v.left <= 0 && v.left > -45) {
    const id = `caffeine:curfew:${o.day}`
    if ((o.dismissed[id] ?? 0) > o.now) return null
    return {
      id,
      kind: 'suggest',
      title: `Caffeine curfew · ${v.curfew}`,
      text: `No more coffee today: bed at ${o.bed}. ${v.cups} today, last at ${v.last}.`,
      face: '☕',
      actions: [{ label: 'Got it', action: { kind: 'dismiss', id, snoozeMin: 1440 }, primary: true }]
    }
  }
  return null
}

// ---- BD6: sleep debt ----------------------------------------------------------

export interface SleepDebt {
  needMin: number
  /** The last 7 nights, oldest first (the morning's day), minutes slept or null when not logged. */
  nights: { day: string; min: number | null }[]
  logged: number
  /** Minutes behind your need over the logged nights (sleeping more pays it back; never below 0). */
  debtMin: number
  level: 'ok' | 'behind' | 'high'
}

/** The rolling 7-night debt against `needH`, from the bed and wake times of each morning's row. */
export function sleepDebt(logs: Pick<SleepLog, 'day' | 'bedTime' | 'wakeTime'>[], today: string, needH = DEFAULT_CARE.needH): SleepDebt {
  const needMin = Math.round(needH * 60)
  const byDay = new Map(logs.map((l) => [l.day, l]))
  const nights = Array.from({ length: 7 }, (_, k) => {
    const day = addDays(today, k - 6)
    return { day, min: nightMinutes(byDay.get(day)) }
  })
  const got = nights.filter((n): n is { day: string; min: number } => n.min != null)
  const debtMin = Math.max(0, got.reduce((t, n) => t + (needMin - n.min), 0))
  return { needMin, nights, logged: got.length, debtMin, level: debtMin >= 180 ? 'high' : debtMin >= 60 ? 'behind' : 'ok' }
}

export const hm = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? ` ${String(min % 60).padStart(2, '0')}` : ''}` : `${min} min`)

export interface DebtAdvice {
  /** The nap line, or null when you're not behind. */
  nap: string | null
  napOk: boolean
  /** The earlier night: which evening and what time, or null. */
  early: { day: string; label: string; bed: string; minutes: number } | null
  line: string
}

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/**
 * What to do about it: one 20-minute nap before 15:00 (after that: no nap,
 * an earlier night instead), and bed earlier on the next free evening
 * (`free(day)`: no work window that day). Earlier by a third of the debt,
 * 15 to 60 minutes.
 */
export function debtAdvice(d: SleepDebt, o: { now: number; today: string; bed: string; free: (day: string) => boolean }): DebtAdvice {
  if (d.level === 'ok') return { nap: null, napOk: false, early: null, line: d.logged ? `On track: ${d.debtMin ? `${hm(d.debtMin)} behind` : 'no debt'} over the last ${d.logged} nights.` : 'Log a few nights (bed and wake-up) to see your sleep debt.' }
  const cur = clockOf(o.now)
  const napOk = cur >= 4 * 60 && cur < 14 * 60 + 40
  const nap = napOk ? 'One 20-minute nap before 15:00 (alarm on: 20 min max, longer makes you groggy).' : cur >= 15 * 60 || cur < 4 * 60 ? 'Too late for a nap today (it would push tonight back): go to bed earlier instead.' : 'Too close to 15:00 for a nap now: an earlier night instead.'
  const minutes = Math.max(15, Math.min(60, Math.round(d.debtMin / 3 / 15) * 15))
  const bedM = toMin(isHm(o.bed) ? o.bed : '23:30')
  // Tonight counts if bedtime is still ahead.
  const tonightOk = (cur < 4 * 60 ? cur + 1440 : cur) < (bedM < 12 * 60 ? bedM + 1440 : bedM) - minutes
  let early: DebtAdvice['early'] = null
  for (let k = tonightOk ? 0 : 1; k <= 6 && !early; k++) {
    const day = addDays(o.today, k)
    if (!o.free(day)) continue
    early = { day, label: k === 0 ? 'tonight' : k === 1 ? 'tomorrow' : WEEKDAY[new Date(`${day}T12:00:00Z`).getUTCDay()], bed: hmOf(bedM - minutes), minutes }
  }
  const line = `${hm(d.debtMin)} behind over the last ${d.logged} nights.${early ? ` Bed at ${early.bed} ${early.label === 'tonight' || early.label === 'tomorrow' ? early.label : `on ${early.label}`} (${minutes} min earlier).` : ''}`
  return { nap, napOk, early, line }
}

/** One line for Ben's prompt. */
export function debtLine(d: SleepDebt, a: DebtAdvice): string {
  if (!d.logged) return ''
  if (d.level === 'ok') return `SLEEP DEBT: fine (${hm(d.debtMin)} behind a ${hm(d.needMin)} need over the last ${d.logged} logged nights). Don't bring it up.`
  return `SLEEP DEBT: ${hm(d.debtMin)} behind a ${hm(d.needMin)} need over the last ${d.logged} logged nights.${a.napOk ? ' Suggest one 20-min nap before 15:00.' : ' No nap today (too late).'}${a.early ? ` Suggest bed at ${a.early.bed} ${a.early.label === 'tonight' || a.early.label === 'tomorrow' ? a.early.label : `on ${a.early.label}`} (his next free evening).` : ''} Say it once, not every message.`
}

/** What the Sleep page and the island read (src/renderer/src/web/careStore.ts careView). */
export interface CareView {
  today: string
  care: SleepCare
  bed: string
  caffeine: CaffeineView
  debt: SleepDebt
  advice: DebtAdvice
  /** Tonight's after-shift plan (afterShift.ts), or null on a normal evening. */
  shift: { start: string; lightsOut: string; done: string[] } | null
}
