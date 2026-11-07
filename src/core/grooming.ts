// BD15 Daily grooming and skin routine (pure, tested in grooming.test.ts).
// One habit tile on Today ("Grooming", the old Skincare tile) with a short
// morning and night checklist, plus weekly items: nails every week and a
// haircut every 3–5 weeks (you pick). Kept in the synced setting `grooming`.
//
// Points stay honest: the habit pays its one rule (face.routine_done) once a
// day, and only when every step of the day's checklist is ticked by you.
// Unticking a step after that takes the points back.
import { addDays } from './dates'

export const GROOMING_KEY = 'grooming'
export const GROOM_RULE = 'face.routine_done'
export const groomRef = (day: string) => `groom:${day}`

export interface GroomStep {
  id: string
  label: string
  part: 'morning' | 'night'
  /** Only on sunny days (SPF). */
  sunny?: boolean
}

export const GROOM_STEPS: GroomStep[] = [
  { id: 'wash_am', label: 'Wash face', part: 'morning' },
  { id: 'moist_am', label: 'Moisturiser', part: 'morning' },
  { id: 'spf', label: 'SPF', part: 'morning', sunny: true },
  { id: 'teeth_am', label: 'Teeth', part: 'morning' },
  { id: 'hair', label: 'Hair / beard', part: 'morning' },
  { id: 'wash_pm', label: 'Wash face', part: 'night' },
  { id: 'moist_pm', label: 'Moisturiser', part: 'night' },
  { id: 'teeth_pm', label: 'Teeth', part: 'night' }
]
const IDS = new Set(GROOM_STEPS.map((s) => s.id))

export interface Grooming {
  /** Day → the steps you ticked. */
  days: Record<string, string[]>
  /** The last day you did your nails / got a haircut. */
  nails: string | null
  haircut: string | null
  /** A haircut every this many weeks (3–5). */
  haircutWeeks: number
  /** Day → the ledger id the day's routine paid (to take it back on an untick). */
  paid: Record<string, number>
}

export const EMPTY_GROOMING: Grooming = { days: {}, nails: null, haircut: null, haircutWeeks: 4, paid: {} }

const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

/** Saved value → valid; keeps 60 days of ticks (the streak and the dots). */
export function cleanGrooming(raw: unknown): Grooming {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<Grooming>
  const days: Record<string, string[]> = {}
  const src = o.days && typeof o.days === 'object' ? (o.days as Record<string, unknown>) : {}
  for (const k of Object.keys(src).filter(isDay).sort().slice(-60)) {
    const v = src[k]
    const list = Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && IDS.has(x)))] : []
    if (list.length) days[k] = list
  }
  const paid: Record<string, number> = {}
  const ps = o.paid && typeof o.paid === 'object' ? (o.paid as Record<string, unknown>) : {}
  for (const k of Object.keys(ps).filter(isDay).sort().slice(-14)) if (typeof ps[k] === 'number' && Number.isFinite(ps[k])) paid[k] = ps[k] as number
  const weeks = typeof o.haircutWeeks === 'number' && Number.isFinite(o.haircutWeeks) ? Math.max(3, Math.min(5, Math.round(o.haircutWeeks))) : 4
  return { days, nails: isDay(o.nails) ? o.nails : null, haircut: isDay(o.haircut) ? o.haircut : null, haircutWeeks: weeks, paid }
}

/** The day's steps: SPF only when it's sunny (unknown weather: shown, but not needed). */
export function stepsFor(sunny: boolean | null): (GroomStep & { optional: boolean })[] {
  return GROOM_STEPS.filter((s) => !s.sunny || sunny !== false).map((s) => ({ ...s, optional: !!s.sunny && sunny !== true }))
}

export interface GroomDay {
  morning: (GroomStep & { optional: boolean; done: boolean })[]
  night: (GroomStep & { optional: boolean; done: boolean })[]
  done: number
  total: number
  /** Every needed step of the day is ticked. */
  complete: boolean
  hint: string
}

export function groomDay(g: Grooming, day: string, sunny: boolean | null): GroomDay {
  const ticked = new Set(g.days[day] ?? [])
  const all = stepsFor(sunny).map((s) => ({ ...s, done: ticked.has(s.id) }))
  const need = all.filter((s) => !s.optional)
  const done = need.filter((s) => s.done).length
  const complete = need.length > 0 && done === need.length
  return { morning: all.filter((s) => s.part === 'morning'), night: all.filter((s) => s.part === 'night'), done, total: need.length, complete, hint: complete ? 'all done' : `${done} of ${need.length}` }
}

