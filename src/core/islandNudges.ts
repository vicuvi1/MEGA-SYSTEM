// Island 2: small, interactive nudges for your body and your day, pure and tested.
//
// - Move breaks (IN1, IN7, IN14, IN31): pick the exercise and the count with
//   −/+, undo it or say "I only did 12", last time's numbers ("Try 22?"),
//   and a gentle escalation: a dot, a peek, a sound, then a firmer Ben line.
// - Eye break (IN11) and a tidy-desk minute (IN25): a real countdown.
// - Posture (IN12), breathing (IN16), mood (IN18), one good thing (IN19),
//   focus check-in (IN20), people to call (IN24), "Moved?" after time away (IN32).
// - Snooze menu (IN30) that counts how often you postponed, and learning
//   (IN26): a nudge you keep skipping moves to another hour or becomes a dot.
// - Daily ring (IN15), Ben's daily challenge (IN49) and the move streak (IN51).
//
// Honest points: only a confirmed log pays (body.move_break, capped by its
// rule), and an undo takes it back. Tallies (eyes, posture, calm) are quiet.
import type { IslandAction, IslandAlert } from './islandModel'
import { badMoment, learned, type SuggestStats } from './suggest'
import { addDays } from './dates'

export type NudgeKind = 'move' | 'water' | 'eyes' | 'posture' | 'breathe' | 'mood' | 'gratitude' | 'focus' | 'people' | 'tidy' | 'away'
export const NUDGE_KINDS: NudgeKind[] = ['move', 'water', 'eyes', 'posture', 'breathe', 'mood', 'gratitude', 'focus', 'people', 'tidy', 'away']
export const NUDGE_LABEL: Record<NudgeKind, string> = {
  move: 'Move breaks',
  water: 'Water',
  eyes: '20-20-20 eye breaks',
  posture: 'Posture check',
  breathe: 'Breathing minute',
  mood: 'Mood tap',
  gratitude: 'One good thing (evening)',
  focus: 'Focus check-in',
  people: 'People to call',
  tidy: 'Tidy-desk minute',
  away: '"Moved?" after time away'
}

/** The rules behind the points (src/core/rules.ts). */
export const MOVE_RULE = 'body.move_break'
export const EYES_RULE = 'body.eye_break'
export const CHALLENGE_RULE = 'body.challenge_done'

export interface NudgePerson {
  id: string
  name: string
  /** Remind me every this many days. */
  everyDays: number
  /** The day you last called (YYYY-MM-DD), or null. */
  last: string | null
}

export interface NudgePrefs {
  /** Minutes at the PC without a 5-minute pause before a move break. */
  sitMin: number
  on: Record<NudgeKind, boolean>
  people: NudgePerson[]
  /** Ben's daily challenge (IN49). */
  challenge: boolean
  /** IN15: the daily movement ring's goal, in reps or minutes. */
  ringGoal: number
  ringUnit: 'reps' | 'min'
  /** IN16: box (4-4-4-4) or 4-7-8 breathing. */
  breath: 'box' | '478'
}

export const DEFAULT_NUDGE_PREFS: NudgePrefs = {
  sitMin: 50,
  on: { move: true, water: true, eyes: true, posture: true, breathe: true, mood: true, gratitude: true, focus: true, people: true, tidy: true, away: true },
  people: [],
  challenge: true,
  ringGoal: 100,
  ringUnit: 'reps',
  breath: 'box'
}

export type FocusAnswer = 'yes' | 'drifted' | 'switch'

/** One move break you logged (kept a few days, so it can be undone or fixed). */
export interface MoveLog {
  id: string
  at: number
  day: string
  ex: string
  name: string
  n: number
  workoutId: number | null
  /** The body.move_break payment (null: the day's cap was used, nothing paid). */
  ledgerId: number | null
  coins: number
  /** "+250 ml too?" answered. */
  water?: boolean
  undone?: boolean
}

export interface NudgeChallenge {
  ex: string
  name: string
  target: number
  /** The bonus payment, once complete. */
  paid?: number | null
  /** Ben's lines already said (25/50/75/100). */
  said?: number[]
}

export interface NudgeDay {
  moves: number
  reps: number
  /** Minutes moved: move breaks (2 each), walks, tidy and breathing minutes. */
  minutes: number
  eyes: number
  posture: number
  postureFix: number
  calm: number
  tidy: number
  walks: number
  moods: number
  gratitude?: boolean
  focus: { at: number; subject: string; answer: FocusAnswer }[]
  /** Nudge kind → times you postponed it today (IN30). */
  postponed: Record<string, number>
  /** Kind → last time it was shown or answered today (spacing). */
  lastAt: Record<string, number>
  challenge?: NudgeChallenge | null
  /** HD: the day's water (ml) and goal, saved by the island for the weekly card. */
  water?: number
  waterTarget?: number
  /** HD: all four parts of a healthy day met, and the bonus payment (ledger id). */
  healthy?: boolean
  healthyPaid?: number | null
}

export interface NudgeStore {
  prefs: NudgePrefs
  days: Record<string, NudgeDay>
  logs: MoveLog[]
  /** IN14: your last move break. */
  last: { ex: string; name: string; n: number } | null
  /** IN26: what you take and skip, per kind (the same shape as Smart island's learning). */
  stats: SuggestStats
  /** Kind → snoozed until (ms). */
  snooze: Record<string, number>
  /** IN51: your best move streak (days with 3+ breaks). */
  best: number
  /** IN32: back after time away (minutes), once. */
  away: { min: number; at: number } | null
}

export const EMPTY_NUDGE_DAY = (): NudgeDay => ({ moves: 0, reps: 0, minutes: 0, eyes: 0, posture: 0, postureFix: 0, calm: 0, tidy: 0, walks: 0, moods: 0, focus: [], postponed: {}, lastAt: {} })
export const EMPTY_NUDGES = (): NudgeStore => ({ prefs: { ...DEFAULT_NUDGE_PREFS, on: { ...DEFAULT_NUDGE_PREFS.on }, people: [] }, days: {}, logs: [], last: null, stats: {}, snooze: {}, best: 0, away: null })

