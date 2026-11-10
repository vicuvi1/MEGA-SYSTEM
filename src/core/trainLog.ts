// Body → Training: today's session on your levels, fast set logging, and the
// progression roadmap (level-up, step back, the "at your pace" estimate,
// placement from your best sets). Everything lives inside Sport Track's state
// so it syncs with it (sport_tracker_json):
//   trainWeek   the weekly split (trainWeek.ts)
//   trainLadders { ladders, updatedAt }: your edited ladders (trainLadders.ts)
//   trainLevels { [ladder]: { level, reached: { [level]: day }, at, declinedOn? } }
//   trainLog    the sessions: { id, date, type, exercises, startedAt, durationSec }
//   trainGear   what you can train with (trainGear.ts); the plan only uses moves it allows
//   trainPicks  { day, at, moves: { [ladder]: Level } }: the move you chose for today only (the swap sheet)
// Sets go to the same set log as Sport Track (sets[day][exerciseId]), with
// rir / feel / session added. Pure and tested (trainLog.test.ts). Nothing
// here pays points: a finished workout is logged like any other workout.
import { moveById } from './sportMoves'
import { moveOf } from './sportLadders'
import { atTop, belowBottom, NEED, type RepRange } from './sportProgress'
import { setsOn, setsText, shiftDay, type SetEntry, type SetLog } from './sportSets'
import { estimateSets, isImported } from './sportLevels'
import { cleanLadders, laddersFor, moveInfo, moveName, rangeText, type Ladder, type LadderId, type Level } from './trainLadders'
import { allowed, cleanGear, effectiveLevel, stepFrom, type Gear } from './trainGear'
import { cleanWeek, daysBetween, SESSION_RULES, type DoneSession, type SessionType, type TrainWeek } from './trainWeek'

export type Feel = 'hard' | 'ok' | 'easy'
/** Reps in reserve for an effort tap: hard 0–1, ok 2–3, easy 4+. */
export const RIR: Record<Feel, number> = { hard: 1, ok: 2, easy: 4 }
export const feelToRir = (f: Feel) => RIR[f]

export interface TrainSet {
  reps: number
  kg?: number
  feel?: Feel
  /** 'off': your form broke on this set. */
  form?: 'off'
}
export interface SessionExercise {
  ladder: LadderId
  move: string
  exId: string
  sets: TrainSet[]
}
export interface TrainSession {
  id: string
  date: string
  type: SessionType
  exercises: SessionExercise[]
  startedAt: number
  durationSec: number
  /** Finished with "Finish workout". */
  done?: boolean
}
export interface LevelState {
  level: number
  /** Level index → the day you reached it. */
  reached: Record<string, string>
  /** Last change (ms): the newer device wins. */
  at: number
  /** "Not yet" / "Stay here" on this day: the suggestion waits for a newer session. */
  declinedOn?: string
}
export type Levels = Partial<Record<LadderId, LevelState>>

/** "Use this move today": your step stays, today's plan uses this move (any other day it is your step again). */
export interface TrainPicks {
  day: string
  at: number
  moves: Partial<Record<LadderId, Level>>
}

export interface TrainData {
  week: TrainWeek
  ladders: Ladder[]
  levels: Levels
  log: TrainSession[]
  /** What you can train with (null: not set yet, nothing is ruled out). */
  gear: Gear | null
  picks: TrainPicks | null
}

function cleanPicks(x: any): TrainPicks | null {
  if (!x || typeof x.day !== 'string' || !x.moves || typeof x.moves !== 'object') return null
  const moves: TrainPicks['moves'] = {}
  for (const [k, v] of Object.entries<any>(x.moves)) {
    const info = v && typeof v.move === 'string' ? moveInfo(v.move) : null
    if (!info) continue
    const lo = Math.max(1, Math.min(300, Math.round(Number(v.lo) || 1)))
    moves[k as LadderId] = { move: v.move, lo, hi: Math.max(lo, Math.min(300, Math.round(Number(v.hi) || lo))), unit: info.unit }
  }
  return { day: x.day, at: Number(x.at) || 0, moves }
}

/** Our part of Sport Track's state, cleaned. */
export function trainOf(st: any): TrainData {
  const lv: Levels = {}
  for (const [k, v] of Object.entries<any>(st?.trainLevels ?? {}))
    if (v && Number.isFinite(Number(v.level))) lv[k as LadderId] = { level: Math.max(0, Math.round(Number(v.level))), reached: v.reached && typeof v.reached === 'object' ? { ...v.reached } : {}, at: Number(v.at) || 0, ...(v.declinedOn ? { declinedOn: String(v.declinedOn) } : {}) }
  return {
    week: cleanWeek(st?.trainWeek),
    ladders: cleanLadders(st?.trainLadders?.ladders),
    levels: lv,
    log: Array.isArray(st?.trainLog) ? st.trainLog.filter((s: any) => s && typeof s.id === 'string' && typeof s.date === 'string' && Array.isArray(s.exercises)) : [],
    gear: cleanGear(st?.trainGear),
    picks: cleanPicks(st?.trainPicks)
  }
}

