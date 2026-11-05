// Ben holds you accountable (pure, tested): promises with stakes (points you
// lose, enforced on time), check-ins at a clock time, the Sunday coach call
// (5 questions → next week's big 3) and the month's progress story.

import { addDays, calendarDay } from './dates'

// ------------------------------------------------------------------- stakes

export interface Stake {
  id: string
  text: string
  /** ISO time it must be done by. */
  due: string
  points: number
  status: 'open' | 'kept' | 'lost'
  at: string
  settledAt?: string
  /** W16: settles by itself when the data shows it (focus minutes on a subject, a workout, a wake-up). */
  proof?: { kind: 'focus'; subject: string; minutes: number } | { kind: 'workout' } | { kind: 'wake'; by: string }
}

export function addStake(list: Stake[], text: string, due: string, points: number, now: Date, proof?: Stake['proof']): Stake[] {
  const p = Math.max(10, Math.min(500, Math.round(points)))
  return [...list, { id: `k${now.getTime().toString(36)}${list.length}`, text: text.slice(0, 120), due, points: p, status: 'open' as const, at: now.toISOString(), ...(proof ? { proof } : {}) }].slice(-100)
}

/**
 * W15: the stake Ben offers when a block slipped twice: 25 minutes on it,
 * by 3 hours from now (21:30 at the latest), 50 points. Only made if you
 * tap Yes.
 */
export function suggestStake(subject: string, now: Date): { text: string; due: string; points: number; proof: Stake['proof'] } {
  const due = new Date(Math.min(now.getTime() + 3 * 3600_000, new Date(now).setHours(21, 30, 0, 0)))
  if (due.getTime() <= now.getTime() + 30 * 60000) due.setTime(now.getTime() + 60 * 60000)
  const s = subject.slice(0, 40)
  return { text: `25 min focus on ${s} by ${due.toTimeString().slice(0, 5)}`, due: due.toISOString(), points: 50, proof: { kind: 'focus', subject: s, minutes: 25 } }
}

/** W16: whether the data already shows the stake is kept. */
export function proofMet(st: Stake, d: { sessions: { subject: string; startedAt: string | null; minutes: number }[]; workoutSince?: boolean; wakeTime?: string | null }): boolean {
  const p = st.proof
  if (!p || st.status !== 'open') return false
  if (p.kind === 'focus') {
    const want = p.subject.toLowerCase().split(/\s+/).filter((w) => w.length >= 3)
    const mins = d.sessions
      .filter((x) => x.startedAt && x.startedAt >= st.at && (!want.length || want.some((w) => x.subject.toLowerCase().includes(w.slice(0, 5)))))
      .reduce((t, x) => t + x.minutes, 0)
    return mins >= p.minutes
  }
  if (p.kind === 'workout') return !!d.workoutSince
  return !!d.wakeTime && d.wakeTime <= p.by
}

export function keepStake(list: Stake[], id: string, now: Date): Stake[] {
  return list.map((s) => (s.id === id && s.status === 'open' ? { ...s, status: 'kept' as const, settledAt: now.toISOString() } : s))
}

/** Open stakes past their time: these get enforced (points taken). */
export function overdueStakes(list: Stake[], now: Date): Stake[] {
  return list.filter((s) => s.status === 'open' && Date.parse(s.due) <= now.getTime())
}

export function loseStakes(list: Stake[], ids: string[], now: Date): Stake[] {
  return list.map((s) => (ids.includes(s.id) && s.status === 'open' ? { ...s, status: 'lost' as const, settledAt: now.toISOString() } : s))
}

/** Kept / lost in the last 30 days, and points lost. */
export function stakeStats(list: Stake[], now: Date): { kept: number; lost: number; pointsLost: number; open: number } {
  const from = now.getTime() - 30 * 86400000
  const recent = list.filter((s) => Date.parse(s.at) >= from)
  return { kept: recent.filter((s) => s.status === 'kept').length, lost: recent.filter((s) => s.status === 'lost').length, pointsLost: recent.filter((s) => s.status === 'lost').reduce((t, s) => t + s.points, 0), open: list.filter((s) => s.status === 'open').length }
}

/**
 * "by 18:00" / "18:00" / "tomorrow 9" / "2026-11-05 18:00" → ISO, in local time.
 * A clock time already past today means tomorrow.
 */
