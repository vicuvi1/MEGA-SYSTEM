// Sets in Sport Track: what you did in one go (reps, or seconds for a hold).
// The sport state keeps them per day and exercise (`sets[day][exerciseId]`),
// next to the day's total (`days[day][exerciseId]`). Days logged as totals
// only (older days, "+ a number", "Done") count as volume, never as a
// one-set best. Pure and tested; the page uses these through sportkit.js.
import { moveOf, type SportEx, type DayLog } from './sportLadders'
import type { Group } from './sportMoves'

export interface SetEntry {
  /** Reps, or seconds for a hold. */
  reps: number
  kg?: number
  /** When it was logged (ms), and an id so two devices' sets merge without doubles. */
  at?: number
  id?: string
}
/** { 'YYYY-MM-DD': { exerciseId: [sets] } } */
export type SetLog = Record<string, Record<string, SetEntry[]>>

export type Muscle = 'push' | 'pull' | 'core' | 'legs'
export const MUSCLES: { id: Muscle; name: string; short: string }[] = [
  { id: 'push', name: 'Chest, shoulders, triceps', short: 'Push' },
  { id: 'pull', name: 'Back and biceps', short: 'Pull' },
  { id: 'core', name: 'Core', short: 'Core' },
  { id: 'legs', name: 'Legs and glutes', short: 'Legs' }
]
/** Hard sets a week per muscle group that grow muscle (about 10 to 20). */
export const WEEKLY_SETS = { lo: 10, hi: 20 }

/** Which muscle group a library group trains (cardio and stretches: none). */
export const muscleOf = (g: Group | undefined | null): Muscle | null => (g === 'push' || g === 'pull' || g === 'core' || g === 'legs' ? g : null)

const clean = (n: unknown) => Math.max(0, Math.min(2000, Math.round(Number(n) || 0)))

/** The sets of one exercise on one day (a copy, only real ones). */
export function setsOn(log: SetLog | null | undefined, day: string, exId: string): SetEntry[] {
  const l = log?.[day]?.[exId]
  return Array.isArray(l) ? l.filter((s) => s && clean(s.reps) > 0) : []
}

/** A set to store: whole numbers, an id and a time. */
export function makeSet(reps: number, now = Date.now(), kg = 0, salt = ''): SetEntry {
  const s: SetEntry = { reps: clean(reps), at: now, id: `${now.toString(36)}${salt || Math.random().toString(36).slice(2, 6)}` }
  if (kg > 0) s.kg = Math.round(kg * 2) / 2
  return s
}

/** Adds sets to a log (a new log; the old one is not changed). */
export function addSets(log: SetLog | null | undefined, day: string, exId: string, reps: number[], now = Date.now()): SetLog {
  const out: SetLog = JSON.parse(JSON.stringify(log ?? {}))
  const list = (out[day] ??= {})[exId] ?? []
  reps.map(clean).filter((r) => r > 0).forEach((r, i) => list.push(makeSet(r, now + i, 0, `${i}${exId.length}`)))
  if (list.length) out[day][exId] = list
  return out
}

/**
 * Two devices' set logs as one: per day and exercise, sets with an id are
 * joined (each once); lists without ids keep the longer one.
 */
export function mergeSets(a: SetLog | null | undefined, b: SetLog | null | undefined): SetLog {
  const out: SetLog = {}
  for (const day of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
    const A = a?.[day] ?? {}
    const B = b?.[day] ?? {}
    for (const ex of new Set([...Object.keys(A), ...Object.keys(B)])) {
      const x = Array.isArray(A[ex]) ? A[ex] : []
      const y = Array.isArray(B[ex]) ? B[ex] : []
      let list: SetEntry[]
      if (x.every((s) => s?.id) && y.every((s) => s?.id)) {
        const seen = new Map<string, SetEntry>()
        for (const s of [...x, ...y]) if (!seen.has(s.id!)) seen.set(s.id!, s)
        list = [...seen.values()].sort((p, q) => (Number(p.at) || 0) - (Number(q.at) || 0))
      } else list = x.length >= y.length ? x : y
      if (list.length) (out[day] ??= {})[ex] = list
    }
  }
  return out
}

