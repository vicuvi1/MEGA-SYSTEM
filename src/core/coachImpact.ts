// Is the coach working? A small daily log (settings.coach_history) of what the
// coach did and what you did with it, turned into a weekly scorecard: promises
// kept, plans approved, day scores, focus hours. Pure and tested.
import { addDays } from './dates'

export interface CoachDay {
  plan?: 'proposed' | 'approved'
  score?: number
  mustdos?: [number, number]
  kept?: number
  broken?: number
  ignored?: number
}

export interface CoachHistory {
  days: Record<string, CoachDay>
}

export const COACH_HISTORY = 'coach_history'
const KEEP_DAYS = 180

export function cleanHistory(h: any): CoachHistory {
  return { days: h && typeof h.days === 'object' && h.days ? h.days : {} }
}

/** Sets fields on a day (and drops days older than half a year). */
export function recordDay(h: CoachHistory, day: string, patch: Partial<CoachDay>): CoachHistory {
  const days = { ...cleanHistory(h).days }
  const cur = days[day] ?? {}
  // An approved plan stays approved when a new version is proposed later.
  const plan = cur.plan === 'approved' && patch.plan === 'proposed' ? 'approved' : patch.plan ?? cur.plan
  days[day] = { ...cur, ...patch, ...(plan ? { plan } : {}) }
  const cutoff = addDays(day, -KEEP_DAYS)
  for (const d of Object.keys(days)) if (d < cutoff) delete days[d]
  return { days }
}

export function bump(h: CoachHistory, day: string, key: 'kept' | 'broken' | 'ignored', by = 1): CoachHistory {
  const cur = cleanHistory(h).days[day] ?? {}
  return recordDay(h, day, { [key]: (cur[key] ?? 0) + by })
}

export interface WeekRow {
  /** Monday. */
  week: string
  kept: number
  broken: number
  ignored: number
  /** Kept out of all judged promises (null when none). */
  keptPct: number | null
  plansProposed: number
  plansApproved: number
  /** Average evening score (null when no reviews). */
  avgScore: number | null
  mustdosDone: number
  mustdosTotal: number
  focusMin: number
}

export const mondayOf = (day: string) => {
  const wd = new Date(`${day}T12:00:00Z`).getUTCDay()
  return addDays(day, -((wd + 6) % 7))
}

/** The last `weeks` weeks (oldest first), this week included. */
export function scorecard(h: CoachHistory, focus: { day: string; minutes: number }[], today: string, weeks = 8): WeekRow[] {
  const days = cleanHistory(h).days
  const thisMonday = mondayOf(today)
  const rows: WeekRow[] = []
  for (let i = weeks - 1; i >= 0; i--) {
    const week = addDays(thisMonday, -7 * i)
    const end = addDays(week, 6)
    const ds = Object.entries(days).filter(([d]) => d >= week && d <= end && d <= today).map(([, v]) => v)
    const kept = ds.reduce((t, d) => t + (d.kept ?? 0), 0)
    const broken = ds.reduce((t, d) => t + (d.broken ?? 0), 0)
    const ignored = ds.reduce((t, d) => t + (d.ignored ?? 0), 0)
    const judged = kept + broken + ignored
    const scores = ds.map((d) => d.score).filter((x): x is number => typeof x === 'number')
    rows.push({
      week,
      kept,
      broken,
      ignored,
      keptPct: judged ? Math.round((kept / judged) * 100) : null,
      plansProposed: ds.filter((d) => d.plan).length,
      plansApproved: ds.filter((d) => d.plan === 'approved').length,
      avgScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
      mustdosDone: ds.reduce((t, d) => t + (d.mustdos?.[0] ?? 0), 0),
      mustdosTotal: ds.reduce((t, d) => t + (d.mustdos?.[1] ?? 0), 0),
      focusMin: focus.filter((f) => f.day >= week && f.day <= end).reduce((t, f) => t + f.minutes, 0)
    })
  }
  return rows
}

/**
 * The honest answer: the last 2 weeks against the 2 before them. "Working"
 * when most measures went up, "not yet" when most went down.
 */
export function impactVerdict(rows: WeekRow[]): { verdict: 'working' | 'mixed' | 'not yet' | 'too early'; lines: string[] } {
  const recent = rows.slice(-2)
  const before = rows.slice(-4, -2)
  const used = rows.filter((r) => r.plansProposed || r.kept + r.broken + r.ignored || r.avgScore != null)
  if (used.length < 2 || !before.some((r) => r.plansProposed || r.avgScore != null || r.kept + r.broken + r.ignored)) return { verdict: 'too early', lines: ['Two weeks of using the coach are needed to compare. Keep answering its check-ins and approving plans.'] }
  const sum = (rs: WeekRow[], f: (r: WeekRow) => number) => rs.reduce((t, r) => t + f(r), 0)
  const pct = (rs: WeekRow[]) => {
    const j = sum(rs, (r) => r.kept + r.broken + r.ignored)
    return j ? sum(rs, (r) => r.kept) / j : null
  }
  const avg = (rs: WeekRow[]) => {
    const s = rs.filter((r) => r.avgScore != null)
    return s.length ? sum(s, (r) => r.avgScore as number) / s.length : null
  }
  const measures: { name: string; a: number | null; b: number | null; fmt: (x: number) => string }[] = [
    { name: 'Promises kept', a: pct(recent), b: pct(before), fmt: (x) => `${Math.round(x * 100)}%` },
    { name: 'Day score', a: avg(recent), b: avg(before), fmt: (x) => `${Math.round(x)}/100` },
    { name: 'Focus', a: sum(recent, (r) => r.focusMin) / 2, b: sum(before, (r) => r.focusMin) / 2, fmt: (x) => `${(x / 60).toFixed(1)}h/week` },
    { name: 'Plans approved', a: sum(recent, (r) => r.plansApproved), b: sum(before, (r) => r.plansApproved), fmt: (x) => `${x}` }
  ]
  let up = 0
  let down = 0
  const lines: string[] = []
  for (const m of measures) {
    if (m.a == null || m.b == null) continue
    const diff = m.a - m.b
    const tol = Math.max(Math.abs(m.b) * 0.05, 1e-9)
    if (diff > tol) up++
    else if (diff < -tol) down++
    lines.push(`${m.name}: ${m.fmt(m.a)} (was ${m.fmt(m.b)}) ${diff > tol ? '↑' : diff < -tol ? '↓' : '='}`)
  }
  return { verdict: up > down && up >= 2 ? 'working' : down > up ? 'not yet' : 'mixed', lines }
}
