// What the Discipline page shows, worked out from the honest event log (pure):
// day badges, the rank ladder, the 6-month calendar, urges per week, your
// streak runs (best record and resets), friendly dates and the breathing guide.
// Nothing here pays points: it only reads what really happened.
import { addDays, daysBetween } from './dates'
import { DISCIPLINE_RANKS, type DisciplineKind } from './discipline'

/** The day badges, in order. */
export const BADGES: { days: number; name: string }[] = [
  { days: 1, name: 'First day' },
  { days: 3, name: 'Three days' },
  { days: 7, name: 'One week' },
  { days: 14, name: 'Two weeks' },
  { days: 30, name: 'One month' },
  { days: 60, name: 'Two months' },
  { days: 90, name: 'Ninety days' },
  { days: 180, name: 'Half a year' },
  { days: 365, name: 'One year' }
]

export type BadgeState = 'now' | 'earned' | 'next' | 'locked'

/**
 * A badge is earned once any streak (your best) reached it; 'now' when the
 * current streak holds it. 'next' is the one the current streak works toward.
 */
export function badgesOf(current: number, best: number): { days: number; name: string; state: BadgeState; left: number }[] {
  const top = Math.max(current, best)
  const nextDays = BADGES.find((b) => current < b.days)?.days ?? null
  return BADGES.map((b) => ({
    ...b,
    state: current >= b.days ? 'now' : b.days === nextDays ? 'next' : top >= b.days ? 'earned' : 'locked',
    left: Math.max(0, b.days - current)
  }))
}

/** The next badge for the current streak and how far along it is (0–1). */
export function nextBadge(current: number): { days: number; name: string; from: number; pct: number } | null {
  const i = BADGES.findIndex((b) => current < b.days)
  if (i < 0) return null
  const from = i === 0 ? 0 : BADGES[i - 1].days
  return { ...BADGES[i], from, pct: Math.max(0, Math.min(1, (current - from) / (BADGES[i].days - from))) }
}

export type RankStep = { days: number; name: string; tier: number; state: 'done' | 'current' | 'locked' }

/** Every rank, with the one you hold marked 'current'. */
export function rankLadder(current: number): RankStep[] {
  let at = 0
  DISCIPLINE_RANKS.forEach((r, i) => current >= r.days && (at = i))
  return DISCIPLINE_RANKS.map((r, i) => ({ ...r, tier: i + 1, state: i < at ? 'done' : i === at ? 'current' : 'locked' }))
}

/** Progress from the rank you hold to the next one (0–1), and the days left. */
export function rankProgress(current: number): { name: string; tier: number; next: { name: string; days: number } | null; pct: number; left: number } {
  const ladder = rankLadder(current)
  const i = ladder.findIndex((r) => r.state === 'current')
  const here = ladder[i]
  const next = ladder[i + 1] ?? null
  if (!next) return { name: here.name, tier: here.tier, next: null, pct: 1, left: 0 }
  return {
    name: here.name,
    tier: here.tier,
    next: { name: next.name, days: next.days },
    pct: Math.max(0, Math.min(1, (current - here.days) / (next.days - here.days))),
    left: next.days - current
  }
}

export interface Mark {
  day: string
  kind: DisciplineKind
  hour: number
}

export type HeatState = 'clean' | 'reset' | 'open' | 'before' | 'future'
export interface HeatCell {
  day: string
  state: HeatState
  urges: number
}

/**
 * A GitHub-style calendar: `weeks` columns of Monday→Sunday ending with the
 * week of `today`. clean = a check-in, reset = an honest reset, open = a day
 * of the streak with no check-in, before = before you started, future = not
 * lived yet. Month labels sit on the first column of each month.
 */
export function heatmap(marks: Mark[], today: string, start: string | null, weeks = 26): { columns: HeatCell[][]; months: { col: number; label: string }[] } {
  const kinds = new Map<string, Set<DisciplineKind>>()
  const urges = new Map<string, number>()
  for (const m of marks) {
    kinds.set(m.day, (kinds.get(m.day) ?? new Set()).add(m.kind))
    if (m.kind === 'urge') urges.set(m.day, (urges.get(m.day) ?? 0) + 1)
  }
  const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7 // Monday = 0
  const first = addDays(today, -dow - (weeks - 1) * 7)
  const columns: HeatCell[][] = []
  const months: { col: number; label: string }[] = []
  let lastMonth = ''
  for (let w = 0; w < weeks; w++) {
    const col: HeatCell[] = []
    for (let d = 0; d < 7; d++) {
      const day = addDays(first, w * 7 + d)
      const k = kinds.get(day)
      const state: HeatState = day > today ? 'future' : !start || day < start ? 'before' : k?.has('reset') ? 'reset' : k?.has('checkin') ? 'clean' : 'open'
      col.push({ day, state, urges: urges.get(day) ?? 0 })
    }
    const month = col[0].day.slice(0, 7)
    if (month !== lastMonth) {
      // Skip a label squeezed in by a partial first column.
      if (!(w === 0 && col[0].day.slice(8) > '24')) months.push({ col: w, label: monthName(col[0].day) })
      lastMonth = month
    }
    columns.push(col)
  }
  return { columns, months }
}

