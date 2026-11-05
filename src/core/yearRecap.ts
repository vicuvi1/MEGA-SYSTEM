// "Your year" (pure, FT12): the year in a few calm cards. Best streaks, focus
// hours by subject, workouts, clean days, money saved, the best month and
// Ben's letters. Only numbers that are really in your data.
import { bestDayStreak } from './streaks'

export interface YearInput {
  year: number
  today: string
  sessions: { day: string; subject: string; minutes: number }[]
  workouts: string[]
  /** On-time wake-ups. */
  wakes: { day: string; onTime: boolean }[]
  /** Clean days (from the discipline streak). */
  cleanDays: string[]
  /** Money in and out (bani), when Finance Helper is on this device. */
  money: { day: string; bani: number; type: 'income' | 'expense' }[] | null
  /** Ben's month letters (YYYY-MM → text). */
  letters: Record<string, string>
}

export interface YearRecap {
  year: number
  /** True while the year is still running. */
  running: boolean
  focusH: number
  bySubject: { subject: string; hours: number }[]
  workouts: number
  cleanDays: number
  onTimeWakes: number
  /** Income minus spending, in bani; null without money data. */
  savedBani: number | null
  bestMonth: { month: string; label: string; focusH: number; workouts: number } | null
  streaks: { id: 'focus' | 'workout' | 'clean' | 'wake'; label: string; best: number }[]
  letters: { month: string; label: string; text: string }[]
  /** Enough data to show the year at all. */
  empty: boolean
}

const monthLabel = (m: string) => new Date(`${m}-01T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' })

export function yearRecap(i: YearInput): YearRecap {
  const y = String(i.year)
  const inY = (d: string) => d.startsWith(y) && d <= i.today
  const sessions = i.sessions.filter((s) => inY(s.day))
  const bySub = new Map<string, { subject: string; min: number }>()
  for (const s of sessions) {
    const k = s.subject.trim().toLowerCase() || 'focus'
    const cur = bySub.get(k) ?? { subject: s.subject.trim() || 'Focus', min: 0 }
    cur.min += s.minutes
    bySub.set(k, cur)
  }
  const focusMin = sessions.reduce((t, s) => t + s.minutes, 0)
  const workouts = [...new Set(i.workouts.filter(inY))]
  const clean = [...new Set(i.cleanDays.filter(inY))]
  const wakes = i.wakes.filter((w) => inY(w.day) && w.onTime).map((w) => w.day)
  const focusDays = new Map<string, number>()
  for (const s of sessions) focusDays.set(s.day, (focusDays.get(s.day) ?? 0) + s.minutes)
  const goodFocus = [...focusDays.entries()].filter(([, m]) => m >= 50).map(([d]) => d)
  // Best month: the most focus, workouts as the tie-break.
  const months = new Map<string, { focus: number; workouts: number }>()
  for (const s of sessions) {
    const m = s.day.slice(0, 7)
    months.set(m, { focus: (months.get(m)?.focus ?? 0) + s.minutes, workouts: months.get(m)?.workouts ?? 0 })
  }
  for (const d of workouts) {
    const m = d.slice(0, 7)
    months.set(m, { focus: months.get(m)?.focus ?? 0, workouts: (months.get(m)?.workouts ?? 0) + 1 })
  }
  const best = [...months.entries()].sort((a, b) => b[1].focus - a[1].focus || b[1].workouts - a[1].workouts)[0]
  const money = i.money?.filter((x) => inY(x.day)) ?? null
  const savedBani = money && money.length ? money.reduce((t, x) => t + (x.type === 'income' ? x.bani : -x.bani), 0) : null
  const letters = Object.entries(i.letters)
    .filter(([m, t]) => m.startsWith(y) && String(t ?? '').trim())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, text]) => ({ month, label: monthLabel(month), text: String(text) }))
  return {
    year: i.year,
    running: i.today.startsWith(y),
    focusH: Math.round((focusMin / 60) * 10) / 10,
    bySubject: [...bySub.values()].sort((a, b) => b.min - a.min).slice(0, 8).map((x) => ({ subject: x.subject, hours: Math.round((x.min / 60) * 10) / 10 })),
    workouts: workouts.length,
    cleanDays: clean.length,
    onTimeWakes: wakes.length,
    savedBani,
    bestMonth: best ? { month: best[0], label: monthLabel(best[0]), focusH: Math.round((best[1].focus / 60) * 10) / 10, workouts: best[1].workouts } : null,
    streaks: [
      { id: 'focus' as const, label: 'Days of 50+ min focus', best: bestDayStreak(goodFocus) },
      { id: 'workout' as const, label: 'Training days', best: bestDayStreak(workouts) },
      { id: 'clean' as const, label: 'Clean days', best: bestDayStreak(clean) },
      { id: 'wake' as const, label: 'Up on time', best: bestDayStreak(wakes) }
    ],
    letters,
    empty: !sessions.length && !workouts.length && !clean.length && !wakes.length
  }
}

/** Whether to offer the year view by itself: December, or the first week of January (last year). */
export function recapSeason(today: string): number | null {
  const m = Number(today.slice(5, 7))
  const d = Number(today.slice(8, 10))
  const y = Number(today.slice(0, 4))
  if (m === 12) return y
  if (m === 1 && d <= 7) return y - 1
  return null
}
