// Study Time insights (pure, tested in studyInsights.test.ts): weekly goals
// per subject, your best hours, the calendar heat map, the timeline of a day,
// one subject's sessions and trend, and the CSV export.
//
// Clock times are read in local time from the stored ISO times, so the tests
// build their times with local dates (they pass in any time zone).
import { addDays, daysBetween } from './dates'
import { categoryColor, categoryEmoji, keysOf, NO_BLOCK_COLOR, prefsOf, weekStart, type GroupBy, type StudyBlock, type StudySession, type StudyStore } from './studyTime'

const blockMap = (store: Pick<StudyStore, 'blocks'>) => new Map(store.blocks.map((b) => [b.id, b]))
const sum = (xs: StudySession[]) => xs.reduce((t, s) => t + s.minutes, 0)

// ---------------------------------------------------------------- goals per subject

export interface GoalView {
  category: string
  color: string
  emoji: string
  goalMin: number
  doneMin: number
  /** 0–100+ (can pass 100). */
  pct: number
  /** Where you'd be on an even pace by the end of today. */
  expectedMin: number
  /** Behind: under 75 % of the even pace and at least 30 min short. */
  behind: boolean
  reached: boolean
  leftMin: number
  /** Minutes a day still needed over the days left (today included). */
  perDayMin: number
  daysLeft: number
}

/** Each weekly goal (Monday to Sunday) against this week's study of that subject. */
export function goalViews(sessions: StudySession[], store: Pick<StudyStore, 'blocks' | 'categories' | 'goals'>, today: string): GoalView[] {
  const from = weekStart(today)
  const blocks = blockMap(store)
  const week = sessions.filter((s) => s.day >= from && s.day <= today)
  const dayNo = daysBetween(from, today) + 1 // Monday 1 … Sunday 7
  return (store.goals ?? []).map((g) => {
    const doneMin = sum(week.filter((s) => (blocks.get(s.blockId ?? '')?.category ?? '').toLowerCase() === g.category.toLowerCase()))
    const expectedMin = Math.round((g.minutes * dayNo) / 7)
    const leftMin = Math.max(0, g.minutes - doneMin)
    const daysLeft = 8 - dayNo
    return {
      category: g.category,
      color: categoryColor(store, g.category),
      emoji: categoryEmoji(store, g.category),
      goalMin: g.minutes,
      doneMin,
      pct: Math.round((doneMin / g.minutes) * 100),
      expectedMin,
      behind: doneMin < g.minutes && doneMin < expectedMin * 0.75 && expectedMin - doneMin >= 30,
      reached: doneMin >= g.minutes,
      leftMin,
      perDayMin: Math.ceil(leftMin / daysLeft),
      daysLeft
    }
  })
}

// ---------------------------------------------------------------- best hours

export interface HourStat {
  hour: number
  minutes: number
  sessions: number
  /** Average length of the sessions that started in this hour. */
  avgMin: number
}

export interface BestHours {
  /** All 24 hours: minutes studied in each (a session spread over the hours it covered). */
  hours: HourStat[]
  /** Up to 3 hours you focus longest in (sessions that start then run longest; at least 2 sessions). */
  best: number[]
  /** "Your best hours: 9–10, 14–15" or ''. */
  line: string
  days: number
}

/**
 * Which hours you focus longest, from the timed sessions of the last `days`
 * days (typed-in ones have no real clock and are left out). For the planner
 * and Ben: `best` hours first.
 */
export function bestHours(sessions: StudySession[], today: string, days = 30): BestHours {
  const from = addDays(today, -(days - 1))
  const hours: HourStat[] = Array.from({ length: 24 }, (_, hour) => ({ hour, minutes: 0, sessions: 0, avgMin: 0 }))
  const lens: number[][] = Array.from({ length: 24 }, () => [])
  for (const s of sessions) {
    if (s.source === 'manual' || s.day < from || s.day > today) continue
    const end = Date.parse(s.endedAt)
    const start = Math.max(Date.parse(s.startedAt), end - s.minutes * 60_000 - (s.breakMin + (s.pauseMin ?? 0)) * 60_000)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue
    lens[new Date(start).getHours()].push(s.minutes)
    // Spread the studied minutes over the clock hours the session covered (breaks thinned out evenly).
    const wall = end - start
    const ratio = Math.min(1, (s.minutes * 60_000) / wall)
    let t = start
    while (t < end) {
      const d = new Date(t)
      const nextHour = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime()
      const stop = Math.min(end, nextHour)
      hours[d.getHours()].minutes += ((stop - t) / 60_000) * ratio
      t = stop
    }
  }
  for (const h of hours) {
    h.minutes = Math.round(h.minutes)
    h.sessions = lens[h.hour].length
    h.avgMin = h.sessions ? Math.round(lens[h.hour].reduce((a, b) => a + b, 0) / h.sessions) : 0
  }
  const best = hours
    .filter((h) => h.sessions >= 2)
    .sort((a, b) => b.avgMin - a.avgMin || b.minutes - a.minutes || a.hour - b.hour)
    .slice(0, 3)
    .map((h) => h.hour)
  const line = best.length ? `Your best hours: ${[...best].sort((a, b) => a - b).map((h) => `${h}–${h + 1}`).join(', ')}` : ''
  return { hours, best, line, days }
}

// ---------------------------------------------------------------- the heat map

export interface HeatCell {
  day: string
  minutes: number
  /** 0 nothing, 1–4 more and more (by your own busiest days). */
  level: 0 | 1 | 2 | 3 | 4
  future: boolean
}