/** Sessions with at least one set, as the week reads them. */
export const doneSessions = (log: TrainSession[]): DoneSession[] => log.filter((s) => s.exercises.some((e) => e.sets.length)).map((s) => ({ date: s.date, type: s.type }))

// ---------- history of a move ----------

/** What an exercise's `move` says: the library id, or `t:<id>` for a move only Body Training has (Sport Track never guesses those from the name). */
export const exMoveTag = (move: string) => (moveById(move) ? move : `t:${move}`)

/** Sport Track exercises that are this move (a library move by its move or name; one of ours by its id). */
export function exIdsFor(exercises: any[], move: string): string[] {
  const lib = moveById(move)
  const tag = exMoveTag(move)
  return (Array.isArray(exercises) ? exercises : []).filter((e) => e && (e.move === tag || (lib && moveOf(e)?.id === move))).map((e) => String(e.id))
}

export interface MoveSession {
  day: string
  sets: SetEntry[]
  reps: number[]
}

/** The days you logged sets of a move (any of its exercises), oldest first, up to `until`. */
export function moveSessions(st: any, move: string, until?: string): MoveSession[] {
  const ids = exIdsFor(st?.exercises, move)
  const log: SetLog = st?.sets ?? {}
  const out: MoveSession[] = []
  for (const day of Object.keys(log).sort()) {
    if (until && day > until) continue
    const sets = ids.flatMap((id) => setsOn(log, day, id)).filter((s) => !s.test).sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0))
    if (sets.length) out.push({ day, sets, reps: sets.map((s) => Math.round(Number(s.reps) || 0)) })
  }
  return out
}

/** The last session before `today` (null: never). */
export function lastTime(sessions: MoveSession[], today: string): MoveSession | null {
  const past = sessions.filter((s) => s.day < today)
  return past[past.length - 1] ?? null
}

/** "Last time: 9 · 8 · 8 → aim to beat it", or a first-time line. */
export function lastLine(last: MoveSession | null, level: Level, sets: number): string {
  if (!last) return `First time: ${sets} sets of ${level.lo}–${level.hi}${level.unit === 'sec' ? ' s' : ''}. Stop with 1–3 reps left.`
  const kg = Math.max(0, ...last.sets.map((s) => Number(s.kg) || 0))
  return `Last time: ${setsText(last.reps.slice(0, Math.max(sets, last.reps.length)), level.unit)}${kg ? ` +${kg} kg` : ''} → aim to beat it`
}

/** "Same as last time": the last session's sets for every set today (the last one repeated if you did fewer), else the bottom of the range. */
export function sameAsLast(last: MoveSession | null, sets: number, level: Level): TrainSet[] {
  return Array.from({ length: sets }, (_, i) => {
    const src = last?.sets[Math.min(i, (last?.sets.length ?? 1) - 1)]
    const s: TrainSet = { reps: src ? Math.round(Number(src.reps) || level.lo) : level.lo }
    if (src && Number(src.kg) > 0) s.kg = Number(src.kg)
    return s
  })
}

// ---------- levels ----------

/** Working sets per move in a session: the first move of the day gets 4, the others 3 (the old rule; ladderSets is used now). */
export const setsFor = (index: number, type: SessionType) => (type === 'upper' && index === 0 ? 4 : 3)

/** The muscle group a ladder trains hard (shoulders count as push, like the body map). */
export const LADDER_MUSCLE: Record<LadderId, 'push' | 'pull' | 'legs' | 'core'> = { push: 'push', shoulders: 'push', pull: 'pull', single: 'legs', hinge: 'legs', core: 'core' }
/** Hard sets per muscle group a week: about 14, never under 10 or over 20 when the week allows it. */
export const WEEK_SETS = { lo: 10, aim: 14, hi: 20 }

/**
 * Working sets of a ladder in each session at the full dose, so every muscle group gets about 10-20 hard
 * sets a week from your split: the muscle's weekly aim is shared by its sessions, then by its ladders in
 * that session (the first one gets the extra set). 2 to 5 sets a move.
 * Default week (3 upper, 2 legs + core): push 3 + shoulders 2, pull 5, single-leg 4 + hinge 3, core 5.
 */
export function ladderSets(week: TrainWeek, ladders: Ladder[], ladder: Ladder): number {
  const mu = LADDER_MUSCLE[ladder.id]
  const n = week.days.filter((d) => d === ladder.type).length || 1
  const per = Math.max(Math.ceil(WEEK_SETS.lo / n), Math.min(Math.floor(WEEK_SETS.hi / n), Math.round(WEEK_SETS.aim / n)))
  const peers = laddersFor(ladders, ladder.type).filter((l) => LADDER_MUSCLE[l.id] === mu)
  const k = Math.max(1, peers.length)
  const i = Math.max(0, peers.indexOf(ladder))
  const share = Math.floor(per / k) + (i < per % k ? 1 : 0)
  return Math.max(2, Math.min(5, share))
}