const num = (v: unknown, d: number, lo: number, hi: number) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d
}
const str = (v: unknown, max = 60) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const recNum = (v: unknown): Record<string, number> => (v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as object).filter(([, n]) => Number.isFinite(n)).slice(-40)) as Record<string, number> : {})

export function cleanPrefs(x: any): NudgePrefs {
  const d = DEFAULT_NUDGE_PREFS
  const on = { ...d.on }
  for (const k of NUDGE_KINDS) if (typeof x?.on?.[k] === 'boolean') on[k] = x.on[k]
  const people = (Array.isArray(x?.people) ? x.people : [])
    .map((p: any, i: number): NudgePerson => ({ id: str(p?.id, 20) || `p${i}`, name: str(p?.name, 30), everyDays: num(p?.everyDays, 7, 1, 90), last: isDay(p?.last) ? p.last : null }))
    .filter((p: NudgePerson) => p.name)
    .slice(0, 12)
  return {
    sitMin: num(x?.sitMin, d.sitMin, 20, 180),
    on,
    people,
    challenge: typeof x?.challenge === 'boolean' ? x.challenge : d.challenge,
    ringGoal: num(x?.ringGoal, d.ringGoal, 5, 1000),
    ringUnit: x?.ringUnit === 'min' ? 'min' : 'reps',
    breath: x?.breath === '478' ? '478' : 'box'
  }
}

function cleanDay(x: any): NudgeDay {
  const e = EMPTY_NUDGE_DAY()
  const n = (k: keyof NudgeDay) => num(x?.[k], 0, 0, 100000)
  const ch = x?.challenge
  return {
    ...e,
    moves: n('moves'),
    reps: n('reps'),
    minutes: n('minutes'),
    eyes: n('eyes'),
    posture: n('posture'),
    postureFix: n('postureFix'),
    calm: n('calm'),
    tidy: n('tidy'),
    walks: n('walks'),
    moods: n('moods'),
    ...(x?.gratitude ? { gratitude: true } : {}),
    focus: (Array.isArray(x?.focus) ? x.focus : []).filter((f: any) => ['yes', 'drifted', 'switch'].includes(f?.answer)).slice(-12).map((f: any) => ({ at: Number(f.at) || 0, subject: str(f.subject), answer: f.answer })),
    postponed: recNum(x?.postponed),
    lastAt: recNum(x?.lastAt),
    ...(Number.isFinite(x?.water) ? { water: num(x.water, 0, 0, 20000) } : {}),
    ...(Number.isFinite(x?.waterTarget) ? { waterTarget: num(x.waterTarget, 0, 0, 20000) } : {}),
    ...(x?.healthy ? { healthy: true } : {}),
    ...(Number.isFinite(x?.healthyPaid) ? { healthyPaid: x.healthyPaid } : {}),
    ...(ch && ch.ex ? { challenge: { ex: str(ch.ex, 40), name: str(ch.name, 40), target: num(ch.target, 50, 1, 1000), paid: Number.isFinite(ch.paid) ? ch.paid : null, said: Array.isArray(ch.said) ? ch.said.filter((v: unknown) => Number.isFinite(v)).slice(0, 4) : [] } } : {})
  }
}

/** Saved state → valid; keeps 45 days of tallies and 3 days of move logs. */
export function cleanNudgeStore(x: any, today?: string): NudgeStore {
  const days: Record<string, NudgeDay> = {}
  if (x?.days && typeof x.days === 'object') for (const k of Object.keys(x.days).filter(isDay).sort().slice(-45)) days[k] = cleanDay(x.days[k])
  const oldest = today ? addDays(today, -2) : ''
  const logs = (Array.isArray(x?.logs) ? x.logs : [])
    .filter((l: any) => l && typeof l.id === 'string' && isDay(l.day) && l.day >= oldest)
    .map((l: any): MoveLog => ({ id: l.id, at: Number(l.at) || 0, day: l.day, ex: str(l.ex, 40), name: str(l.name, 40), n: num(l.n, 0, 0, 1000), workoutId: Number.isFinite(l.workoutId) ? l.workoutId : null, ledgerId: Number.isFinite(l.ledgerId) ? l.ledgerId : null, coins: num(l.coins, 0, 0, 100), ...(l.water ? { water: true } : {}), ...(l.undone ? { undone: true } : {}) }))
    .slice(-40)
  const last = x?.last && x.last.name ? { ex: str(x.last.ex, 40), name: str(x.last.name, 40), n: num(x.last.n, 10, 1, 1000) } : null
  return {
    prefs: cleanPrefs(x?.prefs),
    days,
    logs,
    last,
    stats: x?.stats && typeof x.stats === 'object' ? x.stats : {},
    snooze: recNum(x?.snooze),
    best: num(x?.best, 0, 0, 10000),
    away: x?.away && Number.isFinite(x.away.min) ? { min: num(x.away.min, 0, 0, 1440), at: Number(x.away.at) || 0 } : null
  }
}

export const dayOf = (s: NudgeStore, day: string): NudgeDay => s.days[day] ?? EMPTY_NUDGE_DAY()
const withDay = (s: NudgeStore, day: string, f: (d: NudgeDay) => NudgeDay): NudgeStore => ({ ...s, days: { ...s.days, [day]: f(dayOf(s, day)) } })

// ---- IN1 / IN14: what to do, and how many ------------------------------------

export interface ExerciseLine { id: string; name: string; done: number; target: number; unit?: string }

/** The exercise furthest behind today's target (by share left, then reps left). */
export function behindExercise(list: ExerciseLine[]): ExerciseLine | null {
  const reps = list.filter((e) => e.target > 0 && (!e.unit || e.unit === 'reps'))
  if (!reps.length) return null
  return [...reps].sort((a, b) => (b.target - b.done) / b.target - (a.target - a.done) / a.target || b.target - b.done - (a.target - a.done))[0]
}

/** −/+ steps: 1 under 10, 2 under 30, then 5 (1 to 300). */
export function stepCount(n: number, dir: 1 | -1): number {
  const step = n < 10 || (dir < 0 && n <= 10) ? 1 : n < 30 || (dir < 0 && n <= 30) ? 2 : 5
  return Math.max(1, Math.min(300, Math.round(n) + dir * step))
}

