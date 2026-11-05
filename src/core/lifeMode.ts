// Life modes (pure, FT4): Exam week, Sick, Travel. One switch that, for a few
// days, changes your targets and Ben's nudges. Streaks are kept (sick and
// travel days count as rest days for the workout streak), and points stay
// honest: a mode never pays anything, you're still paid only for what you do.
import { addDays, daysBetween } from './dates'

export const LIFE_MODE = 'life_mode'

export type ModeKind = 'exam' | 'sick' | 'travel'

export interface ModeRules {
  label: string
  emoji: string
  /** What changes, in plain words. */
  blurb: string
  /** Focus target multiplier (1 = your usual). */
  focus: number
  /** Water nudges a day at most (5 normally). */
  waterMax: number
  /** The evening training nudge. */
  training: boolean
  /** "Nothing done for a while" nudges. */
  idle: boolean
  /** The noon re-plan when there's no plan yet. */
  replan: boolean
  /** Ben plans a lighter day. */
  light: boolean
  /** Days count as rest days for the workout streak. */
  rest: boolean
  defaultDays: number
}

export const MODES: Record<ModeKind, ModeRules> = {
  exam: { label: 'Exam week', emoji: '📚', blurb: 'More focus, fewer water and training nudges', focus: 1.5, waterMax: 2, training: false, idle: true, replan: true, light: false, rest: false, defaultDays: 7 },
  sick: { label: 'Sick', emoji: '🤒', blurb: 'Everything down: rest first, no training nudges, streaks kept', focus: 0.3, waterMax: 3, training: false, idle: false, replan: false, light: true, rest: true, defaultDays: 3 },
  travel: { label: 'Travel', emoji: '✈️', blurb: 'A lighter plan and fewer nudges, streaks kept', focus: 0.5, waterMax: 3, training: false, idle: false, replan: false, light: true, rest: true, defaultDays: 4 }
}
export const MODE_KINDS = Object.keys(MODES) as ModeKind[]

export interface LifeMode {
  kind: ModeKind
  /** First day (YYYY-MM-DD). */
  from: string
  /** Last day, included. */
  until: string
  at: string
}
export interface ModeBook {
  current: LifeMode | null
  past: LifeMode[]
}
export const EMPTY_MODES: ModeBook = { current: null, past: [] }

const DAY = /^\d{4}-\d{2}-\d{2}$/
const okMode = (m: any): m is LifeMode => !!m && MODE_KINDS.includes(m.kind) && DAY.test(m.from) && DAY.test(m.until) && m.until >= m.from

/** A saved book, with a mode whose last day has passed moved to the past. */
export function cleanModes(v: any, today: string): ModeBook {
  const past: LifeMode[] = (Array.isArray(v?.past) ? v.past : []).filter(okMode).map((m: LifeMode) => ({ kind: m.kind, from: m.from, until: m.until, at: String(m.at ?? '') }))
  let current: LifeMode | null = okMode(v?.current) ? { kind: v.current.kind, from: v.current.from, until: v.current.until, at: String(v.current.at ?? '') } : null
  if (current && current.until < today) {
    past.push(current)
    current = null
  }
  return { current, past: past.slice(-30) }
}

/** Turns a mode on from today for `days` days (an earlier mode ends yesterday). */
export function startMode(book: ModeBook, kind: ModeKind, days: number, today: string, now = new Date()): ModeBook {
  if (!MODES[kind]) throw new Error('Unknown mode')
  const n = Math.max(1, Math.min(21, Math.round(days) || MODES[kind].defaultDays))
  const ended = endMode(book, today)
  return { current: { kind, from: today, until: addDays(today, n - 1), at: now.toISOString() }, past: ended.past }
}

/** "End now": today is a normal day again. A mode that started today leaves no trace. */
export function endMode(book: ModeBook, today: string): ModeBook {
  const c = book.current
  if (!c) return book
  const past = c.from < today ? [...book.past, { ...c, until: addDays(today, -1) < c.until ? addDays(today, -1) : c.until }] : book.past
  return { current: null, past: past.slice(-30) }
}

export function activeMode(book: ModeBook, today: string): LifeMode | null {
  const c = book.current
  return c && c.from <= today && today <= c.until ? c : null
}

/** The rules for today: a mode's, or null on a normal day. */
export function modeRules(book: ModeBook, today: string): (ModeRules & { kind: ModeKind; until: string; dayN: number; days: number }) | null {
  const m = activeMode(book, today)
  if (!m) return null
  return { ...MODES[m.kind], kind: m.kind, until: m.until, dayN: daysBetween(m.from, today) + 1, days: daysBetween(m.from, m.until) + 1 }
}

/** Days (up to today) that keep the workout streak: sick and travel days. */
export function modeRestDays(book: ModeBook, today: string): string[] {
  const out = new Set<string>()
  for (const m of [...book.past, ...(book.current ? [book.current] : [])]) {
    if (!MODES[m.kind]?.rest) continue
    const last = m.until < today ? m.until : today
    for (let d = m.from, k = 0; d <= last && k < 60; d = addDays(d, 1), k++) out.add(d)
  }
  return [...out].sort().slice(-120)
}

/** A target in a mode: 50 min of focus in exam week is 75 (rounded to 5). */
export function modeTarget(base: number, rules: Pick<ModeRules, 'focus'> | null): number {
  if (!rules) return base
  return Math.max(5, Math.round((base * rules.focus) / 5) * 5)
}

const shortDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
export const untilText = (until: string) => shortDay(until)

/** Ben's line (or ''): what the mode means for how he coaches today. */
export function modeLine(book: ModeBook, today: string): string {
  const r = modeRules(book, today)
  if (!r) return ''
  const how = r.kind === 'exam' ? 'push focus (target ×1.5), keep training and water nudges quiet, protect sleep' : r.kind === 'sick' ? 'everything down: rest, water, sleep; no training, no pressure; a tiny plan at most' : 'a light plan (one or two small things), no training nudges, no guilt'
  return `LIFE MODE: ${r.label} ${r.emoji}, day ${r.dayN} of ${r.days} (until ${shortDay(r.until)}). Coach accordingly: ${how}. Streaks are kept; points are still only for what he does.`
}