/** Hard sets a week per muscle group from your split at the full dose. */
export function weeklySets(data: Pick<TrainData, 'week' | 'ladders'>): Record<'push' | 'pull' | 'legs' | 'core', number> {
  const out = { push: 0, pull: 0, legs: 0, core: 0 }
  for (const l of data.ladders) out[LADDER_MUSCLE[l.id]] += ladderSets(data.week, data.ladders, l) * data.week.days.filter((d) => d === l.type).length
  return out
}

/** How much today: Full, Lighter or Short (readiness or your pick). */
export type Dose = 'full' | 'light' | 'short'
/** Sets today at a dose: Lighter is one set less, Short is 2 sets (never more than planned). */
export const doseSets = (sets: number, dose: Dose = 'full') => (dose === 'short' ? Math.min(sets, 2) : dose === 'light' ? Math.max(Math.min(sets, 2), sets - 1) : sets)

const rangeOf = (v: Level, sets: number): RepRange => ({ lo: v.lo, hi: v.hi, sets, unit: v.unit })

export interface LevelStatus {
  state: 'new' | 'building' | 'complete' | 'struggling'
  /** Complete: why, in a few words ("you hit 4×12 easy"). */
  reason?: string
  /** Complete: how many levels to move up (2 when it was far too easy). */
  jump?: number
  /** How the last session's working sets felt (null: not tapped). */
  effort?: Effort | null
  /** Sessions in a row at the top of the range (of 2). */
  hits: number
  need: number
  /** Sets at the top of the range toward a level-up, and how many are needed (2 sessions × sets). */
  topSets: number
  needSets: number
  /** 0–1 */
  pct: number
  sessions: number
  line: string
}

export type Effort = 'easy' | 'ok' | 'hard'
/**
 * How a session's working sets felt: easy when every one was tapped Easy, ok when all were OK or Easy (the
 * target: 1-2 reps left), hard when any was Hard; null when a working set was not tapped.
 */
export function effortOf(s: { sets: SetEntry[] } | null | undefined, sets: number): Effort | null {
  const w = (s?.sets ?? []).slice(0, sets)
  if (!w.length || w.some((x) => !x.feel)) return null
  if (w.some((x) => x.feel === 'hard')) return 'hard'
  return w.every((x) => x.feel === 'easy') ? 'easy' : 'ok'
}

/** The optional form check: no working set marked "form broke". */
export const formOk = (s: { sets: SetEntry[] } | null | undefined, sets: number) => !(s?.sets ?? []).slice(0, sets).some((x) => x.form === 'off')

/**
 * Where you stand on a level, from the sessions since you reached it. Complete (double progression): every
 * working set at the top of the range in 2 sessions in a row, at the target effort (each set tapped OK or Easy,
 * or not tapped; a session with a Hard set or a "form broke" set doesn't count). The next level is then offered: you choose Apply or
 * Keep (it never moves by itself). Easy both times and far past the top: two levels up. Struggling: the
 * bottom of the range not reached in the last 2 sessions on this level.
 */
export function levelStatus(sessions: MoveSession[], level: Level, sets: number, since?: string | null): LevelStatus {
  const list = since ? sessions.filter((s) => s.day >= since) : sessions
  const r = rangeOf(level, sets)
  const needSets = NEED * sets
  const u = level.unit === 'sec' ? ' s' : ''
  if (!list.length) return { state: 'new', hits: 0, need: NEED, topSets: 0, needSets, pct: 0, sessions: 0, line: `Not started: ${sets}×${level.lo}${u} to begin, ${sets}×${level.hi}${u} twice to unlock the next move.` }
  let hits = 0
  for (let i = list.length - 1; i >= 0 && atTop(list[i], r) && effortOf(list[i], sets) !== 'hard' && formOk(list[i], sets); i--) hits++
  const lastS = list[list.length - 1]
  const partial = hits ? 0 : lastS.reps.slice(0, sets).filter((x) => x >= level.hi).length
  const topSets = Math.min(needSets, hits * sets + partial)
  const effort = effortOf(lastS, sets)
  const base = { hits: Math.min(hits, NEED), need: NEED, topSets, needSets, pct: topSets / needSets, sessions: list.length, effort }
  if (hits >= NEED) {
    const two = list.slice(-NEED)
    const feels = two.map((s) => effortOf(s, sets))
    const easy = feels.every((f) => f === 'easy')
    const way = Math.max(3, Math.ceil(level.hi * 0.25))
    const far = easy && two.every((s) => s.reps.slice(0, sets).every((x) => x >= level.hi + way))
    const how = easy ? 'easy twice' : feels.every((f) => f === 'easy' || f === 'ok') ? 'twice with 1–2 reps left' : `in ${NEED} sessions in a row`
    const reason = `${sets}×${level.hi}${u} ${how}`
    return { ...base, pct: 1, topSets: needSets, state: 'complete', reason, jump: far ? 2 : 1, line: `Step complete: ${reason}.` }
  }
  const lastTwo = list.slice(-2)
  if (lastTwo.length === 2 && lastTwo.every((s) => belowBottom(s, r))) return { ...base, state: 'struggling', line: `Under ${level.lo}${u} twice. Stay here a bit longer, or go one step back.` }
  const hardTop = atTop(lastS, r) && (effort === 'hard' || !formOk(lastS, sets))
  return { ...base, state: 'building', line: hardTop ? `${sets}×${level.hi}${u}, but ${effort === 'hard' ? 'it was hard' : 'your form broke'}. Once more with 1–2 reps left and good form counts.` : hits ? `1 of ${NEED} sessions at the top. One more (not hard) unlocks the next move.` : `${topSets} of ${needSets} sets at the top (${level.hi}${u}).` }
}