/** IN14: a small step up from last time (20 → 22, 8 → 9, at most +5). */
export const tryMore = (n: number) => Math.min(300, Math.round(n) + Math.max(1, Math.min(5, Math.round(n * 0.1))))

/** The count to start with: last time's plus a little (same exercise), else what's left of today, 5–20. */
export function startCount(ex: ExerciseLine | null, last: NudgeStore['last']): { n: number; hint: string | null } {
  if (last && ex && (last.ex === ex.id || last.name.toLowerCase() === ex.name.toLowerCase())) return { n: tryMore(last.n), hint: `Last break: ${last.n} ${last.name.toLowerCase()}. Try ${tryMore(last.n)}?` }
  const left = ex ? ex.target - ex.done : 0
  const n = left > 0 ? Math.max(5, Math.min(20, Math.round(left / 5) * 5 || 5)) : 10
  return { n, hint: last ? `Last break: ${last.n} ${last.name.toLowerCase()}.` : null }
}

// ---- IN31: gentle escalation ------------------------------------------------------

export type NudgeLevel = 'dot' | 'peek' | 'sound' | 'ben'
/** A dot first, a peek 10 min later, a sound after 25, a firmer Ben line at 90 min. Never a lock without asking. */
export function escalation(satMin: number, sitMin: number): NudgeLevel {
  if (satMin >= 90) return 'ben'
  const over = satMin - sitMin
  if (over < 10) return 'dot'
  if (over < 25) return 'peek'
  return 'sound'
}

// ---- IN30: snooze menu ----------------------------------------------------------

export type SnoozeChoice = '5' | '15' | 'task' | 'meeting' | 'lunch'
export interface SnoozeCtx { now: number; taskEnd?: number | null; meetingEnd?: number | null }

const lunchAt = (now: number) => {
  const d = new Date(now)
  d.setHours(12, 30, 0, 0)
  return d.getTime()
}

/** When a snooze ends. */
export function snoozeUntil(c: SnoozeChoice, x: SnoozeCtx): number {
  if (c === '5') return x.now + 5 * 60_000
  if (c === 'task') return x.taskEnd && x.taskEnd > x.now ? x.taskEnd : x.now + 30 * 60_000
  if (c === 'meeting') return x.meetingEnd && x.meetingEnd > x.now ? x.meetingEnd : x.now + 30 * 60_000
  if (c === 'lunch') return lunchAt(x.now) > x.now ? lunchAt(x.now) : x.now + 60 * 60_000
  return x.now + 15 * 60_000
}

/** The choices that make sense now (after this task / the meeting only when there is one; lunch before 12:30). */
export function snoozeChoices(x: SnoozeCtx): { c: SnoozeChoice; label: string }[] {
  const out: { c: SnoozeChoice; label: string }[] = [
    { c: '5', label: '5 min' },
    { c: '15', label: '15 min' }
  ]
  if (x.taskEnd && x.taskEnd > x.now) out.push({ c: 'task', label: 'After this task' })
  if (x.meetingEnd && x.meetingEnd > x.now) out.push({ c: 'meeting', label: 'After the meeting' })
  if (lunchAt(x.now) - x.now > 20 * 60_000) out.push({ c: 'lunch', label: 'Until lunch' })
  return out
}

export const postponedText = (n: number) => (n <= 0 ? '' : n === 1 ? 'Postponed once today' : `Postponed ${n} times today`)

export function postpone(s: NudgeStore, day: string, kind: string, until: number): NudgeStore {
  const next = withDay(s, day, (d) => ({ ...d, postponed: { ...d.postponed, [kind]: (d.postponed[kind] ?? 0) + 1 } }))
  return { ...next, snooze: { ...next.snooze, [kind]: until } }
}

// ---- IN26: learning ---------------------------------------------------------------

/** Counts a yes or a no for a nudge (the same numbers Smart island learns from). */
export function noteAnswer(stats: SuggestStats, kind: string, yes: boolean, hour: number): SuggestStats {
  const k = `n:${kind}`
  const cur = stats[k] ?? { a: 0, d: 0, row: 0 }
  const v = cur.byHour?.[String(hour)] ?? [0, 0]
  return { ...stats, [k]: { ...cur, a: cur.a + (yes ? 1 : 0), d: cur.d + (yes ? 0 : 1), row: yes ? 0 : cur.row + 1, byHour: { ...(cur.byHour ?? {}), [String(hour)]: (yes ? [v[0] + 1, v[1]] : [v[0], v[1] + 1]) as [number, number] } } }
}

/**
 * What learning says now: show it, only a dot (skipped 4 in a row, or rarely
 * taken: body nudges never stop by themselves), or skip this hour (3+ no's and
 * no yes at this hour: it comes at another hour).
 */
export function nudgeGate(stats: SuggestStats, kind: string, hour: number): 'peek' | 'dot' | 'skip' {
  const k = `n:${kind}`
  if (badMoment(stats, k, hour)) return 'skip'
  const l = learned(stats, k)
  return l === 'peek' ? 'peek' : 'dot'
}

/** The hour you take this nudge most (for Settings), or null. */
export function betterHour(stats: SuggestStats, kind: string): number | null {
  const h = stats[`n:${kind}`]?.byHour ?? {}
  const best = Object.entries(h).filter(([, [a]]) => a > 0).sort((x, y) => y[1][0] / (y[1][0] + y[1][1]) - x[1][0] / (x[1][0] + x[1][1]) || y[1][0] - x[1][0])[0]
  return best ? Number(best[0]) : null
}

/** Applies learning and your snooze to an alert: null (not now), a dot, or as is. */
export function learnAlert(a: IslandAlert | null, s: NudgeStore, kind: NudgeKind, now: number): IslandAlert | null {
  if (!a) return null
  if (!s.prefs.on[kind]) return null
  if ((s.snooze[kind] ?? 0) > now) return null
  const g = nudgeGate(s.stats, kind, new Date(now).getHours())
  if (g === 'skip') return null
  return g === 'dot' ? { ...a, dot: true } : a
}

// ---- The nudge card's data ----------------------------------------------------------

