// ME2 + ME3: Ben learns your real rhythm. Pure and tested (benLearn.test.ts).
//
// From your focus log, the plan blocks you were given and what you said when
// a block ended (done / half / no), he learns:
// - per kind of task, how long it really takes compared with the plan
//   (a multiplier: essays take you 1.4× what was planned, quick admin 0.8×);
// - your best focus hours (when focus goes well);
// - the hours you usually skip (blocks there end with "no").
// The day planner uses these for its estimates and for where hard work goes.
// Your own words always win: a duration you told Ben ("takes 40 min") beats
// anything learned.
//
// ME3: after a long shift (4 h or more) the first hour after it is "Quick
// tasks only" too: no deep work right after work.

import { energyMap, type FocusRow } from './benKnows'
import { estimateMinutes, type PlanTask } from './dayPacker'
import { normalize, similarity } from './benNormalize'
import type { WorkToday } from './lifeFit'

export type TaskKind = 'study' | 'code' | 'write' | 'read' | 'chores' | 'sport' | 'admin' | 'other'

const KINDS: [TaskKind, RegExp][] = [
  ['code', /\b(code|coding|program|programming|implement|refactor|build|debug|rust|app|dev|ctf|bug|fix)\w*/],
  ['write', /\b(write|essay|report|thesis|eseu|referat|draft|article|cv|resume)\w*/],
  ['study', /\b(study|learn|revise|exam|homework|course|lecture|lab|laborator|math|algebra|invat|учить|homework|seminar|practice)\w*/],
  ['read', /\b(read|book|chapter|citit|carte|читать)\w*/],
  ['chores', /\b(clean|curata|tidy|laundry|dishes|wash|cook|shopping|groceries|room|camera|убрать|стирка)\w*/],
  ['sport', /\b(gym|sport|workout|run|training|sala|stretch|antrenament|спорт|тренировка)\w*/],
  ['admin', /\b(email|mail|call|pay|book|send|reply|form|bank|apply|sign|print|submit|renew)\w*/]
]

/** What kind of task a title is, from its words. */
export function kindOf(title: string): TaskKind {
  const t = normalize(title)
  for (const [k, re] of KINDS) if (re.test(t)) return k
  return 'other'
}

export interface PlannedRow {
  day: string
  title: string
  /** "HH:MM". */
  start: string
  minutes: number
}
export interface SessionRow extends FocusRow {
  subject: string
}
export interface BlockResult {
  day: string
  at: string
  title: string
  result: 'done' | 'half' | 'no'
}

export interface Rhythm {
  /** Real time ÷ planned time per kind (only kinds with at least 3 samples), 0.6–2.0. */
  mult: Partial<Record<TaskKind, number>>
  /** Samples behind each multiplier. */
  n: Partial<Record<TaskKind, number>>
  /** Best focus hours (start hours), best first. */
  best: number[]
  /** Hours where blocks usually end with "no" (skipped). */
  skip: number[]
  /** Enough data to use any of it. */
  ready: boolean
}

export const EMPTY_RHYTHM: Rhythm = { mult: {}, n: {}, best: [], skip: [], ready: false }

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))

/**
 * Learns from past days: each planned block is matched with the focus you
 * really logged that day for it (same words, or the same kind of task, near
 * its time). A block you never started teaches nothing about length (that is
 * a skip, counted separately).
 */
export function learnRhythm(i: { planned: PlannedRow[]; sessions: SessionRow[]; results?: BlockResult[] }): Rhythm {
  const ratios = new Map<TaskKind, number[]>()
  const used = new Set<SessionRow>()
  for (const b of i.planned) {
    if (!(b.minutes >= 10)) continue
    const kind = kindOf(b.title)
    const sameDay = i.sessions.filter((s) => s.day === b.day && !used.has(s))
    const fits = sameDay.filter((s) => similarity(s.subject, b.title) >= 0.6 || (kind !== 'other' && kindOf(s.subject) === kind && Math.abs(new Date(s.startedAt).getHours() * 60 + new Date(s.startedAt).getMinutes() - toMin(b.start)) <= 120))
    if (!fits.length) continue
    for (const s of fits) used.add(s)
    const real = fits.reduce((t, s) => t + s.minutes, 0)
    ratios.set(kind, [...(ratios.get(kind) ?? []), real / b.minutes])
  }
  const mult: Rhythm['mult'] = {}
  const n: Rhythm['n'] = {}
  for (const [k, xs] of ratios) {
    if (xs.length < 3) continue
    mult[k] = Math.round(Math.max(0.6, Math.min(2, median(xs))) * 100) / 100
    n[k] = xs.length
  }
  const results = i.results ?? []
  const energy = energyMap(i.sessions, [], results.map((r) => ({ at: r.at, result: r.result })))
  // Skipped hours: at least 2 "no" there, and more "no" than "done".
  const byHour = new Map<number, { no: number; done: number }>()
  for (const r of results) {
    const h = new Date(r.at).getHours()
    const v = byHour.get(h) ?? { no: 0, done: 0 }
    if (r.result === 'no') v.no++
    else v.done++
    byHour.set(h, v)
  }
  const skip = [...byHour]
    .filter(([, v]) => v.no >= 2 && v.no > v.done)
    .map(([h]) => h)
    .sort((a, b) => a - b)
  const best = energy.best.filter((h) => !skip.includes(h))
  return { mult, n, best, skip, ready: Object.keys(mult).length > 0 || best.length > 0 || skip.length > 0 }
}