export interface CurrentLevel {
  index: number
  placed: boolean
  since: string | null
}

/**
 * Your level on a ladder: what you chose (or applied), else placement from your best sets. With `today`, your
 * daily totals of the last 60 days count toward placement too (old rep logs place you). The level never moves
 * by itself: a completed level is offered (PlanItem.offer) and you choose Apply or Keep.
 */
export function currentLevel(st: any, data: TrainData, ladder: Ladder, today?: string): CurrentLevel {
  const s = data.levels[ladder.id]
  if (s) {
    const index = Math.min(ladder.levels.length - 1, s.level)
    return { index, placed: false, since: s.reached[String(index)] ?? null }
  }
  return { index: placeLadder(ladder, (m) => bestOf(st, m, today)), placed: true, since: null }
}

/** How far back day totals count for placement. */
export const TOTALS_DAYS = 60

/**
 * Your best single set of a move: logged sets of it, or a best set you told Sport Track. With `today`, your
 * daily totals of the last 60 days count too, as the first set of an even split (130 push-ups in a day is
 * about 6 sets of 22, so 22): old rep logs still place you. Telegram-imported days never do.
 */
export function bestOf(st: any, move: string, today?: string): number | null {
  let best = 0
  for (const s of moveSessions(st, move)) for (const r of s.reps) best = Math.max(best, r)
  for (const b of Object.values<any>(st?.bestSets ?? {})) if (b && b.move === move) best = Math.max(best, Number(b.reps) || 0)
  if (today) {
    const ids = exIdsFor(st?.exercises, move)
    const from = shiftDay(today, -TOTALS_DAYS)
    const unit = moveInfo(move)?.unit ?? 'reps'
    for (const [day, m] of Object.entries<any>(st?.days ?? {})) {
      if (day < from || day > today || !m) continue
      for (const id of ids) {
        if (isImported(st?.importedDays, day, id)) continue
        best = Math.max(best, estimateSets(Number(m[id]) || 0, unit)[0] ?? 0)
      }
    }
  }
  return best > 0 ? best : null
}

/** Each harder level, about 70% of the reps you could do on the one before. */
export const TRANSFER = 0.7

/**
 * Placement from your best single sets: a best set counts toward harder levels at 70% of the reps per
 * step. You start on the hardest level where that still clears the top of its range with room to spare
 * (3 reps, or 10 seconds): your working sets sit inside the range, and a level that is too easy is
 * complete after 2 sessions. 50 push-ups → archer push-ups.
 */
export function placeLadder(ladder: Ladder, best: (move: string) => number | null): number {
  const proj = ladder.levels.map(() => 0)
  ladder.levels.forEach((v, i) => {
    const b = best(v.move)
    if (!b) return
    for (let j = i; j < ladder.levels.length; j++) proj[j] = Math.max(proj[j], b * TRANSFER ** (j - i))
  })
  let at = 0
  ladder.levels.forEach((v, j) => {
    if (proj[j] >= v.hi + (v.unit === 'sec' ? 10 : 3)) at = j
  })
  return at
}

// ---------- the roadmap estimate ----------

export interface Estimate {
  weeks: number | null
  line: string
}

/**
 * "At your pace: ~3 weeks to archer push-ups", from how fast your average working set grows (a straight
 * line through the last up to 8 sessions on this level). Fewer than 3 sessions: not enough data yet.
 */