export interface MoveOption { ex: string; name: string; n: number; left: number }

export type Nudge =
  | { type: 'move'; kind: 'move'; options: MoveOption[]; pick: string; count: number; hint: string | null; level: NudgeLevel; postponed: number; coins: number; tidy: boolean; snooze: { c: SnoozeChoice; label: string }[]; challenge: string | null }
  | { type: 'moveDone'; kind: 'move'; logId: string; name: string; n: number; coins: number; water: boolean; line: string | null }
  | { type: 'timer'; kind: 'eyes' | 'tidy'; seconds: number; postponed: number; snooze: { c: SnoozeChoice; label: string }[] }
  | { type: 'posture'; kind: 'posture' }
  | { type: 'breathe'; kind: 'breathe'; pattern: 'box' | '478'; seconds: number }
  | { type: 'mood'; kind: 'mood' }
  | { type: 'gratitude'; kind: 'gratitude' }
  | { type: 'focus'; kind: 'focus'; subject: string; startedAt: number }
  | { type: 'people'; kind: 'people'; personId: string; name: string; days: number | null; postponed: number; snooze: { c: SnoozeChoice; label: string }[] }
  | { type: 'away'; kind: 'away'; min: number }

export type NudgeOp =
  | { op: 'move'; ex: string; name: string; n: number; alertId: string }
  | { op: 'undo'; logId: string }
  | { op: 'fix'; logId: string; n: number }
  | { op: 'water'; logId: string; ml: number }
  | { op: 'snooze'; kind: NudgeKind; alertId: string; choice: SnoozeChoice }
  | { op: 'skip'; kind: NudgeKind; alertId: string }
  | { op: 'tally'; kind: 'eyes' | 'posture' | 'breathe' | 'tidy'; ok: boolean; alertId: string }
  | { op: 'mood'; mood: number; alertId: string }
  | { op: 'gratitude'; text: string; alertId: string }
  | { op: 'focus'; answer: FocusAnswer; subject: string; startedAt: number; alertId: string }
  | { op: 'person'; personId: string; done: boolean; alertId: string }
  | { op: 'away'; yes: boolean; min: number; alertId: string }
  | { op: 'close'; alertId: string }

/** Taps that end the card (the island goes back to the pill). */
export const NUDGE_CLOSES = new Set<NudgeOp['op']>(['snooze', 'skip', 'tally', 'mood', 'gratitude', 'focus', 'person', 'away', 'close'])

const act = (op: NudgeOp): IslandAction => ({ kind: 'nudge', op })
const hm = (t: number) => new Date(t).toTimeString().slice(0, 5)

export interface MoveInput {
  now: number
  busy: boolean
  idleSec: number | null
  activeSince: number | null
  lastMoveAt: number
  exercises: ExerciseLine[]
  store: NudgeStore
  day: string
  dismissed: Record<string, number>
  coins: number
  snooze: SnoozeCtx
  /** SI12: in the middle of real work (wait for a pause, not past 75 min). */
  doing?: { ctx: string; pause: boolean } | null
}

const FALLBACK_EX: ExerciseLine[] = [
  { id: 'squats', name: 'Squats', done: 0, target: 0 },
  { id: 'pushups', name: 'Push-ups', done: 0, target: 0 }
]

/** IN1, IN14, IN31, IN25: the move break, with its picker and count. */
export function moveNudge(i: MoveInput): IslandAlert | null {
  const s = i.store
  if (i.busy || !i.activeSince || i.idleSec == null || i.idleSec > 120) return null
  const sitMin = s.prefs.sitMin
  if (i.now - i.activeSince < sitMin * 60_000 || i.now - i.lastMoveAt < sitMin * 60_000) return null
  // One sitting, one id; each step of the escalation is a new alert (so a dot can become a peek).
  const base = `move:${Math.floor(i.activeSince / 60_000)}`
  if (Object.entries(i.dismissed).some(([k, t]) => (k === base || k.startsWith(`${base}:`)) && t > i.now)) return null
  const sat = Math.round((i.now - i.activeSince) / 60_000)
  const work = !!i.doing && ['coding', 'study', 'writing', 'ctf'].includes(i.doing.ctx)
  if (work && !i.doing!.pause && sat < 75) return null
  const level = escalation(sat, sitMin)
  const id = `${base}:${level}`
  const list = i.exercises.filter((e) => !e.unit || e.unit === 'reps')
  const opts = list.length ? list : FALLBACK_EX
  const behind = behindExercise(opts) ?? opts[0]
  const start = startCount(behind, s.last)
  const options: MoveOption[] = opts.slice(0, 6).map((e) => ({ ex: e.id, name: e.name, n: e.id === behind.id ? start.n : startCount(e, s.last).n, left: Math.max(0, e.target - e.done) }))
  const d = dayOf(s, i.day)
  const postponed = d.postponed.move ?? 0
  const ch = s.prefs.challenge && d.challenge ? challengeView(d.challenge, i.store, i.day) : null
  const what = i.doing?.ctx === 'ctf' ? 'CTF work' : i.doing?.ctx
  const title = level === 'ben' ? `${sat} min in that chair. Up, now.` : work ? `${sat} min of ${what}: move a bit?` : `${sat} min at the PC`
  const text = level === 'ben' ? "Ben: you said you'd move. 2 minutes, then back to it." : `2-minute break: ${start.n} ${behind.name.toLowerCase()}?${postponed ? ` · ${postponedText(postponed)}` : ''}`
  const alert: IslandAlert = {
    id,
    kind: 'move',
    title,
    text,
    face: level === 'ben' ? '😤' : '🏃',
    actions: [
      { label: `✓ ${start.n} ${behind.name}`, action: act({ op: 'move', ex: behind.id, name: behind.name, n: start.n, alertId: id }), primary: true },
      { label: '🔒 Lock PC 5 min', action: { kind: 'lockPc', alertId: id } },
      { label: 'In 15 min', action: act({ op: 'snooze', kind: 'move', alertId: id, choice: '15' }) }
    ],
    nudge: { type: 'move', kind: 'move', options, pick: behind.id, count: start.n, hint: start.hint, level, postponed, coins: i.coins, tidy: s.prefs.on.tidy && sat >= sitMin + 20 && d.tidy === 0, snooze: snoozeChoices(i.snooze), challenge: ch ? ch.text : null }
  }
  return level === 'dot' ? { ...alert, dot: true } : alert
}

