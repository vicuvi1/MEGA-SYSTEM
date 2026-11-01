// The coach's long-term mind, pure and tested:
// - goals it tracks with you (a deadline and a weekly target),
// - what works for you and what doesn't (it learns from what happened),
// - patterns it finds in your own history ("after a late night you focus
//   40% less"), so advice is about you, not people in general;
// - a short sleep diary and the week ahead, in plain lines for the prompt.
import { addDays } from './dates'

export interface MindGoal {
  title: string
  /** YYYY-MM-DD or '' (no deadline). */
  deadline: string
  /** "10h focus", "3 workouts", "save 2000 lei" ('' = none). */
  weekly: string
  at: string
}

export interface CoachMind {
  goals: MindGoal[]
  works: { t: string; at: string }[]
  fails: { t: string; at: string }[]
  patterns: { t: string; at: string }[]
}

export const EMPTY_MIND: CoachMind = { goals: [], works: [], fails: [], patterns: [] }

const MAX = { goals: 8, works: 12, fails: 12, patterns: 10 }
const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const clip = (t: string, n = 160) => String(t ?? '').trim().slice(0, n)

export function cleanMind(m: any): CoachMind {
  const list = (x: any) => (Array.isArray(x) ? x.filter((e) => e && typeof e.t === 'string').map((e) => ({ t: clip(e.t), at: String(e.at ?? '') })) : [])
  return {
    goals: Array.isArray(m?.goals) ? m.goals.filter((g: any) => g && typeof g.title === 'string').map((g: any) => ({ title: clip(g.title, 120), deadline: /^\d{4}-\d{2}-\d{2}$/.test(g.deadline) ? g.deadline : '', weekly: clip(g.weekly ?? '', 80), at: String(g.at ?? '') })) : [],
    works: list(m?.works),
    fails: list(m?.fails),
    patterns: list(m?.patterns)
  }
}

export type MindOp =
  | { kind: 'aim'; title: string; deadline: string; weekly: string }
  | { kind: 'aimdone'; title: string }
  | { kind: 'works' | 'fails' | 'pattern'; text: string }

/** Reads "aim: …", "aimdone: …", "works: …", "fails: …", "pattern: …" (the coach's memory actions). */
export function readMindOp(line: string): MindOp | null {
  const m = /^\s*(aim|aimdone|works|fails|pattern)\s*:\s*([\s\S]+)$/i.exec(line)
  if (!m) return null
  const kind = m[1].toLowerCase()
  const arg = m[2].trim()
  if (!arg) return null
  if (kind === 'aim') {
    const [title, deadline = '', weekly = ''] = arg.split('|').map((x) => x.trim())
    if (!title) return null
    return { kind: 'aim', title: clip(title, 120), deadline: /^\d{4}-\d{2}-\d{2}$/.test(deadline) ? deadline : '', weekly: clip(weekly.replace(/^-$/, ''), 80) }
  }
  if (kind === 'aimdone') return { kind: 'aimdone', title: clip(arg, 120) }
  return { kind: kind as 'works' | 'fails' | 'pattern', text: clip(arg) }
}

const sameIdea = (a: string, b: string) => {
  const x = norm(a)
  const y = norm(b)
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x))
}

/** Applies one memory change; the newest version of an idea replaces the old one. */
export function applyMind(mind: CoachMind, op: MindOp, today: string): { mind: CoachMind; line: string } {
  const m = cleanMind(mind)
  if (op.kind === 'aim') {
    const goals = m.goals.filter((g) => !sameIdea(g.title, op.title))
    goals.push({ title: op.title, deadline: op.deadline, weekly: op.weekly, at: today })
    return { mind: { ...m, goals: goals.slice(-MAX.goals) }, line: `🎯 Tracking: ${op.title}${op.deadline ? ` by ${op.deadline}` : ''}${op.weekly ? ` · ${op.weekly}/week` : ''}` }
  }
  if (op.kind === 'aimdone') {
    const hit = m.goals.find((g) => sameIdea(g.title, op.title))
    if (!hit) return { mind: m, line: '' }
    return { mind: { ...m, goals: m.goals.filter((g) => g !== hit) }, line: `🏁 Goal closed: ${hit.title}` }
  }
  const key = op.kind === 'pattern' ? 'patterns' : op.kind
  const list = m[key].filter((x) => !sameIdea(x.t, op.text))
  // Something that works can't also be on the "doesn't work" list.
  const other = op.kind === 'works' ? 'fails' : op.kind === 'fails' ? 'works' : null
  const next = { ...m, [key]: [...list, { t: op.text, at: today }].slice(-MAX[key]) } as CoachMind
  if (other) next[other] = next[other].filter((x) => !sameIdea(x.t, op.text))
  const label = op.kind === 'works' ? '🧠 Noted what works' : op.kind === 'fails' ? "🧠 Noted what doesn't work" : '🧠 Noted a pattern'
  return { mind: next, line: `${label}: ${op.text}` }
}