/** Urges beaten per Monday-week, oldest first, ending with this week. */
export function urgesPerWeek(marks: Mark[], today: string, weeks = 8): { from: string; count: number; label: string }[] {
  const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7
  const thisWeek = addDays(today, -dow)
  return Array.from({ length: weeks }, (_, i) => {
    const from = addDays(thisWeek, (i - weeks + 1) * 7)
    const to = addDays(from, 6)
    const count = marks.filter((m) => m.kind === 'urge' && m.day >= from && m.day <= to).length
    return { from, count, label: i === weeks - 1 ? 'This week' : shortDate(from) }
  })
}

export interface StreakRun {
  from: string
  to: string
  days: number
  /** 'reset' = it ended with an honest reset on `to`; 'now' = still going. */
  ended: 'reset' | 'now'
}

/** Every streak from your start date, split at the resets (oldest first). */
export function streakRuns(start: string | null, resets: string[], today: string): StreakRun[] {
  if (!start) return []
  const cuts = [...new Set(resets.filter((d) => d >= start && d <= today))].sort()
  const points = [start, ...cuts]
  return points.map((from, i) => {
    const to = cuts[i] ?? today
    return { from, to, days: Math.max(0, daysBetween(from, to)), ended: i < cuts.length ? 'reset' : 'now' }
  })
}

/** The longest run (the latest one wins a tie, so a streak you're on shows as the record). */
export function bestRun(runs: StreakRun[]): StreakRun | null {
  let best: StreakRun | null = null
  for (const r of runs) if (!best || r.days >= best.days) best = r
  return best
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function monthName(day: string): string {
  return MONTHS[Number(day.slice(5, 7)) - 1].slice(0, 3)
}

/** "2 Nov" (with the year when it isn't this year: "2 Nov 2025"). */
export function shortDate(day: string, today?: string): string {
  const s = `${Number(day.slice(8, 10))} ${monthName(day)}`
  return today && today.slice(0, 4) !== day.slice(0, 4) ? `${s} ${day.slice(0, 4)}` : s
}

/** A friendly date: "today", "yesterday", "Monday, 2 November" (and the year if it isn't this year). */
export function friendlyDate(day: string, today: string): string {
  const n = daysBetween(day, today)
  if (n === 0) return 'today'
  if (n === 1) return 'yesterday'
  const d = new Date(`${day}T12:00:00Z`)
  const s = `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
  return day.slice(0, 4) === today.slice(0, 4) ? s : `${s} ${day.slice(0, 4)}`
}

/** Breathing patterns for the urge crusher. */
export const BREATHING = {
  box: { name: 'Box 4-4-4-4', steps: [['Breathe in', 4], ['Hold', 4], ['Breathe out', 4], ['Hold', 4]] },
  '478': { name: '4-7-8', steps: [['Breathe in', 4], ['Hold', 7], ['Breathe out', 8]] }
} as const satisfies Record<string, { name: string; steps: readonly (readonly [string, number])[] }>
export type BreathingKind = keyof typeof BREATHING

/**
 * Where the breath is after `ms` of breathing: the step's words, the seconds
 * left in it, and how big the circle should be (0 = empty, 1 = full lungs).
 */
export function breathAt(kind: BreathingKind, ms: number): { label: string; secondsLeft: number; step: number; fill: number; stepSeconds: number } {
  const steps = BREATHING[kind].steps
  const cycle = steps.reduce((s, [, n]) => s + n, 0)
  let t = (((Math.max(0, ms) / 1000) % cycle) + cycle) % cycle
  let i = 0
  while (t >= steps[i][1]) t -= steps[i++][1]
  const [label, n] = steps[i]
  const p = t / n
  // Full after breathing in; stays during a hold after it; empties breathing out.
  const prev = i === 0 ? null : steps[i - 1][0]
  const fill = label === 'Breathe in' ? p : label === 'Breathe out' ? 1 - p : prev === 'Breathe in' ? 1 : 0
  return { label, secondsLeft: Math.ceil(n - t), step: i, fill, stepSeconds: n }
}

/** The urge crusher's countdown: the urge wave is about ten minutes. */
export const URGE_WAVE_SECONDS = 600
