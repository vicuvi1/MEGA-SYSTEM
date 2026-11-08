// The home program builder (Body → Training). From the minutes you have
// (20 / 30 / 45), days a week (3 / 4 / 5), what you own and a focus, it builds
// a 4-week block: weeks 1–3 build, week 4 is lighter. Every move sits on YOUR
// current level of its ladder (placement from your real logs, sportLevels.ts),
// with sets × a rep range (strength 5–8 or size 8–15 by move), rest, a warm-up
// and an estimate that fits the time. "Use this program" turns it into a
// Sport Track program (state.program, read by todayRoutine), so Today shows
// that day's session. Pure, deterministic and tested; nothing here pays points.
import { FAMILIES, moveById, type Group, type Move } from './sportMoves'
import { moveOf, type SportEx } from './sportLadders'
import { placeFamily, trackOf, type HistoryInput } from './sportLevels'
import { TRAIN_DAYS, estimateMinutes, type PlanItem } from './sportProgram'
import { mondayOf, shiftDay } from './sportSets'

const dowOf = (day: string) => (new Date(day + 'T12:00:00Z').getUTCDay() + 6) % 7
import { sessionFor, type Program } from './sportPrograms'

export type Equip = 'bar' | 'bands' | 'dumbbells' | 'load' | 'chair'
export type Focus = 'balanced' | 'upper' | 'legs'

export interface HomePrefs {
  minutes: 20 | 30 | 45
  days: 3 | 4 | 5
  /** What you own. Empty: nothing at all (the floor and a door). */
  equip: Equip[]
  focus: Focus
}

export const EQUIPMENT: { id: Equip; label: string }[] = [
  { id: 'bar', label: 'Pull-up bar' },
  { id: 'bands', label: 'Bands' },
  { id: 'dumbbells', label: 'Dumbbells' },
  { id: 'load', label: 'Backpack / load' },
  { id: 'chair', label: 'Chair / table' }
]

export const DEFAULT_PREFS: HomePrefs = { minutes: 30, days: 3, equip: ['chair'], focus: 'balanced' }

/** Any stored value into valid prefs. */
export function cleanPrefs(x: unknown): HomePrefs {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
  const minutes = [20, 30, 45].includes(Number(o.minutes)) ? (Number(o.minutes) as HomePrefs['minutes']) : DEFAULT_PREFS.minutes
  const days = [3, 4, 5].includes(Number(o.days)) ? (Number(o.days) as HomePrefs['days']) : DEFAULT_PREFS.days
  const ids = EQUIPMENT.map((e) => e.id)
  const equip = Array.isArray(o.equip) ? ids.filter((id) => (o.equip as unknown[]).includes(id)) : [...DEFAULT_PREFS.equip]
  const focus = o.focus === 'upper' || o.focus === 'legs' ? o.focus : 'balanced'
  return { minutes, days, equip, focus }
}

/** A move in a program: one from the library (with a demo in Sport Track) or one that needs equipment. */
export interface HomeMove {
  id: string
  name: string
  group: Group
  unit: 'reps' | 'sec'
  /** The library ladder it is on (null for an equipment move). */
  family: string | null
  lib: boolean
  how?: string
}

/** Library moves that need a chair, a table or a bench. */
const NEEDS_CHAIR = new Set(['chair_dip', 'bulgarian_squat', 'box_pistol', 'decline_pushup', 'elevated_pike', 'table_row_bent', 'table_row', 'feet_row', 'onearm_row'])