export function estimateLevelUp(sessions: MoveSession[], level: Level, sets: number, nextName: string | null, since?: string | null): Estimate {
  const list = (since ? sessions.filter((s) => s.day >= since) : sessions).slice(-8)
  const target = nextName ? `to ${nextName}` : 'to finish this ladder'
  if (list.length < 3) return { weeks: null, line: `Not enough data yet: ${3 - list.length} more ${3 - list.length === 1 ? 'session' : 'sessions'} for an estimate.` }
  if (levelStatus(list, level, sets).state === 'complete') return { weeks: 0, line: `Ready now: move up ${target}.` }
  const pts = list.map((s) => {
    const w = s.reps.slice(0, sets)
    return { x: daysBetween(list[0].day, s.day), y: w.reduce((a, b) => a + b, 0) / w.length }
  })
  const n = pts.length
  const mx = pts.reduce((a, p) => a + p.x, 0) / n
  const my = pts.reduce((a, p) => a + p.y, 0) / n
  const sxx = pts.reduce((a, p) => a + (p.x - mx) ** 2, 0)
  const slope = sxx ? pts.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0) / sxx : 0
  if (slope <= 0.02) return { weeks: null, line: 'No growth in the last sessions yet: sleep, full food, and one more rep per set.' }
  const now = pts[n - 1].y
  // Reach the top, then one more session there (about 2–3 days later).
  const days = Math.max(0, (level.hi - now) / slope) + 3
  const weeks = Math.max(1, Math.round(days / 7))
  return { weeks, line: `At your pace: ~${weeks} ${weeks === 1 ? 'week' : 'weeks'} ${target}.` }
}

// ---------- today's session ----------

export interface PlanItem {
  ladder: Ladder
  index: number
  level: Level
  name: string
  sets: number
  placed: boolean
  since: string | null
  last: MoveSession | null
  /** The newest session of this move, today's included. */
  latest: MoveSession | null
  lastLine: string
  status: LevelStatus
  next: Level | null
  /** Working sets at the full dose (sets is today's, after Lighter / Short). */
  fullSets: number
  /** The next level is unlocked and waits for your choice: Apply (move up) or Keep (stay, asked again after a newer session). */
  offer: Offer | null
  /** What happens next time, from today's sets (null until you log one today). */
  nextTime: NextTime | null
  /** Your step needs gear you don't have: this move stands in for it. */
  swapped: boolean
  /** This move is not a step of the chain (a floor pull on the pull chain). */
  alt: boolean
  /** You chose this move for today only (the swap sheet). */
  picked: boolean
}

export interface Offer {
  /** The level index Apply moves you to. */
  to: number
  move: string
  name: string
  /** "3 × 6–12" */
  target: string
  /** "3×12 easy twice" */
  reason: string
  /** "Unlocked: Decline push-ups, because 3×12 easy twice." */
  line: string
}

export interface NextTime {
  /** up: a harder level is unlocked (Apply or Keep) · stay: same level, same aim · reps: beat it by a rep · down: stay or one level back · top: the ladder is done. */
  kind: 'up' | 'stay' | 'reps' | 'down' | 'top'
  /** The move for next time. */
  move: string
  line: string
}

/**
 * "Unlocked: Decline push-ups 4 × 6–12, because 4×12 easy twice": what today's sets of a move mean for
 * the next session, by the same rules that pick that session (levelStatus, currentLevel). Null with no set today.
 */
export function nextTimeOf(p: { ladder: Ladder; index: number; level: Level; name: string; fullSets: number; latest: MoveSession | null; status: LevelStatus; gear?: Gear | null }, today: string): NextTime | null {
  const t = p.latest && p.latest.day === today ? p.latest : null
  if (!t) return null
  const { level, fullSets: sets, status } = p
  const u = level.unit === 'sec' ? ' s' : ''
  if (status.state === 'complete') {
    if (p.index >= p.ladder.levels.length - 1) return { kind: 'top', move: level.move, line: `Next time: ${p.name} with a slow tempo (3 s down, 1 s pause), because ${status.reason}. This is the top of the ladder.` }
    const at = stepFrom(p.ladder, Math.min(p.ladder.levels.length - 1, p.index + (status.jump ?? 1)), 1, p.gear)
    if (at == null) return { kind: 'top', move: level.move, line: `Next time: ${p.name} with a slow tempo (3 s down, 1 s pause), because ${status.reason}. Your gear has no harder step on this chain.` }
    const to = p.ladder.levels[at]
    return { kind: 'up', move: to.move, line: `Unlocked: ${moveName(to.move)} ${sets} × ${rangeText(to)}, because ${status.reason}.` }
  }
  if (status.state === 'struggling') {
    const back = p.ladder.levels[p.index - 1]
    return { kind: 'down', move: level.move, line: `Next time: stay on ${p.name}${back ? ` or go one step back to ${moveName(back.move)}` : ''}, because you stayed under ${level.lo}${u} twice.` }
  }
  const w = t.reps.slice(0, sets)
  if (w.length >= sets && w.every((x) => x >= level.hi))
    return status.hits >= 1
      ? { kind: 'stay', move: level.move, line: `Next time: ${p.name} ${sets} × ${level.hi}${u} again, because one more session at the top unlocks the next move.` }
      : { kind: 'stay', move: level.move, line: `Next time: ${p.name} ${sets} × ${level.hi}${u} again, because you reached the top but it was hard. Twice with 1–2 reps left unlocks the next move.` }
  const step = level.unit === 'sec' ? 5 : 1
  const aim = Array.from({ length: sets }, (_, i) => Math.min(level.hi, w[i] ?? w[w.length - 1] ?? level.lo))
  const low = aim.indexOf(Math.min(...aim))
  aim[low] = Math.min(level.hi, aim[low] + step)
  return { kind: 'reps', move: level.move, line: `Next time: ${p.name} ${setsText(aim, level.unit)}, because ${w.length < sets ? `${sets} sets is the plan` : `one more ${level.unit === 'sec' ? '5 s' : 'rep'} on your lowest set is how you grow`}.` }
}