/** IN7, IN13: right after a move break: undo, "I did fewer", and "+250 ml too?" (3 minutes). */
export function moveDoneAlert(s: NudgeStore, now: number, dismissed: Record<string, number>, day: string): IslandAlert | null {
  const log = [...s.logs].reverse().find((l) => !l.undone && now - l.at < 3 * 60_000)
  if (!log) return null
  const id = `moved:${log.id}`
  if ((dismissed[id] ?? 0) > now) return null
  const d = dayOf(s, day)
  const ch = s.prefs.challenge && d.challenge ? challengeView(d.challenge, s, day) : null
  return {
    id,
    kind: 'move',
    title: `✓ ${log.n} ${log.name}${log.coins ? ` · +${log.coins}` : ''}`,
    text: ch?.text ?? `${d.moves} break${d.moves === 1 ? '' : 's'} today. Nice.`,
    face: '💪',
    actions: [
      ...(log.water ? [] : [{ label: '💧 +250 ml too?', action: act({ op: 'water', logId: log.id, ml: 250 }), primary: true }]),
      { label: '↶ Undo', action: act({ op: 'undo', logId: log.id }) },
      { label: 'Done', action: act({ op: 'close', alertId: id }) }
    ],
    nudge: { type: 'moveDone', kind: 'move', logId: log.id, name: log.name, n: log.n, coins: log.coins, water: !log.water, line: ch?.text ?? null }
  }
}

export interface DayCtx {
  now: number
  day: string
  busy: boolean
  idleSec: number | null
  activeSince: number | null
  store: NudgeStore
  dismissed: Record<string, number>
  snooze: SnoozeCtx
}
const sitting = (c: DayCtx) => (c.activeSince && c.idleSec != null && c.idleSec < 120 ? (c.now - c.activeSince) / 60_000 : 0)
const spaced = (c: DayCtx, kind: string, min: number) => c.now - (dayOf(c.store, c.day).lastAt[kind] ?? 0) >= min * 60_000
const hidden = (c: DayCtx, id: string) => (c.dismissed[id] ?? 0) > c.now
const hourOf = (now: number) => new Date(now).getHours() + new Date(now).getMinutes() / 60

/** IN11: the 20-20-20 eye break, with a real 20 s countdown (only with eye breaks on). */
export function eyesNudge(c: DayCtx & { eyeBreaks: boolean; lastEyesAt: number }): IslandAlert | null {
  if (!c.eyeBreaks || c.busy || sitting(c) < 20 || c.now - c.lastEyesAt < 20 * 60_000) return null
  const id = `eyes:${Math.floor(c.now / (20 * 60_000))}`
  if (hidden(c, id)) return null
  const postponed = dayOf(c.store, c.day).postponed.eyes ?? 0
  return {
    id,
    kind: 'eyes',
    title: '20-20-20',
    text: `Look at something 6 m away for 20 seconds.${postponed ? ` · ${postponedText(postponed)}` : ''}`,
    face: '👁️',
    actions: [{ label: '▶ Start 20 s', action: act({ op: 'tally', kind: 'eyes', ok: true, alertId: id }), primary: true }],
    nudge: { type: 'timer', kind: 'eyes', seconds: 20, postponed, snooze: snoozeChoices(c.snooze) }
  }
}

/** IN25: a tidy-desk minute, once a day, during a long sit. */
export function tidyNudge(c: DayCtx): IslandAlert | null {
  if (c.busy || sitting(c) < c.store.prefs.sitMin + 30 || dayOf(c.store, c.day).tidy > 0 || !spaced(c, 'tidy', 120)) return null
  const id = `tidy:${c.day}`
  if (hidden(c, id)) return null
  return {
    id,
    kind: 'move',
    title: 'Tidy-desk minute',
    text: 'One minute: clear the desk, cups to the kitchen, cables away.',
    face: '🧹',
    actions: [{ label: '▶ Start 60 s', action: act({ op: 'tally', kind: 'tidy', ok: true, alertId: id }), primary: true }],
    nudge: { type: 'timer', kind: 'tidy', seconds: 60, postponed: dayOf(c.store, c.day).postponed.tidy ?? 0, snooze: snoozeChoices(c.snooze) }
  }
}

/** IN12: "Shoulders back, feet flat?" every hour or so while you sit (09–22, at most 4 a day). */
export function postureNudge(c: DayCtx): IslandAlert | null {
  const h = hourOf(c.now)
  const d = dayOf(c.store, c.day)
  if (c.busy || h < 9 || h >= 22 || sitting(c) < 25 || d.posture + d.postureFix >= 4 || !spaced(c, 'posture', 60)) return null
  const id = `posture:${c.day}:${Math.floor(h)}`
  if (hidden(c, id)) return null
  return {
    id,
    kind: 'move',
    title: 'Posture check',
    text: 'Shoulders back, feet flat?',
    face: '🪑',
    actions: [
      { label: '✓ Yes', action: act({ op: 'tally', kind: 'posture', ok: true, alertId: id }), primary: true },
      { label: 'Fix it', action: act({ op: 'tally', kind: 'posture', ok: false, alertId: id }) }
    ],
    nudge: { type: 'posture', kind: 'posture' }
  }
}

/** IN16: a breathing minute once a day (13–19, after 30 min at the PC), or after a low mood. */
export function breatheNudge(c: DayCtx & { lowMood?: boolean }): IslandAlert | null {
  const h = hourOf(c.now)
  const d = dayOf(c.store, c.day)
  if (c.busy || d.calm > 0 || !spaced(c, 'breathe', 180)) return null
  if (!c.lowMood && (h < 13 || h >= 19 || sitting(c) < 30)) return null
  const id = `breathe:${c.day}`
  if (hidden(c, id)) return null
  const p = c.store.prefs.breath
  return {
    id,
    kind: 'move',
    title: 'One calm minute?',
    text: p === 'box' ? 'Box breathing: in 4, hold 4, out 4, hold 4.' : '4-7-8: in 4, hold 7, out 8.',
    face: '🫧',
    actions: [{ label: '▶ Breathe 1 min', action: act({ op: 'tally', kind: 'breathe', ok: true, alertId: id }), primary: true }],
    nudge: { type: 'breathe', kind: 'breathe', pattern: p, seconds: 60 }
  }
}

