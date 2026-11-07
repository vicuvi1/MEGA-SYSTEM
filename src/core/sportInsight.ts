// UX5 + PG4: Ben on your training, in plain words, written in code.
// - workoutNote: after a workout, ONE honest line from Sport Track's summary
//   (a record, a level-up, a hard session, or a push). Every number in it
//   comes from the summary; a line with a number the summary does not have is
//   dropped (the same no-invented-facts guard Ben's chat uses, benGround.ts).
// - stallInsight (PG4): when a move has not gained a rep in 2+ sessions, the
//   likely cause from the Body data: protein, sleep, readiness. With no data
//   it says what is missing ("Log protein to see why"), never a guess.
// Pure and tested: no clock, no DOM. Nothing here pays points.
import { addDays } from './dates'
import { sessionsOf, type SetLog } from './sportSets'
import { moveOf, type SportEx } from './sportLadders'
import { groundReply } from './benGround'

// ---- UX5: the note after a workout ----

/** What Sport Track posts (SPORT_SUMMARY); anything can be missing. */
export interface WorkoutSummary {
  day: string
  source: string
  minutes: number | null
  at: number
  sets: number
  reps: number
  records: number
  levelUps: number
  exercises: { name: string; sets: number[]; next: string | null }[]
}

const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.round(x) : 0)
/** The summary, checked: a bad shape gives null. */
export function cleanSummary(raw: unknown): WorkoutSummary | null {
  const o = raw as Record<string, unknown> | null
  if (!o || typeof o !== 'object' || typeof o.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.day)) return null
  const ex = (Array.isArray(o.exercises) ? o.exercises : []).slice(0, 12).map((e: any) => ({
    name: String(e?.name ?? '').replace(/[^\w .+()-]/g, '').slice(0, 40),
    sets: (Array.isArray(e?.sets) ? e.sets : []).map(num).slice(0, 12),
    next: typeof e?.next === 'string' ? e.next.slice(0, 60) : null
  }))
  const s = num(o.sets)
  if (!s && !num(o.reps) && !ex.length) return null
  return { day: o.day, source: String(o.source ?? 'workout').replace(/[^\w ]/g, '').slice(0, 20) || 'workout', minutes: o.minutes == null ? null : num(o.minutes), at: num(o.at), sets: s, reps: num(o.reps), records: num(o.records), levelUps: num(o.levelUps), exercises: ex.filter((e) => e.name) }
}

const nextTxt = (t: string | null) => String(t ?? '').replace(/^next:?\s*/i, '').replace(/\.$/, '')
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

/**
 * One plain line (null when there is nothing honest to say). Order: a level-up,
 * a record, a hard session (rest advice), a short one (a push), the plain count.
 */
export function workoutNote(s: WorkoutSummary): { text: string; kind: 'levelup' | 'record' | 'rest' | 'push' | 'plain' } | null {
  const raw = (() => {
    if (s.levelUps > 0) return { kind: 'levelup' as const, text: `${s.levelUps === 1 ? 'You moved up a level' : `You moved up ${s.levelUps} levels`} today. That is real progress.` }
    if (s.records > 0) return { kind: 'record' as const, text: `${s.records === 1 ? 'A new record' : `${s.records} new records`} today. Well done.` }
    if (s.sets >= 15 || (s.minutes ?? 0) >= 40) return { kind: 'rest' as const, text: `${plural(s.sets, 'set')} today is a hard session. Eat some protein and sleep well tonight.` }
    const next = s.exercises.find((e) => e.next)
    if (s.sets > 0 && s.sets < 4) return { kind: 'push' as const, text: `${plural(s.sets, 'set')} today is a light one. ${next ? `Next for ${next.name}: ${nextTxt(next.next)}.` : 'One more set next time.'}`.replace(/\.\./g, '.') }
    if (s.sets > 0) return { kind: 'plain' as const, text: `${plural(s.sets, 'set')} and ${plural(s.reps, 'rep')} today.${next ? ` Next for ${next.name}: ${nextTxt(next.next)}.` : ' Same again next time.'}`.replace(/\.\./g, '.') }
    return null
  })()
  if (!raw) return null
  // The guard: no time, event or "almost done" claim the summary does not back, and no number it does not have.
  const facts = JSON.stringify(s)
  const g = groundReply(raw.text, { facts, said: '', now: new Date(0) })
  const known = new Set(facts.match(/\d+/g) ?? [])
  const bad = (raw.text.match(/\d+/g) ?? []).some((n) => !known.has(n))
  if (bad || !g.reply || g.dropped.length) return null
  return { kind: raw.kind, text: raw.text }
}

