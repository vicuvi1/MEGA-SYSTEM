// The habit board on Today (pure): when each habit is due (morning, day,
// evening, "by 10:00"), its last 7 days as dots, streaks (rest and skipped
// days keep a streak alive but never add to it), schedules (every day,
// weekdays, N times a week), the order (done ones move to the end unless you
// keep the order fixed) and the "perfect day". No points here: what a habit
// pays stays in the wallet rules (src/main), only for something you did.
import { addDays } from './dates'
import { dayStreak } from './streaks'

export type Slot = 'morning' | 'day' | 'evening'
/** "any": no time of day (shown with the day's habits). */
export type SlotPick = Slot | 'any'
export type Schedule = { kind: 'daily' } | { kind: 'weekdays' } | { kind: 'perWeek'; n: number }

export const SLOTS: Slot[] = ['morning', 'day', 'evening']
export const SLOT_LABEL: Record<Slot, string> = { morning: 'Morning', day: 'Day', evening: 'Evening' }
/** Where each part of the day starts (minutes after midnight). The app day turns at 04:00. */
const SLOT_START: Record<Slot, number> = { morning: 4 * 60, day: 12 * 60, evening: 18 * 60 }
const SLOT_END: Record<Slot, number> = { morning: 12 * 60, day: 18 * 60, evening: 28 * 60 }

/** The look of a habit: an icon name, a colour name, when in the day, an optional "by" time. */
export interface HabitLook {
  icon: string
  color: string
  slot: SlotPick
  by: string | null
}

export const HABIT_ICONS = ['sunrise', 'shield', 'dumbbell', 'target', 'sparkle', 'wallet', 'book', 'drop', 'run', 'leaf', 'bed', 'phone', 'pen', 'heart', 'brain', 'check'] as const
export const HABIT_COLORS = ['lime', 'amber', 'coral', 'pink', 'violet', 'sky', 'teal', 'slate'] as const

/** The built-in habits' looks (you can change icon, colour and time in the app). */
export const BUILTIN_LOOK: Record<string, HabitLook> = {
  oath: { icon: 'sunrise', color: 'amber', slot: 'morning', by: '10:00' },
  clean: { icon: 'shield', color: 'teal', slot: 'evening', by: null },
  workout: { icon: 'dumbbell', color: 'coral', slot: 'day', by: null },
  focus: { icon: 'target', color: 'lime', slot: 'day', by: null },
  skincare: { icon: 'sparkle', color: 'pink', slot: 'evening', by: null },
  spending: { icon: 'wallet', color: 'sky', slot: 'evening', by: '22:00' }
}
export const DEFAULT_LOOK: HabitLook = { icon: 'check', color: 'violet', slot: 'any', by: null }

const HM = /^([01]\d|2[0-3]):[0-5]\d$/
export const isHm = (v: unknown): v is string => typeof v === 'string' && HM.test(v)
export const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))

/** Minutes since midnight, counted on past midnight until 04:00 (the app day). */
export function dayMinute(hour: number, minute = 0): number {
  const m = hour * 60 + minute
  return m < SLOT_START.morning ? m + 24 * 60 : m
}

/** The part of the day a minute falls in. */
export function slotAt(min: number): Slot {
  const m = min < SLOT_START.morning ? min + 24 * 60 : min
  if (m < SLOT_END.morning) return 'morning'
  if (m < SLOT_END.day) return 'day'
  return 'evening'
}

/** Where a habit sits on the board: its slot, or the slot of its "by" time, or the day. */
export function slotOf(look: Pick<HabitLook, 'slot' | 'by'>): Slot {
  if (look.slot !== 'any') return look.slot
  return look.by && isHm(look.by) ? slotAt(toMin(look.by) - 1) : 'day'
}

export type DueState = 'done' | 'skipped' | 'off' | 'overdue' | 'now' | 'later' | 'anytime'

/**
 * How due a habit is now, with a short hint: "by 10:00", "this evening",
 * "evening", "was due 10:00". Overdue is soft: only a word, never a penalty.
 */