/** One breath cycle: the steps of box (4-4-4-4) or 4-7-8 breathing, in seconds. */
export function breathSteps(p: 'box' | '478'): { say: string; sec: number; grow: boolean }[] {
  return p === 'box'
    ? [{ say: 'Breathe in', sec: 4, grow: true }, { say: 'Hold', sec: 4, grow: true }, { say: 'Breathe out', sec: 4, grow: false }, { say: 'Hold', sec: 4, grow: false }]
    : [{ say: 'Breathe in', sec: 4, grow: true }, { say: 'Hold', sec: 7, grow: true }, { say: 'Breathe out', sec: 8, grow: false }]
}

/** Where in the breath you are after `t` seconds. */
export function breathAt(p: 'box' | '478', t: number): { say: string; grow: boolean; left: number } {
  const steps = breathSteps(p)
  const cycle = steps.reduce((x, s) => x + s.sec, 0)
  let r = ((t % cycle) + cycle) % cycle
  for (const s of steps) {
    if (r < s.sec) return { say: s.say, grow: s.grow, left: Math.ceil(s.sec - r) }
    r -= s.sec
  }
  return { say: steps[0].say, grow: true, left: steps[0].sec }
}

/** IN18: 5 faces, at most twice a day (11–15 and 18–22, once each). */
export function moodNudge(c: DayCtx & { moodSlotsDone: ('noon' | 'evening')[] }): IslandAlert | null {
  const h = hourOf(c.now)
  const slot = h >= 11 && h < 15 ? 'noon' : h >= 18 && h < 22 ? 'evening' : null
  if (!slot || c.busy || c.moodSlotsDone.includes(slot) || dayOf(c.store, c.day).moods >= 2 || sitting(c) < 10) return null
  const id = `mood:${c.day}:${slot}`
  if (hidden(c, id)) return null
  return { id, kind: 'move', title: 'How are you right now?', text: 'One tap. Ben keeps it with your mood check-ins.', face: '🙂', actions: [{ label: 'Later', action: act({ op: 'skip', kind: 'mood', alertId: id }) }], nudge: { type: 'mood', kind: 'mood' } }
}

/** IN19: in the evening (20–23:30), one good thing today, saved to the Notebook. Once a day. */
export function gratitudeNudge(c: DayCtx): IslandAlert | null {
  const h = hourOf(c.now)
  if (h < 20 || h >= 23.5 || c.busy || dayOf(c.store, c.day).gratitude) return null
  const id = `gratitude:${c.day}`
  if (hidden(c, id)) return null
  return { id, kind: 'move', title: 'One good thing today?', text: 'One line. It goes into your Notebook.', face: '🌱', actions: [{ label: 'Not tonight', action: act({ op: 'skip', kind: 'gratitude', alertId: id }) }], nudge: { type: 'gratitude', kind: 'gratitude' } }
}

/** IN20: halfway through a focus timer of 20+ minutes: "Still on X?" (once per timer, for 10 minutes). */
export function focusNudge(c: { now: number; running: { subject: string; startedAt: number; endsAt: number; pausedAt?: number | null; brk?: boolean } | null; store: NudgeStore; day: string; dismissed: Record<string, number> }): IslandAlert | null {
  const r = c.running
  if (!r || r.brk || r.pausedAt) return null
  const len = r.endsAt - r.startedAt
  const half = r.startedAt + len / 2
  if (len < 20 * 60_000 || c.now < half || c.now > half + 10 * 60_000) return null
  if (dayOf(c.store, c.day).focus.some((f) => f.at >= r.startedAt)) return null
  const id = `fcheck:${r.startedAt}`
  if ((c.dismissed[id] ?? 0) > c.now) return null
  return {
    id,
    kind: 'move',
    title: `Still on ${r.subject}?`,
    text: 'Halfway there. An honest answer helps your focus quality.',
    face: '🎯',
    actions: [
      { label: '✓ Yes', action: act({ op: 'focus', answer: 'yes', subject: r.subject, startedAt: r.startedAt, alertId: id }), primary: true },
      { label: 'Drifted', action: act({ op: 'focus', answer: 'drifted', subject: r.subject, startedAt: r.startedAt, alertId: id }) },
      { label: 'Switch', action: act({ op: 'focus', answer: 'switch', subject: r.subject, startedAt: r.startedAt, alertId: id }) }
    ],
    nudge: { type: 'focus', kind: 'focus', subject: r.subject, startedAt: r.startedAt }
  }
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5)

/** IN24: the person most overdue (10–20, not while busy). */
export function personNudge(c: DayCtx): IslandAlert | null {
  const h = hourOf(c.now)
  if (c.busy || h < 10 || h >= 20) return null
  const due = c.store.prefs.people
    .map((p) => ({ p, since: p.last ? daysBetween(p.last, c.day) : null }))
    .filter((x) => x.since == null || x.since >= x.p.everyDays)
    .sort((a, b) => (b.since ?? 999) - b.p.everyDays - ((a.since ?? 999) - a.p.everyDays))[0]
  if (!due) return null
  const id = `person:${due.p.id}:${c.day}`
  if (hidden(c, id)) return null
  const postponed = dayOf(c.store, c.day).postponed.people ?? 0
  return {
    id,
    kind: 'move',
    title: `Call ${due.p.name}?`,
    text: `${due.since == null ? 'No call noted yet.' : `Last call ${due.since} day${due.since === 1 ? '' : 's'} ago.`}${postponed ? ` · ${postponedText(postponed)}` : ''}`,
    face: '📞',
    actions: [
      { label: '✓ Done', action: act({ op: 'person', personId: due.p.id, done: true, alertId: id }), primary: true },
      { label: 'Later', action: act({ op: 'snooze', kind: 'people', alertId: id, choice: '15' }) }
    ],
    nudge: { type: 'people', kind: 'people', personId: due.p.id, name: due.p.name, days: due.since, postponed, snooze: snoozeChoices(c.snooze) }
  }
}