// ---- PG4: why it stalled ----

export interface Stalled {
  name: string
  /** Sessions in a row with no better set than before. */
  sessions: number
  best: number
}

/** Moves with no rep gain in 2+ sessions in a row (needs 3 sessions; the last one within 14 days). */
export function stallsOf(log: SetLog | null | undefined, exercises: SportEx[], today: string): Stalled[] {
  const out: Stalled[] = []
  for (const ex of exercises) {
    if (ex.active === false) continue
    const s = sessionsOf(log, String(ex.id), today)
    if (s.length < 3 || s[s.length - 1].day < addDays(today, -14)) continue
    const best = s.map((x) => Math.max(...x.reps))
    let n = 0
    for (let i = best.length - 1; i >= 1; i--) {
      if (best[i] <= Math.max(...best.slice(0, i))) n++
      else break
    }
    if (n >= 2) out.push({ name: moveOf(ex)?.name ?? ex.name, sessions: n, best: Math.max(...best) })
  }
  return out.sort((a, b) => b.sessions - a.sessions)
}

export interface InsightData {
  /** Average grams on the days logged (of 7), the days logged, and the goal (0: no weight yet). */
  protein: { avg: number; days: number; goal: number } | null
  /** Average minutes a night and the nights known (of 7). */
  sleep: { avgMin: number | null; nights: number } | null
  /** Today's readiness: lighter / short days count as a cause. */
  readiness?: { mode: 'full' | 'light' | 'short'; why: string } | null
}
export interface Insight {
  text: string
  stalled: Stalled[]
  causes: string[]
  /** What to log to get a real answer. */
  missing: string[]
}

export const LOW_PROTEIN = 0.8
export const SHORT_SLEEP_MIN = 420
const hm = (m: number) => `${Math.floor(m / 60)}h${String(Math.round(m % 60)).padStart(2, '0')}`
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

/** The likely reason a move stalled, from real Body data only. Null when nothing stalled. */
export function stallInsight(stalled: Stalled[], d: InsightData): Insight | null {
  if (!stalled.length) return null
  const names = stalled.slice(0, 2).map((x) => x.name)
  const head = `${list(names)}${stalled.length > 2 ? ` and ${stalled.length - 2} more` : ''} stalled.`
  const causes: string[] = []
  const missing: string[] = []
  const p = d.protein
  if (!p || p.days === 0) missing.push('Log protein to see why.')
  else if (p.goal > 0 && p.avg / p.goal < LOW_PROTEIN) causes.push(`Protein averaged ${p.avg} g (goal ${p.goal})`)
  const s = d.sleep
  if (!s || s.avgMin == null || s.nights === 0) missing.push('Log your sleep to see why.')
  else if (s.avgMin < SHORT_SLEEP_MIN) causes.push(`you slept ${hm(s.avgMin)} on average`)
  if (d.readiness && d.readiness.mode !== 'full') causes.push(`today's readiness says ${d.readiness.mode === 'light' ? 'a lighter day' : 'a short day'}${d.readiness.why ? ` (${d.readiness.why})` : ''}`)
  let text: string
  if (causes.length) {
    const c = list(causes)
    text = `${head} ${c.charAt(0).toUpperCase()}${c.slice(1)}. Fix ${causes.length === 1 ? 'that' : 'those'} first.`
    if (missing.length) text += ` ${missing.join(' ')}`
  } else if (missing.length) text = `${head} ${missing.join(' ')}`
  else text = `${head} Protein and sleep look fine, so try slower reps (3 seconds down) or a pause at the bottom.`
  return { text, stalled, causes, missing }
}