/** Moves that need equipment the library does not have (no demo, plain how-to line). */
const EXTRA: Record<string, HomeMove & { needs: Equip }> = {
  neg_pullup: { id: 'neg_pullup', name: 'Slow negative pull-ups', group: 'pull', unit: 'reps', family: null, lib: false, needs: 'bar', how: 'Jump or step to the top, then lower for 4–5 seconds.' },
  chinup: { id: 'chinup', name: 'Chin-ups', group: 'pull', unit: 'reps', family: null, lib: false, needs: 'bar', how: 'Palms facing you, chin over the bar, all the way down each rep.' },
  pullup: { id: 'pullup', name: 'Pull-ups', group: 'pull', unit: 'reps', family: null, lib: false, needs: 'bar', how: 'Palms away, chest to the bar, all the way down each rep.' },
  db_row: { id: 'db_row', name: 'One-arm dumbbell rows', group: 'pull', unit: 'reps', family: null, lib: false, needs: 'dumbbells', how: 'Hand and knee on a bench or chair, pull the dumbbell to your hip.' },
  pack_row: { id: 'pack_row', name: 'Backpack rows', group: 'pull', unit: 'reps', family: null, lib: false, needs: 'load', how: 'Hinge forward, flat back, pull the loaded backpack to your belly.' },
  band_row: { id: 'band_row', name: 'Band rows', group: 'pull', unit: 'reps', family: null, lib: false, needs: 'bands', how: 'Band around a door handle or your feet, pull elbows back, squeeze.' },
  band_pullapart: { id: 'band_pullapart', name: 'Band pull-aparts', group: 'pull', unit: 'reps', family: null, lib: false, needs: 'bands', how: 'Arms straight in front, pull the band apart to your chest.' },
  db_rdl: { id: 'db_rdl', name: 'Dumbbell Romanian deadlifts', group: 'legs', unit: 'reps', family: null, lib: false, needs: 'dumbbells', how: 'Soft knees, push the hips back, dumbbells close to the legs.' }
}

export type ItemKind = 'strength' | 'size' | 'hold'

export interface HomeItem {
  move: HomeMove
  sets: number
  lo: number
  hi: number
  unit: 'reps' | 'sec'
  rest: number
  kind: ItemKind
  /** Your level on that ladder; `start` when nothing is logged yet (an easy start). */
  level: { n: number; of: number; name: string; start: boolean } | null
  /** "Hold the dumbbells", "Wear the loaded backpack". */
  note?: string
  /** Done back to back with the next one (rest after the pair). */
  pairNext?: boolean
}

export interface HomeSession {
  id: string
  name: string
  items: HomeItem[]
  /** Estimated minutes, warm-up included. */
  minutes: number
}

export interface HomeWeek {
  n: 1 | 2 | 3 | 4
  light: boolean
  title: string
  aim: string
  sessions: HomeSession[]
}

export interface HomeProgram {
  prefs: HomePrefs
  /** Training weekdays, 0 = Monday. */
  days: number[]
  /** Session ids in order; they repeat over the training days. */
  rotation: string[]
  warmup: { minutes: number; steps: string[] }
  weeks: HomeWeek[]
  rules: string[]
}

type SessionKind = 'full_a' | 'full_b' | 'upper' | 'lower'
type SlotId = 'push' | 'squat' | 'pull' | 'hinge' | 'core' | 'shoulders' | 'lunge' | 'plank' | 'back' | 'dips' | 'calves'

const SESSIONS: Record<SessionKind, { name: string; slots: SlotId[] }> = {
  full_a: { name: 'Full body A', slots: ['push', 'squat', 'pull', 'hinge', 'core', 'shoulders', 'calves'] },
  full_b: { name: 'Full body B', slots: ['pull', 'lunge', 'shoulders', 'push', 'plank', 'back', 'dips'] },
  upper: { name: 'Upper body', slots: ['push', 'pull', 'shoulders', 'back', 'dips', 'core', 'plank'] },
  lower: { name: 'Lower body', slots: ['squat', 'hinge', 'lunge', 'calves', 'plank', 'core'] }
}
const UPPER: SlotId[] = ['push', 'pull', 'shoulders', 'dips', 'back']
const LEGS: SlotId[] = ['squat', 'lunge', 'hinge', 'calves']
const SPLITS: Record<number, SessionKind[]> = { 3: ['full_a', 'full_b'], 4: ['upper', 'lower'], 5: ['upper', 'lower', 'full_a', 'upper', 'lower'] }
const ROTATION: Record<number, string[]> = { 3: ['full_a', 'full_b'], 4: ['upper', 'lower'], 5: ['upper', 'lower', 'full_a', 'upper', 'lower'] }
/** Jumping moves are cardio, not strength: the program skips them. */
const JUMPY = new Set(['jump_squat', 'jump_lunge'])
/** Families where a hard move is trained for strength (5–8). */
const MAIN = new Set(['pushup', 'squat', 'row', 'pike'])
const WARMUP: Record<number, number> = { 20: 3, 30: 4, 45: 5 }

const lib = (m: Move): HomeMove => ({ id: m.id, name: m.name, group: m.group, unit: m.unit, family: m.family, lib: true })

