// Ready-made home programs (full body 3×/week, Push/Pull/Legs 4×/week, an abs
// finisher), a balanced-routine checker and a deload-week suggestion. Picking a
// program adds its exercises to your routine; your own exercises stay unless you
// confirm "replace" (they are only turned off, never deleted, and come back when
// you stop the program). Moves are picked from YOUR level on each ladder. Pure
// and tested; nothing here pays points.
import { FAMILIES, moveById, type Move } from './sportMoves'
import { moveOf, type SportEx } from './sportLadders'
import { MUSCLES, WEEKLY_SETS, hardSetsByMuscle, mondayOf, shiftDay, weeklyVolume, type Muscle, type SetLog } from './sportSets'
import { trackOf, type HistoryInput, type Placement } from './sportLevels'

export interface Slot {
  /** Ladder family the move comes from (your level picks the step). */
  family: string
  sets: number
  /** Reps (or seconds) per set when you have no level yet. */
  reps: number
  rest: number
}
export interface ProgSession {
  id: string
  name: string
  slots: Slot[]
}
export interface Program {
  id: string
  name: string
  tagline: string
  perWeek: number
  minutes: number
  /** Weekdays (0 = Monday) that are training days, in order. */
  days: number[]
  /** Session ids in order; they repeat across the training days. */
  rotation: string[]
  sessions: ProgSession[]
  /** Added to every day (a finisher): shown on every day of the week. */
  daily?: boolean
}

const S = (family: string, sets = 3, reps = 10, rest = 75): Slot => ({ family, sets, reps, rest })

export const PROGRAMS: Program[] = [
  {
    id: 'fullbody3',
    name: 'Beginner full body, 3× a week',
    tagline: 'Mon · Wed · Fri, about 30 minutes. Two workouts that take turns, so every muscle gets 3 hard days a week.',
    perWeek: 3,
    minutes: 30,
    days: [0, 2, 4],
    rotation: ['a', 'b'],
    sessions: [
      { id: 'a', name: 'Workout A', slots: [S('squat', 3, 12), S('pushup', 3, 8), S('row', 3, 8), S('plank', 3, 30, 60), S('bridge', 3, 12)] },
      { id: 'b', name: 'Workout B', slots: [S('lunge', 3, 10), S('pike', 3, 6), S('back', 3, 10), S('core', 3, 12, 60), S('calf', 3, 15, 45)] }
    ]
  },
  {
    id: 'ppl4',
    name: 'Push / Pull / Legs, 4× a week',
    tagline: 'Mon push · Tue pull · Thu legs · Fri upper + core, about 40 minutes. For when 3 days feels easy.',
    perWeek: 4,
    minutes: 40,
    days: [0, 1, 3, 4],
    rotation: ['push', 'pull', 'legs', 'upper'],
    sessions: [
      { id: 'push', name: 'Push day', slots: [S('pushup', 4, 10), S('pike', 3, 8), S('dips', 3, 10), S('plank', 3, 30, 60)] },
      { id: 'pull', name: 'Pull day', slots: [S('row', 4, 10), S('back', 3, 12), S('core', 3, 12, 60), S('dips', 2, 8)] },
      { id: 'legs', name: 'Legs day', slots: [S('squat', 4, 15), S('lunge', 3, 12), S('bridge', 3, 15), S('calf', 3, 20, 45)] },
      { id: 'upper', name: 'Upper + core day', slots: [S('pushup', 3, 10), S('row', 3, 10), S('pike', 2, 8), S('core', 3, 12, 60), S('plank', 2, 30, 60)] }
    ]
  },
  {
    id: 'core',
    name: 'Abs + core finisher',
    tagline: 'Every day, 6–8 minutes after your normal workout. Add it on top of any program.',
    perWeek: 7,
    minutes: 8,
    days: [0, 1, 2, 3, 4, 5, 6],
    rotation: ['finisher'],
    daily: true,
    sessions: [{ id: 'finisher', name: 'Core finisher', slots: [S('core', 3, 12, 45), S('plank', 3, 30, 45), S('deadbug', 2, 10, 45)] }]
  }
]

export const programById = (id: string | null | undefined) => PROGRAMS.find((p) => p.id === id) ?? null

/** Which session a program has on a day (null: a rest day for the program). The two-workout rotation continues week by week. */
export function sessionFor(program: Program, day: string): ProgSession | null {
  const dow = (new Date(day + 'T12:00:00Z').getUTCDay() + 6) % 7
  const i = program.days.indexOf(dow)
  if (i < 0) return null
  const week = Math.floor(Date.parse(mondayOf(day) + 'T12:00:00Z') / (7 * 86400000))
  const n = (week * program.days.length + i) % program.rotation.length
  return program.sessions.find((s) => s.id === program.rotation[n]) ?? null
}

