// Ben truly knows you (pure, tested): the weekly pattern report, your energy
// map (best hours), the excuses you repeat, mood check-ins linked to sleep,
// sport and spending, and the profile note Ben keeps current. Everything is
// computed from your own data; nothing here calls a model.

import { addDays } from './dates'

// ---------------------------------------------------------------- energy map

export interface FocusRow {
  day: string
  startedAt: string
  minutes: number
}
export interface QualityRow {
  at: string
  pct: number
}
export interface BlockRow {
  at: string
  result: 'done' | 'half' | 'no'
}
export interface EnergyHour {
  h: number
  /** 0..100: how well this hour works for you. */
  score: number
  minutes: number
  /** Data points behind it. */
  n: number
}
export interface EnergyMap {
  hours: EnergyHour[]
  /** The best 2–4 hours (start hour), best first; empty while there's too little data. */
  best: number[]
  worst: number[]
  /** Enough data to trust it (≥ 6 sessions or blocks). */
  ready: boolean
}

const HOURS = Array.from({ length: 18 }, (_, i) => i + 6) // 06..23
const hourOf = (iso: string) => new Date(iso).getHours()

/**
 * Your best hours from focus minutes (how much you do), focus quality (how
 * much of it you were really at it) and finished blocks (done/half/no).
 */
export function energyMap(sessions: FocusRow[], quality: QualityRow[] = [], blocks: BlockRow[] = []): EnergyMap {
  const acc = new Map<number, { min: number; q: number[]; b: number[]; n: number }>()
  const at = (h: number) => acc.get(h) ?? (acc.set(h, { min: 0, q: [], b: [], n: 0 }), acc.get(h)!)
  for (const s of sessions) {
    if (!s.startedAt || !(s.minutes > 0)) continue
    // A long session counts for every hour it covers.
    let t = Date.parse(s.startedAt)
    let left = s.minutes
    while (left > 0 && Number.isFinite(t)) {
      const h = new Date(t).getHours()
      const into = new Date(t).getMinutes()
      const take = Math.min(left, 60 - into)
      const a = at(h)
      a.min += take
      a.n += take >= 15 ? 1 : 0
      left -= take
      t += take * 60000
    }
  }
  for (const q of quality) at(hourOf(q.at)).q.push(Math.max(0, Math.min(100, q.pct)))
  for (const b of blocks) {
    const a = at(hourOf(b.at))
    a.b.push(b.result === 'done' ? 100 : b.result === 'half' ? 50 : 0)
    a.n++
  }
  const maxMin = Math.max(1, ...[...acc.values()].map((v) => v.min))
  const avg = (xs: number[]) => (xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : null)
  const hours = HOURS.map((h) => {
    const a = acc.get(h)
    if (!a) return { h, score: 0, minutes: 0, n: 0 }
    const volume = (a.min / maxMin) * 100
    const q = avg(a.q)
    const b = avg(a.b)
    const parts = [volume, ...(q != null ? [q] : []), ...(b != null ? [b] : [])]
    return { h, score: Math.round(avg(parts) ?? 0), minutes: Math.round(a.min), n: a.n }
  })
  const points = sessions.length + blocks.length
  const ready = points >= 6
  const ranked = hours.filter((x) => x.n > 0).sort((a, b) => b.score - a.score || b.minutes - a.minutes)
  return {
    hours,
    ready,
    best: ready ? ranked.slice(0, Math.min(4, Math.max(2, Math.ceil(ranked.length / 4)))).map((x) => x.h) : [],
    // The weakest hours: only with enough hours to compare, never one of the best.
    worst: ready && ranked.length >= 5 ? ranked.filter((x) => x.n >= 2).slice(-2).reverse().map((x) => x.h).filter((h) => !ranked.slice(0, Math.min(4, Math.max(2, Math.ceil(ranked.length / 4)))).some((b) => b.h === h)) : []
  }
}

/** "09–11 and 16–17" from start hours. */
export function hoursText(hs: number[]): string {
  const s = [...hs].sort((a, b) => a - b)
  const runs: [number, number][] = []
  for (const h of s) {
    const last = runs[runs.length - 1]
    if (last && h === last[1] + 1) last[1] = h
    else runs.push([h, h])
  }
  const p = (h: number) => String(h).padStart(2, '0')
  return runs.map(([a, b]) => `${p(a)}–${p(b + 1)}`).join(' and ')
}