interface Ctx {
  history: HistoryInput
  equip: Set<Equip>
}

/** Your level on a family's track (0: nothing logged). */
const placed = (ctx: Ctx, family: string) => placeFamily(ctx.history, family)?.level ?? 0

const allowed = (ctx: Ctx, id: string) => !NEEDS_CHAIR.has(id) || ctx.equip.has('chair')

/** Range for a move at a level: strength 5–8 (a hard move of a main ladder, 10 reps or fewer at your level), size 8–15, or a hold. */
function rangeAt(family: string, move: Move, reps: number): { kind: ItemKind; lo: number; hi: number } {
  if (move.unit === 'sec') return { kind: 'hold', lo: Math.max(15, reps - 10), hi: reps + 15 }
  if (MAIN.has(family) && move.diff >= 3 && reps <= 10) return { kind: 'strength', lo: 5, hi: 8 }
  return { kind: 'size', lo: 8, hi: 15 }
}

/** The move for a library ladder: your level's move (one harder step when the level is far over the range), within your equipment. */
function ladderItem(ctx: Ctx, family: string): Omit<HomeItem, 'sets' | 'rest'> | null {
  const track = trackOf(family)
  if (!track) return null
  const lvls = track.levels
  const got = placed(ctx, family)
  const start = got === 0
  let i = Math.min(lvls.length, start ? 3 : got) - 1
  // Far more reps than the range, or a jumping move: the first level of the next harder (not jumping) move.
  if ((lvls[i].reps > 15 && moveById(lvls[i].move)?.unit === 'reps') || JUMPY.has(lvls[i].move)) {
    const j = lvls.findIndex((l, k) => k > i && l.move !== lvls[i].move && !JUMPY.has(l.move))
    if (j > 0) i = j
  }
  // Equipment you don't have: the nearest level below whose move you can do, else above.
  if (!allowed(ctx, lvls[i].move)) {
    let k = i
    while (k >= 0 && !allowed(ctx, lvls[k].move)) k--
    if (k < 0) {
      k = i
      while (k < lvls.length && !allowed(ctx, lvls[k].move)) k++
    }
    if (k < 0 || k >= lvls.length) return null
    i = k
  }
  const lv = lvls[i]
  const move = moveById(lv.move)
  if (!move) return null
  const r = rangeAt(family, move, lv.reps)
  return { move: lib(move), lo: r.lo, hi: r.hi, unit: move.unit, kind: r.kind, level: { n: lv.n, of: lvls.length, name: lv.name, start } }
}

const extraItem = (id: keyof typeof EXTRA, kind: ItemKind = 'strength'): Omit<HomeItem, 'sets' | 'rest'> => {
  const { needs: _n, ...move } = EXTRA[id]
  return { move, lo: kind === 'strength' ? 5 : 8, hi: kind === 'strength' ? 8 : 15, unit: 'reps', kind, level: null }
}

/** One slot's item within your equipment (null: skip this slot). */
function slotItem(ctx: Ctx, slot: SlotId): Omit<HomeItem, 'sets' | 'rest'> | null {
  const e = ctx.equip
  const load = e.has('dumbbells') ? 'Hold the dumbbells' : e.has('load') ? 'Wear the loaded backpack' : undefined
  switch (slot) {
    case 'push':
      return ladderItem(ctx, 'pushup')
    case 'squat': {
      const it = ladderItem(ctx, 'squat')
      return it && load && it.move.id !== 'jump_squat' ? { ...it, note: load } : it
    }
    case 'lunge': {
      const it = ladderItem(ctx, 'lunge')
      return it && load && it.move.id !== 'jump_lunge' ? { ...it, note: load } : it
    }
    case 'pull': {
      if (e.has('bar')) {
        const row = placed(ctx, 'row')
        return extraItem(row >= 10 ? 'pullup' : row >= 7 ? 'chinup' : 'neg_pullup')
      }
      if (e.has('chair')) return ladderItem(ctx, 'row')
      if (e.has('dumbbells')) return extraItem('db_row')
      if (e.has('load')) return extraItem('pack_row')
      if (e.has('bands')) return extraItem('band_row', 'size')
      return ladderItem(ctx, 'row') // door rows need nothing
    }
    case 'back':
      return e.has('bands') ? extraItem('band_pullapart', 'size') : ladderItem(ctx, 'back')
    case 'hinge':
      if (e.has('dumbbells')) return extraItem('db_rdl', 'size')
      return ladderItem(ctx, 'bridge')
    case 'shoulders':
      return ladderItem(ctx, 'pike')
    case 'dips':
      return e.has('chair') ? ladderItem(ctx, 'dips') : null
    case 'core':
      return ladderItem(ctx, 'core')
    case 'plank':
      return ladderItem(ctx, 'plank')
    case 'calves':
      return ladderItem(ctx, 'calf')
  }
}