/**
 * How long a task will take, honestly: what he told Ben first (`said`), else
 * the usual guess times his real pace for that kind of task (5-minute steps).
 */
export function learnedEstimate(t: Pick<PlanTask, 'content' | 'duration' | 'priority'>, r: Rhythm, said?: number | null): number {
  if (said && said > 0) return Math.min(240, Math.round(said))
  const base = estimateMinutes(t)
  if (t.duration && t.duration > 0) return base
  const m = r.mult[kindOf(t.content)]
  if (!m) return base
  return Math.min(240, Math.max(10, Math.round((base * m) / 5) * 5))
}

/** One line for Ben's prompt and the plan's "why" ("Essays take you 1.4× the plan; best hours 09–11"). */
export function rhythmLine(r: Rhythm): string {
  if (!r.ready) return ''
  const parts: string[] = []
  const ms = Object.entries(r.mult).filter(([, m]) => m && Math.abs(m - 1) >= 0.15)
  if (ms.length) parts.push(`real pace vs plan: ${ms.map(([k, m]) => `${k} ${m}×`).join(', ')}`)
  if (r.best.length) parts.push(`best focus hours ${r.best.map((h) => `${String(h).padStart(2, '0')}:00`).join(', ')}`)
  if (r.skip.length) parts.push(`usually skips blocks at ${r.skip.map((h) => `${String(h).padStart(2, '0')}:00`).join(', ')}`)
  return parts.length ? `His rhythm (learned from his logs): ${parts.join('; ')}.` : ''
}

// ---- ME3: no deep work right after a long shift --------------------------------

export const LONG_SHIFT_MIN = 240
export const AFTER_SHIFT_MIN = 60

/**
 * Today's work window plus the hour after a long shift as light time (only
 * quick tasks). A short shift or no work tonight changes nothing.
 */
export function withRest(work: WorkToday | null | undefined): (WorkToday & { rest?: { from: string; to: string } }) | null {
  if (!work || work.mode !== 'normal' || !work.light) return work ?? null
  const len = toMin(work.to === '24:00' ? '24:00' : work.to) - toMin(work.from)
  if (len < LONG_SHIFT_MIN) return work
  const end = toMin(work.to)
  if (end >= 23 * 60) return work
  const restEnd = Math.min(24 * 60, end + AFTER_SHIFT_MIN)
  const hm = (m: number) => (m >= 1440 ? '24:00' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`)
  return { ...work, rest: { from: work.to, to: hm(restEnd) } }
}

// ---- Plan history: what was planned each day (kept 30 days) --------------------

export const BEN_LEARN = 'ben_learn'
export interface LearnStore {
  plans: Record<string, { title: string; start: string; minutes: number }[]>
}
export function cleanLearn(raw: unknown): LearnStore {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<LearnStore>
  const plans = o.plans && typeof o.plans === 'object' ? o.plans : {}
  return { plans: Object.fromEntries(Object.entries(plans).filter(([d, v]) => /^\d{4}-\d{2}-\d{2}$/.test(d) && Array.isArray(v))) }
}
/** Today's plan blocks kept for learning (the newest 30 days). */
export function keepPlan(s: LearnStore, day: string, blocks: { title: string; start: string; minutes: number }[]): LearnStore {
  const plans = { ...s.plans, [day]: blocks.slice(0, 12).map((b) => ({ title: String(b.title).slice(0, 80), start: b.start, minutes: Number(b.minutes) || 0 })) }
  const keep = Object.keys(plans).sort().slice(-30)
  return { plans: Object.fromEntries(keep.map((d) => [d, plans[d]])) }
}
export function plannedRows(s: LearnStore, beforeDay: string): PlannedRow[] {
  return Object.entries(s.plans)
    .filter(([d]) => d < beforeDay)
    .flatMap(([day, bs]) => bs.map((b) => ({ day, ...b })))
}
