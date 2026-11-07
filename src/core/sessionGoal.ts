// DX10: a goal for each focus session and an honest verdict at the end.
// When a timer starts, one line: "What exactly will be done at the end?".
// When it ends: Done / Half / Not. The stats then count finished work, not
// only minutes, and Ben learns which kinds of sessions you finish (each
// verdict is also a block result, the same record benLearn.ts reads).
// The verdict never pays or takes points: the timer's own points stay as
// they are (they pay for the minutes you really did). Pure and tested.
import { addDays } from './dates'
import { kindOf, type TaskKind } from './benLearn'

export type Verdict = 'done' | 'half' | 'not'
export const VERDICTS: { id: Verdict; label: string; icon: string }[] = [
  { id: 'done', label: 'Done', icon: '✅' },
  { id: 'half', label: 'Half', icon: '◐' },
  { id: 'not', label: 'Not', icon: '✗' }
]

export interface SessionRec {
  /** The timer's start (ISO): one record per session. */
  id: string
  day: string
  subject: string
  goal: string
  kind: TaskKind
  minutes?: number
  verdict?: Verdict
  endedAt?: string
}
export const SESSIONS_MAX = 300

const clip = (s: unknown, n: number) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n)
const isVerdict = (v: unknown): v is Verdict => v === 'done' || v === 'half' || v === 'not'

export function cleanSessions(raw: unknown): SessionRec[] {
  return (Array.isArray(raw) ? raw : [])
    .filter((x) => x && typeof x.id === 'string' && typeof x.day === 'string')
    .map((x): SessionRec => ({
      id: x.id.slice(0, 40),
      day: x.day.slice(0, 10),
      subject: clip(x.subject, 60),
      goal: clip(x.goal, 120),
      kind: kindOf(String(x.subject ?? '') + ' ' + String(x.goal ?? '')),
      ...(typeof x.minutes === 'number' && Number.isFinite(x.minutes) ? { minutes: Math.max(0, Math.round(x.minutes)) } : {}),
      ...(isVerdict(x.verdict) ? { verdict: x.verdict } : {}),
      ...(typeof x.endedAt === 'string' ? { endedAt: x.endedAt } : {})
    }))
    .slice(-SESSIONS_MAX)
}

/** A one-line goal, tidied (empty: no goal). */
export const cleanGoal = (t: string) => clip(t, 120)

/** The goal for a session that just started (a second call with the same id only changes the goal). */
export function setGoal(list: SessionRec[], o: { id: string; day: string; subject: string; goal: string }): SessionRec[] {
  const goal = cleanGoal(o.goal)
  const i = list.findIndex((x) => x.id === o.id)
  if (i >= 0) return list.map((x, k) => (k === i ? { ...x, goal } : x))
  return [...list, { id: o.id, day: o.day, subject: clip(o.subject, 60), goal, kind: kindOf(`${o.subject} ${goal}`) }].slice(-SESSIONS_MAX)
}

/** The verdict when the timer ends (a session with no goal gets a record too). */
export function setVerdict(list: SessionRec[], o: { id: string; day: string; subject: string; verdict: Verdict; minutes: number; endedAt: string }): SessionRec[] {
  const i = list.findIndex((x) => x.id === o.id)
  const base: SessionRec = i >= 0 ? list[i] : { id: o.id, day: o.day, subject: clip(o.subject, 60), goal: '', kind: kindOf(o.subject) }
  const rec: SessionRec = { ...base, verdict: o.verdict, minutes: Math.max(0, Math.round(o.minutes)), endedAt: o.endedAt }
  return i >= 0 ? list.map((x, k) => (k === i ? rec : x)) : [...list, rec].slice(-SESSIONS_MAX)
}

/** The same answer in the words benLearn's block results use. */
export const blockResultOf = (v: Verdict): 'done' | 'half' | 'no' => (v === 'not' ? 'no' : v)

export interface VerdictStats {
  sessions: number
  done: number
  half: number
  not: number
  /** Finished work: a Done counts 1, a Half ½ (0–1). */
  finished: number
  minutes: number
  /** Minutes in sessions that ended Done. */
  doneMinutes: number
  byKind: { kind: TaskKind; n: number; rate: number }[]
}

/** The last `days` days of answered sessions. */
export function verdictStats(list: SessionRec[], today: string, days = 7): VerdictStats {
  const from = addDays(today, -(days - 1))
  const rows = list.filter((x) => x.verdict && x.day >= from && x.day <= today)
  const n = (v: Verdict) => rows.filter((x) => x.verdict === v).length
  const done = n('done')
  const half = n('half')
  const kinds = new Map<TaskKind, { n: number; score: number }>()
  for (const r of rows) {
    const k = kinds.get(r.kind) ?? { n: 0, score: 0 }
    k.n++
    k.score += r.verdict === 'done' ? 1 : r.verdict === 'half' ? 0.5 : 0
    kinds.set(r.kind, k)
  }
  return {
    sessions: rows.length,
    done,
    half,
    not: n('not'),
    finished: rows.length ? (done + half / 2) / rows.length : 0,
    minutes: rows.reduce((t, r) => t + (r.minutes ?? 0), 0),
    doneMinutes: rows.filter((r) => r.verdict === 'done').reduce((t, r) => t + (r.minutes ?? 0), 0),
    byKind: [...kinds.entries()].map(([kind, v]) => ({ kind, n: v.n, rate: v.score / v.n })).sort((a, b) => b.n - a.n)
  }
}

const KIND_WORD: Record<TaskKind, string> = { code: 'coding', study: 'study', write: 'writing', read: 'reading', chores: 'chores', sport: 'workout', admin: 'admin', other: 'other' }

/** "4 of 6 sessions finished (2 half)" for the stats card. */
export function statsLine(s: VerdictStats): string {
  if (!s.sessions) return 'No answered sessions yet: set a goal when a timer starts, answer Done / Half / Not at the end.'
  return `${s.done} of ${s.sessions} sessions finished${s.half ? ` (${s.half} half)` : ''} · ${Math.round(s.finished * 100)}% finished work`
}

/** One line for Ben: which kinds of sessions you finish (kinds with 3+ answers), or null. */
export function learnLine(s: VerdictStats): string | null {
  const k = s.byKind.filter((x) => x.n >= 3)
  if (!k.length) return null
  const best = [...k].sort((a, b) => b.rate - a.rate)
  const parts = best.slice(0, 3).map((x) => `${KIND_WORD[x.kind]} ${Math.round(x.rate * 100)}%`)
  return `Sessions he finishes (7 days, done = 100%, half = 50%): ${parts.join(', ')}`
}

/** The goal box's example for a subject. */
export function goalHint(subject: string): string {
  const k = kindOf(subject)
  if (k === 'code') return 'e.g. the login form saves and shows an error'
  if (k === 'write') return 'e.g. the intro paragraph, 150 words'
  if (k === 'study') return 'e.g. exercises 1–5 of chapter 3'
  if (k === 'read') return 'e.g. chapter 4, with 3 notes'
  return 'e.g. what will exist at the end that doesn’t now'
}

/** The words after the verdict. */
export function verdictSaid(v: Verdict, goal: string): string {
  const g = goal ? `“${clip(goal, 60)}”` : 'it'
  if (v === 'done') return `✅ Done: ${g}`
  if (v === 'half') return `◐ Half of ${g}. Next time, a smaller goal or a longer block.`
  return `✗ Not this time. Noted, no points lost.`
}