const restOf = (kind: ItemKind, scale: number) => Math.round(((kind === 'strength' ? 150 : kind === 'size' ? 90 : 60) * scale) / 15) * 15

/** Minutes for items (the same estimate Sport Track's plan uses), warm-up included. */
export const minutesOf = (items: HomeItem[], warmup: number) => estimateMinutes(items as unknown as PlanItem[], warmup)

/** The order of slots for a session with your focus (the focus first, the rest after). */
function slotsFor(kind: SessionKind, focus: Focus): SlotId[] {
  const s = SESSIONS[kind].slots
  if (focus === 'balanced') return s
  const pick = focus === 'upper' ? UPPER : LEGS
  return [...s.filter((x) => pick.includes(x)), ...s.filter((x) => !pick.includes(x))]
}

/** Week 3 adds a set to the first two moves; week 4 takes one off everything. */
const setsInWeek = (base: number, i: number, week: number) => (week === 4 ? Math.max(2, base - 1) : week === 3 && i < 2 ? base + 1 : base)

/** One session in its four weekly versions, fitted so the hardest week (week 3) stays inside your minutes. */
function buildSession(id: string, kind: SessionKind, ctx: Ctx, prefs: HomePrefs): HomeSession[] {
  const warm = WARMUP[prefs.minutes]
  const picks: { slot: SlotId; it: Omit<HomeItem, 'sets' | 'rest'> }[] = []
  const used = new Set<string>()
  for (const slot of slotsFor(kind, prefs.focus)) {
    const it = slotItem(ctx, slot)
    if (it && !used.has(it.move.id)) {
      picks.push({ slot, it })
      used.add(it.move.id)
    }
  }
  const focusSlots = prefs.focus === 'upper' ? UPPER : prefs.focus === 'legs' ? LEGS : []
  const baseSets = (p: (typeof picks)[number]) => (p.it.kind === 'strength' && prefs.minutes >= 30 ? 4 : 3) + (focusSlots.includes(p.slot) && prefs.minutes >= 30 ? 1 : 0)
  const make = (n: number, scale: number, paired: boolean, week: number): HomeItem[] =>
    picks.slice(0, n).map((p, i, arr) => ({
      ...p.it,
      sets: setsInWeek(Math.min(5, baseSets(p)), i, week),
      rest: restOf(p.it.kind, scale),
      ...(paired && i % 2 === 0 && i + 1 < arr.length ? { pairNext: true } : {})
    }))
  // Best first: more moves; for each, full rest, shorter rest, then pairs (rest after both moves).
  const tries: [number, number, boolean][] = []
  for (const n of [7, 6, 5, 4, 3]) tries.push([n, 1, false], [n, 0.75, false], [n, 0.75, true], [n, 0.6, true])
  let pick: [number, number, boolean] = [Math.min(3, picks.length), 0.6, true]
  for (const t of tries) {
    if (t[0] > picks.length) continue
    if (minutesOf(make(t[0], t[1], t[2], 3), warm) <= prefs.minutes) {
      pick = t
      break
    }
  }
  return [1, 2, 3, 4].map((w) => {
    const items = make(pick[0], pick[1], pick[2], w)
    return { id, name: SESSIONS[kind].name, items, minutes: minutesOf(items, warm) }
  })
}

const WEEK_TEXT: Record<number, { title: string; aim: string }> = {
  1: { title: 'Week 1 · Build', aim: 'Start at the bottom of each range. Stop each set 2 reps before you would fail.' },
  2: { title: 'Week 2 · Build', aim: 'Same moves: add 1–2 reps to each set.' },
  3: { title: 'Week 3 · Build', aim: 'One more set on the first two moves. Aim for the top of the range.' },
  4: { title: 'Week 4 · Lighter', aim: 'One set less on everything, stop 3 reps short. You recover and come back stronger.' }
}