/** Minutes per day for the last `weeks` weeks (columns Monday to Sunday, ending with this week). */
export function heatMap(sessions: StudySession[], today: string, weeks = 26): { weeks: HeatCell[][]; maxMin: number; totalMin: number; activeDays: number } {
  const start = addDays(weekStart(today), -7 * (weeks - 1))
  const per = new Map<string, number>()
  for (const s of sessions) if (s.day >= start && s.day <= today) per.set(s.day, (per.get(s.day) ?? 0) + s.minutes)
  const values = [...per.values()].filter((m) => m > 0).sort((a, b) => a - b)
  const maxMin = values.length ? values[values.length - 1] : 0
  // Levels by quartiles of your own days (one long day doesn't wash out the rest).
  const q = (f: number) => values[Math.max(0, Math.ceil(values.length * f) - 1)] ?? 0
  const cuts = [q(0.25), q(0.5), q(0.75)]
  const levelOf = (m: number): HeatCell['level'] => (m <= 0 ? 0 : m <= cuts[0] ? 1 : m <= cuts[1] ? 2 : m <= cuts[2] ? 3 : 4)
  const out: HeatCell[][] = []
  for (let w = 0; w < weeks; w++) {
    const col: HeatCell[] = []
    for (let d = 0; d < 7; d++) {
      const day = addDays(start, w * 7 + d)
      const minutes = per.get(day) ?? 0
      col.push({ day, minutes, level: day > today ? 0 : levelOf(minutes), future: day > today })
    }
    out.push(col)
  }
  return { weeks: out, maxMin, totalMin: values.reduce((a, b) => a + b, 0), activeDays: values.length }
}

// ---------------------------------------------------------------- the timeline of a day

export interface TimelineSeg {
  /** Minutes from the day's midnight (local); past 24 h for a late night. */
  from: number
  to: number
  label: string
  color: string
  emoji: string
  minutes: number
  note?: string
}

/** When you studied what on a day: a morning-to-night bar (06:00–24:00, wider when you studied outside it). */
export function dayTimeline(sessions: StudySession[], store: Pick<StudyStore, 'blocks' | 'categories'>, day: string): { segs: TimelineSeg[]; from: number; to: number } {
  const blocks = blockMap(store)
  const [y, m, d] = day.split('-').map(Number)
  const midnight = new Date(y, m - 1, d).getTime()
  const segs: TimelineSeg[] = []
  for (const s of sessions) {
    if (s.day !== day) continue
    const a = Date.parse(s.startedAt)
    const b = Date.parse(s.endedAt)
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue
    const bl = s.blockId ? blocks.get(s.blockId) : undefined
    segs.push({
      from: Math.round((a - midnight) / 60_000),
      to: Math.max(Math.round((a - midnight) / 60_000) + 1, Math.round((b - midnight) / 60_000)),
      label: bl?.name ?? s.subject,
      color: bl ? categoryColor(store, bl.category) : NO_BLOCK_COLOR,
      emoji: bl ? categoryEmoji(store, bl.category) : '',
      minutes: s.minutes,
      ...(s.note ? { note: s.note } : {})
    })
  }
  segs.sort((p, q) => p.from - q.from)
  const from = Math.min(6 * 60, ...segs.map((x) => Math.floor(x.from / 60) * 60))
  const to = Math.max(24 * 60, ...segs.map((x) => Math.ceil(x.to / 60) * 60))
  return { segs, from: Math.max(0, from), to: Math.min(30 * 60, to) }
}

// ---------------------------------------------------------------- one subject

/** The sessions of one donut slice (newest first) and its minutes per week for the last `weeks` weeks. */
export function sliceDetail(sessions: StudySession[], store: Pick<StudyStore, 'blocks'>, by: GroupBy, key: string, today: string, weeks = 8): { sessions: StudySession[]; trend: { week: string; minutes: number }[] } {
  const blocks = blockMap(store)
  const mine = sessions.filter((s) => keysOf(s, by, blocks).some((k) => k.key === key))
  const first = addDays(weekStart(today), -7 * (weeks - 1))
  const trend = Array.from({ length: weeks }, (_, i) => {
    const week = addDays(first, 7 * i)
    const end = addDays(week, 6)
    return { week, minutes: sum(mine.filter((s) => s.day >= week && s.day <= end)) }
  })
  return { sessions: [...mine].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)), trend }
}

// ---------------------------------------------------------------- CSV

const csvCell = (v: string | number) => {
  const t = String(v)
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
}

/** Every session as CSV: block, category, tags, start, end, minutes, break, pause, pomodoros, source, note. */
export function sessionsCsv(sessions: StudySession[], store: Pick<StudyStore, 'blocks'>): string {
  const blocks = blockMap(store)
  const head = ['block', 'category', 'tags', 'start', 'end', 'minutes', 'break_min', 'pause_min', 'pomodoros', 'source', 'note']
  const rows = [...sessions]
    .sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1))
    .map((s) => {
      const b: StudyBlock | undefined = s.blockId ? blocks.get(s.blockId) : undefined
      return [b?.name ?? s.subject, b ? b.category : 'No block', (b?.tags ?? []).join(' '), s.startedAt, s.endedAt, s.minutes, s.breakMin, s.pauseMin ?? 0, s.pomos ?? 0, s.source, s.note ?? ''].map(csvCell).join(',')
    })
  return [head.join(','), ...rows].join('\r\n') + '\r\n'
}

/** The pomodoro lengths in words ("25 / 5, a 15 min break after 4"). */
export function pomoLine(store: Pick<StudyStore, 'prefs'>): string {
  const p = prefsOf(store)
  return `${p.work} / ${p.short}, a ${p.long} min break after ${p.every}`
}