const daysTo = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000)

/** The mind as prompt lines. */
export function mindText(m: CoachMind, today: string): string {
  const out: string[] = []
  if (m.goals.length)
    out.push(
      `Goals you track with him:\n${m.goals
        .map((g) => {
          const left = g.deadline ? daysTo(today, g.deadline) : null
          return `- ${g.title}${g.deadline ? ` · due ${g.deadline} (${left! < 0 ? `${-left!} days late` : `${left} days left`})` : ''}${g.weekly ? ` · weekly target ${g.weekly}` : ''}`
        })
        .join('\n')}`
    )
  if (m.works.length) out.push(`What works for him:\n${m.works.map((x) => `- ${x.t}`).join('\n')}`)
  if (m.fails.length) out.push(`What doesn't work:\n${m.fails.map((x) => `- ${x.t}`).join('\n')}`)
  if (m.patterns.length) out.push(`Patterns you noticed:\n${m.patterns.map((x) => `- ${x.t}`).join('\n')}`)
  return out.join('\n')
}

// ---- Patterns from his own history -------------------------------------

export interface PatternInput {
  today: string
  /** Minutes of focus per session (days repeat). */
  focus: { day: string; minutes: number }[]
  /** Sleep log per morning: wake on time, the bedtime of the night before (on time?), quality 1–5. */
  sleep: { day: string; onTime: boolean; bedOnTime: boolean | null; quality: number | null }[]
  workouts: { day: string }[]
  /** Everyday spending in bani, per expense. */
  spending: { day: string; bani: number }[] | null
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const wd = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay()
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

/**
 * What his last 8 weeks say: focus after a late night vs an on-time one,
 * after a late wake-up, on workout days, his best and worst weekday, and
 * weekend vs weekday spending. Only differences that are big (≥25%) and
 * seen enough (≥3 days each side) count.
 */
export function findPatterns(p: PatternInput, weeks = 8): string[] {
  const from = addDays(p.today, -weeks * 7)
  const days: string[] = []
  for (let d = from; d < p.today; d = addDays(d, 1)) days.push(d)
  const focusBy = new Map<string, number>()
  for (const f of p.focus) if (f.day >= from && f.day < p.today) focusBy.set(f.day, (focusBy.get(f.day) ?? 0) + f.minutes)
  // Only days since he started using focus at all.
  const firstFocus = [...focusBy.keys()].sort()[0]
  const active = firstFocus ? days.filter((d) => d >= firstFocus) : []
  const fm = (d: string) => focusBy.get(d) ?? 0
  const out: string[] = []
  const compare = (label: string, a: string[], b: string[], aName: string, bName: string) => {
    if (a.length < 3 || b.length < 3) return
    const x = avg(a.map(fm))
    const y = avg(b.map(fm))
    if (Math.max(x, y) < 15) return
    const diff = (x - y) / Math.max(x, y)
    if (Math.abs(diff) < 0.25) return
    out.push(`${label}: ${Math.round(x)} min focus on ${aName} vs ${Math.round(y)} min on ${bName} (${a.length} vs ${b.length} days).`)
  }
  const sleep = new Map(p.sleep.map((s) => [s.day, s]))
  const lateNight = active.filter((d) => sleep.get(d)?.bedOnTime === false)
  const goodNight = active.filter((d) => sleep.get(d)?.bedOnTime === true)
  compare('After a late night', lateNight, goodNight, 'days after a late bedtime', 'days after an on-time one')
  const lateUp = active.filter((d) => sleep.get(d)?.onTime === false)
  const upOn = active.filter((d) => sleep.get(d)?.onTime === true)
  compare('Late wake-ups', lateUp, upOn, 'late-wake days', 'on-time days')
  const wset = new Set(p.workouts.map((w) => w.day))
  compare('Training', active.filter((d) => wset.has(d)), active.filter((d) => !wset.has(d)), 'workout days', 'rest days')
  const poor = active.filter((d) => (sleep.get(d)?.quality ?? 0) > 0 && sleep.get(d)!.quality! <= 2)
  const good = active.filter((d) => (sleep.get(d)?.quality ?? 0) >= 4)
  compare('Sleep quality', poor, good, 'days after poor sleep (1–2/5)', 'after good sleep (4–5/5)')
  // Best and worst weekday for focus (needs 3+ weeks of data).
  if (active.length >= 21) {
    const by = WEEKDAYS.map((_, i) => avg(active.filter((d) => wd(d) === i).map(fm)))
    const best = by.indexOf(Math.max(...by))
    const worst = by.indexOf(Math.min(...by))
    if (by[best] >= 20 && by[best] - by[worst] >= Math.max(20, by[best] * 0.4)) out.push(`Best focus day: ${WEEKDAYS[best]} (${Math.round(by[best])} min avg); weakest: ${WEEKDAYS[worst]} (${Math.round(by[worst])} min).`)
  }
  if (p.spending?.length) {
    const spend = new Map<string, number>()
    for (const s of p.spending) if (s.day >= from && s.day < p.today) spend.set(s.day, (spend.get(s.day) ?? 0) + s.bani)
    const firstSpend = [...spend.keys()].sort()[0]
    const sd = firstSpend ? days.filter((d) => d >= firstSpend) : []
    const we = sd.filter((d) => wd(d) === 0 || wd(d) === 6).map((d) => spend.get(d) ?? 0)
    const wk = sd.filter((d) => wd(d) > 0 && wd(d) < 6).map((d) => spend.get(d) ?? 0)
    if (we.length >= 4 && wk.length >= 10) {
      const a = avg(we)
      const b = avg(wk)
      if (Math.max(a, b) >= 5000 && Math.abs(a - b) / Math.max(a, b) >= 0.3) out.push(`Spending: ${Math.round(a / 100)} lei/day on weekends vs ${Math.round(b / 100)} lei/day on weekdays.`)
    }
  }
  return out
}

/** The last nights in one line each: "10-30 bed 00:40 (late) → up 07:20 (late) · 3/5". */
export function sleepDiary(logs: { day: string; wakeTime: string; onTime: boolean; bedTime: string | null; bedOnTime: boolean | null; quality: number | null }[], today: string, nights = 7): string {
  const from = addDays(today, -nights)
  const rows = logs.filter((l) => l.day > from && l.day <= today).sort((a, b) => (a.day < b.day ? -1 : 1))
  if (!rows.length) return 'Sleep diary: nothing logged in the last week.'
  return `Sleep diary (bedtime is the night before): ${rows
    .map((l) => `${l.day.slice(5)} ${l.bedTime ? `bed ${l.bedTime}${l.bedOnTime === false ? ' (late)' : ''} → ` : ''}up ${l.wakeTime}${l.onTime ? '' : ' (late)'}${l.quality ? ` · ${l.quality}/5` : ''}`)
    .join('; ')}.`
}

/** The week ahead from calendar events: per day, how many blocks and busy hours. */
export function weekAhead(events: { start: string; end: string; allDay?: boolean; title: string }[], today: string, days = 7): string {
  const local = (iso: string) => {
    const d = new Date(iso)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  const parts: string[] = []
  for (let i = 1; i <= days; i++) {
    const day = addDays(today, i)
    const list = events.filter((e) => !e.allDay && local(e.start) === day)
    const allDay = events.filter((e) => e.allDay && String(e.start).slice(0, 10) === day)
    const min = list.reduce((t, e) => t + Math.max(0, (Date.parse(e.end) - Date.parse(e.start)) / 60000), 0)
    const name = WEEKDAYS[wd(day)].slice(0, 3)
    parts.push(list.length || allDay.length ? `${name} ${day.slice(5)}: ${list.length} blocks, ${Math.round(min / 6) / 10}h busy${allDay.length ? ` (${allDay.map((e) => e.title).join(', ')})` : ''}` : `${name} ${day.slice(5)}: free`)
  }
  return `Next ${days} days: ${parts.join('; ')}.`
}

/** Focus minutes per subject since `from` (for "where his study time goes"). */
export function focusBySubject(sessions: { day: string; subject: string; minutes: number }[], from: string): string {
  const by = new Map<string, number>()
  for (const s of sessions) if (s.day >= from) by.set(s.subject, (by.get(s.subject) ?? 0) + s.minutes)
  if (!by.size) return ''
  const hm = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`)
  return [...by].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([s, m]) => `${s} ${hm(m)}`).join(', ')
}