export const RULES = [
  'Hit the top of the range in all sets → next time, the next harder variation (at the bottom of its range).',
  'Under the bottom of the range twice → step back one variation.',
  'Stop each set 1–2 reps before failure, and lower slowly (about 2–3 seconds).',
  'Rest the full time between sets: strength 2–2.5 min, size about 1.5 min, holds 1 min.',
  'Week 4 is lighter on purpose. Then start a new block with your new levels.'
]

/**
 * The 4-week block. `history` is your Sport Track log (exercises, days, sets, best sets, imported days):
 * placement puts each move on your current level. Same input, same program.
 */
export function buildHomeProgram(input: HomePrefs, history: HistoryInput): HomeProgram {
  const prefs = cleanPrefs(input)
  const ctx: Ctx = { history, equip: new Set(prefs.equip) }
  const kinds = SPLITS[prefs.days]
  const ids = ROTATION[prefs.days]
  const cache = new Map<SessionKind, HomeSession[]>()
  const perSession = kinds.map((k, i) => {
    if (!cache.has(k)) cache.set(k, buildSession(ids[i], k, ctx, prefs))
    return cache.get(k)!.map((s) => ({ ...s, id: ids[i] }))
  })
  // The first item of the first session warms up with an easy set.
  const first = perSession[0][0].items[0]
  const warmup = {
    minutes: WARMUP[prefs.minutes],
    steps: ['Arm circles, 30 s each way', 'Cat-cow, 6 slow', "World's greatest stretch, 3 a side", first ? `1 easy set of the first move (half the reps)` : 'An easy set of the first move']
  }
  const weeks: HomeWeek[] = [1, 2, 3, 4].map((n) => ({
    n: n as HomeWeek['n'],
    light: n === 4,
    title: WEEK_TEXT[n].title,
    aim: WEEK_TEXT[n].aim,
    sessions: perSession.map((s) => s[n - 1]).filter((s, i, arr) => arr.findIndex((x) => x.id === s.id) === i)
  }))
  return { prefs, days: TRAIN_DAYS[prefs.days], rotation: ids, warmup, weeks, rules: RULES }
}

/** The week of the block (1–4) for a day; the block repeats after week 4. */
export function blockWeek(startedOn: string, today: string): 1 | 2 | 3 | 4 {
  const w = Math.floor((Date.parse(mondayOf(today) + 'T12:00:00Z') - Date.parse(mondayOf(startedOn) + 'T12:00:00Z')) / (7 * 86400000))
  return ((((w % 4) + 4) % 4) + 1) as 1 | 2 | 3 | 4
}

/** Blocks finished since the start (0 in the first 4 weeks). */
export const blocksDone = (startedOn: string, today: string) =>
  Math.max(0, Math.floor((Date.parse(mondayOf(today) + 'T12:00:00Z') - Date.parse(mondayOf(startedOn) + 'T12:00:00Z')) / (28 * 86400000)))

/**
 * The same program in Sport Track's format, so Today (todayRoutine) shows the right session each day.
 * The rotation is turned so your first training day gets the first session.
 */
export function toTrackerProgram(p: HomeProgram, startedOn?: string): Program {
  const w = p.weeks[0]
  let rotation = p.rotation
  if (startedOn && p.days.length) {
    // The first training day on or after the start gets the first session.
    let k = 0
    while (k < 7 && !p.days.includes(dowOf(shiftDay(startedOn, k)))) k++
    const first = shiftDay(startedOn, k)
    const week = Math.floor(Date.parse(mondayOf(first) + 'T12:00:00Z') / (7 * 86400000))
    const R = rotation.length
    const n = (((week * p.days.length + p.days.indexOf(dowOf(first))) % R) + R) % R
    rotation = rotation.map((_, j) => p.rotation[(j - n + R) % R])
  }
  return {
    id: 'home',
    name: `Home program, ${p.prefs.days}× a week`,
    tagline: `${p.prefs.minutes} minutes a session, built on the Body page.`,
    perWeek: p.prefs.days,
    minutes: p.prefs.minutes,
    days: p.days,
    rotation,
    sessions: w.sessions.map((s) => ({ id: s.id, name: s.name, slots: s.items.map((it) => ({ family: it.move.family ?? it.move.id, sets: it.sets, reps: it.lo, rest: it.rest })) }))
  }
}