/** Today's moves for a session type, each on your current level, at today's dose; a completed level carries its offer. */
export function sessionItems(st: any, data: TrainData, type: SessionType, today: string, dose: Dose = 'full'): PlanItem[] {
  return laddersFor(data.ladders, type).map((ladder) => {
    const cur = currentLevel(st, data, ladder, today)
    const stored = data.levels[ladder.id]
    // Your gear decides which move stands in for your step; "Use today" (the swap sheet) wins for today only.
    const eff = effectiveLevel(ladder, cur.index, data.gear)
    const pick = data.picks?.day === today ? data.picks.moves[ladder.id] : undefined
    const picked = !!pick && pick.move !== eff.level.move && allowed(pick.move, data.gear)
    const level = picked ? pick! : eff.level
    const at = picked ? ladder.levels.findIndex((x) => x.move === pick!.move) : -1
    const index = picked ? (at >= 0 ? at : eff.index) : eff.index
    const alt = picked ? at < 0 : eff.alt
    const fullSets = ladderSets(data.week, data.ladders, ladder)
    const sets = doseSets(fullSets, dose)
    const all = moveSessions(st, level.move, today)
    const last = lastTime(all, today)
    const since = eff.swapped || picked ? null : cur.since
    const nextAt = alt ? null : stepFrom(ladder, index + 1, 1, data.gear)
    const item: PlanItem = {
      ladder,
      index,
      level,
      name: moveName(level.move),
      sets,
      placed: cur.placed,
      since,
      last,
      latest: all[all.length - 1] ?? null,
      lastLine: lastLine(last, level, sets),
      status: levelStatus(all, level, fullSets, since),
      next: nextAt == null ? null : ladder.levels[nextAt],
      fullSets,
      offer: null,
      nextTime: null,
      swapped: eff.swapped,
      alt,
      picked
    }
    // A stand-in or a one-day pick is not your step: it offers nothing (its sets still count for that move).
    item.offer = alt || picked ? null : offerOf(item, stored?.declinedOn, data.gear)
    item.nextTime = alt ? null : nextTimeOf({ ...item, gear: data.gear }, today)
    return item
  })
}

/** The next level unlocked by a completed one, unless you chose Keep after your newest session (null: nothing to offer). */
export function offerOf(p: Pick<PlanItem, 'ladder' | 'index' | 'status' | 'latest' | 'fullSets'>, declinedOn?: string, gear?: Gear | null): Offer | null {
  if (p.status.state !== 'complete' || p.index >= p.ladder.levels.length - 1) return null
  if (!suggestNow(p.status, p.latest, declinedOn)) return null
  // The next step your gear allows (a step that needs gear you don't own is skipped).
  const to = stepFrom(p.ladder, Math.min(p.ladder.levels.length - 1, p.index + (p.status.jump ?? 1)), 1, gear)
  if (to == null) return null
  const lv = p.ladder.levels[to]
  const name = moveName(lv.move)
  return { to, move: lv.move, name, target: `${p.fullSets} × ${rangeText(lv)}`, reason: p.status.reason ?? '', line: `Unlocked: ${name}, because ${p.status.reason}.` }
}

/** About how long a session takes: warm-up, ~40 s a set (twice for one-leg moves), 75 s rest between sets. */
export function sessionMinutes(items: { sets: number; level: Level }[]): number {
  let sec = SESSION_RULES.warmupMin * 60
  let total = 0
  for (const it of items) {
    const perSide = ['split_squat', 'bulgarian_squat', 'bss_load', 'box_pistol', 'pistol_squat', 'single_leg_bridge', 'sl_rdl', 'archer_pushup', 'archer_pullup'].includes(it.level.move) ? 2 : 1
    sec += it.sets * (it.level.unit === 'sec' ? it.level.hi : 40) * perSide
    total += it.sets
  }
  sec += Math.max(0, total - 1) * 75
  return Math.round(sec / 60)
}

// ---------- saving (changes Sport Track's state in place; the page passes it to updateSport) ----------

/** The Sport Track exercise for a move: yours when you have one, else a new one (off in Sport Track's Today). */
export function ensureExercise(st: any, move: string, level: Level, sets: number): string {
  st.exercises = Array.isArray(st.exercises) ? st.exercises : []
  const ids = exIdsFor(st.exercises, move)
  if (ids.length) return ids[0]
  const id = `ex_t_${move}`
  st.exercises.push({ id, name: moveName(move), target: sets * level.lo, unit: level.unit, active: false, doneToday: 0, move: exMoveTag(move), train: true })
  return id
}