export function dueState(h: { done: boolean; skipped?: boolean; off?: boolean; slot: SlotPick; by: string | null }, nowMin: number): { state: DueState; hint: string } {
  if (h.done) return { state: 'done', hint: 'done' }
  if (h.skipped) return { state: 'skipped', hint: 'skipped today' }
  if (h.off) return { state: 'off', hint: 'not today' }
  const now = nowMin < SLOT_START.morning ? nowMin + 24 * 60 : nowMin
  if (h.by && isHm(h.by)) {
    const by = toMin(h.by) < SLOT_START.morning ? toMin(h.by) + 24 * 60 : toMin(h.by)
    if (now >= by) return { state: 'overdue', hint: `was due ${h.by}` }
    return { state: by - now <= 90 ? 'now' : 'later', hint: `by ${h.by}` }
  }
  if (h.slot === 'any') return { state: 'anytime', hint: 'any time today' }
  if (now >= SLOT_END[h.slot]) return { state: 'overdue', hint: h.slot === 'morning' ? 'was for this morning' : 'was for today' }
  if (now >= SLOT_START[h.slot]) return { state: 'now', hint: h.slot === 'morning' ? 'this morning' : h.slot === 'day' ? 'today' : 'this evening' }
  return { state: 'later', hint: h.slot === 'day' ? 'afternoon' : h.slot }
}

/** 0 = Monday … 6 = Sunday, for a YYYY-MM-DD day. */
export function weekdayOf(day: string): number {
  const d = new Date(`${day}T12:00:00Z`).getUTCDay()
  return (d + 6) % 7
}
/** The Monday of the day's week. */
export const mondayOf = (day: string) => addDays(day, -weekdayOf(day))

export function cleanSchedule(v: any): Schedule {
  if (v?.kind === 'weekdays') return { kind: 'weekdays' }
  if (v?.kind === 'perWeek') {
    const n = Math.round(Number(v.n))
    return n >= 1 && n <= 6 ? { kind: 'perWeek', n } : { kind: 'daily' }
  }
  return { kind: 'daily' }
}

export function scheduleText(s: Schedule): string {
  return s.kind === 'weekdays' ? 'weekdays' : s.kind === 'perWeek' ? `${s.n}× a week` : 'every day'
}

/** Days a schedule doesn't ask for (weekends for "weekdays"): they keep the streak, like rest days. */
function offDays(s: Schedule, from: string, to: string): string[] {
  if (s.kind !== 'weekdays') return []
  const out: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) if (weekdayOf(d) >= 5) out.push(d)
  return out
}

/** Is it asked for today? "N× a week" is done for the week once N days are in. */
export function dueToday(s: Schedule, doneDays: string[], today: string): boolean {
  if (s.kind === 'weekdays') return weekdayOf(today) < 5
  if (s.kind === 'perWeek') {
    const mon = mondayOf(today)
    const n = doneDays.filter((d) => d >= mon && d < today).length
    return n < s.n
  }
  return true
}

export type DotState = 'done' | 'missed' | 'rest' | 'skip' | 'off' | 'open'

/**
 * The last `n` days (oldest first, today last) as dots. Today not done yet is
 * "open", not missed. Rest days, skips and days the schedule doesn't ask for
 * are their own quiet dots.
 */
export function weekDots(doneDays: Iterable<string>, today: string, o: { rest?: Iterable<string>; skips?: Iterable<string>; schedule?: Schedule; n?: number } = {}): { day: string; state: DotState }[] {
  const done = new Set(doneDays)
  const rest = new Set(o.rest ?? [])
  const skips = new Set(o.skips ?? [])
  const s = o.schedule ?? { kind: 'daily' }
  const n = o.n ?? 7
  const out: { day: string; state: DotState }[] = []
  for (let k = n - 1; k >= 0; k--) {
    const day = addDays(today, -k)
    let state: DotState
    if (done.has(day)) state = 'done'
    else if (skips.has(day)) state = 'skip'
    else if (rest.has(day)) state = 'rest'
    else if (s.kind === 'weekdays' && weekdayOf(day) >= 5) state = 'off'
    else if (s.kind === 'perWeek') state = day === today ? 'open' : 'off'
    else state = day === today ? 'open' : 'missed'
    out.push({ day, state })
  }
  return out
}

/**
 * The streak: days in a row (rest, skipped and days off keep it alive but
 * don't add to it). For "N× a week" it is weeks in a row with N days done
 * (this week counts once it's reached, and doesn't break it while it's on).
 */