/** Done: the person's last call is today. */
export function personCalled(s: NudgeStore, personId: string, day: string): NudgeStore {
  return { ...s, prefs: { ...s.prefs, people: s.prefs.people.map((p) => (p.id === personId ? { ...p, last: day } : p)) } }
}

/** IN32: back after 5+ minutes away: "Moved?" (once, within 10 minutes, 07–23, under 2 hours away). */
export function awayNudge(c: { now: number; store: NudgeStore; dismissed: Record<string, number>; busy: boolean }): IslandAlert | null {
  const a = c.store.away
  const h = hourOf(c.now)
  if (!a || c.busy || a.min < 5 || a.min > 120 || c.now - a.at > 10 * 60_000 || h < 7 || h >= 23) return null
  const id = `away:${a.at}`
  if ((c.dismissed[id] ?? 0) > c.now) return null
  const min = Math.min(30, a.min)
  return {
    id,
    kind: 'move',
    title: 'Moved?',
    text: `You were away ${a.min} min. A walk counts if you really moved.`,
    face: '🚶',
    actions: [
      { label: `✓ Walked ${min} min`, action: act({ op: 'away', yes: true, min, alertId: id }), primary: true },
      { label: 'No', action: act({ op: 'away', yes: false, min, alertId: id }) }
    ],
    nudge: { type: 'away', kind: 'away', min }
  }
}

/** Idle seconds from the desktop → time away, once you're back (IN32). */
export function noteIdle(s: { maxIdle: number }, sec: number, now: number): { maxIdle: number; back: { min: number; at: number } | null } {
  if (sec >= 60) return { maxIdle: Math.max(s.maxIdle, sec), back: null }
  if (s.maxIdle >= 300) return { maxIdle: 0, back: { min: Math.round(s.maxIdle / 60), at: now } }
  return { maxIdle: 0, back: null }
}

// ---- Logging: move breaks, tallies, undo, fixes ------------------------------------

/** IN7: a confirmed move break in the day's tallies, the logs and "last time". */
export function addMove(s: NudgeStore, log: MoveLog): NudgeStore {
  const next = withDay(s, log.day, (d) => ({ ...d, moves: d.moves + 1, reps: d.reps + log.n, minutes: d.minutes + 2, lastAt: { ...d.lastAt, move: log.at } }))
  return { ...next, logs: [...next.logs, log].slice(-40), last: { ex: log.ex, name: log.name, n: log.n } }
}

/** Undo: the break leaves the tallies (its points and workout are reversed by the caller). */
export function undoMove(s: NudgeStore, logId: string): { store: NudgeStore; log: MoveLog | null } {
  const log = s.logs.find((l) => l.id === logId && !l.undone)
  if (!log) return { store: s, log: null }
  const next = withDay(s, log.day, (d) => ({ ...d, moves: Math.max(0, d.moves - 1), reps: Math.max(0, d.reps - log.n), minutes: Math.max(0, d.minutes - 2) }))
  const prev = [...next.logs].reverse().find((l) => !l.undone && l.id !== logId)
  return { store: { ...next, logs: next.logs.map((l) => (l.id === logId ? { ...l, undone: true } : l)), last: prev ? { ex: prev.ex, name: prev.name, n: prev.n } : null }, log }
}

/** "I only did 12": the count changes (down or up, never below 1; 0 is an undo). */
export function fixMove(s: NudgeStore, logId: string, n: number): { store: NudgeStore; log: MoveLog | null; delta: number } {
  const log = s.logs.find((l) => l.id === logId && !l.undone)
  const to = Math.max(1, Math.min(300, Math.round(n)))
  if (!log || to === log.n) return { store: s, log: null, delta: 0 }
  const delta = to - log.n
  const next = withDay(s, log.day, (d) => ({ ...d, reps: Math.max(0, d.reps + delta) }))
  return { store: { ...next, logs: next.logs.map((l) => (l.id === logId ? { ...l, n: to } : l)), last: s.last && s.logs[s.logs.length - 1]?.id === logId ? { ...s.last, n: to } : s.last }, log: { ...log, n: to }, delta }
}

export function setLog(s: NudgeStore, logId: string, patch: Partial<MoveLog>): NudgeStore {
  return { ...s, logs: s.logs.map((l) => (l.id === logId ? { ...l, ...patch } : l)) }
}

export type TallyKind = 'eyes' | 'posture' | 'postureFix' | 'calm' | 'tidy' | 'walk' | 'mood' | 'gratitude'
/** A quiet tally (no points by itself). Minutes moved: tidy 1, calm 1, a walk its minutes. */
export function tally(s: NudgeStore, day: string, k: TallyKind, now: number, minutes = 0): NudgeStore {
  return withDay(s, day, (d) => {
    const lastKey = k === 'postureFix' ? 'posture' : k === 'calm' ? 'breathe' : k === 'walk' ? 'away' : k
    const base = { ...d, lastAt: { ...d.lastAt, [lastKey]: now } }
    if (k === 'eyes') return { ...base, eyes: d.eyes + 1 }
    if (k === 'posture') return { ...base, posture: d.posture + 1 }
    if (k === 'postureFix') return { ...base, postureFix: d.postureFix + 1 }
    if (k === 'calm') return { ...base, calm: d.calm + 1, minutes: d.minutes + 1 }
    if (k === 'tidy') return { ...base, tidy: d.tidy + 1, minutes: d.minutes + 1 }
    if (k === 'walk') return { ...base, walks: d.walks + 1, minutes: d.minutes + Math.max(0, Math.round(minutes)) }
    if (k === 'mood') return { ...base, moods: d.moods + 1 }
    return { ...base, gratitude: true }
  })
}

/** A nudge was shown or answered now (spacing between two of the same kind). */
export const touched = (s: NudgeStore, day: string, kind: string, now: number): NudgeStore => withDay(s, day, (d) => ({ ...d, lastAt: { ...d.lastAt, [kind]: now } }))