/** The hour of a weekday where a hard task should go (the best free one). */
export function bestHourFor(map: EnergyMap, free: (h: number) => boolean): number | null {
  const order = map.ready ? [...map.hours].sort((a, b) => b.score - a.score).map((x) => x.h) : [9, 10, 11, 14, 15, 16, 8, 17, 18, 19]
  return order.find((h) => free(h)) ?? null
}

// ---------------------------------------------------------- weekly patterns

export interface PatternInput {
  today: string
  sessions: FocusRow[]
  sleep: { day: string; wake?: string | null; bed?: string | null; onTime?: boolean }[]
  workouts: string[]
  moods?: MoodEntry[]
  blocks?: { day: string; at: string; result: 'done' | 'half' | 'no' }[]
  exams?: string[]
  spending?: { day: string; bani: number }[] | null
}
export interface Pattern {
  id: string
  text: string
  /** One change to try. */
  change: string
  /** How strong (for sorting). */
  weight: number
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const dow = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay()
const minsOf = (hm?: string | null) => (hm && /^\d{1,2}:\d{2}/.test(hm) ? Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5)) : null)
const sleepMin = (bed: number, wake: number) => (wake - bed + 1440) % 1440

/** What your own data shows, each with one change to try. Strongest first, at most 5. */
export function weeklyPatterns(i: PatternInput): Pattern[] {
  const out: Pattern[] = []
  const from = addDays(i.today, -55)
  const ses = i.sessions.filter((s) => s.day >= from && s.day <= i.today && s.startedAt)
  // 1) Morning vs afternoon focus.
  let am = 0
  let pm = 0
  for (const s of ses) (hourOf(s.startedAt) < 12 ? (am += s.minutes) : (pm += s.minutes))
  if (am + pm >= 300) {
    if (am >= pm * 1.8) out.push({ id: 'am', text: `Your focus is ${(am / Math.max(1, pm)).toFixed(1)}× stronger before noon.`, change: 'Put the hardest task of the day before 12:00.', weight: am / Math.max(1, pm) })
    else if (pm >= am * 1.8) out.push({ id: 'pm', text: `You get ${(pm / Math.max(1, am)).toFixed(1)}× more focus done after noon.`, change: 'Keep mornings for light tasks; book deep work after lunch.', weight: pm / Math.max(1, am) })
  }
  // 2) A weekday afternoon you lose (no focus after 15:00 on that day, most weeks).
  const weeks = 8
  const lateByDow = Array(7).fill(0)
  const daysWithAny = new Set(ses.map((s) => s.day))
  for (const s of ses) if (hourOf(s.startedAt) >= 15) lateByDow[dow(s.day)] += s.minutes
  const totalLate = lateByDow.reduce((t, x) => t + x, 0)
  if (totalLate >= 240 && daysWithAny.size >= 10) {
    const weekdays = [1, 2, 3, 4, 5]
    const avgLate = totalLate / 7
    const lost = weekdays.filter((d) => lateByDow[d] < avgLate * 0.25)
    if (lost.length && lost.length <= 3) out.push({ id: 'lost-pm', text: `You lose afternoons after 15:00 on ${lost.map((d) => DOW[d]).join('/')}.`, change: `Book one 50-min block at 15:00 on ${lost.map((d) => DOW[d]).join(' and ')}, with the task named.`, weight: 2.2 })
  }
  // 3) Weekend dip.
  const perDow = Array(7).fill(0)
  for (const s of ses) perDow[dow(s.day)] += s.minutes
  const wk = (perDow[1] + perDow[2] + perDow[3] + perDow[4] + perDow[5]) / 5
  const we = (perDow[0] + perDow[6]) / 2
  if (wk >= 60 && we < wk * 0.3) out.push({ id: 'weekend', text: `Weekends drop to ${Math.round((we / Math.max(1, wk)) * 100)}% of a weekday's focus.`, change: 'One 50-min block Saturday morning keeps the streak alive without killing the weekend.', weight: 1.6 })
  // 4) Sleep before exams / short nights → less focus.
  const nights = i.sleep
    .filter((s) => s.day >= from)
    .map((s) => {
      const b = minsOf(s.bed)
      const w = minsOf(s.wake)
      return b != null && w != null ? { day: s.day, min: sleepMin(b, w) } : null
    })
    .filter((x): x is { day: string; min: number } => !!x && x.min >= 180 && x.min <= 720)
  if (nights.length >= 6) {
    const avgSleep = nights.reduce((t, n) => t + n.min, 0) / nights.length
    const examDays = new Set((i.exams ?? []).flatMap((d) => [d, addDays(d, -1)]))
    const before = nights.filter((n) => examDays.has(n.day))
    if (before.length >= 1) {
      const b = before.reduce((t, n) => t + n.min, 0) / before.length
      if (avgSleep - b >= 25) out.push({ id: 'exam-sleep', text: `You sleep ${Math.round(avgSleep - b)} min less before exams.`, change: 'Two nights before an exam: lights out at your normal time, review in the morning instead.', weight: 2 })
    }
    const focusOn = (day: string) => ses.filter((s) => s.day === day).reduce((t, s) => t + s.minutes, 0)
    const short = nights.filter((n) => n.min < 390)
    const long = nights.filter((n) => n.min >= 420)
    if (short.length >= 3 && long.length >= 3) {
      const fs = short.reduce((t, n) => t + focusOn(n.day), 0) / short.length
      const fl = long.reduce((t, n) => t + focusOn(n.day), 0) / long.length
      if (fl >= 30 && fl >= fs * 1.4) out.push({ id: 'sleep-focus', text: `After 7h+ of sleep you focus ${Math.round(fl)} min, after a short night only ${Math.round(fs)}.`, change: 'Protect the bedtime: it buys you about an extra focus block the next day.', weight: fl / Math.max(1, fs) })
    }
  }
  // 5) Training days vs focus.
  const wset = new Set(i.workouts.filter((d) => d >= from))
  const days = [...new Set([...ses.map((s) => s.day), ...wset])]
  if (wset.size >= 4 && days.length >= 14) {
    const f = (d: string) => ses.filter((s) => s.day === d).reduce((t, s) => t + s.minutes, 0)
    const on = [...wset].map(f)
    const off = days.filter((d) => !wset.has(d)).map(f)
    const a = on.reduce((t, x) => t + x, 0) / Math.max(1, on.length)
    const b = off.reduce((t, x) => t + x, 0) / Math.max(1, off.length)
    if (a >= b * 1.3 && a >= 40) out.push({ id: 'sport-focus', text: `On training days you focus ${Math.round(a)} min vs ${Math.round(b)} on other days.`, change: 'Train before your hardest study day, even 20 minutes.', weight: a / Math.max(1, b) })
  }
  // 6) Blocks you skip at a certain hour.
  const bl = (i.blocks ?? []).filter((b) => b.day >= from)
  if (bl.length >= 8) {
    const byH = new Map<number, number[]>()
    for (const b of bl) byH.set(hourOf(b.at), [...(byH.get(hourOf(b.at)) ?? []), b.result === 'done' ? 1 : b.result === 'half' ? 0.5 : 0])
    const bad = [...byH.entries()].filter(([, v]) => v.length >= 3 && v.reduce((t, x) => t + x, 0) / v.length < 0.4).sort((a, b) => a[0] - b[0])
    if (bad.length) out.push({ id: 'bad-hour', text: `Blocks at ${bad.map(([h]) => `${String(h).padStart(2, '0')}:00`).join(', ')} mostly don't get done.`, change: 'Stop booking hard work there: a walk, errands or easy tasks fit that hour better.', weight: 1.8 })
  }
  // 7) Mood links (when there are enough check-ins).
  for (const l of moodLinks(i.moods ?? [], i).slice(0, 1)) out.push({ id: `mood-${l.id}`, text: l.text, change: l.change, weight: 1.5 })
  return out.sort((a, b) => b.weight - a.weight).slice(0, 5)
}

