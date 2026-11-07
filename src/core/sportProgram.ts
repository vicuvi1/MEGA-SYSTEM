// A week of home workouts that fits the time you have (20, 30 or 45 minutes):
// 3 or 4 sessions (full body, or upper / lower with 4), 3 hard sets per
// exercise, 4 to 6 exercises, rest 60–120 s, a 3-minute warm-up and an
// optional cool-down. It uses the moves you already do (your step on each
// ladder) and fills the gaps from the library. Pure and tested.
import { FAMILIES, moveById, type Move } from './sportMoves'
import { moveOf, type SportEx } from './sportLadders'
import { rangeFor } from './sportProgress'
import { mondayOf, shiftDay } from './sportSets'

export type Split = 'full' | 'upper_lower'
export type SessionKind = 'full_a' | 'full_b' | 'upper' | 'lower'

export interface ProgramPrefs {
  /** Minutes you have: 20, 30 or 45. */
  minutes: number
  /** Sessions a week: 3 or 4. */
  perWeek: number
  /** Full body, or upper / lower (only with 4 a week; 'auto' picks). */
  split?: Split | 'auto'
  /** Add a 3-minute cool-down. */
  coolDown?: boolean
}

export interface PlanItem {
  move: Move
  /** Your exercise for it (already in your routine), if any. */
  exId: string | null
  sets: number
  lo: number
  hi: number
  unit: 'reps' | 'sec'
  rest: number
  /** Done back to back with the next one (you rest after the pair). */
  pairNext?: boolean
}

export interface PlanSession {
  kind: SessionKind
  name: string
  items: PlanItem[]
  warmup: number
  cooldown: number
  /** Estimated minutes, warm-up and cool-down included. */
  minutes: number
}

export interface WeekDay {
  day: string
  /** 0 = Monday. */
  dow: number
  session: PlanSession | null
}

/** Families for each slot, the first you do wins (else the first step listed here). */
const SLOTS: Record<string, { fams: string[]; start: string[] }> = {
  push: { fams: ['pushup'], start: ['pushup'] },
  shoulders: { fams: ['pike', 'dips'], start: ['pike_pushup', 'chair_dip'] },
  pull: { fams: ['row'], start: ['table_row_bent'] },
  back: { fams: ['back'], start: ['superman'] },
  squat: { fams: ['squat'], start: ['squat'] },
  lunge: { fams: ['lunge'], start: ['reverse_lunge'] },
  hinge: { fams: ['bridge'], start: ['glute_bridge'] },
  calves: { fams: ['calf'], start: ['calf_raise'] },
  abs: { fams: ['core'], start: ['crunch'] },
  plank: { fams: ['plank', 'deadbug'], start: ['plank'] }
}

/** The slots of each session, most important first (4 to 6 are used, by the time you have). */
const SESSIONS: Record<SessionKind, { name: string; slots: string[] }> = {
  full_a: { name: 'Full body A', slots: ['push', 'squat', 'pull', 'abs', 'hinge', 'shoulders'] },
  full_b: { name: 'Full body B', slots: ['shoulders', 'lunge', 'pull', 'plank', 'push', 'back'] },
  upper: { name: 'Upper body', slots: ['push', 'pull', 'shoulders', 'back', 'abs', 'plank'] },
  lower: { name: 'Lower body', slots: ['squat', 'lunge', 'hinge', 'plank', 'calves', 'abs'] }
}

/** Training days (0 = Monday) for 3 or 4 sessions a week, with rest days between. */
export const TRAIN_DAYS: Record<number, number[]> = { 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 4, 5] }

const WARMUP_MIN = 3
const COOLDOWN_MIN = 3
/** Seconds a rep takes (about 1 s up, 2 s down). */
const REP_SEC = 3
const SWITCH_SEC = 20

/** The move for a slot: yours on that ladder (the hardest you do), else the library's start. */
function pickMove(slot: string, mine: { ex: SportEx; move: Move }[], used: Set<string>): { move: Move; exId: string | null } | null {
  const spec = SLOTS[slot]
  for (const f of spec.fams) {
    const have = mine.filter((m) => m.move.family === f && !used.has(m.move.id)).sort((a, b) => FAMILIES[f].steps.indexOf(b.move.id) - FAMILIES[f].steps.indexOf(a.move.id))[0]
    if (have) return { move: have.move, exId: String(have.ex.id) }
  }
  for (const id of spec.start) {
    const m = moveById(id)
    if (m && !used.has(m.id)) return { move: m, exId: null }
  }
  return null
}

/** Seconds of work in one set of an item (the middle of its range). */
const workSec = (it: Pick<PlanItem, 'lo' | 'hi' | 'unit'>) => {
  const mid = (it.lo + it.hi) / 2
  return it.unit === 'sec' ? mid : mid * REP_SEC
}