/** The session (in the right week's version) on a day, or null on a rest day. */
export function sessionOn(p: HomeProgram, startedOn: string, day: string): { week: HomeWeek; session: HomeSession } | null {
  const s = sessionFor(toTrackerProgram(p, startedOn), day)
  if (!s) return null
  const week = p.weeks[blockWeek(startedOn, day) - 1]
  const session = week.sessions.find((x) => x.id === s.id)
  return session ? { week, session } : null
}

type Ex = SportEx & { prog?: string; progSession?: string[]; progOff?: boolean; homeOwn?: boolean; homeTarget?: number; doneToday?: number; move?: string; unit?: string }

const exMoveId = (e: Ex) => moveOf(e)?.id ?? null
const same = (e: Ex, m: HomeMove) => (m.lib ? exMoveId(e) === m.id : String(e.name).toLowerCase() === m.name.toLowerCase())

/**
 * Puts the program on Sport Track's routine for one week of the block: each move is one exercise
 * (yours when you already have that move, so its history continues), tagged with the sessions it is in,
 * its daily target = sets × the bottom of the range. Your other exercises are turned off, never deleted,
 * and come back with stopHomeProgram.
 */
export function applyHomeProgram(exercises: Ex[], p: HomeProgram, week: number, today: string): Ex[] {
  const list: Ex[] = exercises.map((e) => ({ ...e }))
  const stamp = today.replace(/-/g, '')
  const w = p.weeks[Math.max(1, Math.min(4, week)) - 1]
  const keep = new Set<Ex>()
  for (const sess of w.sessions) {
    for (const it of sess.items) {
      const target = it.sets * it.lo
      let ex = list.find((e) => e.prog === 'home' && same(e, it.move)) ?? list.find((e) => !e.prog && e.active !== false && same(e, it.move)) ?? list.find((e) => !e.prog && same(e, it.move))
      if (!ex) {
        ex = { id: `ex_h_${it.move.id}_${stamp}`, name: it.move.name, target, unit: it.unit, active: true, doneToday: 0, ...(it.move.lib ? { move: it.move.id } : {}), prog: 'home' }
        list.push(ex)
      } else if (ex.prog !== 'home') {
        ex.prog = 'home'
        ex.homeOwn = true
        ex.homeTarget = ex.target
        delete ex.progOff
      }
      const again = keep.has(ex)
      ex.active = true
      ex.progSession = again ? [...new Set([...(ex.progSession ?? []), sess.id])] : [sess.id]
      ex.target = again ? Math.max(Number(ex.target) || 0, target) : target
      keep.add(ex)
    }
  }
  for (const e of list) {
    if (keep.has(e)) continue
    if (e.prog === 'home') {
      // A move the new program dropped: yours goes back to waiting (off), a program-made one goes off.
      if (e.homeOwn) {
        if (e.homeTarget != null) e.target = e.homeTarget
        e.progOff = true
        delete e.homeOwn
        delete e.homeTarget
      }
      e.active = false
      delete e.prog
      delete e.progSession
    } else if (e.prog) {
      // Another program's exercise (a switch).
      e.active = false
      delete e.progSession
    } else if (e.active !== false) {
      e.active = false
      e.progOff = true
    }
  }
  return list
}

/** Stops the program: your own exercises come back with their old targets; the program's go off (history stays). */
export function stopHomeProgram(exercises: Ex[]): Ex[] {
  return exercises.map((e) => {
    const x = { ...e }
    if (x.prog === 'home') {
      x.active = !!x.homeOwn
      if (x.homeOwn && x.homeTarget != null) x.target = x.homeTarget
      delete x.prog
      delete x.progSession
      delete x.homeOwn
      delete x.homeTarget
    }
    if (x.progOff) {
      x.active = true
      delete x.progOff
    }
    return x
  })
}

/** The families placed for the program, for the "Your levels" line. */
export function programLevels(p: HomeProgram): { name: string; move: string; level: HomeItem['level'] }[] {
  const seen = new Map<string, { name: string; move: string; level: HomeItem['level'] }>()
  for (const s of p.weeks[0].sessions) for (const it of s.items) if (it.move.family && !seen.has(it.move.family)) seen.set(it.move.family, { name: FAMILIES[it.move.family]?.name ?? it.move.family, move: it.move.name, level: it.level })
  return [...seen.values()]
}