export function readDue(text: string, now: Date): string | null {
  const t = String(text ?? '').trim().toLowerCase()
  const iso = /^(\d{4}-\d{2}-\d{2})[ t](\d{1,2})(?::(\d{2}))?$/.exec(t)
  if (iso) return new Date(`${iso[1]}T${iso[2].padStart(2, '0')}:${iso[3] ?? '00'}:00`).toISOString()
  const m = /^(?:by\s+|până la\s+|pana la\s+)?(tomorrow|mâine|maine|today|azi)?\s*(?:at\s+|la\s+)?(\d{1,2})(?::(\d{2}))?$/.exec(t)
  if (!m) return null
  const h = Number(m[2])
  const mi = Number(m[3] ?? 0)
  if (h > 23 || mi > 59) return null
  const d = new Date(now)
  d.setHours(h, mi, 0, 0)
  if (/tomorrow|mâine|maine/.test(m[1] ?? '')) d.setDate(d.getDate() + 1)
  else if (!m[1] && d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1)
  return d.toISOString()
}

export function stakeLostText(s: Stake): string {
  return `💸 Time's up: "${s.text}" wasn't done by ${new Date(s.due).toTimeString().slice(0, 5)}. −${s.points} points, as you promised. Make the next one smaller and win it back.`
}

export function stakeRemindText(s: Stake, now: Date): string | null {
  const left = (Date.parse(s.due) - now.getTime()) / 60000
  if (left > 60 || left <= 0) return null
  return `⏳ ${Math.round(left)} min left: "${s.text}" or −${s.points} points. Mark it done when it is.`
}

// ---------------------------------------------------------- check-in at time

/** Minutes from now until "HH:MM" (today, or tomorrow if past). */
export function minutesUntil(hmText: string, now: Date): number | null {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(String(hmText ?? '').trim())
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null
  const d = new Date(now)
  d.setHours(Number(m[1]), Number(m[2]), 0, 0)
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1)
  return Math.max(1, Math.round((d.getTime() - now.getTime()) / 60000))
}