/** Estimated minutes for a list of items (pairs rest once per round), warm-up and cool-down included. */
export function estimateMinutes(items: PlanItem[], warmup = WARMUP_MIN, cooldown = 0): number {
  let sec = 0
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    const pair = it.pairNext && items[i + 1]
    if (pair) {
      const b = items[i + 1]
      const rounds = Math.max(it.sets, b.sets)
      sec += rounds * (workSec(it) + SWITCH_SEC + workSec(b)) + (rounds - 1) * it.rest + SWITCH_SEC * 2
      i++
    } else sec += it.sets * workSec(it) + (it.sets - 1) * it.rest + SWITCH_SEC * 2
  }
  return Math.round(sec / 60 + warmup + cooldown)
}

/** One session that fits `minutes`: as many exercises (4–6) and as much rest (60–120 s) as fit; pairs when time is short. */
export function buildSession(kind: SessionKind, exercises: SportEx[], prefs: ProgramPrefs): PlanSession {
  const mine = exercises.filter((e) => e.active !== false).map((ex) => ({ ex, move: moveOf(ex) })).filter((x): x is { ex: SportEx; move: Move } => !!x.move)
  const used = new Set<string>()
  const picks: { move: Move; exId: string | null }[] = []
  for (const slot of SESSIONS[kind].slots) {
    const p = pickMove(slot, mine, used)
    if (p) { picks.push(p); used.add(p.move.id) }
  }
  const cooldown = prefs.coolDown ? COOLDOWN_MIN : 0
  const minutes = Math.max(15, Math.min(60, prefs.minutes || 30))
  const make = (n: number, rest: number, paired: boolean): PlanItem[] =>
    picks.slice(0, n).map((p, i, arr) => {
      const r = rangeFor(p.move)
      return { move: p.move, exId: p.exId, sets: 3, lo: r.lo, hi: r.hi, unit: r.unit, rest, ...(paired && i % 2 === 0 && i + 1 < arr.length ? { pairNext: true } : {}) }
    })
  // Best first: more exercises, straight sets, longer rest.
  const tries: [number, number, boolean][] = []
  for (const n of [6, 5, 4]) for (const rest of [120, 90, 75, 60]) tries.push([n, rest, false])
  for (const n of [6, 5, 4]) for (const rest of [90, 75, 60]) tries.push([n, rest, true])
  let items = make(4, 60, true)
  for (const [n, rest, paired] of tries) {
    if (n > picks.length) continue
    const it = make(n, rest, paired)
    if (estimateMinutes(it, WARMUP_MIN, cooldown) <= minutes) { items = it; break }
  }
  return { kind, name: SESSIONS[kind].name, items, warmup: WARMUP_MIN, cooldown, minutes: estimateMinutes(items, WARMUP_MIN, cooldown) }
}

/** The split to use: upper / lower with 4 or more sessions a week unless you chose full body. */
export const splitOf = (p: ProgramPrefs): Split => (p.split === 'full' || p.split === 'upper_lower' ? (p.perWeek >= 4 ? p.split : 'full') : p.perWeek >= 4 ? 'upper_lower' : 'full')

/** This week (Monday to Sunday) with a session on the training days and rest on the others. */
export function weekPlan(exercises: SportEx[], prefs: ProgramPrefs, today: string): WeekDay[] {
  const per = Math.max(2, Math.min(5, Math.round(prefs.perWeek || 3)))
  const days = TRAIN_DAYS[per]
  const split = splitOf({ ...prefs, perWeek: per })
  // Full body alternates A / B, and the week after starts with the other one.
  const weekNo = Math.floor(Date.parse(mondayOf(today) + 'T12:00:00Z') / (7 * 86400000))
  const kinds: SessionKind[] = split === 'upper_lower' ? ['upper', 'lower'] : weekNo % 2 ? ['full_b', 'full_a'] : ['full_a', 'full_b']
  const cache = new Map<SessionKind, PlanSession>()
  const mon = mondayOf(today)
  return Array.from({ length: 7 }, (_, dow) => {
    const k = days.indexOf(dow)
    const kind = k >= 0 ? kinds[k % 2] : null
    if (kind && !cache.has(kind)) cache.set(kind, buildSession(kind, exercises, prefs))
    return { day: shiftDay(mon, dow), dow, session: kind ? cache.get(kind)! : null }
  })
}

/** Today's session, or null on a rest day. */
export function todaysSession(exercises: SportEx[], prefs: ProgramPrefs, today: string): PlanSession | null {
  return weekPlan(exercises, prefs, today).find((d) => d.day === today)?.session ?? null
}

/** Short tips for growing muscle at home (shown with the plan). */
export function growTips(weightKg?: number | null): string[] {
  const g = weightKg && weightKg >= 35 && weightKg <= 200 ? Math.round(weightKg * 1.6) : null
  return [
    g ? `Protein: about 1.6 g per kg a day (${g} g for you), spread over 3–4 meals.` : 'Protein: about 1.6 g per kg of body weight a day, spread over 3–4 meals.',
    'Go close to failure: stop each set when 1–2 more good reps would be the most you could do.',
    'Sleep 7–9 hours: muscle grows while you rest, not while you train.',
    'Same rest each time (60–120 s), and slow on the way down.'
  ]
}