export function addFocusCheck(s: NudgeStore, day: string, f: { at: number; subject: string; answer: FocusAnswer }): NudgeStore {
  return withDay(s, day, (d) => ({ ...d, focus: [...d.focus, f].slice(-12) }))
}

/** A focus check-in's answer as a quality number for the day log (yes 100, drifted 50, switch 70). */
export const focusAnswerPct = (a: FocusAnswer) => (a === 'yes' ? 100 : a === 'drifted' ? 50 : 70)

// ---- IN49: Ben's daily challenge --------------------------------------------------

/** Today's challenge from your Sport Track targets: the biggest reps target (at most 300). */
export function makeChallenge(list: ExerciseLine[]): NudgeChallenge | null {
  const reps = list.filter((e) => e.target > 0 && (!e.unit || e.unit === 'reps'))
  if (!reps.length) return null
  const e = [...reps].sort((a, b) => b.target - a.target)[0]
  return { ex: e.id, name: e.name, target: Math.min(300, Math.max(10, e.target)), paid: null, said: [] }
}

/** Reps of the challenge's exercise logged in move breaks today (undone ones don't count). */
export function challengeDone(s: NudgeStore, day: string, ch: NudgeChallenge): number {
  return s.logs.filter((l) => l.day === day && !l.undone && (l.ex === ch.ex || l.name.toLowerCase() === ch.name.toLowerCase())).reduce((t, l) => t + l.n, 0)
}

export function challengeView(ch: NudgeChallenge, s: NudgeStore, day: string): { done: number; target: number; pct: number; text: string; complete: boolean } {
  const done = challengeDone(s, day, ch)
  const pct = Math.min(1, done / ch.target)
  const name = ch.name.toLowerCase()
  const text = pct >= 1 ? `Challenge done: ${ch.target} ${name} in breaks. 😎` : `Today: ${ch.target} ${name} in breaks · ${done} so far`
  return { done, target: ch.target, pct, text, complete: pct >= 1 }
}

/** Ben's line when you pass 25, 50, 75 or 100 % (each once a day). */
export function challengeLine(ch: NudgeChallenge, done: number): { mark: number; line: string } | null {
  const pct = (done / ch.target) * 100
  const mark = [100, 75, 50, 25].find((m) => pct >= m)
  if (!mark || (ch.said ?? []).includes(mark)) return null
  const name = ch.name.toLowerCase()
  const left = Math.max(0, ch.target - done)
  const line = mark === 100 ? `${ch.target} ${name} done. That's the challenge. 😎` : mark === 75 ? `${done} ${name}. ${left} to go, finish it.` : mark === 50 ? `Halfway: ${done} of ${ch.target} ${name}.` : `${done} ${name} in. Good start.`
  return { mark, line }
}

// ---- IN51 / IN15: streak and ring ---------------------------------------------------

/** Days in a row with 3+ move breaks (today counts once it has 3; else it starts from yesterday). */
export function moveStreak(s: NudgeStore, today: string): number {
  const ok = (d: string) => (s.days[d]?.moves ?? 0) >= 3
  let d = ok(today) ? today : addDays(today, -1)
  let n = 0
  while (ok(d) && n < 3650) {
    n++
    d = addDays(d, -1)
  }
  return n
}

export interface MovePill {
  /** Today against your ring goal (reps or minutes). */
  done: number
  goal: number
  unit: 'reps' | 'min'
  breaks: number
  streak: number
  best: number
  challenge: { name: string; done: number; target: number } | null
  /** "+3" shown on the pill for a few seconds after a paid break. */
  plus: { coins: number; at: number } | null
}

export function movePill(s: NudgeStore, day: string, now: number): MovePill {
  const d = dayOf(s, day)
  const ch = s.prefs.challenge && d.challenge ? challengeView(d.challenge, s, day) : null
  const last = [...s.logs].reverse().find((l) => !l.undone && l.coins > 0)
  const streak = moveStreak(s, day)
  return {
    done: s.prefs.ringUnit === 'min' ? d.minutes : d.reps,
    goal: s.prefs.ringGoal,
    unit: s.prefs.ringUnit,
    breaks: d.moves,
    streak,
    best: Math.max(s.best, streak),
    challenge: ch && d.challenge ? { name: d.challenge.name, done: ch.done, target: ch.target } : null,
    plus: last && now - last.at < 8000 ? { coins: last.coins, at: last.at } : null
  }
}

/** Does the challenge need its bonus paid (complete, not yet), or taken back (undone below target)? */
export function challengeBonus(ch: NudgeChallenge | null | undefined, done: number): 'pay' | 'undo' | null {
  if (!ch) return null
  if (done >= ch.target && !ch.paid) return 'pay'
  if (done < ch.target && ch.paid) return 'undo'
  return null
}

export const nudgeHm = hm

/** What the island's toast says while a nudge tap is on its way (null: no toast, nothing to wait for). */
export function nudgeTapLabel(op: NudgeOp): string | null {
  switch (op.op) {
    case 'move':
      return `💪 +${op.n} ${op.name}`
    case 'undo':
      return '↶ Undoing'
    case 'fix':
      return `✓ ${op.n} it is`
    case 'water':
      return `💧 +${op.ml} ml`
    case 'snooze':
      return '⏰ Later'
    case 'tally':
      return op.kind === 'eyes' ? '👁️ Eye break' : op.kind === 'posture' ? '🪑 Noted' : op.kind === 'breathe' ? '🫧 Calm minute' : '🧹 Tidy minute'
    case 'mood':
      return 'Mood noted'
    case 'gratitude':
      return 'Saving to Notebook…'
    case 'focus':
      return op.answer === 'switch' ? 'Logging…' : 'Noted'
    case 'person':
      return op.done ? '📞 Noted' : null
    case 'away':
      return op.yes ? `🚶 ${op.min} min walk` : null
    default:
      return null
  }
}

/** Settings: what learning made of a kind (peek: as normal, dot: only a dot). */
export function learnedLevel(stats: SuggestStats, kind: string): 'peek' | 'dot' {
  return learned(stats, `n:${kind}`) === 'peek' ? 'peek' : 'dot'
}