/** Logs one set: into the set log (with effort and session), the day total and today's count. */
export function logSet(st: any, input: { day: string; exId: string; set: TrainSet; session: string; now: number; salt?: string }): SetEntry {
  const { day, exId, set, session, now } = input
  const e: SetEntry = { reps: Math.max(0, Math.min(2000, Math.round(set.reps))), at: now, id: `${now.toString(36)}${input.salt ?? Math.random().toString(36).slice(2, 6)}`, session }
  if (set.kg && set.kg > 0) e.kg = Math.round(set.kg * 2) / 2
  if (set.feel) {
    e.feel = set.feel
    e.rir = feelToRir(set.feel)
  }
  if (set.form === 'off') e.form = 'off'
  st.sets = st.sets ?? {}
  const list = ((st.sets[day] ??= {})[exId] ??= [])
  list.push(e)
  st.days = st.days ?? {}
  const dm = (st.days[day] ??= {})
  dm[exId] = (Number(dm[exId]) || 0) + e.reps
  const ex = (st.exercises ?? []).find((x: any) => String(x.id) === exId)
  if (ex && st.lastDate === day) ex.doneToday = (Number(ex.doneToday) || 0) + e.reps
  return e
}

/** Takes a logged set back out (by its id): the set, the day total and today's count. */
export function unlogSet(st: any, day: string, exId: string, setId: string): boolean {
  const list: SetEntry[] = st?.sets?.[day]?.[exId] ?? []
  const i = list.findIndex((s) => s.id === setId)
  if (i < 0) return false
  const [e] = list.splice(i, 1)
  if (!list.length) delete st.sets[day][exId]
  const dm = st.days?.[day]
  if (dm) {
    dm[exId] = Math.max(0, (Number(dm[exId]) || 0) - e.reps)
    if (!dm[exId]) delete dm[exId]
  }
  const ex = (st.exercises ?? []).find((x: any) => String(x.id) === exId)
  if (ex && st.lastDate === day) ex.doneToday = Math.max(0, (Number(ex.doneToday) || 0) - e.reps)
  return true
}

/** Adds or replaces a session in the training log (newest first, at most 400). */
export function saveSession(st: any, rec: TrainSession): void {
  const list: TrainSession[] = Array.isArray(st.trainLog) ? st.trainLog.filter((s: any) => s?.id !== rec.id) : []
  list.unshift(rec)
  st.trainLog = list.sort((a, b) => b.startedAt - a.startedAt).slice(0, 400)
}

/** A session's record, read back from the set log (so an undone set is gone from it too). */
export function sessionFromSets(st: any, input: { id: string; date: string; type: SessionType; items: { ladder: LadderId; move: string; exId: string }[]; startedAt: number; now: number; done?: boolean }): TrainSession {
  const exercises: SessionExercise[] = input.items.map((it) => ({
    ladder: it.ladder,
    move: it.move,
    exId: it.exId,
    sets: setsOn(st?.sets, input.date, it.exId)
      .filter((s) => s.session === input.id)
      .map((s) => ({ reps: s.reps, ...(s.kg ? { kg: s.kg } : {}), ...(s.feel ? { feel: s.feel } : {}), ...(s.form === 'off' ? { form: 'off' as const } : {}) }))
  }))
  return { id: input.id, date: input.date, type: input.type, exercises, startedAt: input.startedAt, durationSec: Math.max(0, Math.round((input.now - input.startedAt) / 1000)), ...(input.done ? { done: true } : {}) }
}

/** The workout to log for points (the usual "Workout done", once a day), or null when no set was logged. */
export function workoutOf(rec: TrainSession): { title: string; items: { exerciseId: string; name: string; unit: string; amount: number; sets: { reps: number; weight?: number }[] }[]; note: string } | null {
  const items = rec.exercises
    .filter((e) => e.sets.length)
    .map((e) => ({ exerciseId: e.exId, name: moveName(e.move), unit: moveInfo(e.move)?.unit === 'sec' ? 'seconds' : 'reps', amount: e.sets.reduce((n, s) => n + s.reps, 0), sets: e.sets.map((s) => ({ reps: s.reps, ...(s.kg ? { weight: s.kg } : {}) })) }))
  if (!items.length) return null
  const name = rec.type === 'upper' ? 'Upper body' : 'Legs + core'
  return { title: `${name}: ${items.map((i) => `${i.name} ${setsText(i.sets.map((x) => x.reps), i.unit === 'seconds' ? 'sec' : 'reps')}`).join(', ')}`.slice(0, 120), items, note: 'Body training' }
}

/** Keeps the level a session was done at: placement becomes your level the first time you train it (with `day`, the day it was reached). */
export function keepLevel(st: any, ladder: LadderId, index: number, now: number, day?: string): void {
  const lv = (st.trainLevels ??= {})
  if (!lv[ladder]) lv[ladder] = { level: index, reached: day ? { [String(index)]: day } : {}, at: now }
}