/** One session: a day you logged sets of this exercise. */
export interface Session {
  day: string
  reps: number[]
}

/** The days with sets of an exercise, oldest first (only up to `until`, if given). */
export function sessionsOf(log: SetLog | null | undefined, exId: string, until?: string): Session[] {
  return Object.keys(log ?? {})
    .filter((d) => !until || d <= until)
    .sort()
    .map((day) => ({ day, reps: setsOn(log, day, exId).map((s) => clean(s.reps)) }))
    .filter((s) => s.reps.length > 0)
}

/** Your best single set of an exercise (reps or seconds), and the day; null without sets. */
export function bestSet(log: SetLog | null | undefined, exId: string, until?: string): { reps: number; day: string } | null {
  let best: { reps: number; day: string } | null = null
  for (const s of sessionsOf(log, exId, until)) for (const r of s.reps) if (!best || r > best.reps) best = { reps: r, day: s.day }
  return best
}

/** Monday of the week a day is in. */
export function mondayOf(day: string): string {
  const d = new Date(day + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}
export function shiftDay(day: string, n: number): string {
  const d = new Date(day + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * A hard set: one close to what you can do that day, at least 5 reps (or
 * 15 seconds) and at least 70% of the day's best set of that exercise.
 * (A warm-up or a few easy extra reps don't count.)
 */
export function hardSets(reps: number[], unit: string = 'reps'): number {
  const top = Math.max(0, ...reps)
  const min = unit === 'sec' ? 15 : 5
  return reps.filter((r) => r >= min && r >= top * 0.7).length
}

/** Hard sets per muscle group from `from` to `to` (inclusive). */
export function hardSetsByMuscle(log: SetLog | null | undefined, exercises: SportEx[], from: string, to: string): Record<Muscle, number> {
  const out: Record<Muscle, number> = { push: 0, pull: 0, core: 0, legs: 0 }
  const byId = new Map(exercises.map((e) => [String(e.id), e]))
  for (const [day, m] of Object.entries(log ?? {})) {
    if (day < from || day > to) continue
    for (const id of Object.keys(m ?? {})) {
      const ex = byId.get(id)
      const mv = ex ? moveOf(ex) : null
      const mu = muscleOf(mv?.group)
      if (!mu) continue
      out[mu] += hardSets(setsOn(log, day, id).map((s) => s.reps), mv?.unit ?? ex?.unit)
    }
  }
  return out
}

/** Reps (or seconds) per week, the last `weeks` weeks up to `today`, oldest first: from the day totals, so old days count too. */
export function weeklyVolume(days: DayLog | null | undefined, exIds: string[] | null, today: string, weeks = 8): { monday: string; total: number }[] {
  const ids = exIds ? new Set(exIds.map(String)) : null
  const mon = mondayOf(today)
  return Array.from({ length: weeks }, (_, k) => {
    const monday = shiftDay(mon, -7 * (weeks - 1 - k))
    let total = 0
    for (let d = 0; d < 7; d++) for (const [id, v] of Object.entries(days?.[shiftDay(monday, d)] ?? {})) if (!ids || ids.has(id)) total += Number(v) || 0
    return { monday, total }
  })
}

/**
 * Sets from what was already saved, for days that have none yet: sessions
 * logged with sets (history items) and records ("15 in one set"). Day totals
 * are never turned into sets: they stay volume only.
 */
export function importSets(st: { sets?: SetLog; history?: any[]; best?: Record<string, { label?: string; day?: string }>; exercises?: SportEx[] }): SetLog {
  let out: SetLog = JSON.parse(JSON.stringify(st.sets ?? {}))
  for (const h of Array.isArray(st.history) ? st.history : []) {
    const day = typeof h?.day === 'string' ? h.day : null
    if (!day || !Array.isArray(h.items)) continue
    for (const it of h.items) {
      const id = String(it?.exerciseId ?? '')
      if (!id || !Array.isArray(it.sets) || !it.sets.length || setsOn(out, day, id).length) continue
      const reps = it.sets.map((x: any) => clean(x?.reps)).filter((r: number) => r > 0)
      if (reps.length) out = addSets(out, day, id, reps, Number(h.id) > 1e12 ? Number(h.id) : Date.parse(day + 'T12:00:00Z'))
    }
  }
  for (const [id, b] of Object.entries(st.best ?? {})) {
    const m = /^(\d+)\s*s?\s+in one set$/.exec(String(b?.label ?? ''))
    const day = b?.day
    if (!m || !day || setsOn(out, day, id).length) continue
    out = addSets(out, day, id, [Number(m[1])], Date.parse(day + 'T12:00:00Z'))
  }
  return out
}

export interface ParsedSets {
  /** The exercise as typed ("push-ups"). */
  name: string
  reps: number[]
  unit: 'reps' | 'sec'
}

/**
 * Sets in a message: "3x15 push-ups", "push-ups 3×15", "push-ups 15 14 12",
 * "pushups 15, 14, 12", "15 14 12 squats", "plank 3x45s", "plank 60s 45s".
 * One number alone ("50 pushups") is a total, not sets: null.
 */
export function parseSets(text: string): ParsedSets | null {
  const t = String(text ?? '').trim().replace(/^\//, '').replace(/[×*]/g, 'x').replace(/\s+/g, ' ')
  if (!t || t.length > 80) return null
  const name = (s: string) => s.replace(/[:,.\-–]+$/, '').replace(/^[:,.\-–]+/, '').trim()
  const isName = (s: string) => /^[a-zA-ZÀ-ž][a-zA-ZÀ-ž' _-]{1,40}$/.test(s.trim())
  // "3x15 push-ups" / "push-ups 3x15" / "3 x 45s plank"
  const nx = /^(\d{1,2})\s?x\s?(\d{1,3})\s?(s|sec|secs|seconds)?\s+(.+)$/i.exec(t) ?? null
  const xn = /^(.+?)\s+(\d{1,2})\s?x\s?(\d{1,3})\s?(s|sec|secs|seconds)?$/i.exec(t) ?? null
  if (nx && isName(nx[4])) {
    const n = Number(nx[1]), r = Number(nx[2])
    if (n >= 1 && n <= 12 && r >= 1) return { name: name(nx[4]), reps: Array(n).fill(r), unit: nx[3] ? 'sec' : 'reps' }
  }
  if (xn && isName(xn[1])) {
    const n = Number(xn[2]), r = Number(xn[3])
    if (n >= 1 && n <= 12 && r >= 1) return { name: name(xn[1]), reps: Array(n).fill(r), unit: xn[4] ? 'sec' : 'reps' }
  }
  // "push-ups 15 14 12" / "15, 14, 12 squats" / "plank 60s 45s"
  const nums = String.raw`((?:\d{1,3}\s?(?:s|sec)?\s?[,;/ ]\s?)+\d{1,3}\s?(?:s|sec)?)`
  const after = new RegExp(String.raw`^(.+?)[: ]+${nums}$`, 'i').exec(t)
  const before = new RegExp(String.raw`^${nums}\s+(.+)$`, 'i').exec(t)
  const pick = after && isName(after[1]) ? { n: after[1], list: after[2] } : before && isName(before[2]) ? { n: before[2], list: before[1] } : null
  if (!pick) return null
  const parts = pick.list.split(/[,;/ ]+/).filter(Boolean)
  const vals: number[] = []
  let sec = false
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (/^(s|sec)$/i.test(p)) { sec = true; continue }
    const m = /^(\d{1,3})(s|sec)?$/i.exec(p)
    if (!m) return null
    if (m[2]) sec = true
    vals.push(Number(m[1]))
  }
  if (vals.length < 2 || vals.length > 12 || vals.some((v) => v < 1)) return null
  return { name: name(pick.n), reps: vals, unit: sec ? 'sec' : 'reps' }
}

/** "15 · 14 · 12" or "3 × 15" for a list of sets (with "s" for holds). */
export function setsText(reps: number[], unit: string = 'reps'): string {
  const u = unit === 'sec' ? ' s' : ''
  if (!reps.length) return ''
  if (reps.length > 1 && reps.every((r) => r === reps[0])) return `${reps.length} × ${reps[0]}${u}`
  return reps.join(' · ') + u
}