export function habitStreak(doneDays: string[], today: string, o: { rest?: string[]; skips?: string[]; schedule?: Schedule } = {}): { n: number; unit: 'day' | 'week' } {
  const s = o.schedule ?? { kind: 'daily' }
  if (s.kind === 'perWeek') {
    const per = (mon: string) => doneDays.filter((d) => d >= mon && d <= addDays(mon, 6)).length
    let mon = mondayOf(today)
    let n = per(mon) >= s.n ? 1 : 0
    mon = addDays(mon, -7)
    while (per(mon) >= s.n) {
      n++
      mon = addDays(mon, -7)
    }
    return { n, unit: 'week' }
  }
  const from = addDays(today, -400)
  const keep = [...(o.rest ?? []), ...(o.skips ?? []), ...offDays(s, from, today)]
  return { n: dayStreak(doneDays, today, keep), unit: 'day' }
}

export function streakText(s: { n: number; unit: 'day' | 'week' }): string {
  if (!s.n) return ''
  return s.unit === 'week' ? `${s.n} wk` : `${s.n}`
}

/** One tile, as much as the order and the groups need. */
export interface TileLike {
  id: string
  done: boolean
  skipped?: boolean
  off?: boolean
  slot: Slot
}

/**
 * The board's order: your order first (ids you dragged), then the rest as
 * they come; done, skipped and "not today" ones move to the end unless the
 * order is fixed.
 */
export function orderTiles<T extends TileLike>(tiles: T[], order: string[] = [], fixed = false): T[] {
  const pos = (id: string) => {
    const i = order.indexOf(id)
    return i < 0 ? order.length : i
  }
  const settled = (t: T) => (fixed ? 0 : t.done ? 1 : t.skipped || t.off ? 2 : 0)
  return tiles
    .map((t, i) => ({ t, i }))
    .sort((a, b) => settled(a.t) - settled(b.t) || pos(a.t.id) - pos(b.t.id) || a.i - b.i)
    .map((x) => x.t)
}

export interface TileGroup<T> {
  slot: Slot
  label: string
  tiles: T[]
  /** Counted habits (skipped and "not today" don't count). */
  done: number
  total: number
  /** The part of the day it is now. */
  current: boolean
  /** Folded by default: every counted habit is done (or nothing is left to do). */
  settled: boolean
}

/** Morning, Day and Evening, each in board order; empty ones are left out. */
export function groupTiles<T extends TileLike>(tiles: T[], nowMin: number, order: string[] = [], fixed = false): TileGroup<T>[] {
  const now = slotAt(nowMin)
  return SLOTS.map((slot) => {
    const list = orderTiles(
      tiles.filter((t) => t.slot === slot),
      order,
      fixed
    )
    const counted = list.filter((t) => !t.skipped && !t.off)
    const done = counted.filter((t) => t.done).length
    return { slot, label: SLOT_LABEL[slot], tiles: list, done, total: counted.length, current: slot === now, settled: done === counted.length }
  }).filter((g) => g.tiles.length > 0)
}

/**
 * The simple tracker's one list (no Morning · Day · Evening boxes): your
 * order first (ids you dragged), else morning, day, evening as they come;
 * done, skipped and "not today" ones at the end unless the order is fixed.
 */
export function listTiles<T extends TileLike>(tiles: T[], order: string[] = [], fixed = false): T[] {
  const pos = (id: string) => {
    const i = order.indexOf(id)
    return i < 0 ? order.length : i
  }
  const settled = (t: T) => (fixed ? 0 : t.done ? 1 : t.skipped || t.off ? 2 : 0)
  return tiles
    .map((t, i) => ({ t, i }))
    .sort((a, b) => settled(a.t) - settled(b.t) || pos(a.t.id) - pos(b.t.id) || SLOTS.indexOf(a.t.slot) - SLOTS.indexOf(b.t.slot) || a.i - b.i)
    .map((x) => x.t)
}

/** Today's count: done of the habits asked for today (skipped and "not today" left out). */
export function boardCount(tiles: TileLike[]): { done: number; total: number; perfect: boolean } {
  const counted = tiles.filter((t) => !t.skipped && !t.off)
  const done = counted.filter((t) => t.done).length
  // Perfect: every habit asked for today done, and nothing skipped.
  const perfect = counted.length > 0 && done === counted.length && !tiles.some((t) => t.skipped)
  return { done, total: counted.length, perfect }
}

/**
 * Good days in a row: days with at least two thirds of the habits done (of
 * those asked for that day). Today counts once it gets there; until then the
 * run is still alive from yesterday.
 */