/**
 * Moves your level on a ladder (Apply after a level-up, back after struggling, or any level you tap).
 * `keep`: a level you were on before keeps the day you first reached it, so its sessions still count
 * (Make easier / Make harder never lose progress). Logs are never touched.
 */
export function setLevel(st: any, ladder: LadderId, index: number, day: string, now: number, keep = false): void {
  const lv = (st.trainLevels ??= {})
  const cur = lv[ladder] ?? { level: index, reached: {}, at: now }
  const reached = { ...(cur.reached ?? {}) }
  if (!keep || !reached[String(index)]) reached[String(index)] = day
  lv[ladder] = { level: Math.max(0, index), reached, at: now }
}

/**
 * Make easier / Make harder: one level down or up on a ladder, at once. History stays (sets, sessions, the
 * days you reached each level); going down waits for a newer session before offering the harder move again.
 * Returns the new level index (null: already at the end of the ladder).
 */
export function shiftLevel(st: any, data: TrainData, ladder: Ladder, delta: -1 | 1, day: string, now: number): number | null {
  const cur = currentLevel(st, data, ladder, day)
  // From the step the plan really uses; only steps your gear allows count.
  const from = effectiveLevel(ladder, cur.index, data.gear).index
  const to = stepFrom(ladder, from + delta, delta, data.gear)
  if (to == null) return null
  // Placement becomes your level first, so the step is from where you were.
  keepLevel(st, ladder.id, cur.index, now)
  setLevel(st, ladder.id, to, day, now, true)
  if (delta < 0) st.trainLevels[ladder.id].declinedOn = day
  return to
}

/** "Not yet" / "Stay here": the suggestion waits until a newer session. */
export function declineLevel(st: any, ladder: LadderId, index: number, day: string, now: number): void {
  const lv = (st.trainLevels ??= {})
  lv[ladder] = { ...(lv[ladder] ?? { level: index, reached: {} }), at: now, declinedOn: day }
}

/** Shows the level-up / step-back suggestion only when a session came after your last "not yet". */
export const suggestNow = (status: LevelStatus, last: MoveSession | null, declinedOn?: string) =>
  (status.state === 'complete' || status.state === 'struggling') && (!declinedOn || (last?.day ?? '') > declinedOn)

// ---------- merging two devices (sportSync.ts) ----------

/** Two devices' training parts as one: sessions joined by id (the longer wins), the week / ladders / each level from the newer edit. */
export function mergeTrain(a: any, b: any): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (a?.trainLog || b?.trainLog) {
    const m = new Map<string, any>()
    for (const s of [...(Array.isArray(a?.trainLog) ? a.trainLog : []), ...(Array.isArray(b?.trainLog) ? b.trainLog : [])]) {
      if (!s || typeof s.id !== 'string') continue
      const old = m.get(s.id)
      const size = (x: any) => (Array.isArray(x?.exercises) ? x.exercises.reduce((n: number, e: any) => n + (Array.isArray(e?.sets) ? e.sets.length : 0), 0) : 0) + (x?.done ? 0.5 : 0)
      if (!old || size(s) > size(old)) m.set(s.id, s)
    }
    out.trainLog = [...m.values()].sort((x, y) => (Number(y.startedAt) || 0) - (Number(x.startedAt) || 0)).slice(0, 400)
  }
  const newer = (k: string, at: (v: any) => number) => {
    if (a?.[k] == null && b?.[k] == null) return
    out[k] = a?.[k] == null ? b[k] : b?.[k] == null ? a[k] : at(a[k]) >= at(b[k]) ? a[k] : b[k]
  }
  newer('trainWeek', (v) => Number(v?.updatedAt) || 0)
  newer('trainLadders', (v) => Number(v?.updatedAt) || 0)
  newer('trainLighter', (v) => Number(v?.at) || 0)
  newer('trainGear', (v) => Number(v?.at) || 0)
  newer('trainPicks', (v) => Number(v?.at) || 0)
  // Dismissed warnings: the later day per warning.
  if (a?.trainWarnDismiss || b?.trainWarnDismiss) {
    const dm: Record<string, string> = { ...(b?.trainWarnDismiss ?? {}) }
    for (const [k, v] of Object.entries<any>(a?.trainWarnDismiss ?? {})) if (!dm[k] || String(v) > dm[k]) dm[k] = String(v)
    out.trainWarnDismiss = dm
  }
  if (a?.trainLevels || b?.trainLevels) {
    const lv: Record<string, any> = { ...(b?.trainLevels ?? {}) }
    for (const [k, v] of Object.entries<any>(a?.trainLevels ?? {})) if (!lv[k] || (Number(v?.at) || 0) >= (Number(lv[k]?.at) || 0)) lv[k] = v
    out.trainLevels = lv
  }
  return out
}