/** The move for a slot: the one you already do in that family (if on), else your level's move, else a gentle start (level 3). */
export function slotMove(slot: Slot, exercises: SportEx[], places: Placement[]): { move: Move; reps: number } {
  const track = trackOf(slot.family)
  const mine = exercises.filter((e) => e.active !== false).map((e) => moveOf(e)).find((m) => m && m.family === slot.family)
  const place = places.find((p) => p.family === slot.family)
  const lv = place?.lv ?? track?.levels[Math.min(2, (track?.levels.length ?? 1) - 1)] ?? null
  const move = mine ?? moveById(lv?.move) ?? moveById(FAMILIES[slot.family]?.steps[0])!
  const onMove = track?.levels.filter((l) => l.move === move.id) ?? []
  const here = onMove.filter((l) => !place || l.n <= place.level).pop() ?? onMove[0]
  // Start about 2 reps under the level so the first session feels good.
  const reps = place?.lv && here ? Math.max(3, here.reps - 2) : slot.reps
  return { move, reps }
}

export interface ProgramState {
  id: string
  startedOn: string
  /** Your own exercises were turned off for it. */
  replaced?: boolean
}

type Ex = SportEx & { prog?: string; progSession?: string[]; progOff?: boolean; doneToday?: number; plan?: boolean; move?: string }

/**
 * Picks a program. Adds its exercises (new ones are tagged with the program and the sessions they belong to);
 * an exercise of yours that is the same move is shared. With `replace`, your other active exercises are turned
 * off (not deleted) until you stop the program.
 */
export function applyProgram(exercises: Ex[], program: Program, places: Placement[], opts: { replace?: boolean; today: string }): { exercises: Ex[]; added: string[] } {
  const list: Ex[] = exercises.map((e) => ({ ...e }))
  const added: string[] = []
  const stamp = opts.today.replace(/-/g, '')
  // A switch from another program first.
  for (const e of list) if (e.prog && e.prog !== program.id) { e.active = false; delete e.progSession }
  for (const sess of program.sessions) {
    for (const slot of sess.slots) {
      const { move, reps } = slotMove(slot, list, places)
      let ex = list.find((e) => e.active !== false && !e.prog && moveOf(e)?.id === move.id)
      if (ex) continue // yours stays as it is (and shows every day)
      ex = list.find((e) => e.prog === program.id && moveOf(e)?.id === move.id)
      if (ex) {
        ex.active = true
        ex.progSession = [...new Set([...(ex.progSession ?? []), sess.id])]
        continue
      }
      ex = { id: `ex_p_${program.id}_${move.id}_${stamp}`, name: move.name, target: slot.sets * reps, unit: move.unit, active: true, doneToday: 0, move: move.id, prog: program.id, progSession: [sess.id] }
      list.push(ex)
      added.push(move.name)
    }
  }
  if (opts.replace) for (const e of list) if (!e.prog && e.active !== false) { e.active = false; e.progOff = true }
  return { exercises: list, added }
}

/** Stops the program: its exercises go off (their history stays) and the ones it turned off come back. */
export function stopProgram(exercises: Ex[]): Ex[] {
  return exercises.map((e) => {
    const x = { ...e }
    if (x.prog) { x.active = false; delete x.progSession; delete x.prog }
    if (x.progOff) { x.active = true; delete x.progOff }
    return x
  })
}

/**
 * What Today shows: your own active exercises, plus the program's exercises that belong to today's session.
 * Never empty: on a rest day of a program that replaced your routine, your own (turned off) exercises show as an easy option.
 */
export function todayRoutine<T extends Ex>(exercises: T[], program: ProgramState | null | undefined, day: string): { list: T[]; restDay: boolean; session: ProgSession | null } {
  const prog = program ? programById(program.id) : null
  const session = prog ? sessionFor(prog, day) : null
  const mine = exercises.filter((e) => e.active !== false && (!e.prog || (prog && e.prog === prog.id && (!!session && (e.progSession ?? []).includes(session.id)))))
  const extra = prog && prog.daily ? exercises.filter((e) => e.active !== false && e.prog === prog.id && !mine.includes(e)) : []
  const list = [...mine, ...extra]
  if (list.length) return { list, restDay: !!prog && !session, session }
  const off = exercises.filter((e) => e.progOff)
  if (off.length) return { list: off, restDay: true, session }
  const any = exercises.filter((e) => !e.plan && !e.prog)
  return { list: any.length ? any : exercises.slice(0, 3), restDay: !!prog && !session, session }
}