export function toggleStep(g: Grooming, day: string, id: string, on: boolean): Grooming {
  if (!IDS.has(id)) return g
  const cur = new Set(g.days[day] ?? [])
  if (on) cur.add(id)
  else cur.delete(id)
  const days = { ...g.days }
  if (cur.size) days[day] = [...cur]
  else delete days[day]
  return { ...g, days }
}

/** After a tick: pay the day (all done, not paid yet), take it back (paid, no longer all done), or nothing. */
export function groomPay(d: Pick<GroomDay, 'complete'>, paidId: number | null | undefined): 'pay' | 'undo' | null {
  if (d.complete && !paidId) return 'pay'
  if (!d.complete && paidId) return 'undo'
  return null
}

export function setPaid(g: Grooming, day: string, id: number | null): Grooming {
  const paid = { ...g.paid }
  if (id) paid[day] = id
  else delete paid[day]
  return { ...g, paid }
}

/** Days the whole routine was done (for the tile's dots and streak). */
export function groomDays(g: Grooming): string[] {
  return Object.keys(g.paid).sort()
}

// ---- weekly items ----

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5)

export interface WeeklyItem {
  id: 'nails' | 'haircut'
  label: string
  /** 'due' (do it now), 'soon' (this week), 'ok'. */
  state: 'due' | 'soon' | 'ok'
  text: string
}

export function weeklyItems(g: Grooming, today: string): WeeklyItem[] {
  const n = g.nails ? daysBetween(g.nails, today) : null
  const nails: WeeklyItem = {
    id: 'nails',
    label: 'Nails',
    state: n == null || n >= 7 ? 'due' : n >= 5 ? 'soon' : 'ok',
    text: n == null ? 'once a week' : n === 0 ? 'done today' : `${n} ${n === 1 ? 'day' : 'days'} ago`
  }
  const h = g.haircut ? daysBetween(g.haircut, today) : null
  const every = g.haircutWeeks * 7
  const haircut: WeeklyItem = {
    id: 'haircut',
    label: 'Haircut',
    state: h == null ? 'soon' : h >= every ? 'due' : h >= 21 && h >= every - 7 ? 'soon' : 'ok',
    text: h == null ? `every ${g.haircutWeeks} weeks · when was the last?` : h === 0 ? 'done today' : h >= every ? `${Math.floor(h / 7)} weeks: book one` : `${Math.floor(h / 7)} of ${g.haircutWeeks} weeks · next by ${addDays(g.haircut!, every).slice(5)}`
  }
  return [nails, haircut]
}

export function markWeekly(g: Grooming, id: 'nails' | 'haircut', day: string | null): Grooming {
  return id === 'nails' ? { ...g, nails: day } : { ...g, haircut: day }
}

/** SPF day: no rain in the day's main hours and not overcast (null: no weather, you decide). */
export function sunnyDay(w: { rain: { from: string; to: string; prob: number }[]; cloud?: number | null } | null | undefined): boolean | null {
  if (!w) return null
  const toM = (t: string) => (t === '24:00' ? 1440 : Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)))
  const wet = w.rain.some((r) => r.prob >= 50 && toM(r.from) < 17 * 60 && toM(r.to) > 9 * 60)
  if (wet) return false
  if (w.cloud != null) return w.cloud < 70
  return true
}

/** Telegram / Ben: one line about today's routine. */
export function groomLine(g: Grooming, day: string, sunny: boolean | null): string {
  const d = groomDay(g, day, sunny)
  const due = weeklyItems(g, day).filter((x) => x.state === 'due').map((x) => x.label.toLowerCase())
  return `Grooming today: ${d.hint}${due.length ? `; due: ${due.join(', ')}` : ''}.`
}

/** What the grooming sheet reads (src/renderer/src/web/careStore.ts groomView). */
export interface GroomView {
  today: string
  grooming: Grooming
  day: GroomDay
  weekly: WeeklyItem[]
  /** What today's routine paid (0: nothing yet). */
  paid: number
}