// ------------------------------------------------------------------ excuses

export type ExcuseKind = 'tired' | 'busy' | 'sick' | 'forgot' | 'no mood' | 'phone' | 'friends' | 'later'
export interface Excuse {
  at: string
  kind: ExcuseKind
  text: string
}

const EXCUSE_RX: [ExcuseKind, RegExp][] = [
  ['sick', /\b(sick|ill|fever|headache|migraine|cold|flu|bolnav|răcit|racit|ma doare|mă doare|durere)\b/iu],
  ['tired', /\b(tired|exhausted|sleepy|no energy|drained|obosit|somnoros|n-am energie|nu am energie|fără energie|fara energie)\b/iu],
  ['busy', /\b(busy|no time|too much|work(ed)? late|class(es)? all day|ocupat|n-am timp|nu am timp|fără timp|prea mult)\b/iu],
  ['forgot', /\b(forgot|forget|didn'?t remember|am uitat|uitat)\b/iu],
  ['no mood', /\b(lazy|not in the mood|no motivation|don'?t feel like|didn'?t feel like|unmotivated|lene|nu am chef|n-am chef|fără chef|fara chef|nu-mi vine)\b/iu],
  ['phone', /\b(phone|tiktok|youtube|instagram|scroll(ed|ing)?|games?|gaming|netflix|series|telefon)\b/iu],
  ['friends', /\b(friends?|party|went out|guests|prieteni|petrecere|am ieșit|am iesit)\b/iu],
  ['later', /\b(tomorrow|later|next week|mâine|maine|mai târziu|mai tarziu|săptămâna viitoare)\b/iu]
]

/** The kind of excuse in a message, or null when it isn't one. */
export function classifyExcuse(text: string): ExcuseKind | null {
  const t = String(text ?? '')
  // Only messages about NOT doing something.
  if (!/\b(didn'?t|did not|couldn'?t|can'?t|won'?t|not|skip(ped)?|missed|no\b|nu|n-am|n-a|nu am|am sărit|am sarit)\b|\bbecause\b|\bpentru că\b|\bpt ca\b/iu.test(t)) return null
  for (const [k, rx] of EXCUSE_RX) if (rx.test(t)) return k
  return null
}

export function addExcuse(list: Excuse[], text: string, at: string): Excuse[] {
  const kind = classifyExcuse(text)
  if (!kind) return list
  if (list.some((e) => e.at.slice(0, 10) === at.slice(0, 10) && e.kind === kind)) return list
  return [...list, { at, kind, text: String(text).slice(0, 160) }].slice(-120)
}

export interface ExcuseCount {
  kind: ExcuseKind
  n: number
  last: string
}
/** Excuses in the last `days`, most repeated first. */
export function excuseCounts(list: Excuse[], today: string, days = 30): ExcuseCount[] {
  const from = addDays(today, -(days - 1))
  const m = new Map<ExcuseKind, ExcuseCount>()
  for (const e of list) {
    if (e.at.slice(0, 10) < from) continue
    const c = m.get(e.kind) ?? { kind: e.kind, n: 0, last: e.at }
    c.n++
    if (e.at > c.last) c.last = e.at
    m.set(e.kind, c)
  }
  return [...m.values()].sort((a, b) => b.n - a.n || b.last.localeCompare(a.last))
}

const EXCUSE_WORD: Record<ExcuseKind, string> = { tired: '"too tired"', busy: '"no time"', sick: '"sick"', forgot: '"I forgot"', 'no mood': '"not in the mood"', phone: 'the phone', friends: 'going out', later: '"tomorrow"' }
const EXCUSE_FIX: Record<ExcuseKind, string> = {
  tired: 'Do the 10-minute version, then decide.',
  busy: 'Book 25 minutes now so it has a slot.',
  sick: "Rest is fine, but say when you're back on.",
  forgot: 'Set a check-in at the time you will do it.',
  'no mood': 'Start for 5 minutes; mood follows action.',
  phone: 'Phone in another room for one block.',
  friends: 'Do the block before you go out.',
  later: 'Pick the exact time now.'
}

/** Ben's kind call-out of a repeat ("3rd time this month it's 'too tired'"), or null. */
export function excuseCallout(list: Excuse[], kind: ExcuseKind, today: string): string | null {
  const c = excuseCounts(list, today).find((x) => x.kind === kind)
  if (!c || c.n < 2) return null
  const nth = c.n === 2 ? '2nd' : c.n === 3 ? '3rd' : `${c.n}th`
  return `That's the ${nth} time this month it's ${EXCUSE_WORD[kind]}. ${EXCUSE_FIX[kind]}`
}

/** One line for Ben's prompt. */
export function excuseLine(list: Excuse[], today: string): string {
  const c = excuseCounts(list, today)
  return c.length ? `Excuses he gave in the last 30 days: ${c.map((x) => `${EXCUSE_WORD[x.kind]} ×${x.n}`).join(', ')}. Name a repeat kindly, with the count.` : ''
}

// --------------------------------------------------------------------- mood

export type MoodSlot = 'noon' | 'evening'
export interface MoodEntry {
  day: string
  slot: MoodSlot
  /** 1 (awful) .. 5 (great). */
  mood: number
  at: string
}
export const MOOD_FACES = ['😫', '😕', '😐', '🙂', '😄'] as const
export const moodFace = (m: number) => MOOD_FACES[Math.max(1, Math.min(5, Math.round(m))) - 1]

export function addMood(list: MoodEntry[], e: MoodEntry): MoodEntry[] {
  const mood = Math.max(1, Math.min(5, Math.round(e.mood)))
  return [...list.filter((x) => !(x.day === e.day && x.slot === e.slot)), { ...e, mood }].sort((a, b) => a.at.localeCompare(b.at)).slice(-240)
}

/** Which check-in is due now (12–15 noon, 19–23 evening), if not done today. */
export function moodDue(list: MoodEntry[], now: Date): MoodSlot | null {
  const h = now.getHours()
  const day = now.toLocaleDateString('sv-SE')
  const slot: MoodSlot | null = h >= 12 && h < 15 ? 'noon' : h >= 19 && h < 23 ? 'evening' : null
  return slot && !list.some((x) => x.day === day && x.slot === slot) ? slot : null
}

export interface MoodLink {
  id: string
  text: string
  change: string
  diff: number
}

/** How mood moves with sleep, training and spending (only with enough days). */
export function moodLinks(moods: MoodEntry[], i: Pick<PatternInput, 'sleep' | 'workouts' | 'spending'>): MoodLink[] {
  const byDay = new Map<string, number[]>()
  for (const m of moods) byDay.set(m.day, [...(byDay.get(m.day) ?? []), m.mood])
  const dayMood = new Map([...byDay.entries()].map(([d, v]) => [d, v.reduce((t, x) => t + x, 0) / v.length]))
  if (dayMood.size < 6) return []
  const out: MoodLink[] = []
  const split = (id: string, yes: (d: string) => boolean | null, text: (a: number, b: number) => string, change: string | ((a: number, b: number) => string)) => {
    const a: number[] = []
    const b: number[] = []
    for (const [d, m] of dayMood) {
      const y = yes(d)
      if (y === null) continue
      ;(y ? a : b).push(m)
    }
    if (a.length < 3 || b.length < 3) return
    const ma = a.reduce((t, x) => t + x, 0) / a.length
    const mb = b.reduce((t, x) => t + x, 0) / b.length
    if (Math.abs(ma - mb) >= 0.5) out.push({ id, text: text(ma, mb), change: typeof change === 'string' ? change : change(ma, mb), diff: Math.abs(ma - mb) })
  }
  const w = new Set(i.workouts)
  split('sport', (d) => w.has(d), (a, b) => `Mood ${a.toFixed(1)} on training days vs ${b.toFixed(1)} without.`, 'When the day feels heavy, train first: it lifts you.')
  const night = new Map(
    i.sleep.map((s) => {
      const b = minsOf(s.bed)
      const wk = minsOf(s.wake)
      return [s.day, b != null && wk != null ? sleepMin(b, wk) : null] as const
    })
  )
  split('sleep', (d) => (night.get(d) == null ? null : (night.get(d) as number) >= 420), (a, b) => `Mood ${a.toFixed(1)} after 7h+ of sleep vs ${b.toFixed(1)} after less.`, 'A bad mood is often a short night: go to bed on time tonight.')
  if (i.spending?.length) {
    const spent = new Map<string, number>()
    for (const s of i.spending) spent.set(s.day, (spent.get(s.day) ?? 0) + s.bani)
    const vals = [...spent.values()].sort((a, b) => a - b)
    const high = vals[Math.floor(vals.length * 0.75)] ?? Infinity
    split('spend', (d) => (spent.get(d) ?? 0) >= high && high > 0, (a, b) => `On big spending days your mood is ${a.toFixed(1)} vs ${b.toFixed(1)}.`, (a, b) => a < b ? 'Low days → impulse buys. Wait a day before buying when you feel down.' : 'Spending lifts you only for the day; plan treats instead.')
  }
  return out.sort((a, b) => b.diff - a.diff)
}

export function moodLine(list: MoodEntry[], today: string): string {
  const recent = list.filter((m) => m.day >= addDays(today, -6))
  if (!recent.length) return ''
  const avg = recent.reduce((t, m) => t + m.mood, 0) / recent.length
  const todayM = list.filter((m) => m.day === today).map((m) => `${m.slot} ${moodFace(m.mood)} ${m.mood}/5`)
  return `Mood check-ins: last 7 days average ${avg.toFixed(1)}/5${todayM.length ? `; today ${todayM.join(', ')}` : ''}.`
}

// ------------------------------------------------------------------ profile

export interface ProfileInput {
  today: string
  aboutMe: string
  goals: { title: string; deadline?: string | null; weekly?: string | null }[]
  exams: { title: string; deadline: string }[]
  people: { name: string; note: string }[]
  works: string[]
  fails: string[]
  patterns: Pattern[]
  energy: EnergyMap
  excuses: ExcuseCount[]
  moodAvg: number | null
}

export const PROFILE_NOTE = "Ben's profile of you"
const KEEP_MARK = '## Your corrections'

/**
 * The profile note Ben keeps current: goals, exams, people, what works, what
 * fails, patterns, best hours, excuses. A "Your corrections" section at the end
 * is yours: it is kept as you wrote it on every refresh (and Ben reads it).
 */
export function profileNote(p: ProfileInput, previousBody = ''): string {
  const keep = previousBody.includes(KEEP_MARK) ? previousBody.slice(previousBody.indexOf(KEEP_MARK)) : `${KEEP_MARK}\n\nWrite here anything above that's wrong or missing. Ben keeps this part and reads it.\n\n- \n`
  const left = (d: string) => Math.round((Date.parse(`${d}T12:00:00Z`) - Date.parse(`${p.today}T12:00:00Z`)) / 86400000)
  const list = (xs: string[], empty: string) => (xs.length ? xs.map((x) => `- ${x}`).join('\n') : `- ${empty}`)
  return [
    `# ${PROFILE_NOTE}`,
    '',
    `Ben updates this himself (last ${p.today}). Edit the last section to correct him.`,
    '',
    '## Goals',
    list(p.goals.map((g) => `${g.title}${g.deadline ? ` (by ${g.deadline}, ${left(g.deadline)} days)` : ''}${g.weekly ? ` · ${g.weekly} a week` : ''}`), 'none yet: tell Ben one with a date'),
    '',
    '## Exams & deadlines',
    list(p.exams.filter((e) => left(e.deadline) >= 0).sort((a, b) => a.deadline.localeCompare(b.deadline)).map((e) => `${e.title}: ${e.deadline} (${left(e.deadline)} days)`), 'none coming up'),
    '',
    '## People',
    list(p.people.map((x) => `${x.name}: ${x.note}`), 'none yet'),
    '',
    '## Best hours (energy map)',
    p.energy.ready ? `- Best: ${hoursText(p.energy.best)}${p.energy.worst.length ? `\n- Weakest: ${hoursText(p.energy.worst)}` : ''}` : '- Not enough focus data yet (about a week of sessions).',
    '',
    '## What works',
    list(p.works, 'Ben is still learning'),
    '',
    "## What doesn't",
    list(p.fails, 'Ben is still learning'),
    '',
    '## Patterns',
    list(p.patterns.map((x) => `${x.text} → ${x.change}`), 'none strong enough yet'),
    '',
    '## Excuses (30 days)',
    list(p.excuses.map((e) => `${EXCUSE_WORD[e.kind]} ×${e.n}`), 'none: nice'),
    p.moodAvg != null ? `\n## Mood\n- 7-day average ${p.moodAvg.toFixed(1)}/5` : '',
    '',
    keep.replace(/\n+$/, ''),
    ''
  ].join('\n')
}

/** What you wrote in "Your corrections" (for Ben's prompt). */
export function profileCorrections(body: string): string {
  if (!body.includes(KEEP_MARK)) return ''
  return body
    .slice(body.indexOf(KEEP_MARK) + KEEP_MARK.length)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^-\s*\S/.test(l))
    .join('\n')
}