// ---------------------------------------------------------------- the balanced-routine checker

export interface Balance {
  kind: 'missing' | 'under' | 'over'
  muscle: Muscle
  text: string
}

const NAMES: Record<Muscle, string> = { push: 'Push', pull: 'Pull', core: 'Core', legs: 'Legs' }

/**
 * Warns when a muscle group is missing from your routine, has no work yet this week (from Thursday on), or is over-trained
 * (more than 20 hard sets in a week, or twice as much as the group you train least).
 */
export function balanceCheck(input: { exercises: SportEx[]; sets: SetLog | null | undefined; today: string }): Balance[] {
  const out: Balance[] = []
  const active = input.exercises.filter((e) => e.active !== false)
  const inRoutine = new Set<Muscle>()
  for (const e of active) {
    const g = moveOf(e)?.group
    if (g === 'push' || g === 'pull' || g === 'core' || g === 'legs') inRoutine.add(g)
  }
  const mon = mondayOf(input.today)
  const hard = hardSetsByMuscle(input.sets, input.exercises, mon, input.today)
  const dow = (new Date(input.today + 'T12:00:00Z').getUTCDay() + 6) % 7
  for (const m of MUSCLES) {
    if (!inRoutine.has(m.id)) out.push({ kind: 'missing', muscle: m.id, text: `No ${NAMES[m.id].toLowerCase()} exercise in your routine. Add one so nothing gets left behind.` })
    else if (dow >= 3 && hard[m.id] === 0) out.push({ kind: 'under', muscle: m.id, text: `No ${NAMES[m.id].toLowerCase()} work yet this week. A short set today keeps the balance.` })
  }
  const trained = MUSCLES.map((m) => hard[m.id]).filter((n) => n > 0)
  const least = trained.length > 1 ? Math.min(...trained) : 0
  for (const m of MUSCLES) {
    if (hard[m.id] > WEEKLY_SETS.hi || (least > 0 && hard[m.id] >= 8 && hard[m.id] >= least * 2.5)) out.push({ kind: 'over', muscle: m.id, text: `${NAMES[m.id]} has ${hard[m.id]} hard sets this week${hard[m.id] > WEEKLY_SETS.hi ? ` (over ${WEEKLY_SETS.hi})` : ' (much more than the rest)'}. Ease off and give it 48 hours.` })
  }
  return out
}

// ---------------------------------------------------------------- the deload week

export interface Deload {
  state: 'none' | 'suggest' | 'overdue' | 'active'
  /** Weeks of training in a row since the last easy week. */
  weeks: number
  text: string
  /** What an easy week means. */
  plan: string
}

const PLAN = 'One easy week: one set less on every move, stop 3 reps before it gets hard, and no record attempts. Then you come back stronger.'

/**
 * After 4–6 weeks of steady training with progress, suggest one lighter week. `lastDeload` is the Monday of your last easy
 * week; `until` the last day of an easy week that is running now.
 */
export function deloadAdvice(input: HistoryInput & { lastDeload?: string | null; until?: string | null }): Deload {
  if (input.until && input.until >= input.today) return { state: 'active', weeks: 0, text: `Easy week until ${input.until}: lighter sets, same days. Enjoy it.`, plan: PLAN }
  const vol = weeklyVolume(input.days, null, input.today, 9)
  // Complete weeks only (drop the current one), newest last.
  const weeks = vol.slice(0, -1)
  let run = 0
  for (let i = weeks.length - 1; i >= 0; i--) {
    const w = weeks[i]
    if (input.lastDeload && w.monday <= input.lastDeload) break
    if (w.total <= 0) break
    run++
  }
  let progress = 0
  const last = weeks.slice(weeks.length - run)
  last.forEach((w, i) => { if (i === 0 || w.total >= last[i - 1].total * 0.95) progress++ })
  if (run >= 6) return { state: 'overdue', weeks: run, text: `${run} weeks of training in a row. An easy week now is the smartest move: it keeps you growing.`, plan: PLAN }
  if (run >= 4 && progress >= 3) return { state: 'suggest', weeks: run, text: `${run} weeks of steady progress. Time for one lighter week to recover and keep growing.`, plan: PLAN }
  return { state: 'none', weeks: run, text: run ? `${run} ${run === 1 ? 'week' : 'weeks'} in a row. An easy week will make sense after 4–6.` : 'Train 4 weeks in a row and I will tell you when an easy week makes sense.', plan: PLAN }
}

/** An easy week that starts today and lasts 7 days. */
export function deloadWeek(today: string): { from: string; to: string } {
  return { from: today, to: shiftDay(today, 6) }
}