export function goodDayRun(habits: { days: string[]; asked: (day: string) => boolean }[], today: string, max = 120): number {
  const good = (day: string) => {
    const asked = habits.filter((h) => h.asked(day))
    if (!asked.length) return null
    const done = asked.filter((h) => h.days.includes(day)).length
    return done * 3 >= asked.length * 2
  }
  let n = 0
  let d = good(today) ? today : addDays(today, -1)
  for (let i = 0; i < max; i++, d = addDays(d, -1)) {
    const g = good(d)
    if (g === null) continue
    if (!g) break
    n++
  }
  return n
}

/** Move `id` to sit before `before` (or to the end) in the full id list. */
export function moveBefore(ids: string[], id: string, before: string | null): string[] {
  const rest = ids.filter((x) => x !== id)
  const at = before ? rest.indexOf(before) : -1
  if (at < 0) return [...rest, id]
  return [...rest.slice(0, at), id, ...rest.slice(at)]
}

/** One step earlier (-1) or later (+1) in the list. */
export function nudge(ids: string[], id: string, dir: -1 | 1): string[] {
  const i = ids.indexOf(id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= ids.length) return ids
  const out = [...ids]
  ;[out[i], out[j]] = [out[j], out[i]]
  return out
}

// ------------------------------------------------- the board's own settings

/** What you changed on the board (synced): looks, order, hidden ones, skips. */
export interface BoardPrefs {
  looks: Record<string, Partial<HabitLook>>
  order: string[]
  hidden: string[]
  /** Day → ids skipped that day (no points; the streak waits). */
  skips: Record<string, string[]>
  /** Keep the order as it is (done ones don't move to the end). */
  fixed: boolean
}
export const BOARD_PREFS = 'habit_board'
export const EMPTY_PREFS: BoardPrefs = { looks: {}, order: [], hidden: [], skips: {}, fixed: false }

const DAY = /^\d{4}-\d{2}-\d{2}$/
const ID = /^[\w:.-]{1,60}$/

export function cleanLook(v: any): Partial<HabitLook> {
  const out: Partial<HabitLook> = {}
  if ((HABIT_ICONS as readonly string[]).includes(v?.icon)) out.icon = v.icon
  if ((HABIT_COLORS as readonly string[]).includes(v?.color)) out.color = v.color
  if (v?.slot === 'any' || (SLOTS as string[]).includes(v?.slot)) out.slot = v.slot
  if (v?.by === null || isHm(v?.by)) out.by = v.by
  return out
}

export function cleanPrefs(v: any): BoardPrefs {
  const ids = (a: any) => (Array.isArray(a) ? [...new Set(a.map(String).filter((x: string) => ID.test(x)))].slice(0, 60) : [])
  const looks: Record<string, Partial<HabitLook>> = {}
  if (v?.looks && typeof v.looks === 'object') for (const [k, l] of Object.entries(v.looks).slice(0, 60)) if (ID.test(k)) looks[k] = cleanLook(l)
  const skips: Record<string, string[]> = {}
  if (v?.skips && typeof v.skips === 'object')
    for (const d of Object.keys(v.skips).filter((d) => DAY.test(d)).sort().slice(-90)) {
      const list = ids(v.skips[d])
      if (list.length) skips[d] = list
    }
  return { looks, order: ids(v?.order), hidden: ids(v?.hidden), skips, fixed: v?.fixed === true }
}

/** The look of a habit: what you set, over the built-in one, over the default. */
export function lookOf(id: string, prefs: BoardPrefs, own?: Partial<HabitLook>): HabitLook {
  return { ...DEFAULT_LOOK, ...(BUILTIN_LOOK[id] ?? {}), ...(own ?? {}), ...(prefs.looks[id] ?? {}) }
}

export function skipsOf(prefs: BoardPrefs, id: string): string[] {
  return Object.keys(prefs.skips).filter((d) => prefs.skips[d].includes(id))
}

export function setSkip(prefs: BoardPrefs, id: string, day: string, on: boolean): BoardPrefs {
  const cur = prefs.skips[day] ?? []
  const next = on ? [...new Set([...cur, id])] : cur.filter((x) => x !== id)
  const skips = { ...prefs.skips, [day]: next }
  if (!next.length) delete skips[day]
  return { ...prefs, skips }
}
