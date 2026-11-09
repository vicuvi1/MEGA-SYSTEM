// Body → Training: today's session on your levels, fast set logging, and the
// progression roadmap (level-up, step back, the "at your pace" estimate,
// placement from your best sets). Everything lives inside Sport Track's state
// so it syncs with it (sport_tracker_json):
//   trainWeek   the weekly split (trainWeek.ts)
//   trainLadders { ladders, updatedAt }: your edited ladders (trainLadders.ts)
//   trainLevels { [ladder]: { level, reached: { [level]: day }, at, declinedOn? } }
//   trainLog    the sessions: { id, date, type, exercises, startedAt, durationSec }
// Sets go to the same set log as Sport Track (sets[day][exerciseId]), with
// rir / feel / session added. Pure and tested (trainLog.test.ts). Nothing
// here pays points: a finished workout is logged like any other workout.
import { moveById } from './sportMoves'
import { moveOf } from './sportLadders'
import { atTop, belowBottom, NEED, type RepRange } from './sportProgress'
import { setsOn, setsText, type SetEntry, type SetLog } from './sportSets'
import { cleanLadders, laddersFor, moveInfo, moveName, type Ladder, type LadderId, type Level } from './trainLadders'
import { cleanWeek, daysBetween, SESSION_RULES, type DoneSession, type SessionType, type TrainWeek } from './trainWeek'

export type Feel = 'hard' | 'ok' | 'easy'
/** Reps in reserve for an effort tap: hard 0–1, ok 2–3, easy 4+. */
export const RIR: Record<Feel, number> = { hard: 1, ok: 2, easy: 4 }
export const feelToRir = (f: Feel) => RIR[f]

export interface TrainSet {
  reps: number
  kg?: number
  feel?: Feel
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

export interface TrainData {
  week: TrainWeek
  ladders: Ladder[]
  levels: Levels
  log: TrainSession[]
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
    log: Array.isArray(st?.trainLog) ? st.trainLog.filter((s: any) => s && typeof s.id === 'string' && typeof s.date === 'string' && Array.isArray(s.exercises)) : []
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

/** Working sets per move in a session: the first move of the day gets 4, the others 3. */
export const setsFor = (index: number, type: SessionType) => (type === 'upper' && index === 0 ? 4 : 3)

const rangeOf = (v: Level, sets: number): RepRange => ({ lo: v.lo, hi: v.hi, sets, unit: v.unit })

export interface LevelStatus {
  state: 'new' | 'building' | 'complete' | 'struggling'
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

/**
 * Where you stand on a level, from the sessions since you reached it. Complete: every working set at
 * the top of the range in 2 sessions in a row (Sport Track's rule, sportProgress.ts). Struggling: the
 * bottom of the range not reached in the last 2 sessions on this level.
 */
export function levelStatus(sessions: MoveSession[], level: Level, sets: number, since?: string | null): LevelStatus {
  const list = since ? sessions.filter((s) => s.day >= since) : sessions
  const r = rangeOf(level, sets)
  const needSets = NEED * sets
  const u = level.unit === 'sec' ? ' s' : ''
  if (!list.length) return { state: 'new', hits: 0, need: NEED, topSets: 0, needSets, pct: 0, sessions: 0, line: `Not started: ${sets}×${level.lo}${u} to begin, ${sets}×${level.hi}${u} twice to level up.` }
  let hits = 0
  for (let i = list.length - 1; i >= 0 && atTop(list[i], r); i--) hits++
  const lastS = list[list.length - 1]
  const partial = hits ? 0 : lastS.reps.slice(0, sets).filter((x) => x >= level.hi).length
  const topSets = Math.min(needSets, hits * sets + partial)
  const base = { hits: Math.min(hits, NEED), need: NEED, topSets, needSets, pct: topSets / needSets, sessions: list.length }
  if (hits >= NEED) return { ...base, state: 'complete', line: `Level complete: ${sets}×${level.hi}${u} in ${NEED} sessions in a row.` }
  const lastTwo = list.slice(-2)
  if (lastTwo.length === 2 && lastTwo.every((s) => belowBottom(s, r))) return { ...base, state: 'struggling', line: `Under ${level.lo}${u} twice. Stay here a bit longer, or go one level back.` }
  return { ...base, state: 'building', line: hits ? `1 of ${NEED} sessions at the top. One more and this level is done.` : `${topSets} of ${needSets} sets at the top (${level.hi}${u}).` }
}

/** Your level on a ladder: what you chose, else placement from your best sets. */
export function currentLevel(st: any, data: TrainData, ladder: Ladder): { index: number; placed: boolean; since: string | null } {
  const s = data.levels[ladder.id]
  if (s) {
    const index = Math.min(ladder.levels.length - 1, s.level)
    return { index, placed: false, since: s.reached[String(index)] ?? null }
  }
  return { index: placeLadder(ladder, (m) => bestOf(st, m)), placed: true, since: null }
}

/** Your best single set of a move: logged sets of it, or a best set you told Sport Track. */
export function bestOf(st: any, move: string): number | null {
  let best = 0
  for (const s of moveSessions(st, move)) for (const r of s.reps) best = Math.max(best, r)
  for (const b of Object.values<any>(st?.bestSets ?? {})) if (b && b.move === move) best = Math.max(best, Number(b.reps) || 0)
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
}

/** Today's moves for a session type, each on your current level. */
export function sessionItems(st: any, data: TrainData, type: SessionType, today: string): PlanItem[] {
  return laddersFor(data.ladders, type).map((ladder, i) => {
    const cur = currentLevel(st, data, ladder)
    const level = ladder.levels[cur.index]
    const sets = setsFor(i, type)
    const all = moveSessions(st, level.move, today)
    const last = lastTime(all, today)
    return {
      ladder,
      index: cur.index,
      level,
      name: moveName(level.move),
      sets,
      placed: cur.placed,
      since: cur.since,
      last,
      latest: all[all.length - 1] ?? null,
      lastLine: lastLine(last, level, sets),
      status: levelStatus(all, level, sets, cur.since),
      next: ladder.levels[cur.index + 1] ?? null
    }
  })
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
      .map((s) => ({ reps: s.reps, ...(s.kg ? { kg: s.kg } : {}), ...(s.feel ? { feel: s.feel } : {}) }))
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

/** Keeps the level a session was done at (placement becomes your level the first time you train it). */
export function keepLevel(st: any, ladder: LadderId, index: number, now: number): void {
  const lv = (st.trainLevels ??= {})
  if (!lv[ladder]) lv[ladder] = { level: index, reached: {}, at: now }
}

/** Moves your level on a ladder (up after a level-up, back after struggling, or any level you tap). */
export function setLevel(st: any, ladder: LadderId, index: number, day: string, now: number): void {
  const lv = (st.trainLevels ??= {})
  const cur = lv[ladder] ?? { level: index, reached: {}, at: now }
  lv[ladder] = { level: Math.max(0, index), reached: { ...(cur.reached ?? {}), [String(index)]: day }, at: now }
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