/** "I'll start at 15:00" / "o să încep la 15" → "15:00". */
export function saysStartAt(text: string): string | null {
  const m = /(?:^|[\s,])(?:i'?ll|i will|gonna|going to|o să|o sa|voi)\s[^.?!]{0,60}?(?:^|\s)(?:at|la)\s+(\d{1,2})(?::(\d{2}))?(?!\d)/iu.exec(String(text ?? ''))
  if (!m || Number(m[1]) > 23) return null
  return `${m[1].padStart(2, '0')}:${m[2] ?? '00'}`
}

// -------------------------------------------------------- Sunday coach call

export const CALL_QUESTIONS = [
  { id: 'good', q: 'What went well this week?', hint: 'One or two wins, even small.' },
  { id: 'bad', q: "What didn't go well?", hint: 'Be honest, no excuses.' },
  { id: 'why', q: 'Why do you think it happened?', hint: 'The real reason.' },
  { id: 'change', q: 'One change for next week?', hint: 'Small and specific: "phone out of the room during blocks".' },
  { id: 'big3', q: "Next week's big 3?", hint: 'One per line: the 3 things that would make it a great week.' }
] as const
export type CallId = (typeof CALL_QUESTIONS)[number]['id']

export interface CoachCall {
  week: string
  at: string
  answers: Record<CallId, string>
}

/** The Monday a week starts on. */
export function weekOf(day: string): string {
  const dow = (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7
  return addDays(day, -dow)
}

/** The call is due Saturday 18:00 → Monday 12:00 when this week has none. */
export function callDue(calls: CoachCall[], now: Date): boolean {
  const day = calendarDay(now)
  const dow = now.getDay()
  const h = now.getHours()
  const open = (dow === 6 && h >= 18) || dow === 0 || (dow === 1 && h < 12)
  if (!open) return false
  const wk = dow === 1 ? addDays(weekOf(day), -7) : weekOf(day)
  return !calls.some((c) => c.week === wk)
}

export function big3Of(answer: string): string[] {
  return String(answer ?? '')
    .split(/\n|;|\s\/\s|^\d[.)]\s*/m)
    .map((x) => x.replace(/^\s*(\d[.)]|[-•*])\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 3)
}

export function callNote(c: CoachCall): string {
  const a = c.answers
  return [`## Week of ${c.week}`, `- ✅ Went well: ${a.good || '-'}`, `- ❌ Didn't: ${a.bad || '-'}`, `- 🔍 Why: ${a.why || '-'}`, `- 🔧 One change: ${a.change || '-'}`, `- 🎯 Big 3: ${big3Of(a.big3).join(' · ') || '-'}`].join('\n')
}

// ------------------------------------------------------- the month's story

export interface MonthInput {
  month: string
  today: string
  focus: { day: string; minutes: number }[]
  workouts: string[]
  restDays: string[]
  sleep: { day: string; wake?: string | null; bed?: string | null; onTime?: boolean }[]
  spent: { day: string; bani: number }[]
  moods: { day: string; mood: number }[]
  stakes: { kept: number; lost: number }
  promises: { kept: number; missed: number }
}
export interface MonthDay {
  day: string
  focus: number
  trained: boolean
  rest: boolean
  slept: number | null
  mood: number | null
  /** 0..4: how full the day was (for the calendar shade). */
  level: number
}
export interface MonthStory {
  month: string
  label: string
  days: MonthDay[]
  /** Blank cells before day 1 (Mon-first grid). */
  pad: number
  stats: { focusH: number; trained: number; avgSleep: string | null; onTime: number; spent: number; moodAvg: number | null; bestDay: string | null; bestStreak: number }
  compare: { focusH: number; trained: number; spent: number } | null
  lines: string[]
}

const sleptMin = (bed?: string | null, wake?: string | null) => {
  const m = (t?: string | null) => (t && /^\d{1,2}:\d{2}/.test(t) ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : null)
  const b = m(bed)
  const w = m(wake)
  if (b == null || w == null) return null
  const v = (w - b + 1440) % 1440
  return v >= 120 && v <= 840 ? v : null
}

function monthSums(i: MonthInput, month: string, upToDay = 31) {
  const inM = (d: string) => d.startsWith(month) && Number(d.slice(8, 10)) <= upToDay
  return {
    focusH: i.focus.filter((f) => inM(f.day)).reduce((t, f) => t + f.minutes, 0) / 60,
    trained: new Set(i.workouts.filter(inM)).size,
    spent: i.spent.filter((s) => inM(s.day)).reduce((t, s) => t + s.bani, 0)
  }
}

/** The month as a calendar (one cell a day) plus its numbers and the plain-words lines. */
export function monthStory(i: MonthInput): MonthStory {
  const [y, mo] = i.month.split('-').map(Number)
  const n = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  const first = `${i.month}-01`
  const pad = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7
  const focusBy = new Map<string, number>()
  for (const f of i.focus) focusBy.set(f.day, (focusBy.get(f.day) ?? 0) + f.minutes)
  const w = new Set(i.workouts)
  const r = new Set(i.restDays)
  const sl = new Map(i.sleep.map((s) => [s.day, sleptMin(s.bed, s.wake)]))
  const md = new Map<string, number[]>()
  for (const m of i.moods) md.set(m.day, [...(md.get(m.day) ?? []), m.mood])
  const days: MonthDay[] = []
  for (let k = 1; k <= n; k++) {
    const day = `${i.month}-${String(k).padStart(2, '0')}`
    if (day > i.today) break
    const focus = focusBy.get(day) ?? 0
    const trained = w.has(day)
    const level = Math.min(4, (focus >= 180 ? 3 : focus >= 90 ? 2 : focus >= 25 ? 1 : 0) + (trained ? 1 : 0))
    const moods = md.get(day)
    days.push({ day, focus, trained, rest: r.has(day), slept: sl.get(day) ?? null, mood: moods ? moods.reduce((t, x) => t + x, 0) / moods.length : null, level })
  }
  const nights = days.map((d) => d.slept).filter((x): x is number => x != null)
  const avg = nights.length ? nights.reduce((t, x) => t + x, 0) / nights.length : null
  const moods = days.map((d) => d.mood).filter((x): x is number => x != null)
  const best = [...days].sort((a, b) => b.focus - a.focus)[0]
  let streak = 0
  let bestStreak = 0
  for (const d of days) {
    streak = d.level >= 1 ? streak + 1 : 0
    bestStreak = Math.max(bestStreak, streak)
  }
  const sums = monthSums(i, i.month)
  const prevMonth = (() => {
    const d = new Date(Date.UTC(y, mo - 2, 1))
    return d.toISOString().slice(0, 7)
  })()
  // A month still running is compared with the same days of last month (1–4 Nov vs 1–4 Oct).
  const running = i.today.startsWith(i.month)
  const prev = monthSums(i, prevMonth, running ? Number(i.today.slice(8, 10)) : 31)
  const compare = prev.focusH || prev.trained || prev.spent ? prev : null
  const onTime = i.sleep.filter((s) => s.day.startsWith(i.month) && s.onTime).length
  const stats = {
    focusH: Math.round(sums.focusH * 10) / 10,
    trained: sums.trained,
    avgSleep: avg != null ? `${Math.floor(avg / 60)}h${String(Math.round(avg % 60)).padStart(2, '0')}` : null,
    onTime,
    spent: sums.spent,
    moodAvg: moods.length ? Math.round((moods.reduce((t, x) => t + x, 0) / moods.length) * 10) / 10 : null,
    bestDay: best && best.focus > 0 ? best.day : null,
    bestStreak
  }
  const delta = (a: number, b: number) => (b ? `${a >= b ? '+' : ''}${Math.round(((a - b) / b) * 100)}%` : '')
  const vsLast = running ? 'vs the same days last month' : 'vs last month'
  const shortDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  const lines = [
    `🎯 ${stats.focusH}h of focus${compare ? ` (${delta(sums.focusH, compare.focusH)} ${vsLast})` : ''}${stats.bestDay ? `, best day ${shortDay(stats.bestDay)} with ${Math.round((focusBy.get(stats.bestDay) ?? 0) / 60 * 10) / 10}h` : ''}.`,
    `💪 Trained ${stats.trained} day${stats.trained === 1 ? '' : 's'}${compare ? ` (${running ? 'same days last month' : 'last month'}: ${compare.trained})` : ''}.`,
    stats.avgSleep ? `😴 Slept ${stats.avgSleep} on average, up on time ${onTime} day${onTime === 1 ? '' : 's'}.` : '',
    stats.spent ? `💸 Spent ${Math.round(stats.spent / 100).toLocaleString('en-US')} lei${compare?.spent ? ` (${delta(sums.spent, compare.spent)})` : ''}.` : '',
    i.promises.kept + i.promises.missed ? `🤝 Promises: ${i.promises.kept} kept, ${i.promises.missed} missed.` : '',
    i.stakes.kept + i.stakes.lost ? `💎 Stakes: ${i.stakes.kept} won, ${i.stakes.lost} lost.` : '',
    stats.moodAvg != null ? `🙂 Mood ${stats.moodAvg}/5 on average.` : '',
    bestStreak >= 3 ? `🔥 Longest run of active days: ${bestStreak}.` : ''
  ].filter(Boolean)
  const label = new Date(`${first}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return { month: i.month, label, days, pad, stats, compare, lines }
}

export function monthTakePrompt(s: MonthStory, goals: string[]): string {
  return [
    "You are Ben, Victor's best friend and coach. Write his month's letter: 4–6 short lines, plain text, warm and honest (tough love when it's earned).",
    'Line 1: the verdict on the month in one sentence. Then what was strongest, what slipped (with his numbers), and ONE change for next month. End with one line that makes him want to start.',
    'Use ONLY these numbers, never invent any. English.',
    '',
    `Month: ${s.label}`,
    ...s.lines,
    goals.length ? `His goals: ${goals.join('; ')}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

/** The desk actions Ben may use (prompt text; parsed by readDeskOp in web/benDesk). */
export const DESK_ACTIONS = `His coaching desk (these stay and show on his Coach page):
- "stake: <what> | <by when: 18:00, tomorrow 9, YYYY-MM-DD HH:MM> | <points 10-500>" a promise WITH STAKES: if it isn't marked done in time, the app takes the points by itself. Only when he agrees to put points on it ("bet 50 points", "if I don't, take 100").
- "study: <exam> | <topic>" a topic he just learned: the app brings it back for review after 1, 3, 7, 14, 30 days (before the exam). "reviewed: <topic>" when he reviewed one that was due.
- "stack: after <cue> → <step> → <step>" a habit chain he wants ("after coffee → 10 pushups → plan review").
- "mood: <1-5>" when he tells you how he feels today (1 awful … 5 great).
- "checkin: <HH:MM> | <question>" also works with a clock time ("I'll start at 15:00" → "checkin: 15:00 | Started the lab?").`
